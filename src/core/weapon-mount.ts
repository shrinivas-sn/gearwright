/**
 * L0 PLATFORM CORE — where the drawn weapon sits, from stance + aim alone.
 *
 * This used to live in the composition (`main.ts`) and took its origin from
 * `characterFacts().handR` — the *rendered* right hand — every fixed step. That made a closed loop:
 * muzzle → rear-grip IK target → hand position → next step's muzzle. The hand chased its own
 * output forward until the arm's reach clamp locked it straight, and every millimetre of grip
 * wobble re-steered the gun. A simulated weapon must not depend on a rendered one.
 *
 * So the mount is a pure function of the player's stance and the camera's aim line, in metres:
 *  - the gun rides on the **right of the aim line** (not of the body), so it stays where a
 *    third-person camera expects it while the character turns to follow;
 *  - its origin is a shoulder-height point ahead of the chest, and the **muzzle** is `MUZZLE_LEAD`
 *    further along the aim; the barrel's convergence point is re-computed from the muzzle onto the
 *    camera's own line, so the shot still lands under the reticle;
 *  - crouching drops it with the body.
 *
 * The two-bone grip targets derived from this (`WEAPON_REAR_GRIP_OFFSET` / front) are then
 * reachable by both arms, which is what stops the "hands hovering beside the gun" look. Nothing
 * here reads a renderer or allocates.
 */

import type { Vec3 } from './vec3.ts';

/** Height of the weapon's origin above the feet, standing, metres (the character's shoulders). */
export const WEAPON_SHOULDER_HEIGHT = 1.44;
/** The same, crouched. The stance drops the whole upper body, so the mount drops with it. */
export const WEAPON_SHOULDER_HEIGHT_CROUCHED = 1.08;
/**
 * Lateral offset of the gun from the aim line, metres. Slightly right of centre, not at the
 * shoulder: the gun has to be *reachable by both arms*, and the imported body's arms are 0.46 m
 * from shoulder to wrist. Biasing it out to 0.1 m put the fore-end 0.48 m from the left shoulder,
 * which the arm could not span — the left hand sat at full extension and was dragged around by the
 * walk clip's own chest sway (measured in the `arms` harness scenario).
 */
export const WEAPON_SIDE_OFFSET = 0.04;
/**
 * Distance from the grip origin to the muzzle, metres. The rear hand then sits
 * `MUZZLE_LEAD − WEAPON_REAR_GRIP_OFFSET` = 0.18 m ahead of the shoulder line and the front hand
 * `MUZZLE_LEAD − WEAPON_FRONT_GRIP_OFFSET` = 0.36 m out — 0.436 m from the *left* shoulder, inside
 * the 0.464 m the imported arm can actually span, with 2.8 cm of margin for the chest's walk sway.
 * (At 0.55 the fore-end was 0.48 m out: unreachable, and the supporting hand sat clamped.)
 */
export const WEAPON_MUZZLE_LEAD = 0.48;
/** How far along the camera's line the aim is converged, metres. */
export const AIM_CONVERGENCE_M = 60;

/** The aim line the weapon is mounted on: the camera's eye and the point it is looking at. */
export interface WeaponAimLine {
  readonly eye: Vec3;
  readonly target: Vec3;
}

/** The stance the mount follows. `position` is at the player's feet. */
export interface WeaponStance {
  readonly position: Vec3;
  readonly facingYaw: number;
  readonly crouched: boolean;
}

/** Mutable mount, rewritten every step (no allocation in the fixed loop). */
export interface WeaponMount {
  readonly muzzle: { x: number; y: number; z: number };
  readonly aimDirection: { x: number; y: number; z: number };
}

export function createWeaponMount(): WeaponMount {
  return {
    muzzle: { x: 0, y: 0, z: 0 },
    aimDirection: { x: 0, y: 0, z: -1 }
  };
}

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

/**
 * Resolve the mount for this step into `out`. Returns `out` (the caller owns the buffer).
 *
 * Degenerate input never produces NaN: a zero-length camera line falls back to the body's facing,
 * and an aim that is exactly vertical falls back to the body's own lateral axis.
 */
export function resolveWeaponMount(
  aim: WeaponAimLine,
  stance: WeaponStance,
  out: WeaponMount
): WeaponMount {
  const feetX = finite(stance.position.x);
  const feetY = finite(stance.position.y);
  const feetZ = finite(stance.position.z);
  const yaw = finite(stance.facingYaw);

  // 1. The aim direction (unit). A zero-length line means "straight ahead from the body".
  let dx = finite(aim.target.x) - finite(aim.eye.x);
  let dy = finite(aim.target.y) - finite(aim.eye.y);
  let dz = finite(aim.target.z) - finite(aim.eye.z);
  let length = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (!(length > 1e-6)) {
    dx = -Math.sin(yaw);
    dy = 0;
    dz = -Math.cos(yaw);
    length = 1;
  }
  dx /= length;
  dy /= length;
  dz /= length;

  // 2. The lateral axis: horizontal, perpendicular to the aim, on the shooter's right. The body's
  //    own right is the fallback for a near-vertical aim (looking straight up/down).
  let rightX = -dz;
  let rightZ = dx;
  let rightLength = Math.hypot(rightX, rightZ);
  if (!(rightLength > 1e-4)) {
    rightX = Math.cos(yaw);
    rightZ = -Math.sin(yaw);
    rightLength = 1;
  }
  rightX /= rightLength;
  rightZ /= rightLength;

  // 3. Origin at shoulder height, right of the aim line. The muzzle is the same point advanced
  //    along the aim, so the drawn barrel, the shot origin and the grip targets share one frame.
  const height = stance.crouched
    ? WEAPON_SHOULDER_HEIGHT_CROUCHED
    : WEAPON_SHOULDER_HEIGHT;
  const originX = feetX + rightX * WEAPON_SIDE_OFFSET;
  const originY = feetY + height;
  const originZ = feetZ + rightZ * WEAPON_SIDE_OFFSET;
  out.muzzle.x = originX + dx * WEAPON_MUZZLE_LEAD;
  out.muzzle.y = originY + dy * WEAPON_MUZZLE_LEAD;
  out.muzzle.z = originZ + dz * WEAPON_MUZZLE_LEAD;

  // 4. Converge from the muzzle onto the camera's own line, so a barrel that is not at the eye
  //    still puts its rounds under the reticle instead of parallel to it.
  const aimX = finite(aim.eye.x) + dx * AIM_CONVERGENCE_M;
  const aimY = finite(aim.eye.y) + dy * AIM_CONVERGENCE_M;
  const aimZ = finite(aim.eye.z) + dz * AIM_CONVERGENCE_M;
  let ax = aimX - out.muzzle.x;
  let ay = aimY - out.muzzle.y;
  let az = aimZ - out.muzzle.z;
  const aimLength = Math.sqrt(ax * ax + ay * ay + az * az);
  if (!(aimLength > 1e-6)) {
    ax = dx;
    ay = dy;
    az = dz;
  } else {
    ax /= aimLength;
    ay /= aimLength;
    az /= aimLength;
  }
  out.aimDirection.x = ax;
  out.aimDirection.y = ay;
  out.aimDirection.z = az;
  return out;
}
