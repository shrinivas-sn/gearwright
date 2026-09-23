/**
 * L1 â€” the save codec (ARCH Â§31, Â§40 `game-state/save-codec.ts`).
 *
 * The ONLY serialisation path in the game (R5: "persistence only through
 * DTOs"). It reads canonical DTOs from the L1 owners and writes a validated,
 * versioned JSON document; nothing here ever touches a live object graph, a
 * `THREE.Object3D`, a physics body or the DOM.
 *
 * The load path is a *typed pipeline*, never silent (Â§31.5):
 * decode â†’ schema validation â†’ version check â†’ integrity checks â†’ `apply()`
 * rebuilding the L1 owners with every repair reported. Every failure has a
 * reason code (EC-SAVE-05/06/07/09/10/11); the two P0 reconcile rules live
 * here because they are *cross-owner* decisions: the ledger is authoritative
 * for grants (EC-SAVE-09) and a completion milestone proves a lost grant
 * (EC-SAVE-10).
 */

import type { Pose } from './component-model.ts';

/** The current schema version. Bump + add a migration step when it changes. */
export const SAVE_SCHEMA_VERSION = 2;

/**
 * Upper bound on the persisted action log. The owner already bounds it
 * (`DEFAULT_ACTION_LIMIT`); this is the *decode* guard, so a hostile or corrupted blob
 * cannot ask the game to rebuild an unbounded log (§38 "fail soft", never allocate
 * what a file demands).
 */
export const MAX_SAVED_ACTIONS = 512;

/** Game version stamped into every save (meta only; never load-bearing). */
export const SAVE_GAME_VERSION = '0.1.0';

/** Matches `MachineGraph.attachments` â€” the canonical edge DTO (Â§31.1). */
export interface Attachment { readonly componentId: string; readonly socketId: string }

/** Quantised canonical pose, JSON-safe by construction (Â§31.1 `canonicalPose`). */
export interface SavedPose {
  readonly center: { readonly x: number; readonly y: number; readonly z: number };
  readonly yaw: number;
}

/** The canonical document (v2: ADR-018 action history on top of ARCH section 31.1). */
export interface SaveFile {
  readonly version: number;
  readonly meta: {
    readonly savedAt: number;
    readonly gameVersion: string;
    readonly playtimeSec: number;
    readonly slot: 'autosave' | 'checkpoint';
  };
  readonly progression: { readonly completedPuzzles: ReadonlyArray<string>; readonly storyClues: ReadonlyArray<string> };
  readonly puzzles: Readonly<Record<string, { readonly state: string }>>;
  readonly machines: Readonly<Record<string, { readonly edges: ReadonlyArray<Attachment> }>>;
  readonly components: Readonly<Record<string, {
    readonly defId: string;
    readonly canonicalPose: SavedPose;
    readonly lastValidPose: SavedPose;
    readonly inInventory: boolean;
  }>>;
  readonly inventory: {
    readonly parts: ReadonlyArray<string>;
    readonly materials: Readonly<Record<string, number>>;
    readonly blueprints: ReadonlyArray<string>;
  };
  readonly rewards: { readonly granted: ReadonlyArray<string> };
  readonly checkpoint: { readonly id: string; readonly anchorId: string };
  /**
   * §12.2 action history (ADR-018, v2): the ordered ids of the player's staged actions
   * (`bm1/prime-*`, `bm1/engage`). It is canonical because staged validation reads it —
   * without it a reload would re-open a priming stage the player already finished —
   * and it is the *only* v2 field, which is why the migration from v1 is a pure
   * widening (a v1 save simply has no staged progress yet).
   */
  readonly actions: { readonly ids: ReadonlyArray<string> };
  /**
   * §12.2/§29.2 `HintState` (M10): one `hintLevel` per puzzle, canonical and restored
   * independently of puzzle state (§29.2: "stored per puzzle in a separate HintState").
   * Optional in the document so v2 files written before M10 decode cleanly — an absent
   * row is L0, which is exactly what those sessions' ladders held.
   */
  readonly hints?: { readonly levels: Readonly<Record<string, number>> } | undefined;
}

/** What the codec reads when building a document â€” the L1 owners, nothing else. */
export interface SaveCaptureInput {
  readonly savedAt: number;
  readonly playtimeSec: number;
  readonly slot: 'autosave' | 'checkpoint';
  readonly ledger: { readonly grantedIds: ReadonlyArray<string> };
  readonly inventory: {
    readonly partIds: ReadonlyArray<string>;
    readonly materialCounts: Readonly<Record<string, number>>;
    readonly blueprintIds: ReadonlyArray<string>;
  };
  readonly checkpoint: { readonly id: string; readonly anchorId: string };
  readonly puzzles: ReadonlyArray<{ readonly puzzleId: string; readonly state: string }>;
  /** `MachineGraph.attachments`, grouped by the machine that owns the socket. */
  readonly machineEdges: ReadonlyArray<{ readonly machineId: string; readonly edges: ReadonlyArray<Attachment> }>;
  /** Component records: the pose owner is the caller (Â§31.4, EC-SAVE-02). */
  readonly components: ReadonlyArray<{
    readonly componentId: string;
    readonly defId: string;
    readonly canonicalPose: SavedPose;
    readonly lastValidPose: SavedPose;
    readonly inInventory: boolean;
  }>;
  readonly storyClues?: ReadonlyArray<string> | undefined;
  /** §12.2 action history (ADR-018). Absent = no staged progress yet. */
  readonly actions?: ReadonlyArray<string> | undefined;
  /** §12.2/§29.2 `HintState` (M10): per-puzzle ladder levels. Absent = every ladder L0. */
  readonly hintLevels?: Readonly<Record<string, number>> | undefined;
}

export type SaveFailureReason =
  | 'empty'
  | 'malformed'
  | 'schema'
  | 'version-unsupported'
  | 'duplicate-id';

export type DecodeResult =
  | { readonly ok: true; readonly save: SaveFile }
  | { readonly ok: false; readonly reason: SaveFailureReason; readonly detail: string };

/** One load-time repair or warning, destined for the load log (Â§31.5/Â§31.6). */
export interface SaveLoadNote {
  readonly code:
    | 'ledger-reconciled-puzzle'        // EC-SAVE-09 (R-10 repair): reward recorded, puzzle state missing
    | 'ledger-confirmed-from-milestone' // EC-SAVE-10: puzzle Complete, reward missing
    | 'component-ref-missing'           // EC-SAVE-06: save references a removed id
    | 'duplicate-machine-edges-dropped';
  readonly detail: string;
}

/** What `apply()` writes back â€” every L1 canonical owner, behind tiny seams. */
export interface SaveTargets {
  readonly ledger: { restore(snapshot: { granted: ReadonlyArray<string> }): void; confirm(grantId: string): boolean };
  readonly inventory: {
    restore(snapshot: {
      parts: ReadonlyArray<string>;
      materials: Readonly<Record<string, number>>;
      blueprints: ReadonlyArray<string>;
    }): void;
  };
  readonly checkpoint: { restore(snapshot: { id: string; anchorId: string }): void };
  readonly graph: { reset(attachments: ReadonlyArray<Attachment>): void };
  readonly puzzles: ReadonlyArray<{ puzzleId: string; restore(state: string): void }>;
  /**
   * §12.2 progression: its only canonical *field* is the clue seen-id set. Branch
   * state and hub stage are derived from the restored puzzle states, so they need no
   * field of their own — and therefore no schema change (the `progression` object has
   * carried `storyClues` since v1).
   */
  readonly progression?: { restore(snapshot: { clues: ReadonlyArray<string> }): void } | undefined;
  /**
   * §12.2 action history (ADR-018). Restored *after* the graph and *before* the
   * puzzles, so the first stepped frame already validates staged requirements against
   * the restored log — a save taken mid-stage must not lose its priming.
   */
  readonly actions?: { restore(snapshot: { ids: ReadonlyArray<string> }): void } | undefined;
  /**
   * §12.2/§29.2 `HintState` (M10): the ladder's per-puzzle levels. Optional for the
   * same reason as `progression`/`actions` — a headless load (tests, tools) can skip it.
   */
  readonly hints?: { restore(levels: Readonly<Record<string, number>>): void } | undefined;
}


/** ---------- capture ---------- */

export class SaveCodec {
  private readonly log: SaveLoadNote[] = [];

  constructor(
    /** Puzzle definitions, for the reconcile milestones (Â§31.5). */
    private readonly puzzleDefinitions: ReadonlyArray<{ readonly id: string; readonly milestoneId: string }>,
    /** All valid component ids for the level â€” the EC-SAVE-06 reference set. */
    private readonly knownComponentIds: ReadonlyArray<string> = []
  ) {}

  /** Repairs and warnings from the most recent load, in order. */
  get loadLog(): ReadonlyArray<SaveLoadNote> {
    return this.log;
  }

  capture(input: SaveCaptureInput): SaveFile {
    return {
      version: SAVE_SCHEMA_VERSION,
      meta: {
        savedAt: input.savedAt,
        gameVersion: SAVE_GAME_VERSION,
        playtimeSec: input.playtimeSec,
        slot: input.slot
      },
      progression: {
        completedPuzzles: [...input.puzzles].filter((p) => p.state === 'Complete').map((p) => p.puzzleId).sort(),
        storyClues: [...(input.storyClues ?? [])].sort()
      },
      puzzles: Object.fromEntries(input.puzzles.map((p) => [p.puzzleId, { state: p.state }])),
      machines: Object.fromEntries(
        [...input.machineEdges]
          .sort((a, b) => (a.machineId < b.machineId ? -1 : a.machineId > b.machineId ? 1 : 0))
          .map((m) => [m.machineId, { edges: [...m.edges].map((e) => ({ ...e })) }])
      ),
      components: Object.fromEntries(
        [...input.components]
          .sort((a, b) => (a.componentId < b.componentId ? -1 : a.componentId > b.componentId ? 1 : 0))
          .map((c) => [
            c.componentId,
            {
              defId: c.defId,
              canonicalPose: clonePose(c.canonicalPose),
              lastValidPose: clonePose(c.lastValidPose),
              inInventory: c.inInventory
            }
          ])
      ),
      inventory: {
        parts: [...input.inventory.partIds].sort(),
        materials: { ...input.inventory.materialCounts },
        blueprints: [...input.inventory.blueprintIds].sort()
      },
      rewards: { granted: [...input.ledger.grantedIds].sort() },
      checkpoint: { ...input.checkpoint },
      actions: { ids: [...(input.actions ?? [])] },
      // §29.2 HintState: levels only (the request counter restarts on load — see
      // `HintSystem.restore`). Rows with nothing to say are omitted, not zero-filled.
      ...(input.hintLevels !== undefined && Object.keys(input.hintLevels).length > 0
        ? { hints: { levels: { ...input.hintLevels } } }
        : {})
    };
  }

  /** Canonical JSON. Throws only on non-finite numbers â€” a caller bug, not data (Â§11.3). */
  encode(save: SaveFile): string {
    assertJsonSafe(save);
    return JSON.stringify(save);
  }


  /**
   * Parse + validate. Returns a typed failure instead of throwing: malformed
   * JSON, wrong shapes, non-finite poses and duplicate ids are *data problems*
   * with recovery paths (Â§31.5), not crashes.
   */
  decode(json: string): DecodeResult {
    if (json.trim().length === 0) return fail('empty', 'save payload is empty');
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      return fail('malformed', 'payload is not valid JSON');
    }
    if (!isRecord(parsed)) return fail('schema', 'save root is not an object');

    const version = parsed['version'];
    if (typeof version !== 'number' || !Number.isInteger(version)) {
      return fail('schema', 'missing or non-integer version');
    }
    if (version > SAVE_SCHEMA_VERSION) {
      return fail('version-unsupported', `save version ${version} is newer than ${SAVE_SCHEMA_VERSION}`);
    }
    const migrated = SaveCodec.migrate(parsed);
    if (!migrated.ok) return migrated;

    const save = migrated.save;
    if (!isRecord(save.meta) || typeof save.meta['savedAt'] !== 'number') {
      return fail('schema', 'meta.savedAt missing');
    }
    if (typeof save.meta['playtimeSec'] !== 'number' || !Number.isFinite(save.meta['playtimeSec'])) {
      return fail('schema', 'meta.playtimeSec must be a finite number');
    }
    if (save.meta['slot'] !== 'autosave' && save.meta['slot'] !== 'checkpoint') {
      return fail('schema', 'meta.slot must be "autosave" or "checkpoint"');
    }
    if (!isRecord(save.puzzles) || !isRecord(save.machines) || !isRecord(save.components)) {
      return fail('schema', 'puzzles/machines/components must be objects');
    }
    if (!isRecord(save.inventory) || !isRecord(save.checkpoint)) {
      return fail('schema', 'inventory/checkpoint must be objects');
    }
    if (!isRecord(save.rewards) || !Array.isArray(save.rewards['granted'])) {
      return fail('schema', 'rewards.granted must be an array');
    }
    if (!Array.isArray(save.inventory['parts']) || !Array.isArray(save.inventory['blueprints'])) {
      return fail('schema', 'inventory.parts/blueprints must be arrays');
    }
    if (!isRecord(save.inventory['materials'])) {
      return fail('schema', 'inventory.materials must be an object');
    }
    if (typeof save.checkpoint['id'] !== 'string' || typeof save.checkpoint['anchorId'] !== 'string') {
      return fail('schema', 'checkpoint id/anchorId must be strings');
    }
    if (!isRecord(save.progression)) {
      return fail('schema', 'progression must be an object');
    }
    if (
      !Array.isArray(save.progression['completedPuzzles']) ||
      !Array.isArray(save.progression['storyClues'])
    ) {
      return fail('schema', 'progression.completedPuzzles/storyClues must be arrays');
    }
    for (const clue of [...save.progression['storyClues'], ...save.progression['completedPuzzles']]) {
      if (typeof clue !== 'string') return fail('schema', 'progression entries must be strings');
    }
    // v2 (ADR-018): the action history is canonical, so it is validated like every
    // other owner's block — including a bound, because the log's length must never be
    // dictated by the file (§38).
    if (!isRecord(save.actions) || !Array.isArray(save.actions['ids'])) {
      return fail('schema', 'actions.ids must be an array');
    }
    if (save.actions['ids'].length > MAX_SAVED_ACTIONS) {
      return fail('schema', `actions.ids exceeds the ${MAX_SAVED_ACTIONS}-entry bound`);
    }
    for (const action of save.actions['ids']) {
      if (typeof action !== 'string') return fail('schema', 'actions.ids entries must be strings');
    }
    // v2 (M10): HintState is validated like every owner's block — present or absent
    // (older v2 files), never malformed. Levels are floored onto the ladder by
    // `HintSystem.restore`, so the file must promise only "number-valued rows".
    if (save['hints'] !== undefined) {
      if (!isRecord(save['hints']) || !isRecord(save['hints']['levels'])) {
        return fail('schema', 'hints.levels must be an object');
      }
      for (const [puzzleId, level] of Object.entries(save['hints']['levels'])) {
        if (typeof level !== 'number' || !Number.isFinite(level)) {
          return fail('schema', `hints.levels[${puzzleId}] must be a finite number`);
        }
      }
    }
    for (const [puzzleId, entry] of Object.entries(save.puzzles)) {
      if (!isRecord(entry) || typeof entry['state'] !== 'string') {
        return fail('schema', `puzzles[${puzzleId}].state must be a string`);
      }
    }
    for (const machineId of Object.keys(save.machines)) {
      const entry = save.machines[machineId];
      if (!isRecord(entry) || !Array.isArray(entry['edges'])) {
        return fail('schema', `machines[${machineId}].edges must be an array`);
      }
    }
    for (const [componentId, entry] of Object.entries(save.components)) {
      if (
        !isRecord(entry) ||
        typeof entry['defId'] !== 'string' ||
        !isRecord(entry['canonicalPose']) ||
        !isRecord(entry['lastValidPose']) ||
        typeof entry['inInventory'] !== 'boolean'
      ) {
        return fail('schema', `components[${componentId}] is malformed`);
      }
      if (!isFinitePose(entry['canonicalPose']) || !isFinitePose(entry['lastValidPose'])) {
        return fail('schema', `components[${componentId}] poses must be finite (no NaN/Infinity)`);
      }
    }
    for (const value of Object.values(save.inventory['materials'])) {
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
        return fail('schema', 'material counts must be non-negative integers');
      }
    }
    for (const grant of save.rewards['granted']) {
      if (typeof grant !== 'string') return fail('schema', 'rewards.granted entries must be strings');
    }
    for (const id of [...save.rewards['granted'], ...save.inventory['parts'], ...save.inventory['blueprints']]) {
      if (typeof id !== 'string') return fail('schema', 'id sets must contain only strings');
    }
    const duplicate = firstDuplicate([
      ...save.rewards['granted'],
      ...save.inventory['parts'],
      ...save.inventory['blueprints']
    ]);
    if (duplicate !== null) return fail('duplicate-id', `duplicate id "${duplicate}" in reward/inventory sets`);

    return { ok: true, save };
  }


  /**
   * Rebuild the L1 owners from a validated document, applying Â§31.5's
   * integrity rules and Â§31.6's reconcile policy. Every repair is reported
   * through `loadLog` â€” never silent.
   */
  apply(save: SaveFile, targets: SaveTargets): ReadonlyArray<SaveLoadNote> {
    this.log.length = 0;

    // --- EC-SAVE-06: drop edges that reference unknown ids --------------------
    const known = new Set(this.knownComponentIds);
    const machineEdges = new Map<string, Attachment[]>();
    let droppedDuplicateEdges = 0;
    for (const [machineId, entry] of Object.entries(save.machines)) {
      const seen = new Set<string>();
      const edges: Attachment[] = [];
      for (const edge of entry.edges) {
        if (!known.has(edge.componentId) || !known.has(edge.socketId)) {
          this.log.push({
            code: 'component-ref-missing',
            detail: `${machineId}: edge ${edge.componentId}â†’${edge.socketId} references an unknown id; dropped`
          });
          continue;
        }
        if (seen.has(edge.componentId)) {
          droppedDuplicateEdges += 1;
          continue;
        }
        seen.add(edge.componentId);
        edges.push({ ...edge });
      }
      machineEdges.set(machineId, edges);
    }
    if (droppedDuplicateEdges > 0) {
      this.log.push({
        code: 'duplicate-machine-edges-dropped',
        detail: `${droppedDuplicateEdges} duplicate attachment edge(s) dropped`
      });
    }

    // --- reconcile (P0, Â§31.6): ledger â†” puzzle-state --------------------------
    // One grant id per (puzzle, completion milestone) â€” the same derivation the
    // reward system uses (TEST Â§10: "grantId derived from (puzzleId, milestone)").
    // Reconciliation runs BEFORE `ledger.restore` wipes the set: `confirm`
    // writes into the ledger's own set, and the restore below is seeded from
    // the save's (reconciled) row list â€” see `restoredRows` below.
    const completionGrantIds = new Map<string, string>();
    for (const puzzle of this.puzzleDefinitions) {
      completionGrantIds.set(puzzle.id, `${puzzle.id}:${puzzle.milestoneId}`);
    }

    const puzzleStates: Record<string, string> = {};
    for (const [puzzleId, entry] of Object.entries(save.puzzles)) puzzleStates[puzzleId] = entry.state;

    // EC-SAVE-09 / R-10 (repair half): reward recorded, puzzle state missing â†’
    // the LEDGER is authoritative for grants; the puzzle state is repaired to
    // `Complete`. A grant recorded under a puzzle's completion milestone proves
    // that puzzle completed, even when its state block was lost or corrupted.
    const granted = new Set(save.rewards.granted);
    const restoredRows = [...save.rewards.granted];
    for (const grant of save.rewards.granted) {
      for (const [puzzleId, grantId] of completionGrantIds) {
        if (grant !== grantId) continue;
        if (puzzleStates[puzzleId] !== 'Complete') {
          this.log.push({
            code: 'ledger-reconciled-puzzle',
            detail: `${puzzleId}: reward "${grant}" recorded; puzzle state repaired to Complete (ledger authoritative)`
          });
          puzzleStates[puzzleId] = 'Complete';
        }
      }
    }

    // EC-SAVE-10: puzzle state recorded, reward missing â†’ reconcile the grant
    // from the completion milestone; granted once, never applied twice.
    for (const [puzzleId, state] of Object.entries(puzzleStates)) {
      if (state !== 'Complete') continue;
      const grantId = completionGrantIds.get(puzzleId);
      if (grantId === undefined || granted.has(grantId)) continue;
      targets.ledger.confirm(grantId);
      restoredRows.push(grantId);
      this.log.push({
        code: 'ledger-confirmed-from-milestone',
        detail: `${puzzleId}: puzzle Complete; reward "${grantId}" reconciled from the completion milestone`
      });
    }

    // --- rebuild the owners (ledger â†’ inventory â†’ checkpoint â†’ graph â†’ puzzles)
    // The ledger restore is seeded with the RECONCILED row set: confirms above
    // survive it, and nothing is lost or duplicated.
    targets.ledger.restore({ granted: restoredRows });
    targets.inventory.restore({
      parts: save.inventory.parts,
      materials: save.inventory.materials,
      blueprints: save.inventory.blueprints
    });
    targets.checkpoint.restore({ ...save.checkpoint });

    const attachments: Attachment[] = [];
    for (const machineId of [...machineEdges.keys()].sort()) {
      attachments.push(...(machineEdges.get(machineId) ?? []));
    }
    targets.graph.reset(attachments);

    // §12.2 action history (ADR-018): restored between the graph and the puzzles, so
    // the first evaluation after a load already validates staged requirements against
    // the restored log (a save taken mid-stage keeps its priming).
    targets.actions?.restore({ ids: [...save.actions.ids] });

    for (const puzzle of targets.puzzles) {
      const state = puzzleStates[puzzle.puzzleId];
      if (state !== undefined) puzzle.restore(state);
    }

    // Progression last: it derives branch state and the hub stage from the puzzle
    // states just restored, and takes the saved clue set (§12.2).
    targets.progression?.restore({ clues: save.progression.storyClues });

    // §29.2 HintState, after the puzzles so the ladder's restore replaces whatever the
    // session had built up (HintSystem.restore is a full replacement, not a merge).
    // An absent block — a pre-M10 v2 file — simply restores nothing: every row the
    // ladder zeroed stays L0, which is the truth about that session.
    targets.hints?.restore(save.hints?.levels ?? {});

    return this.log;
  }

  /**
   * Version migration chain (ARCH 31.5, EC-SAVE-12). Each step rewrites the document
   * one version forward, and the version band is checked before and after: a save
   * newer than this build is refused outright (`version-unsupported`), never partially
   * read. v1 -> v2 is the first live step (ADR-018 added the action history).
   */
  static migrate(parsed: unknown): DecodeResult {
    if (!isRecord(parsed)) return fail('schema', 'save root is not an object');
    const version = parsed['version'];
    if (typeof version !== 'number' || !Number.isInteger(version)) {
      return fail('schema', 'missing or non-integer version');
    }
    let document: Record<string, unknown> = parsed;
    if (version === 1) document = migrateV1ToV2(document);
    if (document['version'] === SAVE_SCHEMA_VERSION) {
      return { ok: true, save: document as unknown as SaveFile };
    }
    return fail('version-unsupported', `no migration path from ${version} to ${SAVE_SCHEMA_VERSION}`);
  }
}


/** ---------- guards + small helpers (module-private) ---------- */

/**
 * v1 → v2 migration (ADR-018). The only difference is the added action history: a v1
 * save was written before staged validation existed, so it carries no staged progress
 * and the step is a pure widening — nothing is dropped, reinterpreted or guessed. A v1
 * save's machine states and edges are read exactly as before, so an in-flight restore
 * from the previous build keeps the whole branch.
 */
function migrateV1ToV2(document: Record<string, unknown>): Record<string, unknown> {
  return { ...document, version: 2, actions: { ids: [] } };
}

function fail(reason: SaveFailureReason, detail: string): DecodeResult {
  return { ok: false, reason, detail };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isFinitePose(value: unknown): value is SavedPose {
  return (
    isRecord(value) &&
    isFinite(value['yaw']) &&
    isRecord(value['center']) &&
    isFinite(value['center']['x']) &&
    isFinite(value['center']['y']) &&
    isFinite(value['center']['z'])
  );
}

function firstDuplicate(ids: ReadonlyArray<string>): string | null {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) return id;
    seen.add(id);
  }
  return null;
}

function clonePose(pose: SavedPose): SavedPose {
  return { center: { x: pose.center.x, y: pose.center.y, z: pose.center.z }, yaw: pose.yaw };
}

/** JSON.stringify turns NaN/Infinity into `null` silently â€” refuse instead. */
function assertJsonSafe(save: SaveFile): void {
  const walk = (value: unknown, path: string): void => {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new Error(`save contains a non-finite number at ${path}`);
    }
    if (Array.isArray(value)) {
      value.forEach((entry, index) => walk(entry, `${path}[${index}]`));
      return;
    }
    if (isRecord(value)) {
      for (const [key, entry] of Object.entries(value)) walk(entry, `${path}.${key}`);
    }
  };
  walk(save, '$');
}
/** Canonical pose â†’ JSON-safe pose DTO (the owner already quantised it). */
export function savedPoseOf(pose: Pose): SavedPose {
  return { center: { x: pose.center.x, y: pose.center.y, z: pose.center.z }, yaw: pose.yaw };
}

/** Pose DTO â†’ canonical pose (fresh object; never aliases the save). */
export function poseOfSaved(saved: SavedPose): Pose {
  return { center: { x: saved.center.x, y: saved.center.y, z: saved.center.z }, yaw: saved.yaw };
}





