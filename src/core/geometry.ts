/**
 * L0 PLATFORM CORE — small geometric helpers shared by gameplay systems.
 *
 * Deliberately tiny: just the axis-aligned maths that more than one L2 system needs
 * and that must stay engine-free (ARCH §11 rule R2). Anything bigger belongs in the
 * system that owns the concept.
 */

import type { Vec3 } from './vec3.ts';

/**
 * Axis-aligned footprint of a box rotated about Y: the AABB that contains the
 * rotation. Used for carryable collision checks and socket detection volumes, which
 * is why it lives here rather than inside either system.
 */
export function rotatedHalfExtents(halfExtents: Vec3, yaw: number, out: Vec3): Vec3 {
  const cos = Math.abs(Math.cos(yaw));
  const sin = Math.abs(Math.sin(yaw));
  out.x = halfExtents.x * cos + halfExtents.z * sin;
  out.y = halfExtents.y;
  out.z = halfExtents.x * sin + halfExtents.z * cos;
  return out;
}
