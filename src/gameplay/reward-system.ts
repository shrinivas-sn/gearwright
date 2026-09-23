/**
 * L2 — the reward system (ARCH §26 flow, §27.2 rules, §40 `gameplay/`).
 *
 * The one writer of rewards: it reads `RewardDefinition` data and calls *into*
 * `InventorySystem` / `BlueprintSystem` — never the reverse (§27.2 rule 5), and
 * nothing else in the game may mutate those resources (§27.2 rule 1). Every
 * grant flows through `RewardLedger.grant()`, whose id set is the idempotency
 * source of truth (TEST §10): `grant()` returning false means the milestone was
 * already spent, and the reward is not applied twice — no matter how often the
 * completion event arrives (R-2/R-3) or whether it came from this session or a
 * restored save (R-4/R-6).
 *
 * The `grantId` for a puzzle completion is exactly `${puzzleId}:${milestoneId}`
 * — the same derivation `SaveCodec.apply()` uses when it reconciles a save
 * (EC-SAVE-09/10), so ledger rows are stable across sessions.
 *
 * Unknown content ids (a reward definition naming a removed material or
 * blueprint) are **skipped with a reported reason, never a crash** (R-9), and
 * progression continues: the ledger still holds the grant, so a fixed content
 * table cannot retroactively double-apply.
 */

import type { InventorySystem, MaterialCounts, MaterialKind } from '../game-state/inventory-system.ts';
import type { PuzzleEvent } from '../game-state/puzzle-system.ts';
import type { RewardLedger } from '../game-state/reward-ledger.ts';

/** One milestone's rewards (§27.1 `RewardDefinition`), authored in `data/`. */
export interface RewardDefinition {
  /** The milestone id a puzzle's `milestoneId` names (e.g. `milestone/p1-first-mesh`). */
  readonly id: string;
  readonly title: string;
  readonly materials?: ReadonlyArray<{ readonly kind: MaterialKind; readonly amount: number }> | undefined;
  readonly blueprints?: ReadonlyArray<string> | undefined;
}

export interface RewardGrantOutcome {
  readonly grantId: string;
  readonly milestoneId: string;
  /** False when the ledger already held the grant — nothing was applied. */
  readonly applied: boolean;
  /** Amounts actually added by this grant (all zero when not applied). */
  readonly materials: MaterialCounts;
  /** Blueprints newly unlocked by this grant. */
  readonly blueprints: ReadonlyArray<string>;
  /** Declared content ids that could not resolve (R-9) — reported, not fatal. */
  readonly skipped: ReadonlyArray<string>;
}

function emptyOutcomeMaterials(): MaterialCounts {
  return { scrap: 0, brass: 0, sealant: 0, alloy: 0 };
}

export class RewardSystem {
  constructor(
    private readonly ledger: RewardLedger,
    private readonly inventory: InventorySystem,
    private readonly definitions: ReadonlyArray<RewardDefinition> = []
  ) {}

  /** The reward definition for a milestone, or null (R-9's warning path). */
  definitionFor(milestoneId: string): RewardDefinition | null {
    return this.definitions.find((definition) => definition.id === milestoneId) ?? null;
  }

  /**
   * The PuzzleCompleted path (§26 flow step 2). `grantId` derivation matches
   * the codec's reconcile exactly.
   */
  grantCompletion(puzzleId: string, milestoneId: string): RewardGrantOutcome {
    return this.grantMilestone(milestoneId, puzzleId);
  }

  /** Direct milestone grant (hub/story milestones later); same idempotency. */
  grantMilestone(milestoneId: string, sourceId = 'milestone'): RewardGrantOutcome {
    const grantId = `${sourceId}:${milestoneId}`;
    const nothing: RewardGrantOutcome = {
      grantId,
      milestoneId,
      applied: false,
      materials: emptyOutcomeMaterials(),
      blueprints: [],
      skipped: []
    };

    // The ledger decides: a repeat is a no-op that reaches nothing else (R-2).
    if (!this.ledger.grant(grantId)) return nothing;

    const definition = this.definitionFor(milestoneId);
    if (!definition) {
      // R-9: the grant is recorded (so it cannot re-apply later), the missing
      // content is reported, progression continues. Not silent: the outcome
      // carries the skip for the caller to log.
      return { ...nothing, applied: true, skipped: [milestoneId] };
    }

    const materials = emptyOutcomeMaterials();
    const unlocked: string[] = [];
    const skipped: string[] = [];

    for (const material of definition.materials ?? []) {
      const result = this.inventory.addMaterial(material.kind, material.amount);
      if (result === 'Ok') materials[material.kind] += material.amount;
      else skipped.push(`${material.kind}×${material.amount} (${result})`);
    }
    for (const blueprintId of definition.blueprints ?? []) {
      if (this.inventory.unlockBlueprint(blueprintId)) unlocked.push(blueprintId);
      // Already unlocked → set semantics absorbed it (R-8): nothing to report.
    }

    return { grantId, milestoneId, applied: true, materials, blueprints: unlocked, skipped };
  }

  /**
   * Consume a puzzle update's events (the PhaseWorld step result's
   * `puzzle.events`). The completion latch guarantees one `PuzzleCompleted`
   * per completion (EC-PZ-02); even a duplicated event stream grants once
   * (R-3), because the ledger holds the id after the first.
   */
  consumePuzzleEvents(events: ReadonlyArray<PuzzleEvent>): ReadonlyArray<RewardGrantOutcome> {
    const outcomes: RewardGrantOutcome[] = [];
    for (const event of events) {
      if (event.type !== 'PuzzleCompleted') continue;
      outcomes.push(this.grantCompletion(event.puzzleId, event.milestoneId));
    }
    return outcomes;
  }
}
