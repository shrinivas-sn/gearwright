import { describe, expect, it } from 'vitest';

import { CheckpointSystem } from '../../src/game-state/checkpoint-system.ts';
import { ActionHistory } from '../../src/game-state/action-history.ts';
import { HintSystem } from '../../src/game-state/hint-system.ts';
import { InventorySystem } from '../../src/game-state/inventory-system.ts';
import { MachineGraph } from '../../src/game-state/machine-graph.ts';
import { PuzzleSystem } from '../../src/game-state/puzzle-system.ts';
import { ProgressionSystem } from '../../src/game-state/progression-system.ts';
import { RewardLedger } from '../../src/game-state/reward-ledger.ts';
import {
  SaveCodec,
  SAVE_SCHEMA_VERSION,
  poseOfSaved,
  savedPoseOf,
  type SaveCaptureInput,
  type SaveFile
} from '../../src/game-state/save-codec.ts';
import {
  SaveSystem,
  type PuzzleSaveTarget,
  type RestoredPose
} from '../../src/gameplay/save-system.ts';
import type { SaveSlotId, StorageEntry, StoragePort, StorageQuota, StorageResult } from '../../src/ports/storage-port.ts';
import { MILESTONE_P1_FIRST_MESH } from '../../src/data/rewards.ts';
import { BRANCH_DEFINITIONS } from '../../src/data/branches.ts';
import { HUB_STAGE_DEFINITIONS } from '../../src/data/hub-stages.ts';
import { P1_PUZZLE } from '../../src/data/puzzles/p1.ts';
import { p1Content } from './support/p1-mesh.ts';

/**
 * SAVE / LOAD (TEST_SUITE_PLAN §11, ARCH §31) — the persistence suite.
 * Round-trip fidelity, version handling, malformed data, dual-slot precedence,
 * interrupted writes and the reconcile repairs — all against the real codec,
 * a real graph and a failure-injecting fake `StoragePort` (the seam §31.3
 * exists for). The browser adapter itself is covered in `tests/dom/`.
 */

const KNOWN_IDS = ['gear-a', 'plate-a', 'shaft-a', 'shaft-b', 'frame-a', 'socket-mesh', 'socket-shaft-a', 'socket-shaft-b'];

/** Failure-injecting StoragePort (§31.3: "tests inject a fake that can fail mid-write"). */
class FakeStorage implements StoragePort {
  private readonly slots = new Map<
    SaveSlotId,
    { current: { payload: string; savedAt: number } | null; pending: { payload: string; savedAt: number } | null }
  >();
  /** Next write fails with this code (once). */
  failNextWrite: 'QuotaExceeded' | 'WriteFailed' | 'Unavailable' | null = null;
  /** Slots whose reads return corrupted bytes (per-slot corruption). */
  readonly corruptSlots = new Set<SaveSlotId>();

  private entry(slot: SaveSlotId): { current: { payload: string; savedAt: number } | null; pending: { payload: string; savedAt: number } | null } {
    let entry = this.slots.get(slot);
    if (!entry) {
      entry = { current: null, pending: null };
      this.slots.set(slot, entry);
    }
    return entry;
  }

  read(slot: SaveSlotId): StorageEntry | null {
    const entry = this.entry(slot);
    if (entry.current === null) return null;
    const payload = this.corruptSlots.has(slot) ? '!!corrupted!!' : entry.current.payload;
    return { payload, savedAt: entry.current.savedAt };
  }

  writePending(slot: SaveSlotId, payload: string, savedAt: number): StorageResult {
    if (this.failNextWrite) {
      const code = this.failNextWrite;
      this.failNextWrite = null;
      return { ok: false, failure: { code, detail: `injected ${code}` } };
    }
    this.entry(slot).pending = { payload, savedAt };
    return { ok: true };
  }

  verifyPending(slot: SaveSlotId, payload: string): boolean {
    return this.entry(slot).pending?.payload === payload;
  }

  promote(slot: SaveSlotId): StorageResult {
    const entry = this.entry(slot);
    if (entry.pending === null) {
      return { ok: false, failure: { code: 'WriteFailed', detail: 'nothing pending' } };
    }
    entry.current = { ...entry.pending };
    entry.pending = null;
    return { ok: true };
  }

  clear(slot: SaveSlotId): StorageResult {
    this.slots.delete(slot);
    return { ok: true };
  }

  isAvailable(): boolean {
    return true;
  }

  quota(): StorageQuota {
    return { remaining: null };
  }

  /** Test view: the raw promoted payload (what a real loader would parse). */
  rawPayload(slot: SaveSlotId): string | null {
    return this.entry(slot).current?.payload ?? null;
  }
}

/** A capture fixture with overridable canonical sections. */
function captureInput(overrides: Partial<SaveCaptureInput> = {}): SaveCaptureInput {
  return {
    savedAt: 5000,
    playtimeSec: 120,
    slot: 'autosave',
    ledger: { grantedIds: ['P1:milestone/p1-first-mesh'] },
    inventory: {
      partIds: ['gear-a'],
      materialCounts: { scrap: 3, brass: 1, sealant: 0, alloy: 0 },
      blueprintIds: []
    },
    checkpoint: { id: 'CP-00', anchorId: 'spawn/lab' },
    puzzles: [{ puzzleId: 'P1', state: 'Complete' }],
    machineEdges: [
      {
        machineId: 'P1-mesh',
        edges: [
          { componentId: 'shaft-a', socketId: 'socket-shaft-a' },
          { componentId: 'shaft-b', socketId: 'socket-shaft-b' },
          { componentId: 'gear-a', socketId: 'socket-mesh' }
        ]
      }
    ],
    components: [
      {
        componentId: 'gear-a',
        defId: 'gear',
        canonicalPose: { center: { x: -8, y: 1.2, z: 0 }, yaw: 0 },
        lastValidPose: { center: { x: -8, y: 1.2, z: 0 }, yaw: 0 },
        inInventory: false
      }
    ],
    ...overrides
  };
}

function codec(): SaveCodec {
  return new SaveCodec([{ id: 'P1', milestoneId: MILESTONE_P1_FIRST_MESH }], KNOWN_IDS);
}

/** Real owners + a real graph, wired the way main.ts does. */
function owners() {
  const ledger = new RewardLedger();
  const inventory = new InventorySystem();
  const checkpoint = new CheckpointSystem([{ id: 'CP-00', anchorId: 'spawn/lab' }]);
  const graph = new MachineGraph();
  const puzzles: Array<{ target: PuzzleSaveTarget; restored: Map<string, string> }> = [];
  const restored = new Map<string, string>();
  const target: PuzzleSaveTarget = {
    puzzleId: 'P1',
    state: () => restored.get('P1') ?? 'InProgress',
    restore: (state) => {
      restored.set('P1', state);
    }
  };
  puzzles.push({ target, restored });
  const progression = new ProgressionSystem(BRANCH_DEFINITIONS, HUB_STAGE_DEFINITIONS);
  return { ledger, inventory, checkpoint, graph, target, restored, progression };
}

/** Build a SaveSystem over the fake storage with the real owners. */
function system(storage: FakeStorage, restorePoses?: (poses: ReadonlyArray<RestoredPose>) => void) {
  const ownersRef = owners();
  const actions = new ActionHistory();
  const save = new SaveSystem(storage, {
    ledger: ownersRef.ledger,
    inventory: ownersRef.inventory,
    checkpoint: ownersRef.checkpoint,
    graph: ownersRef.graph,
    progression: ownersRef.progression,
    puzzles: [ownersRef.target],
    puzzleDefinitions: [{ id: 'P1', milestoneId: MILESTONE_P1_FIRST_MESH }],
    knownComponentIds: KNOWN_IDS,
    restorePoses,
    // ADR-018: the staged log rides every save/load exactly as main.ts wires it.
    actions: {
      snapshot: () => actions.actions,
      restore: (ids) => actions.restore({ actions: ids })
    }
  });
  return { ...ownersRef, actions, save };
}

// __SAVE_TESTS_PART_2__

/** Minimal §31.4 world view: gear-a is pose-observable, sockets map to P1-mesh. */
function fakeWorld() {
  return {
    playtimeSec: () => 120,
    componentRecordOf: (componentId: string) =>
      componentId === 'gear-a'
        ? {
            canonicalPose: { center: { x: -8, y: 1.2, z: 0 }, yaw: 0 },
            lastValidPose: { center: { x: -8, y: 1.2, z: 0 }, yaw: 0 },
            inInventory: false
          }
        : null,
    machineOfSocket: (socketId: string) => (socketId.startsWith('socket-') ? 'P1-mesh' : null),
    defIdOf: (componentId: string) => (KNOWN_IDS.includes(componentId) ? componentId : null)
  };
}

describe('save/load — round-trip + version + malformed data (TEST §11)', () => {
  it('decode(encode(state)) deep-equals the captured document', () => {
    const codecInstance = codec();
    const save = codecInstance.capture(captureInput());
    const decoded = codecInstance.decode(codecInstance.encode(save));
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.save).toEqual(save);
  });

  it('pose converters are exact (the codec never drifts a quantised pose)', () => {
    const pose = { center: { x: -8, y: 1.2, z: 0 }, yaw: 0.5 };
    expect(poseOfSaved(savedPoseOf(pose))).toEqual(pose);
  });

  it('empty / malformed / wrong-type payloads are refused with reason codes', () => {
    const codecInstance = codec();
    expect(codecInstance.decode('')).toMatchObject({ ok: false, reason: 'empty' });
    expect(codecInstance.decode('not json at all {')).toMatchObject({ ok: false, reason: 'malformed' });
    expect(codecInstance.decode('"just a string"')).toMatchObject({ ok: false, reason: 'schema' });
    expect(codecInstance.decode('{}')).toMatchObject({ ok: false, reason: 'schema' });
  });

  it('NaN/Infinity poses are refused (no silent JSON nulling)', () => {
    const codecInstance = codec();
    const broken = captureInput();
    const withNan = {
      ...broken,
      components: [
        {
          componentId: 'gear-a',
          defId: 'gear',
          canonicalPose: { center: { x: Number.NaN, y: 0, z: 0 }, yaw: 0 },
          lastValidPose: { center: { x: 0, y: 0, z: 0 }, yaw: 0 },
          inInventory: false
        }
      ]
    } as unknown as SaveCaptureInput;
    // capture would carry NaN through; decode is the gate that refuses it.
    expect(codecInstance.decode(JSON.stringify(withNan))).toMatchObject({ ok: false, reason: 'schema' });
    expect(() => codecInstance.encode(withNan as unknown as SaveFile)).toThrow(/non-finite/);
  });

  it('a newer schema version is refused, never partially loaded', () => {
    const codecInstance = codec();
    const future = { ...codecInstance.capture(captureInput()), version: SAVE_SCHEMA_VERSION + 1 };
    expect(codecInstance.decode(JSON.stringify(future))).toMatchObject({ ok: false, reason: 'version-unsupported' });
  });

  // TEST §11: "one migration path exercised end-to-end on a real fixture". v2's only
  // new owner is the action history (ADR-018), so the step is a pure widening: the
  // migrated v1 document deep-equals what this codec would have written for the same
  // state, with an empty log — staged progress did not exist before staged validation.
  it('a v1 save migrates forward to v2: same data, an empty action log (EC-SAVE-12)', () => {
    const codecInstance = codec();
    const v1 = { ...codecInstance.capture(captureInput()), version: 1 } as Record<string, unknown>;
    delete v1['actions'];
    const decoded = codecInstance.decode(JSON.stringify(v1));
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.save.version).toBe(SAVE_SCHEMA_VERSION);
    expect(decoded.save.actions).toEqual({ ids: [] });
    expect(decoded.save).toEqual(codecInstance.capture(captureInput()));
  });

  it('duplicate ids in reward/inventory sets are rejected before any owner is touched', () => {
    const codecInstance = codec();
    const duplicated = codecInstance.capture(captureInput({ ledger: { grantedIds: ['a:x', 'a:x'] } }));
    expect(codecInstance.decode(codecInstance.encode(duplicated))).toMatchObject({ ok: false, reason: 'duplicate-id' });
  });

  it('machine edges referencing removed ids are dropped, the rest survives (EC-SAVE-06)', () => {
    const codecInstance = codec();
    const withGhost = captureInput({
      machineEdges: [
        {
          machineId: 'P1-mesh',
          edges: [
            { componentId: 'shaft-a', socketId: 'socket-shaft-a' },
            { componentId: 'removed-part', socketId: 'socket-mesh' }
          ]
        }
      ]
    });
    const decoded = codecInstance.decode(codecInstance.encode(codecInstance.capture(withGhost)));
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    const graph = new MachineGraph();
    codecInstance.apply(decoded.save, {
      ledger: new RewardLedger(),
      inventory: new InventorySystem(),
      checkpoint: new CheckpointSystem(),
      graph,
      puzzles: []
    });
    expect(graph.attachmentOf('shaft-a')).toBe('socket-shaft-a');
    expect(graph.attachmentOf('removed-part')).toBeNull();
    expect(graph.attachmentCount).toBe(1);
    expect(codecInstance.loadLog.some((note) => note.code === 'component-ref-missing')).toBe(true);
  });
});

// __SAVE_TESTS_PART_3__

describe('save/load — the write protocol (EC-SAVE-01/04/12, §31.3)', () => {
  it('quota-exceeded write leaves the previous save intact and reports typed', () => {
    const storage = new FakeStorage();
    const { save } = system(storage);
    const world = fakeWorld();

    const good = save.save('autosave', 1000, world, ['gear-a']);
    expect(good.ok).toBe(true);

    storage.failNextWrite = 'QuotaExceeded';
    const rejected = save.save('autosave', 2000, world, ['gear-a']);
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.failure).toContain('QuotaExceeded');

    // The loader still reads the LAST GOOD save.
    const loaded = save.load();
    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      expect(loaded.slot).toBe('autosave');
      expect(save.playtimeSec).toBe(120);
    }
  });

  it('an interrupted (pending) write is invisible to the loader', () => {
    const storage = new FakeStorage();
    const { save } = system(storage);
    const world = fakeWorld();
    expect(save.save('checkpoint', 1000, world, ['gear-a']).ok).toBe(true);

    // A newer write staged as pending, then the crash: never promoted. The
    // slot's previous good save (savedAt 1000) is what the loader sees — §31.3.
    storage.writePending('checkpoint', '{"version":1}', 2000);
    const loaded = save.load();
    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      expect(loaded.slot).toBe('checkpoint');
      expect(save.playtimeSec).toBe(120);
    }
  });

  it('corrupt autosave + valid checkpoint → the newest VALID slot wins (EC-SAVE-08)', () => {
    const storage = new FakeStorage();
    const { save } = system(storage);
    const world = fakeWorld();

    expect(save.save('checkpoint', 1000, world, ['gear-a']).ok).toBe(true);
    expect(save.save('autosave', 2000, world, ['gear-a']).ok).toBe(true);
    storage.corruptSlots.add('autosave');

    const loaded = save.load();
    expect(loaded.ok).toBe(true);
    if (loaded.ok) expect(loaded.slot).toBe('checkpoint');
  });

  it('both slots invalid → typed failure with a detail, no partial load', () => {
    const storage = new FakeStorage();
    const { save } = system(storage);
    expect(save.save('autosave', 1000, fakeWorld(), ['gear-a']).ok).toBe(true);
    storage.corruptSlots.add('autosave');
    storage.corruptSlots.add('checkpoint');
    const loaded = save.load();
    expect(loaded.ok).toBe(false);
    if (!loaded.ok) expect(loaded.reason).toBe('SaveLoadFailed');
  });

  it('storage-unavailable writes fail typed and leave nothing behind', () => {
    const storage = new FakeStorage();
    storage.failNextWrite = 'Unavailable';
    const { save } = system(storage);
    const result = save.save('autosave', 1000, fakeWorld(), ['gear-a']);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure).toContain('Unavailable');
    expect(storage.rawPayload('autosave')).toBeNull();
  });
});

describe('save/load — restore through the real owners (§31.5)', () => {
  it('a full save rebuilds ledger, inventory, checkpoint, graph and puzzle state', () => {
    const storage = new FakeStorage();
    const game = system(storage);
    const world = fakeWorld();

    // State to persist: P1 complete, rewards granted, gear mounted.
    game.graph.configure(p1Content());
    game.graph.reset([
      { componentId: 'shaft-a', socketId: 'socket-shaft-a' },
      { componentId: 'shaft-b', socketId: 'socket-shaft-b' },
      { componentId: 'gear-a', socketId: 'socket-mesh' }
    ]);
    game.ledger.grant(`P1:${MILESTONE_P1_FIRST_MESH}`);
    game.inventory.addMaterial('scrap', 3);
    game.inventory.addMaterial('brass', 1);
    game.inventory.unlockBlueprint('blueprint/scanner');

    expect(game.save.save('checkpoint', 1000, world, KNOWN_IDS).ok).toBe(true);

    // Wipe everything (a fresh boot).
    game.ledger.resetAll();
    game.inventory.resetAll();
    game.graph.reset([]);

    const loaded = game.save.load();
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;

    expect(game.ledger.has(`P1:${MILESTONE_P1_FIRST_MESH}`)).toBe(true);
    expect(game.inventory.materialCount('scrap')).toBe(3);
    expect(game.inventory.materialCount('brass')).toBe(1);
    expect(game.inventory.hasBlueprint('blueprint/scanner')).toBe(true);
    expect(game.graph.attachmentOf('gear-a')).toBe('socket-mesh');
    expect(game.checkpoint.currentId).toBe('CP-00');
    // The fixture granted the reward while the puzzle was still InProgress — a
    // real desync, and the ledger is authoritative (EC-SAVE-09): the load
    // repairs P1 to Complete and reports exactly that one note.
    expect(game.save.loadLog.map((note) => note.code)).toEqual(['ledger-reconciled-puzzle']);
    expect(game.restored.get('P1')).toBe('Complete');
  });

  it('reconciliation notes are reported, never silent (EC-SAVE-09/10 through the system)', () => {
    const storage = new FakeStorage();
    const game = system(storage);
    // Hand-write a desynced save: puzzle Complete, no reward row.
    const codecInstance = codec();
    const desynced = codecInstance.capture(captureInput({ ledger: { grantedIds: [] } }));
    storage.writePending('checkpoint', codecInstance.encode(desynced), 1000);
    storage.promote('checkpoint');

    const loaded = game.save.load();
    expect(loaded.ok).toBe(true);
    expect(game.ledger.has(`P1:${MILESTONE_P1_FIRST_MESH}`)).toBe(true);
    expect(game.save.loadLog.some((note) => note.code === 'ledger-confirmed-from-milestone')).toBe(true);
  });

  it('newGame resets canonical state and clears storage', () => {
    const storage = new FakeStorage();
    const game = system(storage);
    game.ledger.grant('P1:milestone/p1-first-mesh');
    game.inventory.addMaterial('scrap', 3);
    expect(game.save.save('autosave', 1000, fakeWorld(), ['gear-a']).ok).toBe(true);

    game.save.newGame();
    expect(game.ledger.size).toBe(0);
    expect(game.inventory.materialCount('scrap')).toBe(0);
    expect(game.graph.attachmentCount).toBe(0);
    expect(storage.rawPayload('autosave')).toBeNull();
    expect(storage.rawPayload('checkpoint')).toBeNull();
  });
});

/**
 * M9 — the pose handover (§31.5).
 *
 * Poses belong to the L2 manipulation SM (§12.1), which the L1 codec may not reach: so
 * the coordinator passes them across a seam, once, *after* `apply()` rebuilt the graph.
 * The order is the load-bearing part — the `attached` flag the world reads must be the
 * restored edge set, or a save-reloaded part would be placed loose on top of a socket
 * the same load just filled.
 */
describe('save/load — poses are handed to their owner (§31.5, M9)', () => {
  it('offers every saved component after the graph is restored, flagged by attachment and inventory', () => {
    const storage = new FakeStorage();
    const collected: RestoredPose[] = [];
    const game = system(storage, (poses) => collected.push(...poses));
    game.graph.configure(p1Content());

    const codecInstance = codec();
    const document = codecInstance.capture(
      captureInput({
        machineEdges: [
          { machineId: 'P1-mesh', edges: [{ componentId: 'gear-a', socketId: 'socket-mesh' }] }
        ],
        components: [
          {
            componentId: 'gear-a',
            defId: 'gear',
            canonicalPose: { center: { x: -8, y: 1.2, z: 0 }, yaw: 0 },
            lastValidPose: { center: { x: -8, y: 1.2, z: 0 }, yaw: 0 },
            inInventory: false
          },
          {
            componentId: 'plate-a',
            defId: 'blanking-plate',
            canonicalPose: { center: { x: -6.6, y: 0.04, z: 2.7 }, yaw: 0.25 },
            lastValidPose: { center: { x: -6.6, y: 0.04, z: 2.7 }, yaw: 0.25 },
            inInventory: true
          }
        ]
      })
    );
    storage.writePending('checkpoint', codecInstance.encode(document), 1000);
    storage.promote('checkpoint');

    // Nothing is placed before a load happens.
    expect(collected).toEqual([]);
    expect(game.save.load().ok).toBe(true);

    const gear = collected.find((entry) => entry.componentId === 'gear-a');
    expect(gear).toMatchObject({ attached: true, inInventory: false });
    expect(gear?.pose).toEqual({ center: { x: -8, y: 1.2, z: 0 }, yaw: 0 });

    // The inventory part is offered too — and flagged, so the world can skip it rather
    // than dropping it at its last on-floor pose while the player also holds it.
    const plate = collected.find((entry) => entry.componentId === 'plate-a');
    expect(plate).toMatchObject({ attached: false, inInventory: true });
    expect(plate?.pose.yaw).toBe(0.25);
  });

  it('offers a component the graph no longer places as loose — reported, not repaired', () => {
    const storage = new FakeStorage();
    const collected: RestoredPose[] = [];
    const game = system(storage, (poses) => collected.push(...poses));

    const codecInstance = codec();
    const document = codecInstance.capture(
      captureInput({
        machineEdges: [],
        components: [
          {
            componentId: 'gear-a',
            defId: 'gear',
            canonicalPose: { center: { x: 1, y: 2, z: 3 }, yaw: 0 },
            lastValidPose: { center: { x: 1, y: 2, z: 3 }, yaw: 0 },
            inInventory: false
          }
        ]
      })
    );
    storage.writePending('autosave', codecInstance.encode(document), 1000);
    storage.promote('autosave');

    expect(game.save.load().ok).toBe(true);
    // The handover is deliberately dumb: the pose owner's own lookup decides whether the
    // id is an authored carryable, so the save layer reports a pose instead of guessing.
    expect(collected).toHaveLength(1);
    expect(collected[0]?.attached).toBe(false);
    expect(collected[0]?.pose.center.y).toBe(2);
  });

  it('never touches a pose when the save is refused (EC-SAVE-05)', () => {
    const storage = new FakeStorage();
    const collected: RestoredPose[] = [];
    const game = system(storage, (poses) => collected.push(...poses));
    storage.writePending('autosave', '!!not json!!', 1000);
    storage.promote('autosave');

    expect(game.save.load().ok).toBe(false);
    expect(collected).toEqual([]);
  });
});

// __SAVE_TESTS_PART_4__

describe('save/load — §29.2 HintState persistence (M10)', () => {
  /** The `hints` seam adapter, wired exactly as main.ts adapts the ladder. */
  function hintLadder() {
    const ladder = new HintSystem({ puzzleIds: ['P1'] });
    return { ladder, seam: {
      snapshot: () => Object.fromEntries(ladder.snapshot().map((row) => [row.puzzleId, row.level])),
      restore: (restored: Readonly<Record<string, number>>) => ladder.restore(restored)
    } };
  }

  it('hint levels round-trip through the codec (capture → encode → decode → apply)', () => {
    const codecInstance = codec();
    const input = captureInput({ hintLevels: { P1: 2 } });
    const file = codecInstance.capture(input);
    expect(file.hints).toEqual({ levels: { P1: 2 } });

    const decoded = codecInstance.decode(codecInstance.encode(file));
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.save.hints?.levels).toEqual({ P1: 2 });

    // The apply path reaches the owner through the `hints` target.
    const { ladder, seam } = hintLadder();
    codecInstance.apply(decoded.save, {
      ledger: new RewardLedger(),
      inventory: new InventorySystem(),
      checkpoint: new CheckpointSystem(),
      graph: new MachineGraph(),
      puzzles: [],
      hints: { restore: seam.restore }
    });
    expect(ladder.level('P1')).toBe(2);
  });

  it('a pre-M10 v2 file (no hints block) restores nothing and stays valid', () => {
    const codecInstance = codec();
    const file = codecInstance.capture(captureInput());
    expect(file.hints).toBeUndefined();

    const decoded = codecInstance.decode(codecInstance.encode(file));
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;

    const { ladder, seam } = hintLadder();
    // The session had climbed to L3 before loading the old file.
    ladder.request('P1');
    ladder.request('P1');
    ladder.request('P1');
    expect(ladder.level('P1')).toBe(3);

    codecInstance.apply(decoded.save, {
      ledger: new RewardLedger(),
      inventory: new InventorySystem(),
      checkpoint: new CheckpointSystem(),
      graph: new MachineGraph(),
      puzzles: [],
      hints: { restore: seam.restore }
    });
    expect(ladder.level('P1')).toBe(0);
  });

  it('SaveSystem captures and restores the ladder through deps.hints', () => {
    const storage = new FakeStorage();
    const game = system(storage);
    const { ladder, seam } = hintLadder();
    const withHints = new SaveSystem(storage, {
      ledger: game.ledger,
      inventory: game.inventory,
      checkpoint: game.checkpoint,
      graph: game.graph,
      progression: game.progression,
      puzzles: [game.target],
      puzzleDefinitions: [{ id: 'P1', milestoneId: MILESTONE_P1_FIRST_MESH }],
      knownComponentIds: KNOWN_IDS,
      restorePoses: () => {},
      actions: {
        snapshot: () => game.actions.actions,
        restore: (ids) => game.actions.restore({ actions: ids })
      },
      hints: seam
    });
    const world = fakeWorld();

    // Climb the ladder in-session (two explicit requests → L2), then save.
    ladder.request('P1');
    ladder.request('P1');
    expect(withHints.save('autosave', 1000, world, ['gear-a']).ok).toBe(true);

    // Wipe the session ladder, then load: the save's levels come back.
    ladder.resetAll();
    expect(ladder.level('P1')).toBe(0);
    const loaded = withHints.load();
    expect(loaded.ok).toBe(true);
    expect(ladder.level('P1')).toBe(2);
  });

  it('malformed hints blocks are refused by decode (schema gate)', () => {
    const codecInstance = codec();
    const file = codecInstance.capture(captureInput());
    const bad = JSON.parse(codecInstance.encode(file));
    bad['hints'] = { levels: { P1: 'two' } };
    expect(codecInstance.decode(JSON.stringify(bad))).toMatchObject({ ok: false, reason: 'schema' });

    const worse = JSON.parse(codecInstance.encode(file));
    worse['hints'] = { levels: 'nope' };
    expect(codecInstance.decode(JSON.stringify(worse))).toMatchObject({ ok: false, reason: 'schema' });
  });

  it('New Game runs with and without a hints dep and clears the ladder when present', () => {
    const storage = new FakeStorage();
    const game = system(storage);
    const { ladder, seam } = hintLadder();

    // Headless compose (no hints dep): New Game must not throw.
    expect(() => game.save.newGame()).not.toThrow();

    // With the seam wired: a climbed ladder is cleared with the rest.
    const withHints = new SaveSystem(storage, {
      ledger: game.ledger,
      inventory: game.inventory,
      checkpoint: game.checkpoint,
      graph: game.graph,
      progression: game.progression,
      puzzles: [game.target],
      puzzleDefinitions: [{ id: 'P1', milestoneId: MILESTONE_P1_FIRST_MESH }],
      knownComponentIds: KNOWN_IDS,
      restorePoses: () => {},
      actions: {
        snapshot: () => game.actions.actions,
        restore: (ids) => game.actions.restore({ actions: ids })
      },
      hints: seam
    });
    ladder.request('P1');
    expect(ladder.level('P1')).toBe(1);
    withHints.newGame();
    expect(ladder.level('P1')).toBe(0);
  });
});

describe('puzzle restore — the completion latch across loads (R-4/R-6)', () => {
  it('a saved Complete restores completed and never re-fires; a pre-completion save replays once', () => {
    const content = p1Content();
    const graph = new MachineGraph();
    graph.configure(content);
    graph.reset([
      { componentId: 'shaft-a', socketId: 'socket-shaft-a' },
      { componentId: 'shaft-b', socketId: 'socket-shaft-b' },
      { componentId: 'gear-a', socketId: 'socket-mesh' }
    ]);
    const puzzle = new PuzzleSystem(P1_PUZZLE, graph, content, { stableSteps: 1 });

    // Save BEFORE completion, then complete in-session.
    puzzle.restore('InProgress');
    graph.recomputeIfDirty();
    puzzle.update(true);
    puzzle.update(true);
    puzzle.update(true);
    expect(puzzle.state).toBe('Complete');

    // A pre-completion save (InProgress) resets the latch: one replay possible.
    puzzle.restore('InProgress');
    expect(puzzle.state).toBe('InProgress');
    let refire = 0;
    graph.recomputeIfDirty();
    for (let step = 0; step < 4; step += 1) {
      const update = puzzle.update(true);
      refire += update.events.filter((event) => event.type === 'PuzzleCompleted').length;
    }
    expect(puzzle.state).toBe('Complete');
    expect(refire).toBe(1); // the FIRST grant of this run, not a duplicate (R-6)

    // A saved Complete restores completed; re-evaluation fires nothing (R-4).
    puzzle.restore('Complete');
    expect(puzzle.state).toBe('Complete');
    let events = 0;
    graph.recomputeIfDirty();
    for (let step = 0; step < 3; step += 1) {
      events += puzzle.update(true).events.length;
    }
    expect(events).toBe(0);
  });
});



