import { describe, expect, it } from 'vitest';

import { classify, DEFAULT_PERF_BUDGET, FrameStatsRecorder } from '../../src/core/perf.ts';

describe('classify — budget status', () => {
  it('reports ok at or below the ceiling', () => {
    expect(classify(0, 100, 150)).toBe('ok');
    expect(classify(100, 100, 150)).toBe('ok');
  });

  it('reports warn between the ceiling and the hard ceiling', () => {
    expect(classify(101, 100, 150)).toBe('warn');
    expect(classify(150, 100, 150)).toBe('warn');
  });

  it('reports over past the hard ceiling', () => {
    expect(classify(151, 100, 150)).toBe('over');
  });
});

describe('FrameStatsRecorder — aggregation', () => {
  it('returns an empty snapshot before any sample', () => {
    const snapshot = new FrameStatsRecorder().snapshot();

    expect(snapshot.samples).toBe(0);
    expect(snapshot.fps).toBe(0);
    expect(snapshot.frameStatus).toBe('ok');
  });

  it('computes fps, average, max and p95 from the rolling window', () => {
    const recorder = new FrameStatsRecorder({}, 10);
    for (let ms = 1; ms <= 10; ms += 1) {
      recorder.record({ frameMs: ms, steps: 1 });
    }

    const snapshot = recorder.snapshot();

    expect(snapshot.samples).toBe(10);
    expect(snapshot.avgFrameMs).toBeCloseTo(5.5, 5);
    expect(snapshot.maxFrameMs).toBe(10);
    expect(snapshot.p95FrameMs).toBe(10);
    expect(snapshot.lastFrameMs).toBe(10);
    expect(snapshot.fps).toBeCloseTo(1000 / 5.5, 3);
  });

  it('keeps only the last N samples', () => {
    const recorder = new FrameStatsRecorder({}, 3);
    recorder.record({ frameMs: 10, steps: 0 });
    recorder.record({ frameMs: 20, steps: 0 });
    recorder.record({ frameMs: 30, steps: 0 });
    recorder.record({ frameMs: 5, steps: 0 });

    const snapshot = recorder.snapshot();

    expect(snapshot.samples).toBe(3);
    expect(snapshot.avgFrameMs).toBeCloseTo((20 + 30 + 5) / 3, 5);
    expect(snapshot.maxFrameMs).toBe(30);
  });

  it('tracks worst-case render statistics across the window', () => {
    const recorder = new FrameStatsRecorder({ drawCallCeiling: 150, triangleCeiling: 250_000 }, 10);
    recorder.record({ frameMs: 16, steps: 2, drawCalls: 40, triangles: 50_000, lights: 2 });
    recorder.record({ frameMs: 16, steps: 2, drawCalls: 90, triangles: 120_000, lights: 4 });

    const snapshot = recorder.snapshot();

    expect(snapshot.worstDrawCalls).toBe(90);
    expect(snapshot.worstTriangles).toBe(120_000);
    expect(snapshot.worstLights).toBe(4);
    expect(snapshot.drawStatus).toBe('ok');
    expect(snapshot.triangleStatus).toBe('ok');
  });

  it('flags a breached budget', () => {
    const recorder = new FrameStatsRecorder({ drawCallCeiling: 150 }, 5);
    recorder.record({ frameMs: 16, steps: 1, drawCalls: 400 });

    expect(recorder.snapshot().drawStatus).toBe('over');
  });

  it('averages simulation steps per frame', () => {
    const recorder = new FrameStatsRecorder({}, 10);
    recorder.record({ frameMs: 16, steps: 2 });
    recorder.record({ frameMs: 16, steps: 0 });

    expect(recorder.snapshot().avgSteps).toBeCloseTo(1, 5);
  });
});

describe('FrameStatsRecorder — sanitisation and reset', () => {
  it('treats non-finite frame times as zero instead of poisoning statistics', () => {
    const recorder = new FrameStatsRecorder({}, 5);
    recorder.record({ frameMs: Number.NaN, steps: 1 });
    recorder.record({ frameMs: -5, steps: 1 });

    const snapshot = recorder.snapshot();

    expect(snapshot.avgFrameMs).toBe(0);
    expect(snapshot.fps).toBe(0);
  });

  it('ignores negative step counts', () => {
    const recorder = new FrameStatsRecorder({}, 5);
    recorder.record({ frameMs: 16, steps: -3 });

    expect(recorder.snapshot().avgSteps).toBe(0);
  });

  it('reset clears every derived value', () => {
    const recorder = new FrameStatsRecorder({}, 5);
    recorder.record({ frameMs: 16, steps: 2, drawCalls: 10 });
    recorder.reset();

    const snapshot = recorder.snapshot();

    expect(snapshot.samples).toBe(0);
    expect(snapshot.worstDrawCalls).toBe(0);
  });

  it('validates the window size', () => {
    expect(() => new FrameStatsRecorder({}, 0)).toThrow(RangeError);
    expect(() => new FrameStatsRecorder({}, 1.5)).toThrow(RangeError);
  });

  it('exposes the effective budget', () => {
    const recorder = new FrameStatsRecorder({ drawCallCeiling: 42 });

    expect(recorder.budgetSnapshot.drawCallCeiling).toBe(42);
    expect(recorder.budgetSnapshot.frameBudgetMs).toBe(DEFAULT_PERF_BUDGET.frameBudgetMs);
  });
});