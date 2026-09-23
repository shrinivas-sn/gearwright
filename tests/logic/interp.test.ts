import { describe, expect, it } from 'vitest';

import { clamp01, lerp, lerpAngle } from '../../src/core/interp.ts';

describe('interp (PLAN T2.1)', () => {
  it('returns exact endpoints', () => {
    expect(lerp(0.1, 0.3, 1)).toBe(0.3);
    expect(lerp(0.1, 0.3, 0)).toBe(0.1);
    expect(lerp(0, 10, 0.25)).toBe(2.5);
  });
  it('takes the short way round for angles', () => {
    expect(lerpAngle(3, -3, 0.5)).toBeCloseTo(3 + (2 * Math.PI - 6) / 2, 9);
    expect(lerpAngle(0, 1, 1)).toBe(1);
  });
  it('clamps factors and treats NaN as 1', () => {
    expect(clamp01(-2)).toBe(0);
    expect(clamp01(5)).toBe(1);
    expect(clamp01(Number.NaN)).toBe(1);
  });
});
