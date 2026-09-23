/**
 * L2 — feedback model (ARCH §32.1, §40 `gameplay/feedback-model.ts`).
 *
 * The translation pipeline is: L1/L2 events → **this** model (deterministic,
 * headless: it decides WHAT feedback is warranted) → `FeedbackIntent[]` → the
 * L4 composer decides HOW it looks/sounds. No system plays sound or touches the
 * renderer directly, and feedback never mutates game state (§32.4 rule 1).
 *
 * Deduping lives here (§32.1): a completion produces exactly **one**
 * celebration intent even if the latch were somehow re-reported, machine
 * running/idle are edges rather than levels, and objective changes fire only
 * when the failed-requirement set actually changes (§25 event contract).
 */

import type { SpinDirection } from '../game-state/component-model.ts';
import type { MachineChanged, MachineRuntimeState } from '../game-state/machine-graph.ts';
import type { PuzzleState, PuzzleUpdate } from '../game-state/puzzle-system.ts';
import type { ManipulationStepResult } from './manipulation-system.ts';

/** What the composer should do — plain data, no presentation decision in it. */
export type FeedbackIntent =
  | { readonly kind: 'attach-confirmed'; readonly componentId: string }
  | { readonly kind: 'attach-refused'; readonly componentId: string; readonly reason: string }
  | { readonly kind: 'detach-confirmed'; readonly componentId: string }
  | {
      readonly kind: 'machine-running';
      readonly machineId: string;
      /** Rotation sense of the machine's first output (drives placeholder spin). */
      readonly spin: SpinDirection | null;
    }
  | { readonly kind: 'machine-idle'; readonly machineId: string }
  | { readonly kind: 'puzzle-stage'; readonly puzzleId: string; readonly state: PuzzleState }
  | {
      readonly kind: 'puzzle-completed';
      readonly puzzleId: string;
      readonly milestoneId: string;
    }
  | {
      readonly kind: 'objective-changed';
      readonly puzzleId: string;
      /** First failed requirement id, or null when everything is satisfied. */
      readonly reasonCode: string | null;
    };

export interface FeedbackStepInput {
  readonly manipulation?: ManipulationStepResult | null | undefined;
  readonly machine?: MachineChanged | null | undefined;
  /**
   * Every puzzle evaluated this step (M8). A branch has several puzzles; each one's
   * edges are translated independently, so a completion in P3 cannot be swallowed by
   * P1 sitting at rest.
   */
  readonly puzzles?: ReadonlyArray<PuzzleUpdate> | undefined;
}

const EMPTY_INTENTS: ReadonlyArray<FeedbackIntent> = [];

export class FeedbackModel {
  /** Last seen machine runtime state per machine id (edge detection). */
  private readonly machineStates = new Map<string, MachineRuntimeState>();
  /** Completion celebrations already emitted (§32.1 dedupe — belt over the latch's braces). */
  private readonly celebrated = new Set<string>();
  private puzzleStates = new Map<string, PuzzleState>();
  private reasonCodes = new Map<string, ReadonlyArray<string>>();

  /** One fixed step. Pure with respect to the world; owns only its own mirrors. */
  step(input: FeedbackStepInput): ReadonlyArray<FeedbackIntent> {
    const intents: FeedbackIntent[] = [];

    this.collectManipulation(input.manipulation ?? null, intents);
    this.collectMachine(input.machine ?? null, intents);
    for (const puzzle of input.puzzles ?? []) this.collectPuzzle(puzzle, intents);

    return intents.length === 0 ? EMPTY_INTENTS : intents;
  }

  private collectManipulation(
    manipulation: ManipulationStepResult | null,
    intents: FeedbackIntent[]
  ): void {
    for (const event of manipulation?.events ?? []) {
      if (event.type === 'Attached' && event.id !== null) {
        intents.push({ kind: 'attach-confirmed', componentId: event.id });
      } else if (event.type === 'AttachRefused' && event.id !== null) {
        intents.push({
          kind: 'attach-refused',
          componentId: event.id,
          reason: String(event.reason ?? 'unknown')
        });
      } else if (event.type === 'Detached' && event.id !== null) {
        intents.push({ kind: 'detach-confirmed', componentId: event.id });
      }
    }
  }

  private collectMachine(machine: MachineChanged | null, intents: FeedbackIntent[]): void {
    for (const state of machine?.machines ?? []) {
      const previous = this.machineStates.get(state.machineId);
      this.machineStates.set(state.machineId, state.state);
      if (previous === state.state) continue;
      // "Connected mechanism reacts only if the machine now propagates — no
      // fake motion" (§32.3 layer 4): running/idle are real derived edges.
      if (state.state === 'running') {
        intents.push({
          kind: 'machine-running',
          machineId: state.machineId,
          spin: state.outputs[0]?.spin ?? null
        });
      } else if (previous === 'running') {
        intents.push({ kind: 'machine-idle', machineId: state.machineId });
      }
    }
  }

  private collectPuzzle(puzzle: PuzzleUpdate | null, intents: FeedbackIntent[]): void {
    if (puzzle === null) return;

    const knownState = this.puzzleStates.get(puzzle.puzzleId);
    if (knownState !== puzzle.state) {
      this.puzzleStates.set(puzzle.puzzleId, puzzle.state);
      intents.push({ kind: 'puzzle-stage', puzzleId: puzzle.puzzleId, state: puzzle.state });
    }

    for (const event of puzzle.events) {
      if (event.type === 'PuzzleCompleted' && !this.celebrated.has(event.puzzleId)) {
        this.celebrated.add(event.puzzleId);
        intents.push({
          kind: 'puzzle-completed',
          puzzleId: event.puzzleId,
          milestoneId: event.milestoneId
        });
      }
    }

    const knownReasons = this.reasonCodes.get(puzzle.puzzleId);
    const nextReasons = puzzle.reasonCodes;
    const changed =
      knownReasons === undefined ||
      knownReasons.length !== nextReasons.length ||
      nextReasons.some((code, index) => knownReasons[index] !== code);
    if (changed) {
      this.reasonCodes.set(puzzle.puzzleId, nextReasons);
      intents.push({
        kind: 'objective-changed',
        puzzleId: puzzle.puzzleId,
        reasonCode: nextReasons[0] ?? null
      });
    }
  }
}
