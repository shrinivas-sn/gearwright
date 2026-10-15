/**
 * Pure clip-blend maths for a clip-driven player body (CHARACTER-3D.md §5).
 *
 * The procedural rig *samples* a pose function; an imported humanoid *plays* authored clips. This
 * module is the part of that mapping that can be tested headlessly: which clip is carrying the body
 * at a given speed, and where inside its cycle the feet are — driven by the same distance-based
 * phase the procedural gait uses (`GaitDriver`), so an imported body keeps the project's "feet
 * never slide" property instead of running on wall-clock time (ADR-003, ARCH §31).
 *
 * Nothing here touches three, a bone, or game state: it is numbers in, numbers out.
 */

import { clamp01 } from './interp.ts';

const TAU = Math.PI * 2;

/**
 * Reusable weight buffer. Mutable by design, like `CharacterPose`: the hot path writes into one of
 * these every frame (ARCH §14).
 */
export interface ClipWeights {
  /** Standing / breathing. */
  idle: number;
  walk: number;
  run: number;
}

export function createClipWeights(): ClipWeights {
  return { idle: 1, walk: 0, run: 0 };
}

/**
 * Split the body's motion across idle/walk/run. The three weights always sum to 1, so a body that
 * cross-fades on them can never go partially transparent or double-pose; `speed` is clamped to the
 * run ceiling and a non-finite value reads as standing still.
 */
export function sampleClipWeights(
  speed: number,
  walkSpeed: number,
  runSpeed: number,
  out: ClipWeights
): ClipWeights {
  const walk = Number.isFinite(walkSpeed) && walkSpeed > 0 ? walkSpeed : 1.8;
  const run = Number.isFinite(runSpeed) && runSpeed > walk ? runSpeed : walk * 2;
  const value = Number.isFinite(speed) ? Math.min(Math.max(speed, 0), run) : 0;

  // Full walk weight at the walk speed; everything above it hands over to the run clip.
  const moving = clamp01(value / walk);
  const running = clamp01((value - walk) / (run - walk));

  out.idle = 1 - moving;
  out.walk = moving * (1 - running);
  out.run = moving * running;
  return out;
}

/**
 * Where inside a one-cycle clip the body is, from the gait phase (radians). Both the procedural
 * gait and an exported walk/run cycle cover exactly one full stride, so this is the whole
 * phase → time mapping: `clipTime = clipFraction(phase) * clip.duration`. Non-finite in, 0 out.
 */
export function clipFraction(phase: number): number {
  if (!Number.isFinite(phase)) return 0;
  const fraction = (phase % TAU) / TAU;
  return fraction < 0 ? fraction + 1 : fraction;
}
