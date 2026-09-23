/**
 * L0 PLATFORM CORE — minimal 3D vector math (ARCH §14 hot-loop discipline).
 *
 * Gameplay (L2) and logical (L1) code must never import `three` (ARCH §11 rule R2),
 * so this module provides the small set of operations the simulation needs.
 * All mutating operations take an explicit `out` parameter: callers reuse scratch
 * objects instead of allocating inside `simulate()` / `render()`.
 */

/** Plain mutable 3D vector. Engine-agnostic: structurally compatible with three's Vector3. */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export function vec3(x = 0, y = 0, z = 0): Vec3 {
  return { x, y, z };
}

export function vec3Set(out: Vec3, x: number, y: number, z: number): Vec3 {
  out.x = x;
  out.y = y;
  out.z = z;
  return out;
}

export function vec3Copy(out: Vec3, source: Vec3): Vec3 {
  out.x = source.x;
  out.y = source.y;
  out.z = source.z;
  return out;
}

export function vec3Add(out: Vec3, a: Vec3, b: Vec3): Vec3 {
  out.x = a.x + b.x;
  out.y = a.y + b.y;
  out.z = a.z + b.z;
  return out;
}

export function vec3Sub(out: Vec3, a: Vec3, b: Vec3): Vec3 {
  out.x = a.x - b.x;
  out.y = a.y - b.y;
  out.z = a.z - b.z;
  return out;
}

export function vec3Scale(out: Vec3, a: Vec3, scalar: number): Vec3 {
  out.x = a.x * scalar;
  out.y = a.y * scalar;
  out.z = a.z * scalar;
  return out;
}

/** out = a + b * scalar (fused multiply-add for intent + dt displacement). */
export function vec3AddScaled(out: Vec3, a: Vec3, b: Vec3, scalar: number): Vec3 {
  out.x = a.x + b.x * scalar;
  out.y = a.y + b.y * scalar;
  out.z = a.z + b.z * scalar;
  return out;
}

export function vec3Dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function vec3Cross(out: Vec3, a: Vec3, b: Vec3): Vec3 {
  const x = a.y * b.z - a.z * b.y;
  const y = a.z * b.x - a.x * b.z;
  const z = a.x * b.y - a.y * b.x;
  out.x = x;
  out.y = y;
  out.z = z;
  return out;
}

export function vec3LengthSq(a: Vec3): number {
  return a.x * a.x + a.y * a.y + a.z * a.z;
}

export function vec3Length(a: Vec3): number {
  return Math.sqrt(vec3LengthSq(a));
}

/** Normalises `a` into `out`. Zero-length input yields the zero vector (never NaN). */
export function vec3Normalize(out: Vec3, a: Vec3): Vec3 {
  const length = vec3Length(a);
  if (!(length > 0)) {
    out.x = 0;
    out.y = 0;
    out.z = 0;
    return out;
  }
  const inverse = 1 / length;
  out.x = a.x * inverse;
  out.y = a.y * inverse;
  out.z = a.z * inverse;
  return out;
}

export function vec3DistanceSq(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

export function vec3Distance(a: Vec3, b: Vec3): number {
  return Math.sqrt(vec3DistanceSq(a, b));
}

export function vec3Lerp(out: Vec3, a: Vec3, b: Vec3, t: number): Vec3 {
  out.x = a.x + (b.x - a.x) * t;
  out.y = a.y + (b.y - a.y) * t;
  out.z = a.z + (b.z - a.z) * t;
  return out;
}

/** Component-wise clamp into `out`. */
export function vec3Clamp(out: Vec3, value: Vec3, min: Vec3, max: Vec3): Vec3 {
  out.x = Math.min(Math.max(value.x, min.x), max.x);
  out.y = Math.min(Math.max(value.y, min.y), max.y);
  out.z = Math.min(Math.max(value.z, min.z), max.z);
  return out;
}

export function vec3EqualsEps(a: Vec3, b: Vec3, epsilon: number): boolean {
  return (
    Math.abs(a.x - b.x) <= epsilon &&
    Math.abs(a.y - b.y) <= epsilon &&
    Math.abs(a.z - b.z) <= epsilon
  );
}

export function vec3IsFinite(a: Vec3): boolean {
  return Number.isFinite(a.x) && Number.isFinite(a.y) && Number.isFinite(a.z);
}

/** Sanitizer for step boundaries: replaces non-finite components with the fallback. */
export function vec3Sanitize(out: Vec3, value: Vec3, fallback: Vec3): Vec3 {
  out.x = Number.isFinite(value.x) ? value.x : fallback.x;
  out.y = Number.isFinite(value.y) ? value.y : fallback.y;
  out.z = Number.isFinite(value.z) ? value.z : fallback.z;
  return out;
}