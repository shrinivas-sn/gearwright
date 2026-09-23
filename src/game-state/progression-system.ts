/**
 * L1 — the progression system (ARCH §12.2, §26, §40 `game-state/`).
 *
 * One owner for branch state, the derived hub stage and the discovered-clue set.
 * §12.2 makes it canonical, and §26 fixes how it learns things: **progression never
 * inspects the world directly — it consumes events.** So it is deliberately *not* a
 * second copy of puzzle state:
 *
 *   - Puzzle SMs own their own states (§25) and persist them.
 *   - The composition feeds this system the branch's completed-puzzle ids
 *     (`update`), exactly as it feeds `MachineGraph` its attachment edges.
 *   - Branch state and hub stage are **derived** from that set plus the branch/hub
 *     data, which is what §12.2 means by the hub stage being "rebuilt from branch
 *     completions" — there is no hub-stage field to desync.
 *
 * The only canonical *field* here is the clue set (§12.2 "Discovered clues / log
 * entries ... Canonical (seen-id set)"), which is why it — and only it — is captured
 * into the save and restored from it (§31.1 already carries `progression.storyClues`).
 *
 * This system holds no ports and reads no transforms: it is pure L1 logic, headless
 * and engine-free like everything else in this layer (§11 rule R2).
 */

import type { PuzzleState } from './puzzle-system.ts';

/** §26 `BranchState`. `Locked`/`Available` are the gated states (EC-*: doors read them). */
export type BranchState = 'Locked' | 'Available' | 'InProgress' | 'Complete';

/**
 * A branch of the hub (§6). Content lives in `data/`; the *shape* lives here, like
 * every other content contract in L1 (`PuzzleDefinition`, `RewardDefinition`).
 */
export interface BranchDefinition {
  readonly id: string;
  readonly title: string;
  /** The branch's puzzles, in authoring order. Empty = no content yet. */
  readonly puzzleIds: ReadonlyArray<string>;
  /** Branches that must be Complete before this one is Available. */
  readonly requiresBranches: ReadonlyArray<string>;
  /**
   * Build-time seal (§6: Branch B and C are "sealed, visual" in the MVP). A sealed
   * branch never becomes Available whatever its requirements say — the door is
   * geometry, and progression agrees with it rather than contradicting it. When the
   * branch's content lands, the flag goes away and the door opens by itself.
   */
  readonly sealed: boolean;
}

/**
 * One ordered hub stage (§6/§26): the central machine's visible progress. A stage is
 * reached when every branch it requires is Complete, so the *highest* satisfied stage
 * in authoring order is the current one (`HUB_STAGE_DEFINITIONS` is authored low → high).
 */
export interface HubStageDefinition {
  readonly id: string;
  readonly title: string;
  readonly requiresBranches: ReadonlyArray<string>;
}

export class ProgressionSystem {
  private readonly branches: ReadonlyArray<BranchDefinition>;
  private readonly stages: ReadonlyArray<HubStageDefinition>;
  /** Derived input: the branch's completed puzzles (owned by the puzzle SMs, §25). */
  private completedPuzzleIds: ReadonlySet<string> = new Set();
  /** Canonical (§12.2): discovered clue ids. */
  private readonly clueIds = new Set<string>();

  constructor(
    branches: ReadonlyArray<BranchDefinition>,
    stages: ReadonlyArray<HubStageDefinition>
  ) {
    this.branches = branches;
    this.stages = stages;
  }

  /**
   * Feed the authoritative completion set. Cheap and idempotent: the composition
   * calls it from the same place it consumes `PuzzleCompleted` (§31.4 triggers),
   * never per frame.
   */
  update(completedPuzzleIds: ReadonlyArray<string>): void {
    this.completedPuzzleIds = new Set(completedPuzzleIds);
  }

  /** Convenience for the composition: the ids of every puzzle currently `Complete`. */
  get completed(): ReadonlyArray<string> {
    return [...this.completedPuzzleIds].sort();
  }

  branchDefinition(branchId: string): BranchDefinition | null {
    return this.branches.find((branch) => branch.id === branchId) ?? null;
  }

  /** The branch a puzzle belongs to, or null when content names an unknown puzzle. */
  branchOf(puzzleId: string): BranchDefinition | null {
    return this.branches.find((branch) => branch.puzzleIds.includes(puzzleId)) ?? null;
  }

  /**
   * §26's branch state, derived. An unknown branch is `Locked` (never reachable): a
   * door naming a branch that does not exist must not open.
   */
  branchState(branchId: string): BranchState {
    const branch = this.branchDefinition(branchId);
    if (branch === null || branch.sealed) return 'Locked';
    if (!branch.requiresBranches.every((required) => this.isBranchComplete(required))) {
      return 'Locked';
    }
    if (branch.puzzleIds.length === 0) return 'Available';
    const done = branch.puzzleIds.filter((puzzleId) => this.completedPuzzleIds.has(puzzleId)).length;
    if (done === 0) return 'Available';
    return done === branch.puzzleIds.length ? 'Complete' : 'InProgress';
  }

  /**
   * The AccessGate rule (§6): a door opens when its branch is anything but `Locked`.
   * It lives here, in L1, because §26 requires gating to be enforced by reading
   * branch state — never by scene geometry. A door's *volume* is level data; whether
   * it blocks is this function's answer, so the two can never disagree.
   */
  canEnter(branchId: string): boolean {
    return this.branchState(branchId) !== 'Locked';
  }

  /**
   * The state a puzzle's SM starts in on a fresh load (§25 `Locked` → `Available` →
   * `InProgress`).
   *
   * The MVP ships one scene, so a puzzle that is *composed at all* is a puzzle the
   * player is standing in: a non-gated branch's puzzles start `InProgress`, which is
   * exactly the behaviour M6 shipped. `Available` is the pre-load state for §34's
   * additive branch chunks, and a gated branch's puzzles start `Locked` — the door
   * and the SM then agree, and `PuzzleSystem.unlock()`/`begin()` walk the two edges.
   */
  initialPuzzleState(puzzleId: string): PuzzleState {
    const branch = this.branchOf(puzzleId);
    if (branch === null) return 'Locked';
    return this.branchState(branch.id) === 'Locked' ? 'Locked' : 'InProgress';
  }

  /** True when a branch's puzzles are all complete (the hub's building block). */
  isBranchComplete(branchId: string): boolean {
    const branch = this.branchDefinition(branchId);
    if (branch === null || branch.sealed || branch.puzzleIds.length === 0) return false;
    return branch.puzzleIds.every((puzzleId) => this.completedPuzzleIds.has(puzzleId));
  }

  /** Index into `HUB_STAGE_DEFINITIONS`: the last stage whose requirements are met. */
  get hubStageIndex(): number {
    let index = 0;
    for (let i = 0; i < this.stages.length; i += 1) {
      const stage = this.stages[i];
      if (stage && stage.requiresBranches.every((required) => this.isBranchComplete(required))) {
        index = i;
      }
    }
    return index;
  }

  /** The current hub stage. Empty stage data degrades to a synthetic dormant stage. */
  get hubStage(): HubStageDefinition {
    return this.stages[this.hubStageIndex] ?? EMPTY_STAGE;
  }

  // --- clues (§12.2: a seen-id set; the only canonical field here) ---------------

  /** Record a discovery. Returns true when it was genuinely new (set semantics). */
  discoverClue(clueId: string): boolean {
    if (this.clueIds.has(clueId)) return false;
    this.clueIds.add(clueId);
    return true;
  }

  hasClue(clueId: string): boolean {
    return this.clueIds.has(clueId);
  }

  get discoveredClueIds(): ReadonlyArray<string> {
    return [...this.clueIds].sort();
  }

  /** §31.5 load protocol: the saved seen-id set replaces the current one. */
  restoreClues(clueIds: ReadonlyArray<string>): void {
    this.clueIds.clear();
    for (const clueId of clueIds) this.clueIds.add(clueId);
  }

  /**
   * New Game only (§12.2 "New Game resets"). Branch state re-derives from an empty
   * completion set, so there is nothing else to clear.
   */
  resetAll(): void {
    this.clueIds.clear();
    this.completedPuzzleIds = new Set();
  }
}

const EMPTY_STAGE: HubStageDefinition = { id: 'stage/none', title: '', requiresBranches: [] };
