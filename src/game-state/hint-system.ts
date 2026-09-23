/**
 * L1 — the hint / scanner escalation ladder (ARCH §29.1, §29.2, §40 `game-state/hint-system.ts`).
 *
 * §29's principle is *layers, never the answer*: assistance climbs L0 → L4 one rung at a
 * time, L3 is the scanner and L4 is a conceptual nudge that still names no placement
 * ("Never given", §29.1). Two §29.2 rules shape every line here:
 *
 *   1. **Anti-annoyance.** Idling while exploring escalates nothing: the stall clock only
 *      runs while the composition reports the player *inside* a puzzle area *and*
 *      interacting with its machine (`HintEngagement`), and it is generous
 *      (`DEFAULT_STALL_SECONDS`). Automatic escalation stops at L2 — the scanner reveal is
 *      a deliberate act, never something that happens to a player who is merely thinking.
 *      A level that is no longer needed decays one rung per `decaySeconds`, so a returning
 *      player is not spammed at L4.
 *   2. **Tracked completely independently of puzzle state.** This is the canonical
 *      `HintState` of §12.2/§31.1, and it is read-only with respect to the puzzle SMs: it
 *      never evaluates a requirement, never writes a `PuzzleState` and never gates a
 *      reward. `PuzzleState` appears here as a *type* only (the sole import in this file),
 *      and completion is *reported* to the ladder, never decided by it (§29.2).
 *
 * `update()` is the only source of puzzle state, because the composed
 * `request(puzzleId)` signature carries none: the last reported state per puzzle is
 * remembered and used to apply §29.2's immunity rule (a puzzle at `Complete`, `Locked` or
 * `Available` answers a request with its current level and counts nothing). A puzzle that
 * has not been reported since construction is treated as workable — the composition hands
 * the hint key to the puzzle the player is standing in, and §25's gating answer arrives
 * with the very next fixed step.
 *
 * `Activated` is deliberately outside the workable set: the machine already runs and the
 * SM is latching to `Complete`, so there is nothing left to hint at. `Complete` also stops
 * the stall clock (it is not workable), which settles the decision §29.2 leaves open.
 *
 * The scanner blueprint is *not* read here. §29.1's L3 trigger is "scanner unlocked
 * (blueprint) + request", and the blueprint lives in `InventorySystem` (§27.3) — an L1
 * hint owner must not reach into the inventory, so the composition withholds the ladder
 * above L2 until the player owns `blueprint/scanner`. What is encoded here is exactly the
 * split §29.2 demands: the *stall* path caps at L2, the *request* path reaches `maxLevel`.
 *
 * Time is the fixed step's `dt` (§14 step 8) — no wall clock, so assistance is as
 * deterministic and replayable as the rest of the simulation.
 */

import type { PuzzleState } from './puzzle-system.ts';

/** §29.1's five layers: L0 nothing … L4 conceptual hint. */
export type HintLevel = 0 | 1 | 2 | 3 | 4;

/** The ladder in order. Doubles as the clamp table, so a rung is `LADDER[rung]`. */
const LADDER: ReadonlyArray<HintLevel> = [0, 1, 2, 3, 4];

/** §29.1's top rung. A sixth layer means a new `HintLevel` member *and* a data row. */
export const MAX_HINT_LEVEL: HintLevel = 4;

/**
 * §29.2's "generous" idling threshold, in seconds of *engaged* work on one machine.
 * "Generous" is tens of seconds: an unasked-for cue must feel late, never early.
 */
export const DEFAULT_STALL_SECONDS = 45;

/** §29.2's decay window: "decays slowly so a returning player isn't spammed at L4". */
export const DEFAULT_DECAY_SECONDS = 180;

/**
 * The ceiling of the *automatic* path (§29.1's trigger column): L2 is the last layer the
 * ladder may hand out unprompted. L3 is the scanner ("blueprint + request") and L4 is
 * asked for explicitly, so both live on the request path only.
 */
export const AUTOMATIC_STALL_CAP: HintLevel = 2;

/** What the composition knows about the player's engagement with a puzzle (§29.2). */
export interface HintEngagement {
  readonly puzzleId: string | null;
  readonly puzzleState: PuzzleState;
  /** True only while the player is inside the puzzle area AND interacting with its machine. */
  readonly engaged: boolean;
}

/** The read-model row of §33.1's hint affordance (§31.1 persists `level`). */
export interface HintSnapshot {
  readonly puzzleId: string;
  readonly level: HintLevel;
  readonly requests: number;
  readonly stalledSec: number;
}

export interface HintSystemOptions {
  readonly puzzleIds: ReadonlyArray<string>;
  readonly stallSeconds?: number | undefined; // default 45 (§29.2 "generous"), step up one level
  readonly decaySeconds?: number | undefined; // default 180, step down one level
  readonly maxLevel?: HintLevel | undefined; // default 4
}

/** One puzzle's ladder row: the canonical `HintLevel` plus the §29.2 clocks. */
interface HintRow {
  level: HintLevel;
  requests: number;
  /** Engaged seconds accumulated toward the next step-up. */
  stallSec: number;
  /** Seconds since the last request or stall step — the decay clock. */
  idleSec: number;
  /** Last state the composition reported, or null before the first report. */
  lastState: PuzzleState | null;
}

/**
 * §25 states in which a hint can mean anything. `Activated` is absent on purpose (the
 * machine already runs and the SM is latching to `Complete`), and `null` — "not reported
 * yet" — counts as workable so the hint key answers on frame one.
 */
function acceptsHints(state: PuzzleState | null): boolean {
  return state === null || state === 'InProgress' || state === 'Assembled' || state === 'Validated';
}

/** Tuning guards behave like `FixedStepLoop`'s: an authored mistake is loud, not silent. */
function positiveSeconds(value: number | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`HintSystem: ${name} must be a finite number > 0`);
  }
  return value;
}

/**
 * Floor an authored or saved number onto the ladder and clamp it to `cap`: a non-finite
 * value (corrupt save row, `NaN` out of arithmetic) is L0, and 9 is L4 rather than a rung
 * that does not exist.
 */
function levelAtMost(value: number, cap: HintLevel): HintLevel {
  if (!Number.isFinite(value)) return 0;
  const rung = Math.floor(value);
  if (rung <= 0) return 0;
  return LADDER[rung < cap ? rung : cap] ?? 0;
}

/** One rung up, never above `cap` (`cap ≤ MAX_HINT_LEVEL`, so the lookup always exists). */
function rungAbove(level: HintLevel, cap: HintLevel): HintLevel {
  if (level >= cap) return level;
  return LADDER[level + 1] ?? level;
}

/** One rung down, floored at L0 (§29.2: decay never goes negative). */
function rungBelow(level: HintLevel): HintLevel {
  if (level <= 0) return 0;
  return LADDER[level - 1] ?? 0;
}

/** A fresh row: L0, nothing counted, both clocks at zero, no state reported yet. */
function newRow(): HintRow {
  return { level: 0, requests: 0, stallSec: 0, idleSec: 0, lastState: null };
}

export class HintSystem {
  private readonly stallSeconds: number;
  private readonly decaySeconds: number;
  private readonly maxLevel: HintLevel;
  private readonly rows = new Map<string, HintRow>();

  constructor(options: HintSystemOptions) {
    this.stallSeconds = positiveSeconds(options.stallSeconds, DEFAULT_STALL_SECONDS, 'stallSeconds');
    this.decaySeconds = positiveSeconds(options.decaySeconds, DEFAULT_DECAY_SECONDS, 'decaySeconds');
    this.maxLevel = levelAtMost(options.maxLevel ?? MAX_HINT_LEVEL, MAX_HINT_LEVEL);
    for (const puzzleId of options.puzzleIds) {
      // A repeated id keeps the first row: one puzzle, one ladder (EC-style hygiene).
      if (this.rows.has(puzzleId)) continue;
      this.rows.set(puzzleId, newRow());
    }
  }

  /**
   * Explicit request (hint key / button): always answers immediately and advances at most
   * one level (§29.2). An unknown id is ignored and answered with L0, and a puzzle that
   * cannot be worked on (§29.2 immunity: `Complete`, `Locked`, `Available`, and the
   * `Activated` latch window) is answered with its current level *without* counting a
   * request — the HUD must never show a hint spent on a puzzle that cannot take one.
   */
  request(puzzleId: string): HintLevel {
    const row = this.rows.get(puzzleId);
    if (row === undefined) return 0;
    if (!acceptsHints(row.lastState)) return row.level;

    row.level = rungAbove(row.level, this.maxLevel);
    row.requests += 1;
    // A request is attention paid to *this* puzzle: both clocks restart, so the ladder
    // cannot hand out a stall step on the very next tick (double-escalation) and the
    // decay rule does not fire on a player who is actively asking for help.
    row.idleSec = 0;
    row.stallSec = 0;
    return row.level;
  }

  /**
   * One fixed step of the §29.2 rules. `dt` is seconds, and a non-finite or non-positive
   * step is ignored outright (the §38 sanitizer: a corrupt frame must not poison the
   * clocks — the same guard `FixedStepLoop` applies to its own delta).
   */
  update(dt: number, engagement: HintEngagement): void {
    if (!Number.isFinite(dt) || dt <= 0) return;

    const reported = engagement.puzzleId === null ? undefined : this.rows.get(engagement.puzzleId);
    // The report is recorded even while the player is only looking around: immunity has to
    // track the state the moment it changes, not only while the machine is being handled.
    if (reported !== undefined) reported.lastState = engagement.puzzleState;

    // §29.2: exactly one puzzle's stall clock can run — the one the player is inside and
    // working. Every other puzzle is *being ignored*, which is precisely what the decay
    // rule exists for.
    const worked =
      reported !== undefined && engagement.engaged && acceptsHints(engagement.puzzleState)
        ? reported
        : undefined;

    for (const row of this.rows.values()) {
      if (row === worked) {
        row.stallSec += dt;
        if (row.stallSec >= this.stallSeconds) {
          // Reset rather than carry the remainder: one step per closed window, and never a
          // second step on the very next tick (§29.2).
          row.stallSec = 0;
          row.idleSec = 0; // stall progress restarts the decay clock
          row.level = rungAbove(row.level, Math.min(AUTOMATIC_STALL_CAP, this.maxLevel) as HintLevel);
        }
        continue;
      }

      row.idleSec += dt;
      if (row.idleSec >= this.decaySeconds) {
        row.idleSec = 0;
        row.level = rungBelow(row.level);
      }
    }
  }

  /** Current rung for a puzzle; an unknown id is L0 (§33.1's indicator never guesses). */
  level(puzzleId: string): HintLevel {
    const row = this.rows.get(puzzleId);
    return row === undefined ? 0 : row.level;
  }

  /** How many hints this puzzle has spent (§31.1's `hintsUsed`); an unknown id is 0. */
  requestsFor(puzzleId: string): number {
    const row = this.rows.get(puzzleId);
    return row === undefined ? 0 : row.requests;
  }

  /**
   * §31.1 `puzzles[puzzleId].hintLevel` — canonical, restored independently of puzzle
   * state. A restore *replaces* the ladder (every row starts clean and only the file's
   * rows survive), so a save loaded mid-session cannot leave a stale level or clock
   * behind. Unknown ids are ignored and never create a row; out-of-range values are
   * floored onto the ladder and clamped to `maxLevel`; non-finite values become L0.
   *
   * The frozen signature carries levels only, so `requests` is not restored here: the
   * counter restarts at 0 with the restored level (see the report for the save-side seam).
   */
  restore(levels: Readonly<Record<string, number>>): void {
    this.zeroRows();
    for (const [puzzleId, value] of Object.entries(levels)) {
      const row = this.rows.get(puzzleId);
      if (row === undefined) continue;
      row.level = levelAtMost(value, this.maxLevel);
    }
  }

  /**
   * New Game only (§12.2's `HintState` row): every puzzle back to L0 with both clocks and
   * the request counters cleared. The last *reported* state is deliberately kept — it is
   * the composition's report, re-sent every fixed step, and clearing it would only open a
   * one-tick window in which §29.2's immunity cannot be applied.
   */
  resetAll(): void {
    this.zeroRows();
  }

  /**
   * Read model for §33.1's hint affordance and the debug overlay. Rows come back in the
   * order the composition declared its puzzles (stable, and no sort per frame), and the
   * array plus its rows are fresh objects, so a consumer cannot reach into the ladder.
   */
  snapshot(): ReadonlyArray<HintSnapshot> {
    const rows: HintSnapshot[] = [];
    for (const [puzzleId, row] of this.rows) {
      rows.push({
        puzzleId,
        level: row.level,
        requests: row.requests,
        stalledSec: row.stallSec
      });
    }
    return rows;
  }

  /** Level, counters and both clocks to zero — the shared body of restore and New Game. */
  private zeroRows(): void {
    for (const row of this.rows.values()) {
      row.level = 0;
      row.requests = 0;
      row.stallSec = 0;
      row.idleSec = 0;
    }
  }
}

