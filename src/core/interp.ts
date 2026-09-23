/**
 * L0 — presentation interpolation helpers (PLAN T2.1). Pure math: no DOM, no engine.
 * `t` at or beyond the ends returns the end value *exactly*, so an interpolation factor of 1
 * reproduces the simulation state bit-for-bit.
 */

export function clamp01(t: number): number {
  if (!Number.isFinite(t)) return 1;
  return Math.min(Math.max(t, 0), 1);
}

export function lerp(a: number, b: number, t: number): number {
  if (t >= 1) return b;
  if (t <= 0) return a;
  return a + (b - a) * t;
}

/** Shortest-path angle interpolation (radians). */
export function lerpAngle(a: number, b: number, t: number): number {
  if (t >= 1) return b;
  if (t <= 0) return a;
  const full = Math.PI * 2;
  let delta = (b - a) % full;
  if (delta > Math.PI) delta -= full;
  if (delta < -Math.PI) delta += full;
  return a + delta * t;
}
