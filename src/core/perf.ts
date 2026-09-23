/**
 * L0 PLATFORM CORE — frame statistics and budget accounting (ARCH §35/§36, §37 overlay).
 * Pure logic: no DOM, no `three`. The debug overlay (L4) only reads snapshots.
 */

export interface FrameSample {
  /** Frame duration in ms (wall clock between frames). */
  readonly frameMs: number;
  /** Simulation steps executed during this frame. */
  readonly steps: number;
  /** Optional render statistics snapshot. */
  readonly drawCalls?: number;
  readonly triangles?: number;
  readonly lights?: number;
}

export interface PerfBudget {
  /** Ideal frame budget in ms (60 FPS). */
  readonly frameBudgetMs: number;
  /** Acceptable floor in ms (45 FPS, ARCH §36.1). */
  readonly frameFloorMs: number;
  /** Ceilings from ARCH §36.2/§36.3. */
  readonly drawCallCeiling: number;
  readonly triangleCeiling: number;
  readonly lightCeiling: number;
}

export const DEFAULT_PERF_BUDGET: PerfBudget = {
  frameBudgetMs: 16.67,
  frameFloorMs: 22.22,
  drawCallCeiling: 150,
  triangleCeiling: 250_000,
  lightCeiling: 8
};

export type BudgetStatus = 'ok' | 'warn' | 'over';

export interface PerfSnapshot {
  readonly samples: number;
  readonly fps: number;
  readonly lastFrameMs: number;
  readonly avgFrameMs: number;
  readonly maxFrameMs: number;
  /** 95th percentile frame time over the rolling window. */
  readonly p95FrameMs: number;
  readonly avgSteps: number;
  readonly worstDrawCalls: number;
  readonly worstTriangles: number;
  readonly worstLights: number;
  readonly frameStatus: BudgetStatus;
  readonly drawStatus: BudgetStatus;
  readonly triangleStatus: BudgetStatus;
  readonly lightStatus: BudgetStatus;
}

const EMPTY_SNAPSHOT: PerfSnapshot = {
  samples: 0,
  fps: 0,
  lastFrameMs: 0,
  avgFrameMs: 0,
  maxFrameMs: 0,
  p95FrameMs: 0,
  avgSteps: 0,
  worstDrawCalls: 0,
  worstTriangles: 0,
  worstLights: 0,
  frameStatus: 'ok',
  drawStatus: 'ok',
  triangleStatus: 'ok',
  lightStatus: 'ok'
};

export class FrameStatsRecorder {
  private readonly windowSize: number;
  private readonly budget: PerfBudget;
  private frameTimes: number[] = [];
  private stepsTotal = 0;
  private samplesTotal = 0;
  private worstDrawCalls = 0;
  private worstTriangles = 0;
  private worstLights = 0;

  constructor(budget: Partial<PerfBudget> = {}, windowSize = 120) {
    this.budget = { ...DEFAULT_PERF_BUDGET, ...budget };
    if (!Number.isInteger(windowSize) || windowSize < 1) {
      throw new RangeError('FrameStatsRecorder: windowSize must be an integer >= 1');
    }
    this.windowSize = windowSize;
  }

  record(sample: FrameSample): void {
    const frameMs = Number.isFinite(sample.frameMs) && sample.frameMs >= 0 ? sample.frameMs : 0;
    this.frameTimes.push(frameMs);
    if (this.frameTimes.length > this.windowSize) {
      this.frameTimes.shift();
    }

    const steps = Number.isFinite(sample.steps) && sample.steps > 0 ? sample.steps : 0;
    this.stepsTotal += steps;
    this.samplesTotal += 1;

    this.worstDrawCalls = Math.max(this.worstDrawCalls, sample.drawCalls ?? 0);
    this.worstTriangles = Math.max(this.worstTriangles, sample.triangles ?? 0);
    this.worstLights = Math.max(this.worstLights, sample.lights ?? 0);
  }

  reset(): void {
    this.frameTimes = [];
    this.stepsTotal = 0;
    this.samplesTotal = 0;
    this.worstDrawCalls = 0;
    this.worstTriangles = 0;
    this.worstLights = 0;
  }

  get budgetSnapshot(): PerfBudget {
    return this.budget;
  }

  snapshot(): PerfSnapshot {
    if (this.frameTimes.length === 0) {
      return EMPTY_SNAPSHOT;
    }

    const times = this.frameTimes;
    const sum = times.reduce((total, value) => total + value, 0);
    const avg = sum / times.length;
    const max = Math.max(...times);

    // Deterministic percentile: nearest-rank on a sorted copy (no sampling jitter).
    const sorted = [...times].sort((a, b) => a - b);
    const rankIndex = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
    const p95 = sorted[Math.max(0, rankIndex)] ?? max;

    const avgSteps = this.samplesTotal === 0 ? 0 : this.stepsTotal / this.samplesTotal;

    return {
      samples: times.length,
      fps: avg > 0 ? 1000 / avg : 0,
      lastFrameMs: times[times.length - 1] ?? 0,
      avgFrameMs: avg,
      maxFrameMs: max,
      p95FrameMs: p95,
      avgSteps,
      worstDrawCalls: this.worstDrawCalls,
      worstTriangles: this.worstTriangles,
      worstLights: this.worstLights,
      frameStatus: classify(p95, this.budget.frameFloorMs, this.budget.frameFloorMs * 1.5),
      drawStatus: classify(this.worstDrawCalls, this.budget.drawCallCeiling, this.budget.drawCallCeiling * 1.5),
      triangleStatus: classify(
        this.worstTriangles,
        this.budget.triangleCeiling,
        this.budget.triangleCeiling * 1.5
      ),
      lightStatus: classify(this.worstLights, this.budget.lightCeiling, this.budget.lightCeiling * 1.5)
    };
  }
}

/** ok: within ceiling · warn: up to 1.5× ceiling (headroom watch) · over: past 1.5×. */
export function classify(value: number, ceiling: number, hardCeiling: number): BudgetStatus {
  if (value <= ceiling) return 'ok';
  if (value <= hardCeiling) return 'warn';
  return 'over';
}

/** Monotonic wall-clock reading in ms. Injected so tests never touch a real clock. */
export type Clock = () => number;

export const realClock: Clock = () =>
  typeof performance !== 'undefined' ? performance.now() : Date.now();