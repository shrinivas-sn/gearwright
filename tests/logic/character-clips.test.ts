import { describe, expect, it } from 'vitest';

import {
  clipFraction,
  createClipWeights,
  sampleClipWeights
} from '../../src/core/character-clips.ts';

const WALK = 1.8;
const RUN = 4.2;

describe('sampleClipWeights — which clip carries the body', () => {
  it('stands on the idle clip with no speed', () => {
    const weights = sampleClipWeights(0, WALK, RUN, createClipWeights());
    expect(weights).toEqual({ idle: 1, walk: 0, run: 0 });
  });

  it('is fully on the walk clip at the walk speed', () => {
    const weights = sampleClipWeights(WALK, WALK, RUN, createClipWeights());
    expect(weights.walk).toBeCloseTo(1, 9);
    expect(weights.idle).toBeCloseTo(0, 9);
    expect(weights.run).toBeCloseTo(0, 9);
  });

  it('is fully on the run clip at the run speed', () => {
    const weights = sampleClipWeights(RUN, WALK, RUN, createClipWeights());
    expect(weights.run).toBeCloseTo(1, 9);
    expect(weights.idle).toBeCloseTo(0, 9);
    expect(weights.walk).toBeCloseTo(0, 9);
  });

  it('always sums to exactly 1 across the whole speed range', () => {
    const out = createClipWeights();
    for (let speed = 0; speed <= RUN + 2; speed += 0.05) {
      const weights = sampleClipWeights(speed, WALK, RUN, out);
      expect(weights.idle + weights.walk + weights.run).toBeCloseTo(1, 9);
      for (const weight of [weights.idle, weights.walk, weights.run]) {
        expect(weight).toBeGreaterThanOrEqual(0);
        expect(weight).toBeLessThanOrEqual(1);
      }
    }
  });

  it('blends walk into run between the two speeds, monotonically', () => {
    const out = createClipWeights();
    let previous = 0;
    for (let step = 0; step <= 24; step += 1) {
      const speed = WALK + ((RUN - WALK) * step) / 24;
      const run = sampleClipWeights(speed, WALK, RUN, out).run;
      expect(run).toBeGreaterThanOrEqual(previous - 1e-9);
      previous = run;
    }
    expect(previous).toBeCloseTo(1, 9);
  });

  it('clamps a sprint above the run speed and treats garbage as standing still', () => {
    expect(sampleClipWeights(99, WALK, RUN, createClipWeights()).run).toBeCloseTo(1, 9);
    expect(sampleClipWeights(Number.NaN, WALK, RUN, createClipWeights()).idle).toBe(1);
    expect(sampleClipWeights(-5, WALK, RUN, createClipWeights()).idle).toBe(1);
  });

  it('survives hostile walk/run tunings', () => {
    expect(sampleClipWeights(0, 0, 0, createClipWeights()).idle).toBe(1);
    const equal = sampleClipWeights(1, 2, 2, createClipWeights());
    expect(equal.idle + equal.walk + equal.run).toBeCloseTo(1, 9);
  });
});

describe('clipFraction — where in the cycle the feet are', () => {
  it('maps the gait phase onto one cycle', () => {
    expect(clipFraction(0)).toBe(0);
    expect(clipFraction(Math.PI)).toBeCloseTo(0.5, 9);
  });

  it('wraps instead of leaving [0, 1)', () => {
    expect(clipFraction(Math.PI * 4 + Math.PI)).toBeCloseTo(0.5, 9);
    expect(clipFraction(-Math.PI)).toBeCloseTo(0.5, 9);
    expect(clipFraction(-Math.PI * 3)).toBeCloseTo(0.5, 9);
  });

  it('treats garbage as the start of the cycle', () => {
    expect(clipFraction(Number.NaN)).toBe(0);
    expect(clipFraction(Number.POSITIVE_INFINITY)).toBe(0);
  });
});
