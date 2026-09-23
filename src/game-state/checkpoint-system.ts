/**
 * L1 — the checkpoint system (ARCH §12.2, §26, §31.2).
 *
 * The canonical owner of "where the player would resume from" — an **anchor
 * id**, never a transform (§22). It is deliberately tiny: `mark()` accepts a
 * trigger only when the level's checkpoint data defines it (unknown ids are
 * rejected, so a typo'd trigger fails loudly instead of silently moving the
 * player's respawn), `markOnce()` is the idempotent shape triggers use, and
 * the fallback anchor `CP-00` exists so a load can always place the player
 * (§36 boot table, "missing anchor → fallback CP-00").
 *
 * The *save trigger* is not here: §31.4 puts saves on events outside the sim
 * loop, decided by the composition root. This module only owns canonical
 * checkpoint state.
 */

/** The bootstrap checkpoint every new game and every load falls back to. */
export const FALLBACK_CHECKPOINT_ID = 'CP-00';

export interface CheckpointDefinition {
  /** Canonical id (`CP-xx`). */
  readonly id: string;
  /** Where respawn places the player (nearest safe clearance is the spawner's job, EC-PC-04). */
  readonly anchorId: string;
}

export interface CheckpointSnapshot {
  readonly id: string;
  readonly anchorId: string;
}

export class CheckpointSystem {
  private current: CheckpointSnapshot;
  private readonly defined: ReadonlyMap<string, CheckpointDefinition>;

  constructor(
    definitions: ReadonlyArray<CheckpointDefinition> = [],
    fallback: CheckpointDefinition = { id: FALLBACK_CHECKPOINT_ID, anchorId: 'spawn/lab' }
  ) {
    this.defined = new Map(definitions.map((definition) => [definition.id, definition]));
    this.current = { id: fallback.id, anchorId: fallback.anchorId };
  }

  /** The anchor a load/respawn must use (spawn searches nearest clearance, EC-PC-04). */
  get snapshot(): CheckpointSnapshot {
    return { ...this.current };
  }

  get currentId(): string {
    return this.current.id;
  }

  /**
   * Advance to a defined checkpoint. `false` when the id is not in the level's
   * checkpoint data (nothing moves — an unknown checkpoint is a content bug).
   */
  mark(checkpointId: string): boolean {
    const definition = this.defined.get(checkpointId);
    if (!definition) return false;
    this.current = { id: definition.id, anchorId: definition.anchorId };
    return true;
  }

  /** Idempotent mark (§26: `markOnce`) — the trigger may fire repeatedly. */
  markOnce(checkpointId: string): boolean {
    if (this.current.id === checkpointId) return false;
    return this.mark(checkpointId);
  }

  /** True when the level's data defines this checkpoint id. */
  isDefined(checkpointId: string): boolean {
    return this.defined.has(checkpointId);
  }

  /** Restore from a save. Accepts only defined checkpoints; falls back otherwise. */
  restore(snapshot: CheckpointSnapshot): void {
    this.current = this.defined.has(snapshot.id) ? { ...snapshot } : this.snapshot;
  }

  /** New Game: back to the bootstrap checkpoint (ARCH §12.2). */
  resetAll(): void {
    this.current = this.fallbackSnapshot;
  }

  private get fallbackSnapshot(): CheckpointSnapshot {
    const [only] = this.defined.keys();
    return only !== undefined && only === FALLBACK_CHECKPOINT_ID
      ? { ...this.defined.get(FALLBACK_CHECKPOINT_ID)! }
      : { id: FALLBACK_CHECKPOINT_ID, anchorId: 'spawn/lab' };
  }
}
