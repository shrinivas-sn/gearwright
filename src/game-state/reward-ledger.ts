/**
 * L1 — the reward ledger (ARCH §27.1, §40 `game-state/reward-ledger.ts`).
 *
 * The canonical record of **which grants have ever been applied**. Its `grantId`
 * set is the idempotency source of truth for the whole reward pipeline
 * (TEST §10: "inventory and blueprints are functions of the *set* of granted
 * ids, not the *count* of events"):
 *
 *   - `grant()` returns `false` for a known id and applies nothing — the caller
 *     (the reward system) never even reaches the inventory (R-1, R-2).
 *   - Completion may be re-evaluated as often as the validator likes; the
 *     ledger makes every repeat a no-op (R-3, R-4, R-5).
 *   - Desync repair (§31.6): `confirm()` lets the load path record a grant that
 *     a puzzle's completion milestone proves (EC-SAVE-10) and `has()` answers
 *     whether one is recorded (EC-SAVE-09) — both *without* applying rewards,
 *     which stays the reward system's job.
 *
 * Deliberately dumb: no reward definitions live here, no inventory lives here,
 * and the only mutation is adding ids. Cleared only by `resetAll()` (New Game,
 * ARCH §12.2 ledger row).
 */

/** Canonical `GrantId` shape: `${sourceId}:${milestone}` (ARCH §27.1). */
export function grantIdOf(sourceId: string, milestone: string): string {
  return `${sourceId}:${milestone}`;
}

export interface RewardLedgerSnapshot {
  readonly granted: ReadonlyArray<string>;
}

export class RewardLedger {
  private readonly granted = new Set<string>();

  /** True when this grant id has already been applied (R-4, EC-SAVE-09). */
  has(grantId: string): boolean {
    return this.granted.has(grantId);
  }

  /**
   * Record a grant. Returns `true` exactly once per id (the caller then applies
   * the reward); `false` for a repeat — a no-op that mutates nothing (R-2).
   */
  grant(grantId: string): boolean {
    if (this.granted.has(grantId)) return false;
    this.granted.add(grantId);
    return true;
  }

  /**
   * Load-path repair: record a grant the save proves without re-applying it
   * (EC-SAVE-10 — puzzle state says Complete, ledger row missing). Idempotent
   * by construction; `false` when it was already recorded.
   */
  confirm(grantId: string): boolean {
    return this.grant(grantId);
  }

  /** Every granted id, sorted for deterministic saves (ARCH §23.2 hygiene). */
  get grantedIds(): ReadonlyArray<string> {
    return [...this.granted].sort();
  }

  get size(): number {
    return this.granted.size;
  }

  /** Restore from a save (the codec owns validation of the payload itself). */
  restore(snapshot: RewardLedgerSnapshot): void {
    this.granted.clear();
    for (const grantId of snapshot.granted) this.granted.add(grantId);
  }

  snapshot(): RewardLedgerSnapshot {
    return { granted: this.grantedIds };
  }

  /** New Game only (ARCH §12.2: "cleared only on New Game"). */
  resetAll(): void {
    this.granted.clear();
  }
}
