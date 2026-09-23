/**
 * L2 â€” the save/checkpoint coordinator (ARCH Â§31.3â€“31.5, Â§40 `gameplay/`).
 *
 * Owns the *write and load protocols*; the L1 codec owns the format and the
 * L4 storage owns the bytes. This is the module that keeps Â§31.4's rule â€”
 * saves happen on **events outside the sim loop** (puzzle completed, part
 * collected, checkpoint marked), never per frame, never mid-manipulation: the
 * composition root calls `save()` from exactly those triggers.
 *
 * Write protocol (Â§31.3, crash-safe): capture â†’ encode â†’ `writePending` â†’
 * verify readback â†’ `promote`. A failure at any point leaves the slot's
 * previous valid save untouched and is reported typed (EC-SAVE-01/04/12).
 *
 * Load protocol (Â§31.5): newest **valid** entry across both slots (EC-SAVE-08)
 * â†’ decode (typed refusal: empty/malformed/schema/version) â†’ `apply()` with
 * reconcile (EC-SAVE-09/10) â†’ every repair reported in `loadLog`. There is no
 * code path that silently loads partial data.
 */

import type { StorageEntry, StoragePort, SaveSlotId } from '../ports/storage-port.ts';
import {
  SaveCodec,
  poseOfSaved,
  savedPoseOf,
  type Attachment,
  type SaveCaptureInput,
  type SaveFile,
  type SaveLoadNote
} from '../game-state/save-codec.ts';
import type { Pose } from '../game-state/component-model.ts';
import type { CheckpointSystem } from '../game-state/checkpoint-system.ts';
import type { InventorySystem } from '../game-state/inventory-system.ts';
import type { RewardLedger } from '../game-state/reward-ledger.ts';
import type { MachineGraph } from '../game-state/machine-graph.ts';
import type { ProgressionSystem } from '../game-state/progression-system.ts';

/** One component's persisted pose record, provided by the pose owner (L2/L4). */
export interface ComponentRecordInput {
  readonly canonicalPose: Pose;
  readonly lastValidPose: Pose;
  readonly inInventory: boolean;
}

/**
 * The world-side view the coordinator needs at capture time. Poses come from
 * the L2 SM â€” a held object is recorded at its `lastValidPose`, never "in
 * hand" (EC-SAVE-02) â€” and the socketâ†’machine mapping comes from socket data.
 */
export interface SaveWorldView {
  /** Elapsed play seconds (meta only). */
  readonly playtimeSec: () => number;
  readonly componentRecordOf: (componentId: string) => ComponentRecordInput | null;
  /** Which machine a socket belongs to (socket definition `machineId`). */
  readonly machineOfSocket: (socketId: string) => string | null;
  /** The registry's definition id for a component instance (capture identity). */
  readonly defIdOf: (componentId: string) => string | null;
}

/**
 * One component's persisted pose, offered to the *pose owner* after a load.
 *
 * Poses belong to the L2 manipulation SM (ARCH §12.1), which is neither an L1 owner nor
 * something the codec may reach: so the coordinator — which is allowed to touch both —
 * passes them across this seam once, after `apply()` has rebuilt the graph.
 */
export interface RestoredPose {
  readonly componentId: string;
  /** The last committed pose (EC-SAVE-02: a held part was saved at this one). */
  readonly pose: Pose;
  /** True when the restored graph says the part is mounted, so its socket places it. */
  readonly attached: boolean;
  /** True when the part lives in the inventory and is not in the world at all. */
  readonly inInventory: boolean;
}

/** A puzzle as the save layer sees it (load rebuilds through `restore`). */
export interface PuzzleSaveTarget {
  readonly puzzleId: string;
  readonly state: () => string;
  /** Canonical restore (Â§31.5): state only â€” the ledger was reconciled first. */
  readonly restore: (state: string) => void;
  /** §25 start state for a New Game (defaults to `InProgress`). */
  readonly initialState?: (() => string) | undefined;
}

export type SaveWriteResult =
  | { readonly ok: true; readonly slot: SaveSlotId }
  | { readonly ok: false; readonly slot: SaveSlotId; readonly failure: string };

export type SaveLoadResult =
  | { readonly ok: true; readonly slot: SaveSlotId; readonly notes: ReadonlyArray<SaveLoadNote> }
  | { readonly ok: false; readonly reason: string; readonly detail: string };

export interface SaveSystemDeps {
  readonly ledger: RewardLedger;
  readonly inventory: InventorySystem;
  readonly checkpoint: CheckpointSystem;
  readonly graph: MachineGraph;
  /** §12.2 progression owner: the clue set is captured, restored and reset here. */
  readonly progression: ProgressionSystem;
  readonly puzzles: ReadonlyArray<PuzzleSaveTarget>;
  readonly puzzleDefinitions: ReadonlyArray<{ readonly id: string; readonly milestoneId: string }>;
  /** Every component id the level knows â€” capture set + EC-SAVE-06 reference set. */
  readonly knownComponentIds: ReadonlyArray<string>;
  /**
   * Optional load-time pose handover (§31.5, M9). Called with every component the save
   * carried, *after* the graph has been rebuilt, so the handler can place only the loose
   * ones and let the mounted ones follow their socket. Absent means poses are ignored —
   * which is exactly what a headless load (tests, tools) wants.
   */
  readonly restorePoses?: ((poses: ReadonlyArray<RestoredPose>) => void) | undefined;
  /**
   * The §12.2 action history (ADR-018): captured on every save and restored on every
   * load, right between the graph and the puzzles (see `saveTargets`). The seam is
   * synchronous on purpose — a staged save that loads without its priming would demand
   * the player repeat actions they already performed.
   */
  readonly actions: {
    readonly snapshot: () => ReadonlyArray<string>;
    readonly restore: (ids: ReadonlyArray<string>) => void;
  };
  /**
   * The §12.2/§29.2 `HintState` owner (M10): per-puzzle ladder levels, captured on
   * every save and restored on every load, after progression. Optional — a headless
   * load (tests, tools) can compose without a ladder, exactly as with poses.
   */
  readonly hints?:
    | {
        readonly snapshot: () => Readonly<Record<string, number>>;
        readonly restore: (levels: Readonly<Record<string, number>>) => void;
      }
    | undefined;
}


export class SaveSystem {
  private readonly codec: SaveCodec;
  private playtimeOffsetSec = 0;

  constructor(
    private readonly storage: StoragePort,
    private readonly deps: SaveSystemDeps
  ) {
    this.codec = new SaveCodec(deps.puzzleDefinitions, deps.knownComponentIds);
  }

  /** True when the storage backend is reachable (boot may warn / disable Continue). */
  get storageAvailable(): boolean {
    return this.storage.isAvailable();
  }

  /** Accumulate elapsed time (the composition root adds real dt; pauses excluded). */
  addPlaytime(seconds: number): void {
    if (Number.isFinite(seconds) && seconds > 0) this.playtimeOffsetSec += seconds;
  }

  get playtimeSec(): number {
    return this.playtimeOffsetSec;
  }

  /** Decode + integrity repairs from the most recent load (empty before one). */
  get loadLog(): ReadonlyArray<SaveLoadNote> {
    return this.codec.loadLog;
  }

  /**
   * Capture the canonical DTO from the L1 owners and write it through the
   * crash-safe two-phase protocol. `world` supplies the L2/L4-owned pose and
   * socketâ†’machine views; everything canonical is read from L1 here.
   */
  save(
    slot: SaveSlotId,
    savedAt: number,
    world: SaveWorldView,
    componentIds: ReadonlyArray<string>
  ): SaveWriteResult {
    const components: Array<SaveCaptureInput['components'][number]> = [];
    for (const componentId of componentIds) {
      const record = world.componentRecordOf(componentId);
      const defId = world.defIdOf(componentId) ?? 'unknown';
      if (record !== null) {
        components.push({
          componentId,
          defId,
          canonicalPose: savedPoseOf(record.canonicalPose),
          lastValidPose: savedPoseOf(record.lastValidPose),
          inInventory: record.inInventory
        });
      } else {
        // Not pose-observable (e.g. a fixed component with no L2 mirror):
        // persist identity only, at an identity pose.
        components.push({
          componentId,
          defId,
          canonicalPose: ZERO_POSE,
          lastValidPose: ZERO_POSE,
          inInventory: false
        });
      }
    }

    const byMachine = new Map<string, Attachment[]>();
    for (const attachment of this.deps.graph.attachments) {
      const machineId = world.machineOfSocket(attachment.socketId);
      if (machineId === null) continue;
      const edges = byMachine.get(machineId) ?? [];
      edges.push({ componentId: attachment.componentId, socketId: attachment.socketId });
      byMachine.set(machineId, edges);
    }
    const machineEdges: Array<SaveCaptureInput['machineEdges'][number]> = [];
    for (const machineId of [...byMachine.keys()].sort()) {
      const edges = byMachine.get(machineId);
      if (edges) machineEdges.push({ machineId, edges });
    }

    const puzzles = this.deps.puzzles.map((puzzle) => ({
      puzzleId: puzzle.puzzleId,
      state: puzzle.state()
    }));

    const save = this.codec.capture({
      savedAt,
      playtimeSec: world.playtimeSec(),
      slot,
      ledger: { grantedIds: this.deps.ledger.grantedIds },
      inventory: {
        partIds: this.deps.inventory.partIds,
        materialCounts: this.deps.inventory.materialCounts,
        blueprintIds: this.deps.inventory.blueprintIds
      },
      checkpoint: this.deps.checkpoint.snapshot,
      puzzles,
      machineEdges,
      components,
      // §12.2 action history (ADR-018): staged progress is player progress, so every
      // save — autosave and checkpoint alike — carries the log. See the codec for why
      // the v1 migration is a pure widening.
      actions: this.deps.actions.snapshot(),
      // §29.2 HintState (M10): hint levels are player progress too — a reload must
      // not hand back a ladder the session already climbed or decayed.
      hintLevels: this.deps.hints?.snapshot(),
      // §12.2: progression's one canonical field. Branch state and the hub stage are
      // not captured — they re-derive from the puzzle states on load.
      storyClues: this.deps.progression.discoveredClueIds
    });

    return this.write(slot, save);
  }

  /** The Â§31.3 protocol: pending â†’ verify readback â†’ promote (typed failures). */
  write(slot: SaveSlotId, save: SaveFileLike): SaveWriteResult {
    const payload = this.codec.encode(save);
    const pending = this.storage.writePending(slot, payload, save.meta.savedAt);
    if (!pending.ok) {
      return { ok: false, slot, failure: `${pending.failure.code}: ${pending.failure.detail}` };
    }
    // Readback verification (Â§31.3): the staged bytes must be exactly what we
    // wrote before promotion is allowed.
    if (!this.storage.verifyPending(slot, payload)) {
      return { ok: false, slot, failure: 'WriteFailed: readback verification failed' };
    }
    const promoted = this.storage.promote(slot);
    if (!promoted.ok) {
      return { ok: false, slot, failure: `${promoted.failure.code}: ${promoted.failure.detail}` };
    }
    return { ok: true, slot };
  }


  /** Both slots' metadata, for menus ("Continue", slot pick â€” EC-SAVE-08). */
  entries(): ReadonlyArray<StorageEntry | null> {
    return [this.storage.read('autosave'), this.storage.read('checkpoint')];
  }

  /**
   * Newest **valid** entry across both slots wins (EC-SAVE-08); a slot whose
   * payload fails to decode is skipped, not fatal â€” the other slot still loads.
   */
  load(): SaveLoadResult {
    const candidates: Array<{ slot: SaveSlotId; payload: string; savedAt: number }> = [];
    for (const slot of ['checkpoint', 'autosave'] as const) {
      const entry = this.storage.read(slot);
      if (entry !== null && entry.payload !== null) {
        candidates.push({ slot, payload: entry.payload, savedAt: entry.savedAt });
      }
    }
    candidates.sort((a, b) => b.savedAt - a.savedAt);

    let lastFailure = 'no valid save in either slot';
    for (const candidate of candidates) {
      const decoded = this.codec.decode(candidate.payload);
      if (!decoded.ok) {
        lastFailure = `${decoded.reason}: ${decoded.detail}`;
        continue;
      }
      // Playtime resumes from the save's value.
      this.playtimeOffsetSec = decoded.save.meta.playtimeSec;
      const notes = this.codec.apply(decoded.save, saveTargets(this.deps));
      // Poses are handed over last, and only after `apply()` rebuilt the graph: the
      // `attached` flag the handler reads is the *restored* edge set, not the boot one.
      this.deps.restorePoses?.(restoredPoses(decoded.save, this.deps.graph));
      return { ok: true, slot: candidate.slot, notes };
    }
    return { ok: false, reason: 'SaveLoadFailed', detail: lastFailure };
  }

  /** New Game (Â§31.6): canonical state resets, storage cleared, never wiped silently. */
  newGame(): void {
    this.deps.ledger.resetAll();
    this.deps.inventory.resetAll();
    this.deps.checkpoint.resetAll();
    this.deps.graph.reset([]);
    this.deps.progression.resetAll();
    // ADR-018: staged progress is player progress, so a New Game clears the log with
    // everything else — a fresh dynamo has no priming to remember.
    this.deps.actions.restore([]);
    // M10: the ladder is player progress too — New Game returns every puzzle to L0
    // with its counters cleared (§29.2: a separate HintState, reset with the rest).
    this.deps.hints?.restore({});
    // A New Game returns each puzzle to its §25 *start* state — which is `Locked` for
    // a gated branch, not `InProgress`. Resetting every puzzle to `InProgress` would
    // hand the player a locked branch's content.
    for (const puzzle of this.deps.puzzles) {
      puzzle.restore(puzzle.initialState?.() ?? 'InProgress');
    }
    this.playtimeOffsetSec = 0;
    this.storage.clear('autosave');
    this.storage.clear('checkpoint');
  }
}

/**
 * The saved component records, as poses for the world (one per component the save
 * carried). A component the graph no longer knows is offered with `attached: false`:
 * the pose owner's own lookup decides whether it exists, so this stays a dumb handover
 * rather than a second integrity check.
 */
function restoredPoses(save: SaveFile, graph: MachineGraph): RestoredPose[] {
  const poses: RestoredPose[] = [];
  for (const [componentId, record] of Object.entries(save.components)) {
    poses.push({
      componentId,
      pose: poseOfSaved(record.lastValidPose),
      attached: graph.attachmentOf(componentId) !== null,
      inInventory: record.inInventory
    });
  }
  return poses;
}

/** The codec's `SaveFile`, referenced without importing it into the class API twice. */
type SaveFileLike = ReturnType<SaveCodec['capture']>;

/** Flatten the deps into the codec's `SaveTargets` seam (fresh closures each load). */
function saveTargets(deps: SaveSystemDeps): Parameters<SaveCodec['apply']>[1] {
  return {
    ledger: deps.ledger,
    inventory: deps.inventory,
    checkpoint: deps.checkpoint,
    graph: deps.graph,
    puzzles: deps.puzzles.map((puzzle) => ({ puzzleId: puzzle.puzzleId, restore: puzzle.restore })),
    progression: {
      restore: (snapshot) => deps.progression.restoreClues(snapshot.clues)
    },
    // ADR-018: the staged log rebuilds after the graph and before the puzzles, so the
    // first stepped frame already has it when staged requirements evaluate.
    actions: {
      restore: (snapshot) => deps.actions.restore(snapshot.ids)
    },
    // §29.2 HintState (M10): restored last, after progression, so the ladder replaces
    // the session's levels with the file's (HintSystem.restore is a replacement).
    ...(deps.hints !== undefined
      ? { hints: { restore: (levels: Readonly<Record<string, number>>) => deps.hints?.restore(levels) } }
      : {})
  };
}

const ZERO_POSE = { center: { x: 0, y: 0, z: 0 }, yaw: 0 };


