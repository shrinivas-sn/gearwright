/**
 * L1 — the player's action history (ARCH §12.2, §24.1, §31.1; ADR-018).
 *
 * Staged validation (BM-1: assembly → priming → activation) is the one puzzle
 * requirement that is a function of *what the player did* rather than of the machine
 * graph. §24.1's requirement union is deliberately a function of the graph and its
 * declared relations, so the extra input lives *here* instead of leaking into the
 * validator: this owner keeps a bounded, ordered, id-tagged log of the player's
 * actions, and the validator reads a plain snapshot through `ValidationContext.actions`
 * — which keeps it pure (same inputs, same result) exactly like `previousStreak`.
 *
 * Two rules live here because two consumers must agree on them (*one* authority each):
 *
 *  - `coversAll` — the §24.1 `state: 'primed'` question: every action the machine
 *    declares as a priming action happened, in any order (§7's "order-flexible
 *    priming").
 *  - `witnessesInOrder` — ADR-018's ordered-witness rule: each step names the actions
 *    that may witness it, one witness per step must appear, and the witnesses must
 *    appear in the declared order. Matching is *earliest-match*, so engaging before
 *    priming and then priming and engaging again is a legitimate recovery: the second
 *    engage witnesses the second step. A stricter "every witness list must be
 *    exhausted in order" rule would lock a player out of a puzzle they can still see
 *    how to solve.
 *
 * The log is canonical (§31.1) and therefore persisted: `snapshot()`/`restore()` are
 * its only persistence seam and `resetAll()` is what a New Game calls. It is bounded
 * because an unbounded player-driven log is a memory leak; when the bound is reached
 * the *oldest* record is dropped (FIFO), which is safe because a completed puzzle
 * latches (§25 `Complete` is terminal) and only an unfinished puzzle can be affected.
 */

/** One recorded action. The sequence number is local ordering metadata, not content. */
export interface ActionRecord {
  /** Authored action id (e.g. `bm1/prime-feed`) — data, never code. */
  readonly action: string;
  /** Monotonic record number, 1-based; survives a save/load round trip via order. */
  readonly seq: number;
}

/** The persisted view (§31.1): the ordered action ids, nothing else. */
export interface ActionHistorySnapshot {
  readonly actions: ReadonlyArray<string>;
}

/**
 * How many records are kept. Far above anything the MVP's staged content needs
 * (BM-1 logs four), so the FIFO bound is a safety net rather than a gameplay rule.
 */
export const DEFAULT_ACTION_LIMIT = 128;

/**
 * ADR-018 ordered-witness rule. Pure and exported so the validator, the composition
 * and the tests all read the same semantics.
 *
 * `steps[i]` is the set of actions that may witness step `i`; the rule finds the
 * earliest record for step 0, then the earliest record *after* it for step 1, and so
 * on. Any step with no findable witness fails.
 */
export function witnessesInOrder(
  actions: ReadonlyArray<string>,
  steps: ReadonlyArray<ReadonlyArray<string>>
): boolean {
  let cursor = -1;
  for (const witnesses of steps) {
    let found = -1;
    for (let index = cursor + 1; index < actions.length; index += 1) {
      const action = actions[index];
      if (action !== undefined && witnesses.includes(action)) {
        found = index;
        break;
      }
    }
    if (found === -1) return false;
    cursor = found;
  }
  return true;
}

/** True when every required action appears somewhere in the log (order-free). */
export function coversAll(actions: ReadonlyArray<string>, required: ReadonlyArray<string>): boolean {
  return required.every((action) => actions.includes(action));
}


export class ActionHistory {
  private readonly limit: number;
  private readonly records: ActionRecord[] = [];
  private nextSeq = 1;
  private versionValue = 0;

  constructor(options: { readonly limit?: number | undefined } = {}) {
    this.limit = Math.max(1, Math.floor(options.limit ?? DEFAULT_ACTION_LIMIT));
  }

  /** Record an action. Blank ids are refused (`false`); a repeat is allowed. */
  append(action: string): boolean {
    const trimmed = action.trim();
    if (trimmed.length === 0) return false;
    this.records.push({ action: trimmed, seq: this.nextSeq });
    this.nextSeq += 1;
    if (this.records.length > this.limit) this.records.shift();
    this.versionValue += 1;
    return true;
  }

  has(action: string): boolean {
    return this.records.some((record) => record.action === action);
  }

  count(action: string): number {
    return this.records.filter((record) => record.action === action).length;
  }

  /** First record index of an action at or after `fromIndex`, or -1. */
  indexOf(action: string, fromIndex = 0): number {
    for (let index = Math.max(0, fromIndex); index < this.records.length; index += 1) {
      if (this.records[index]?.action === action) return index;
    }
    return -1;
  }

  /** The ordered action ids — a fresh array, so callers cannot mutate the log. */
  get actions(): ReadonlyArray<string> {
    return this.records.map((record) => record.action);
  }

  /** Ordered records (debug/DTO use). A fresh array of immutable records. */
  get entries(): ReadonlyArray<ActionRecord> {
    return this.records.map((record) => ({ ...record }));
  }

  get size(): number {
    return this.records.length;
  }

  /**
   * Changes on every append/restore/reset — lets the composition notice "the staged
   * input changed" without comparing arrays per frame (ARCH §35.3).
   */
  get version(): number {
    return this.versionValue;
  }

  /** §24.1 `state: 'primed'`: all priming actions happened, any order. */
  coversAll(required: ReadonlyArray<string>): boolean {
    return coversAll(this.actions, required);
  }

  /** ADR-018 ordered-witness rule over this log. */
  witnessesInOrder(steps: ReadonlyArray<ReadonlyArray<string>>): boolean {
    return witnessesInOrder(this.actions, steps);
  }

  snapshot(): ActionHistorySnapshot {
    return { actions: this.actions };
  }

  /**
   * §31.5 load path. Malformed input is *cleared*, never thrown on: `restore` must
   * never leave the game unbootable (§38), and the codec validates the DTO's shape
   * first — this seam is doubly defensive because a non-array here means the caller
   * (not the file) is at fault. Skipping blank entries preserves the order of the
   * rest, so a single bad record cannot scramble the witnesses that follow it.
   */
  restore(snapshot: { readonly actions: ReadonlyArray<string> }): void {
    this.records.length = 0;
    this.nextSeq = 1;
    const entries = Array.isArray(snapshot.actions) ? snapshot.actions : [];
    for (const action of entries) {
      if (typeof action !== 'string') continue;
      const trimmed = action.trim();
      if (trimmed.length === 0) continue;
      this.records.push({ action: trimmed, seq: this.nextSeq });
      this.nextSeq += 1;
    }
    while (this.records.length > this.limit) this.records.shift();
    this.versionValue += 1;
  }

  /** New Game (§25): the staged input is player progress, so it resets with it. */
  resetAll(): void {
    this.records.length = 0;
    this.nextSeq = 1;
    this.versionValue += 1;
  }
}
