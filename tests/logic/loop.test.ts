import { describe, expect, it } from 'vitest';

import { DEFAULT_LOOP_CONFIG, FixedStepLoop, type SteppedFrame } from '../../src/core/loop.ts';

const FIXED_DT = DEFAULT_LOOP_CONFIG.fixedDt;

interface Harness {
  readonly loop: FixedStepLoop;
  readonly stepTimes: number[];
}

function createHarness(config: Partial<typeof DEFAULT_LOOP_CONFIG> = {}): Harness {
  const stepTimes: number[] = [];
  const loop = new FixedStepLoop(
    {
      fixedStep: (dt) => {
        stepTimes.push(dt);
      },
      render: () => {}
    },
    config
  );
  return { loop, stepTimes };
}

function advanceFrames(loop: FixedStepLoop, frameDeltasMs: readonly number[], startMs = 0): SteppedFrame[] {
  const results: SteppedFrame[] = [];
  let now = startMs;
  for (const delta of frameDeltasMs) {
    now += delta;
    results.push(loop.advance(now));
  }
  return results;
}

describe('FixedStepLoop — time accumulation', () => {
  it('first frame establishes the time origin and performs no work', () => {
    const harness = createHarness();
    const result = harness.loop.advance(1000);

    expect(result.steps).toBe(0);
    expect(result.alpha).toBe(0);
    expect(harness.stepTimes).toHaveLength(0);
    expect(harness.loop.stats.frames).toBe(0);
  });

  it('executes one fixed step per fixedDt of elapsed time', () => {
    const harness = createHarness();
    const results = advanceFrames(harness.loop, [1000, 34, 34]);

    // 34 ms > 1/30 s, so each of the two subsequent frames produces one step.
    expect(results[1]?.steps).toBe(1);
    expect(results[2]?.steps).toBe(1);
    expect(harness.stepTimes).toEqual([FIXED_DT, FIXED_DT]);
  });

  it('does not step when the frame is shorter than fixedDt', () => {
    const harness = createHarness();
    const results = advanceFrames(harness.loop, [0, 10, 10]);

    expect(results.every((frame) => frame.steps === 0)).toBe(true);
    expect(harness.loop.stats.accumulator).toBeGreaterThan(0);
  });

  it('keeps alpha inside [0,1)', () => {
    const harness = createHarness();
    const results = advanceFrames(harness.loop, [0, 5, 12, 19, 26, 33, 40]);

    for (const frame of results) {
      expect(frame.alpha).toBeGreaterThanOrEqual(0);
      expect(frame.alpha).toBeLessThan(1);
    }
  });
});

describe('FixedStepLoop — backlog protection (ARCH §14)', () => {
  it('clamps a long frame to maxFrameDelta', () => {
    const harness = createHarness();
    advanceFrames(harness.loop, [0, 5000]);

    expect(harness.loop.stats.lastRawFrameDelta).toBeCloseTo(5, 5);
    expect(harness.loop.stats.lastFrameDelta).toBeCloseTo(DEFAULT_LOOP_CONFIG.maxFrameDelta, 5);
  });

  it('caps substeps, then drops the backlog instead of spiralling', () => {
    const harness = createHarness();
    harness.loop.advance(0);

    const capped = harness.loop.advance(1000);

    expect(capped.steps).toBe(DEFAULT_LOOP_CONFIG.maxSubSteps);
    expect(capped.droppedBacklog).toBe(true);
    expect(harness.loop.stats.droppedBacklog).toBe(1);

    // The backlog was discarded: the accumulator holds no catch-up debt.
    expect(harness.loop.stats.accumulator).toBe(0);

    // The next frame behaves normally again (no catch-up surge).
    const next = harness.loop.advance(1034);
    expect(next.steps).toBe(1);
  });

  it('never executes more than maxSubSteps in a single frame', () => {
    const harness = createHarness();
    harness.loop.advance(0);
    for (let frame = 1; frame <= 20; frame += 1) {
      const result = harness.loop.advance(frame * 400);
      expect(result.steps).toBeLessThanOrEqual(DEFAULT_LOOP_CONFIG.maxSubSteps);
    }
  });
});

describe('FixedStepLoop — clock sanitisation (ARCH §38)', () => {
  it('ignores non-finite timestamps', () => {
    const harness = createHarness();
    harness.loop.advance(0);

    const nan = harness.loop.advance(Number.NaN);
    const infinite = harness.loop.advance(Number.POSITIVE_INFINITY);

    expect(nan.steps).toBe(0);
    expect(infinite.steps).toBe(0);
    expect(harness.loop.stats.steps).toBe(0);
  });

  it('ignores duplicate timestamps and backwards clock movement', () => {
    const harness = createHarness();
    advanceFrames(harness.loop, [0, 34]);

    const duplicate = harness.loop.advance(34);
    const backwards = harness.loop.advance(10);

    expect(duplicate.steps).toBe(0);
    expect(backwards.steps).toBe(0);
    expect(harness.loop.stats.steps).toBe(1);
  });
});

describe('FixedStepLoop — determinism', () => {
  it('produces identical results for identical timestamp sequences', () => {
    const deltas = [0, 17, 16, 33, 12, 71, 5, 120, 9];
    const first = createHarness();
    const second = createHarness();

    const firstResults = advanceFrames(first.loop, deltas);
    const secondResults = advanceFrames(second.loop, deltas);

    expect(firstResults).toEqual(secondResults);
    expect(first.stepTimes).toEqual(second.stepTimes);
  });

  it('never simulates more time than the clamped elapsed time allows', () => {
    const harness = createHarness();
    const deltas = [0, ...Array.from({ length: 9 }, () => 33.4)];
    advanceFrames(harness.loop, deltas);

    const simulatedSeconds = harness.loop.stats.steps * FIXED_DT;

    expect(harness.loop.stats.steps).toBe(9);
    expect(simulatedSeconds).toBeLessThanOrEqual(9 * (33.4 / 1000) + FIXED_DT);
  });
});

describe('FixedStepLoop — reset and counters', () => {
  it('reset clears timing so no background time is replayed (EC-BRN-03)', () => {
    const harness = createHarness();
    advanceFrames(harness.loop, [0, 34]);
    const stepsBefore = harness.loop.stats.steps;

    harness.loop.reset();
    const afterResetFirstFrame = harness.loop.advance(50_000);

    expect(afterResetFirstFrame.steps).toBe(0);
    expect(harness.loop.stats.accumulator).toBe(0);
    expect(harness.loop.stats.steps).toBe(stepsBefore);
  });

  it('resetCounters clears both timing and totals', () => {
    const harness = createHarness();
    advanceFrames(harness.loop, [0, 34, 34]);
    harness.loop.resetCounters();

    expect(harness.loop.stats.frames).toBe(0);
    expect(harness.loop.stats.steps).toBe(0);
    expect(harness.loop.stats.accumulator).toBe(0);
  });

  it('rejects invalid configuration at construction time', () => {
    expect(() => createHarness({ fixedDt: 0 })).toThrow(RangeError);
    expect(() => createHarness({ maxSubSteps: 0 })).toThrow(RangeError);
    expect(() => createHarness({ maxSubSteps: 2.5 })).toThrow(RangeError);
    expect(() => createHarness({ maxFrameDelta: -1 })).toThrow(RangeError);
  });
});