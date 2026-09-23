import { describe, expect, it } from 'vitest';

import {
  vec3,
  vec3Add,
  vec3AddScaled,
  vec3Clamp,
  vec3Copy,
  vec3Cross,
  vec3Distance,
  vec3DistanceSq,
  vec3Dot,
  vec3EqualsEps,
  vec3IsFinite,
  vec3Length,
  vec3LengthSq,
  vec3Lerp,
  vec3Normalize,
  vec3Sanitize,
  vec3Scale,
  vec3Set,
  vec3Sub
} from '../../src/core/vec3.ts';

describe('vec3 — construction and out-param contracts', () => {
  it('creates components with zero defaults', () => {
    expect(vec3()).toEqual({ x: 0, y: 0, z: 0 });
    expect(vec3(1, 2, 3)).toEqual({ x: 1, y: 2, z: 3 });
  });

  it('mutates and returns the out parameter (hot-path discipline)', () => {
    const out = vec3();
    expect(vec3Set(out, 1, 2, 3)).toBe(out);
    expect(out).toEqual({ x: 1, y: 2, z: 3 });

    expect(vec3Copy(out, vec3(4, 5, 6))).toBe(out);
    expect(out).toEqual({ x: 4, y: 5, z: 6 });
  });

  it('stays correct when the out parameter aliases an input', () => {
    const a = vec3(1, 2, 3);
    vec3Add(a, a, vec3(1, 1, 1));
    expect(a).toEqual({ x: 2, y: 3, z: 4 });

    vec3Scale(a, a, 2);
    expect(a).toEqual({ x: 4, y: 6, z: 8 });

    vec3Sub(a, a, vec3(1, 1, 1));
    expect(a).toEqual({ x: 3, y: 5, z: 7 });
  });
});

describe('vec3 — arithmetic', () => {
  it('adds, subtracts, and scales component-wise', () => {
    const out = vec3();
    expect(vec3Add(out, vec3(1, 2, 3), vec3(4, 5, 6))).toEqual({ x: 5, y: 7, z: 9 });
    expect(vec3Sub(out, vec3(4, 5, 6), vec3(1, 2, 3))).toEqual({ x: 3, y: 3, z: 3 });
    expect(vec3Scale(out, vec3(1, -2, 3), 2)).toEqual({ x: 2, y: -4, z: 6 });
  });

  it('fuses a + b * scalar in one pass', () => {
    const out = vec3();
    expect(vec3AddScaled(out, vec3(1, 1, 1), vec3(2, 4, 6), 0.5)).toEqual({ x: 2, y: 3, z: 4 });
  });

  it('computes dot, cross, and lengths', () => {
    expect(vec3Dot(vec3(1, 2, 3), vec3(4, -5, 6))).toBe(4 - 10 + 18);
    expect(vec3LengthSq(vec3(3, 4, 0))).toBe(25);
    expect(vec3Length(vec3(3, 4, 0))).toBe(5);

    const out = vec3();
    expect(vec3Cross(out, vec3(1, 0, 0), vec3(0, 1, 0))).toEqual({ x: 0, y: 0, z: 1 });
  });
});

describe('vec3 — normalise and distance', () => {
  it('normalises to unit length', () => {
    const out = vec3();
    vec3Normalize(out, vec3(0, 3, 4));
    expect(out.x).toBe(0);
    expect(out.y).toBeCloseTo(0.6, 12);
    expect(out.z).toBeCloseTo(0.8, 12);
    expect(vec3Length(out)).toBeCloseTo(1, 12);
  });

  it('returns the zero vector (never NaN) for zero-length input', () => {
    const out = vec3();
    vec3Normalize(out, vec3(0, 0, 0));
    expect(out).toEqual({ x: 0, y: 0, z: 0 });
    expect(vec3IsFinite(out)).toBe(true);
  });

  it('measures distance and squared distance', () => {
    expect(vec3DistanceSq(vec3(1, 1, 1), vec3(4, 5, 1))).toBe(9 + 16);
    expect(vec3Distance(vec3(1, 1, 1), vec3(4, 5, 1))).toBe(5);
  });
});

describe('vec3 — interpolation, clamp, and guards', () => {
  it('lerps and clamps component-wise', () => {
    const out = vec3();
    expect(vec3Lerp(out, vec3(0, 0, 0), vec3(10, 20, 30), 0.5)).toEqual({ x: 5, y: 10, z: 15 });
    expect(vec3Clamp(out, vec3(5, -5, 0.5), vec3(0, 0, 0), vec3(1, 1, 1))).toEqual({ x: 1, y: 0, z: 0.5 });
  });

  it('compares within an epsilon', () => {
    expect(vec3EqualsEps(vec3(1, 1, 1), vec3(1.001, 0.999, 1), 0.01)).toBe(true);
    expect(vec3EqualsEps(vec3(1, 1, 1), vec3(1.1, 1, 1), 0.01)).toBe(false);
  });

  it('detects non-finite components', () => {
    expect(vec3IsFinite(vec3(1, 2, 3))).toBe(true);
    expect(vec3IsFinite(vec3(Number.NaN, 0, 0))).toBe(false);
    expect(vec3IsFinite(vec3(0, Number.POSITIVE_INFINITY, 0))).toBe(false);
  });

  it('sanitises poisoned components to the fallback', () => {
    const out = vec3();
    const fallback = vec3(1, 2, 3);
    vec3Sanitize(out, vec3(Number.NaN, 5, Number.NEGATIVE_INFINITY), fallback);
    expect(out).toEqual({ x: 1, y: 5, z: 3 });
  });
});
