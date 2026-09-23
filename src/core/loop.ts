/**
 * L0 PLATFORM CORE — fixed-timestep driver (ADR-007, ARCH §14).
 *
 * Pure logic: no DOM, no `three`, no timers. A real frame clock is injected;
 * tests drive `advance()` with synthetic timestamps, which is what makes
 * gameplay determinism verifiable headlessly (TEST §3).
 *
 * Contract:
 *  - frame delta is clamped to `maxFrameDelta` (tab-switch / breakpoint guard)
 *  - at most `maxSubSteps` simulation steps per frame
 *  - any remaining backlog is DROPPED (never spirals into catch-up)
 *  - `render` receives an interpolation alpha in [0,1); interpolation is visual only
 */

export interface FixedStepConfig {
  /** Seconds per simulation step. */
  readonly fixedDt: number;
  /** Hard cap on simulation steps per rendered frame. */
  readonly maxSubSteps: number;
  /** Maximum accepted frame delta in seconds. */
  readonly maxFrameDelta: number;
}

export const DEFAULT_LOOP_CONFIG: FixedStepConfig = {
  fixedDt: 1 / 30,
  maxSubSteps: 5,
  maxFrameDelta: 0.25
};

export interface LoopCallbacks {
  /** Advance simulation by exactly `dt` seconds. Must be deterministic. */
  fixedStep(dt: number, stepIndex: number): void;
  /** Present the frame. `alpha` is interpolation between the previous and current sim states. */
  render(alpha: number, frameDelta: number): void;
}

export interface LoopStats {
  /** Rendered frames processed. */
  readonly frames: number;
  /** Simulation steps executed. */
  readonly steps: number;
  /** Frames where the substep cap was hit and backlog was discarded. */
  readonly droppedBacklog: number;
  /** Last unclamped frame delta in seconds (raw sensor value, for diagnostics). */
  readonly lastRawFrameDelta: number;
  /** Last clamped frame delta actually simulated. */
  readonly lastFrameDelta: number;
  /** Leftover time carried into the next frame, in seconds. */
  readonly accumulator: number;
}

export interface SteppedFrame {
  readonly steps: number;
  readonly alpha: number;
  readonly droppedBacklog: boolean;
}

const isFinitePositive = (value: number): boolean => Number.isFinite(value) && value > 0;

export class FixedStepLoop {
  private readonly config: FixedStepConfig;
  private readonly callbacks: LoopCallbacks;
  private accumulatorSeconds = 0;
  private lastTimestampMs: number | null = null;
  private counters = { frames: 0, steps: 0, droppedBacklog: 0 };
  private lastRawFrameDelta = 0;
  private lastFrameDelta = 0;

  constructor(callbacks: LoopCallbacks, config: Partial<FixedStepConfig> = {}) {
    const merged: FixedStepConfig = { ...DEFAULT_LOOP_CONFIG, ...config };

    if (!isFinitePositive(merged.fixedDt)) {
      throw new RangeError('FixedStepLoop: fixedDt must be a finite number > 0');
    }
    if (!Number.isInteger(merged.maxSubSteps) || merged.maxSubSteps < 1) {
      throw new RangeError('FixedStepLoop: maxSubSteps must be an integer >= 1');
    }
    if (!isFinitePositive(merged.maxFrameDelta)) {
      throw new RangeError('FixedStepLoop: maxFrameDelta must be a finite number > 0');
    }

    this.config = merged;
    this.callbacks = callbacks;
  }

  /**
   * Process one rendered frame at absolute time `nowMs` (e.g. `performance.now()`).
   * The first call establishes the time origin and performs no steps.
   */
  advance(nowMs: number): SteppedFrame {
    if (!Number.isFinite(nowMs)) {
      // Sanitizer (ARCH §38): a corrupt clock must not poison simulation state.
      return { steps: 0, alpha: this.currentAlpha(), droppedBacklog: false };
    }

    const previous = this.lastTimestampMs;
    this.lastTimestampMs = nowMs;

    if (previous === null) {
      return { steps: 0, alpha: 0, droppedBacklog: false };
    }

    const rawDeltaSeconds = (nowMs - previous) / 1000;
    // A non-positive delta (clock going backwards, duplicate timestamp) is ignored.
    if (!Number.isFinite(rawDeltaSeconds) || rawDeltaSeconds <= 0) {
      this.lastRawFrameDelta = 0;
      this.lastFrameDelta = 0;
      return { steps: 0, alpha: this.currentAlpha(), droppedBacklog: false };
    }

    this.lastRawFrameDelta = rawDeltaSeconds;
    const frameDelta = Math.min(rawDeltaSeconds, this.config.maxFrameDelta);
    this.lastFrameDelta = frameDelta;
    this.accumulatorSeconds += frameDelta;

    let steps = 0;
    while (this.accumulatorSeconds >= this.config.fixedDt && steps < this.config.maxSubSteps) {
      this.callbacks.fixedStep(this.config.fixedDt, steps);
      this.accumulatorSeconds -= this.config.fixedDt;
      steps += 1;
    }

    const droppedBacklog = steps === this.config.maxSubSteps && this.accumulatorSeconds >= this.config.fixedDt;
    if (droppedBacklog) {
      // Discard the backlog instead of trying to catch up forever (ARCH §14).
      this.accumulatorSeconds = 0;
      this.counters.droppedBacklog += 1;
    }

    this.counters.frames += 1;
    this.counters.steps += steps;

    const alpha = this.currentAlpha();
    this.callbacks.render(alpha, frameDelta);
    return { steps, alpha, droppedBacklog };
  }

  /** Clear timing state (used on resume from suspension so no time is replayed). */
  reset(): void {
    this.lastTimestampMs = null;
    this.accumulatorSeconds = 0;
    this.lastRawFrameDelta = 0;
    this.lastFrameDelta = 0;
  }

  /** Clear timing state *and* cumulative counters. */
  resetCounters(): void {
    this.reset();
    this.counters = { frames: 0, steps: 0, droppedBacklog: 0 };
  }

  private currentAlpha(): number {
    const alpha = this.accumulatorSeconds / this.config.fixedDt;
    if (!Number.isFinite(alpha) || alpha <= 0) return 0;
    return alpha >= 1 ? 0.999999 : alpha;
  }

  get configSnapshot(): FixedStepConfig {
    return this.config;
  }

  get stats(): LoopStats {
    return {
      ...this.counters,
      lastRawFrameDelta: this.lastRawFrameDelta,
      lastFrameDelta: this.lastFrameDelta,
      accumulator: this.accumulatorSeconds
    };
  }
}