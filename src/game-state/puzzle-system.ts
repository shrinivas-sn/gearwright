/**
 * L1 — the puzzle state machine (ARCH §25, §40 `game-state/puzzle-system.ts`).
 *
 * One instance per puzzle. The validator (§24) is pure and may report
 * `satisfied: true` repeatedly without acting; **this** system owns the two
 * things the architecture reserves for it (EC-PZ-01):
 *
 *   1. the **stable-frame hysteresis counter** — a satisfied result only counts
 *      once it has held for `stableSteps` consecutive evaluations, and
 *   2. the **completion latch** — `PuzzleCompleted` fires exactly once, and
 *      `Complete` is never rewound by later invalidation (EC-PZ-02/03).
 *
 * The SM follows the §25 table exactly:
 *
 *   InProgress →(satisfied)→ Assembled →(hysteresis passed)→ Validated
 *   Validated →(activation confirmed)→ Activated →[PuzzleCompleted once]→ Complete
 *
 * with `Assembled`/`Validated` breaking back to `InProgress` when the machine
 * stops satisfying the requirements, and `reset()` returning the puzzle to
 * `InProgress` without ever touching rewards (the ledger is M7).
 *
 * Activation (§25 "activation input confirmed") is **data**: a puzzle declares
 * what confirms activation. M6 ships `machineRunning` — the machine's own
 * derived `running` state is the confirmation (§24.4: the stable result walks
 * the puzzle through `Validated → Activated`). A discrete player activation
 * key, if a later puzzle wants one, is another `PuzzleActivation` variant — no
 * SM change.
 *
 * Evaluation is dirty-driven (§14 step 8, §35.3): it runs when the machine
 * graph actually changed and while the hysteresis window is open, never as
 * unconditional per-frame work.
 */

import type { MachineContent } from './component-registry.ts';
import type { MachineGraph, MachineRuntimeState } from './machine-graph.ts';
import { DEFAULT_STABLE_STEPS, evaluateRequirements, type Requirement } from './validator.ts';

/** All §25 states, in lifecycle order. `Locked`/`Available` arrive with progression (M9). */
export type PuzzleState =
  | 'Locked'
  | 'Available'
  | 'InProgress'
  | 'Assembled'
  | 'Validated'
  | 'Activated'
  | 'Complete';

/** What confirms activation (§25 "activation input confirmed"). Data, not code. */
export type PuzzleActivation =
  | { readonly kind: 'machineRunning'; readonly machineId: string };

/**
 * A puzzle definition (ARCH §24.1). Machines themselves live in the graph's
 * `MachineContent` bundle — requirements address them by id, which keeps one
 * owner for machine truth (§23). `milestoneId` is the completion milestone the
 * reward ledger will key on (M7); it is carried so the event contract is final.
 */
export interface PuzzleDefinition {
  readonly id: string;
  readonly title: string;
  readonly requirements: ReadonlyArray<Requirement>;
  readonly activation: PuzzleActivation;
  readonly milestoneId: string;
  /** Plain-language text per requirement id, for the objective line (§33.1). */
  readonly objectiveText?: Readonly<Record<string, string>>;
}

export type PuzzleEventType = 'PuzzleStateChanged' | 'PuzzleCompleted' | 'RequirementFailed';

export type PuzzleEvent =
  | {
      readonly type: 'PuzzleStateChanged';
      readonly puzzleId: string;
      readonly from: PuzzleState;
      readonly to: PuzzleState;
    }
  | {
      readonly type: 'PuzzleCompleted';
      readonly puzzleId: string;
      readonly milestoneId: string;
    }
  | {
      readonly type: 'RequirementFailed';
      readonly puzzleId: string;
      readonly reasonCode: string;
    };

export interface PuzzleUpdate {
  readonly puzzleId: string;
  readonly state: PuzzleState;
  readonly previousState: PuzzleState;
  /**
   * Requirement result of this update; `null` when evaluation was skipped
   * (graph unchanged and no hysteresis window open — the common rest case).
   */
  readonly satisfied: boolean | null;
  readonly streak: number;
  /** Ids of the requirements that failed at the last evaluation (§24.2). */
  readonly reasonCodes: ReadonlyArray<string>;
  /** Edges emitted this update; the backing array is reused between updates. */
  readonly events: ReadonlyArray<PuzzleEvent>;
}

export interface PuzzleSystemOptions {
  /** Stable frames a satisfied result must hold (ARCH §24.2, default 3). */
  readonly stableSteps?: number | undefined;
  /**
   * Where the SM starts (§25). Defaults to `InProgress`, which is what a single-scene
   * MVP needs: a composed puzzle is a puzzle the player is standing in. A gated
   * branch's puzzles start `Locked` and walk `Locked → Available → InProgress` through
   * `unlock()`/`begin()` — the composition asks `ProgressionSystem` for the answer.
   */
  readonly initialState?: PuzzleState | undefined;
  /**
   * The §12.2 action history, as a *provider* (ADR-018). A staged puzzle
   * (`state: 'primed'`, `sequence.ordered`) is validated against live player actions,
   * so the SM reads the log on every evaluation rather than capturing a snapshot at
   * construction — a captured array would freeze the first frame's history forever.
   * Absent means "no staged requirements can be satisfied here".
   */
  readonly readActions?: (() => ReadonlyArray<string>) | undefined;
}

export class PuzzleSystem {
  private readonly definition: PuzzleDefinition;
  private readonly graph: MachineGraph;
  private readonly content: MachineContent;
  private readonly stableSteps: number;
  /** ADR-018: the live action log the staged requirements read (absent = no history). */
  private readonly readActions: (() => ReadonlyArray<string>) | undefined;

  private stateValue: PuzzleState = 'InProgress';
  private streak = 0;
  /** False until the first evaluation has run: the objective line needs its reasons. */
  private evaluated = false;
  private lastReasonCodes: ReadonlyArray<string> = [];
  private completedOnce = false;
  private readonly events: PuzzleEvent[] = [];

  constructor(
    definition: PuzzleDefinition,
    graph: MachineGraph,
    content: MachineContent,
    options: PuzzleSystemOptions = {}
  ) {
    this.definition = definition;
    this.graph = graph;
    this.content = content;
    this.stableSteps = Math.max(1, options.stableSteps ?? DEFAULT_STABLE_STEPS);
    this.stateValue = options.initialState ?? 'InProgress';
    this.readActions = options.readActions;
  }

  get puzzleId(): string {
    return this.definition.id;
  }

  get title(): string {
    return this.definition.title;
  }

  get state(): PuzzleState {
    return this.stateValue;
  }

  get reasonCodes(): ReadonlyArray<string> {
    return this.lastReasonCodes;
  }

  /**
   * One fixed step (§14 step 8). `changed` is the caller's
   * "something the validator reads has changed" signal: the machine graph
   * (`MachineGraph.recomputeIfDirty() !== null`) **or** the action history (ADR-018 —
   * a staged requirement changes outcome with no structural change at all). Evaluation
   * is skipped entirely while nothing changed and no hysteresis window is open.
   */
  update(changed: boolean): PuzzleUpdate {
    this.events.length = 0;
    const previousState = this.stateValue;

    // `Complete` is terminal (EC-PZ-03): no evaluation, no rewind, no events.
    if (this.stateValue === 'Complete') {
      return this.snapshot(previousState, null);
    }

    // Gated (§25): `Locked` is not reachable and `Available` has not been entered, so
    // neither evaluates. The objective line stays empty rather than reporting every
    // requirement as failed for a puzzle the player cannot touch yet.
    if (this.stateValue === 'Locked' || this.stateValue === 'Available') {
      return this.snapshot(previousState, null);
    }

    const windowOpen = this.stateValue === 'Assembled' || this.stateValue === 'Validated';
    // The first evaluation is not skipped, even though nothing has changed yet: the
    // objective line (§33.1) reads `reasonCodes`, and at level start "nothing has
    // happened" is exactly when the player needs to know what is missing. After that
    // it stays dirty-driven, so the steady state costs nothing (ARCH §14 step 8).
    if (this.evaluated && !changed && !windowOpen && this.streak === 0) {
      return this.snapshot(previousState, null);
    }
    this.evaluated = true;

    const result = evaluateRequirements(this.definition.requirements, {
      graph: this.graph,
      content: this.content,
      actions: this.readActions?.(),
      previousStreak: this.streak,
      stableSteps: this.stableSteps
    });

    if (result.satisfied) {
      this.streak = result.streak;
      // InProgress → Assembled → Validated → Activated → Complete, in table
      // order; each guard fires only from its own state, so a single update can
      // walk several transitions when the structure has been stable a while.
      if (this.stateValue === 'InProgress') this.transition('Assembled');
      if (this.stateValue === 'Assembled' && result.confirmed) this.transition('Validated');
      if (this.stateValue === 'Validated' && this.activationMet()) {
        this.transition('Activated');
        // The latch (EC-PZ-02): exactly one completion event, ever.
        if (!this.completedOnce) {
          this.completedOnce = true;
          this.events.push({
            type: 'PuzzleCompleted',
            puzzleId: this.definition.id,
            milestoneId: this.definition.milestoneId
          });
        }
        this.transition('Complete');
      }
      this.lastReasonCodes = [];
    } else {
      // A broken structure drops the puzzle back to InProgress and closes the
      // hysteresis window (EC-PZ-01: transient validity never completes).
      this.streak = 0;
      if (this.stateValue === 'Assembled' || this.stateValue === 'Validated') {
        this.transition('InProgress');
      }
      if (changedReasons(result.reasonCodes, this.lastReasonCodes)) {
        for (const reasonCode of result.reasonCodes) {
          this.events.push({ type: 'RequirementFailed', puzzleId: this.definition.id, reasonCode });
        }
      }
      this.lastReasonCodes = result.reasonCodes;
    }

    return this.snapshot(previousState, result.satisfied);
  }

  /**
   * Explicit reset (§25): back to `InProgress`, hysteresis cleared, events
   * drained. `Complete` is never reset here — explicit replay is post-MVP, and
   * the reward ledger (M7) must never be double-granted through a reset.
   */
  reset(): void {
    this.events.length = 0;
    // `Locked`/`Available` are not reset into `InProgress`: that would walk a gated
    // puzzle straight through its door (§25). Only a *started* puzzle re-opens.
    if (
      this.stateValue === 'Complete' ||
      this.stateValue === 'InProgress' ||
      this.stateValue === 'Locked' ||
      this.stateValue === 'Available'
    ) {
      return;
    }
    const from = this.stateValue;
    this.stateValue = 'InProgress';
    this.streak = 0;
    this.evaluated = false;
    this.lastReasonCodes = [];
    this.events.push({
      type: 'PuzzleStateChanged',
      puzzleId: this.definition.id,
      from,
      to: 'InProgress'
    });
  }
  /**
   * Canonical restore (§31.5 load protocol): put the SM back into the saved
   * state without emitting feedback events — a load is not gameplay.
   *
   * The save defines the world, so the latch follows the saved state: a saved
   * `Complete` re-arms as completed (the ledger was already reconciled by
   * `SaveCodec.apply`, and re-evaluation can never fire a second
   * `PuzzleCompleted` — R-4), while a pre-completion save resets the latch so
   * the puzzle can be replayed exactly once more — which is R-6's "reward
   * applied, crash before save → reload from last checkpoint → replay grants
   * once, no duplication": the checkpoint's ledger row set is authoritative,
   * and one replay grant is the *first*, not a duplicate.
   */
  restore(state: PuzzleState): void {
    this.streak = 0;
    this.evaluated = false;
    this.lastReasonCodes = [];
    // A load is not gameplay: nothing pending may leak into the first stepped frame.
    this.events.length = 0;
    if (state === 'Complete') {
      this.completedOnce = true;
      this.stateValue = 'Complete';
      return;
    }
    this.completedOnce = false;
    // The gating states survive a load (§25 lists every state as "Persisted: yes"),
    // otherwise a locked branch's puzzle would come back enterable. Every other
    // non-terminal state reloads as `InProgress` and simply re-validates — the M7
    // behaviour (R-6: a pre-completion checkpoint replays its stable window).
    this.stateValue = state === 'Locked' || state === 'Available' ? state : 'InProgress';
  }

  /**
   * §25 `Locked → Available`: branch access was granted. Idempotent — a repeat unlock
   * is a no-op and can never produce a second edge.
   *
   * The transition deliberately does **not** push into `this.events`: that buffer is
   * drained by `snapshot()` at the end of an `update()`, so an out-of-step transition
   * would have its event cleared by the next step's top-of-update reset. The change is
   * published where every consumer already reads it — `PuzzleUpdate.state`, which the
   * L2 feedback model mirrors and reports as a `puzzle-stage` intent.
   */
  unlock(): boolean {
    if (this.stateValue !== 'Locked') return false;
    this.stateValue = 'Available';
    return true;
  }

  /**
   * §25 `Available → InProgress`: the player entered the puzzle's area. Evaluation
   * starts on the next step, so the §33.1 objective line appears as they arrive.
   */
  begin(): boolean {
    if (this.stateValue !== 'Available') return false;
    this.stateValue = 'InProgress';
    this.evaluated = false;
    return true;
  }

  /** True while the puzzle is not yet playable (§25 `Locked`/`Available`). */
  get isGated(): boolean {
    return this.stateValue === 'Locked' || this.stateValue === 'Available';
  }

  /**
   * Snapshot + event drain: every `PuzzleEvent` is handed to the caller exactly
   * once (the array is reused between updates, like the other L2 event pipes).
   */
  private snapshot(previousState: PuzzleState, satisfied: boolean | null): PuzzleUpdate {
    const drained = this.events.length === 0 ? EMPTY_EVENTS : [...this.events];
    this.events.length = 0;
    return {
      puzzleId: this.definition.id,
      state: this.stateValue,
      previousState,
      satisfied,
      streak: this.streak,
      reasonCodes: this.lastReasonCodes,
      events: drained
    };
  }

  private transition(next: PuzzleState): void {
    if (this.stateValue === next) return;
    const from = this.stateValue;
    this.stateValue = next;
    this.events.push({
      type: 'PuzzleStateChanged',
      puzzleId: this.definition.id,
      from,
      to: next
    });
  }

  /** Activation predicate, evaluated against derived machine state only. */
  private activationMet(): boolean {
    const activation = this.definition.activation;
    // One rule per variant, indexed by the discriminant: `ACTIVATION_RULES` is a
    // total map over `PuzzleActivation['kind']`, so adding a variant without its
    // rule is a compile error (and a second variant also makes this call site
    // non-callable until it becomes an explicit switch) — the vocabulary stays
    // closed and compiler-checked.
    return ACTIVATION_RULES[activation.kind](this.graph, activation);
  }
}

const EMPTY_EVENTS: ReadonlyArray<PuzzleEvent> = [];

/** One activation rule per `PuzzleActivation` variant (ARCH §25 activation input). */
type ActivationRules = {
  readonly [K in PuzzleActivation['kind']]: (
    graph: MachineGraph,
    activation: Extract<PuzzleActivation, { readonly kind: K }>
  ) => boolean;
};

const ACTIVATION_RULES: ActivationRules = {
  machineRunning: (graph, activation) => graph.machineState(activation.machineId)?.state === 'running'
};

function changedReasons(next: ReadonlyArray<string>, previous: ReadonlyArray<string>): boolean {
  if (next.length !== previous.length) return true;
  for (let i = 0; i < next.length; i += 1) {
    if (next[i] !== previous[i]) return true;
  }
  return false;
}

/** Machine runtime state, re-exported for feedback consumers' convenience. */
export type { MachineRuntimeState };
