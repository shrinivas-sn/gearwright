/**
 * CONTENT — staged action ids (ARCH §24.1, §12.2; ADR-018).
 *
 * A staged puzzle's order is made of *player actions*, not of geometry: priming a
 * machine is something the player does at a prop, and the machine definition declares
 * which actions prime it (`MachineDefinition.primingActions`). The ids therefore live
 * in content, next to the puzzle that uses them.
 *
 * The composition never hard-codes a puzzle: it logs a prop press only when the prop's
 * id appears in `STAGED_ACTIONS`. Adding a staged machine is therefore one entry here
 * plus its machine/puzzle data — never a new branch in `main.ts`.
 */

/**
 * BM-1's three priming lines. **Order-flexible** (§7: "1 structure, order-flexible
 * priming"): the priming stage is complete once all three have been performed, in
 * whatever order the player finds them.
 */
export const BM1_PRIMING_ACTIONS: ReadonlyArray<string> = [
  'bm1/prime-feed',
  'bm1/prime-return',
  'bm1/prime-bleed'
];

/**
 * BM-1's activation: the engage lever. It must be thrown *after* priming, which is
 * what the puzzle's ordered-sequence requirement witnesses (ADR-018).
 */
export const BM1_ENGAGE_ACTION = 'bm1/engage';

/**
 * BM-2's three priming lines (Branch B's staged final machine). Same shape as BM-1's:
 * **order-flexible** coverage, so the stage is a small open problem rather than a lock.
 */
export const BM2_PRIMING_ACTIONS: ReadonlyArray<string> = [
  'bm2/prime-inlet',
  'bm2/prime-outlet',
  'bm2/prime-drain'
];

/** BM-2's activation: the throttle lever, thrown *after* priming (ADR-018). */
export const BM2_ENGAGE_ACTION = 'bm2/engage';

/** Every staged action the game ships — the composition's allow-list. */
export const STAGED_ACTIONS: ReadonlyArray<string> = [
  ...BM1_PRIMING_ACTIONS,
  BM1_ENGAGE_ACTION,
  ...BM2_PRIMING_ACTIONS,
  BM2_ENGAGE_ACTION
];

/** True when an interaction target is a staged action the history must record. */
export function isStagedAction(id: string): boolean {
  return STAGED_ACTIONS.includes(id);
}
