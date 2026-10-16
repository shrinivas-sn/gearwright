/**
 * L0 PLATFORM CORE — procedural humanoid pose, gait and two-bone arm aim.
 *
 * GEARWRIGHT ships no artist asset, so the player character is *computed*: the skeleton offsets,
 * the walk cycle and the hand placement are plain numbers here — no `three`, no DOM, no
 * allocation inside the frame loop (every entry point writes into an `out` buffer, the same
 * convention as `vec3.ts`). The L4 adapter (`adapters/character-rig.ts`) only turns these
 * numbers into bones and matrices, and `tests/logic/character-pose.test.ts` pins the maths
 * without a GPU.
 *
 * Conventions, shared with the rig that consumes them:
 *  - Offsets are metres and **parent-relative**; `hips` is relative to the character root.
 *  - A bone points down its own local `-Y`, so "swing the thigh forward" is a positive rotation
 *    about the bone's local X (the character faces `-Z` at yaw 0, like `PlayerController`).
 *  - The root sits at the player's feet, so the rest offsets alone give a ~1.7 m figure.
 *  - The player's left is `-X` (facing `-Z`, left = up × forward), which is also the camera's
 *    left when the camera looks along the player's facing — the rig reads correctly from behind.
 */

import { clamp01, lerp } from './interp.ts';
import type { Vec3 } from './vec3.ts';

const TAU = Math.PI * 2;

/** Joint order is the rig's build order and the pose buffer's key set — one source of truth. */
export const CHARACTER_JOINTS = [
  'hips',
  'spine',
  'chest',
  'neck',
  'head',
  'shoulderL',
  'upperArmL',
  'foreArmL',
  'handL',
  'shoulderR',
  'upperArmR',
  'foreArmR',
  'handR',
  'thighL',
  'shinL',
  'footL',
  'thighR',
  'shinR',
  'footR'
] as const;

export type CharacterJointId = (typeof CHARACTER_JOINTS)[number];

/** Limb lengths live in one place: the rest offsets and the arm IK must never disagree. */
export const CHARACTER_ARM = { upper: 0.3, fore: 0.26 } as const;
export const CHARACTER_LEG = { thigh: 0.46, shin: 0.44 } as const;

/** Rest offsets (metres, parent-relative). Sum down a chain = that joint's rest height. */
export const CHARACTER_REST_OFFSETS: Readonly<
  Record<CharacterJointId, { readonly x: number; readonly y: number; readonly z: number }>
> = {
  hips: { x: 0, y: 0.98, z: 0 },
  spine: { x: 0, y: 0.15, z: 0 },
  chest: { x: 0, y: 0.2, z: 0 },
  neck: { x: 0, y: 0.18, z: 0 },
  head: { x: 0, y: 0.09, z: 0 },
  // Facing -Z, the player's left is -X (and the camera's left when viewed from behind).
  shoulderL: { x: -0.17, y: 0.13, z: 0 },
  upperArmL: { x: -0.06, y: 0, z: 0 },
  foreArmL: { x: 0, y: -CHARACTER_ARM.upper, z: 0 },
  handL: { x: 0, y: -CHARACTER_ARM.fore, z: 0 },
  shoulderR: { x: 0.17, y: 0.13, z: 0 },
  upperArmR: { x: 0.06, y: 0, z: 0 },
  foreArmR: { x: 0, y: -CHARACTER_ARM.upper, z: 0 },
  handR: { x: 0, y: -CHARACTER_ARM.fore, z: 0 },
  thighL: { x: -0.105, y: -0.03, z: 0 },
  shinL: { x: 0, y: -CHARACTER_LEG.thigh, z: 0 },
  footL: { x: 0, y: -CHARACTER_LEG.shin, z: 0 },
  thighR: { x: 0.105, y: -0.03, z: 0 },
  shinR: { x: 0, y: -CHARACTER_LEG.thigh, z: 0 },
  footR: { x: 0, y: -CHARACTER_LEG.shin, z: 0 }
};

/** Parent of each joint; `hips` is rooted at the character root. */
export const CHARACTER_PARENTS: Readonly<Record<CharacterJointId, CharacterJointId | null>> = {
  hips: null,
  spine: 'hips',
  chest: 'spine',
  neck: 'chest',
  head: 'neck',
  shoulderL: 'chest',
  upperArmL: 'shoulderL',
  foreArmL: 'upperArmL',
  handL: 'foreArmL',
  shoulderR: 'chest',
  upperArmR: 'shoulderR',
  foreArmR: 'upperArmR',
  handR: 'foreArmR',
  thighL: 'hips',
  shinL: 'thighL',
  footL: 'shinL',
  thighR: 'hips',
  shinR: 'thighR',
  footR: 'shinR'
};

/** Ankle height above the sole, metres: the leg IK plants the ankle this far above the ground. */
export const CHARACTER_ANKLE_HEIGHT = 0.05;

/** Metres of travel per full gait cycle (two steps). Distance-driven, so feet never slide. */
export const STRIDE_WALK = 1.55;
export const STRIDE_RUN = 2.55;
/** Breathing cycle rate while standing (rad/s of the breath phase). */
export const BREATH_RATE = 1.15;

/** Hard joint limit: nothing this rig produces may exceed it (also the "sanitised" bound). */
export const JOINT_LIMIT = 1.5;

/** Gait tuning, named so the tests can assert against the intent rather than magic numbers. */
const THIGH_SWING = 0.58;
const KNEE_LEAD = 1.35;
const KNEE_BEND = 0.5;
const ARM_SWING = 0.42;
const FOREARM_SWING = 0.28;
const FOOT_COMPENSATION = 0.6;

export interface JointAngles {
  x: number;
  y: number;
  z: number;
}

/**
 * Reusable pose buffer. Mutable by design: `sampleCharacterPose` writes into it every frame, so
 * a running game allocates nothing (ARCH §14 hot-loop discipline).
 */
export interface CharacterPose {
  joints: Record<CharacterJointId, JointAngles>;
  /** Vertical offset of the whole body above the root, metres (bob, crouch, breathing). */
  hipsRise: number;
  /** 0 = standing, 1 = at or above run speed. Drives run-specific tuning. */
  speedFactor: number;
  /** 0 = idle stance, 1 = full gait (reached at walk speed). */
  gaitWeight: number;
}

export interface CharacterPoseInput {
  readonly speed: number;
  readonly walkSpeed: number;
  readonly runSpeed: number;
  readonly grounded: boolean;
  readonly carrying: boolean;
  /** A drawn weapon steadies the arms like a carry, without pulling them onto a part. */
  readonly aiming: boolean;
  /** Gait cycle in radians, produced by `GaitDriver` from distance travelled. */
  readonly gaitPhase: number;
  readonly breathPhase: number;
}

export function createCharacterPose(): CharacterPose {
  const joints = {} as Record<CharacterJointId, JointAngles>;
  for (const joint of CHARACTER_JOINTS) joints[joint] = { x: 0, y: 0, z: 0 };
  return { joints, hipsRise: 0, speedFactor: 0, gaitWeight: 0 };
}

/**
 * Distance- and time-driven pose phases. Feet stay on the ground because the gait advances with
 * *distance travelled*, never with wall time, and breathing keeps its own clock so a standing
 * character is never frozen (a still frame must still read as alive).
 */
export class GaitDriver {
  private gait = 0;
  private breath = 0;

  /** Advance by how far the player actually moved this frame (metres) and the frame time. */
  advance(distanceMoved: number, dt: number, speedFactor: number): void {
    const stride = lerp(STRIDE_WALK, STRIDE_RUN, clamp01(speedFactor));
    if (Number.isFinite(distanceMoved) && distanceMoved > 0 && stride > 0) {
      this.gait = (this.gait + (distanceMoved / stride) * TAU) % TAU;
    }
    if (Number.isFinite(dt) && dt > 0) this.breath = (this.breath + dt * BREATH_RATE) % TAU;
  }

  get phase(): number {
    return this.gait;
  }

  get breathPhase(): number {
    return this.breath;
  }

  reset(): void {
    this.gait = 0;
    this.breath = 0;
  }
}

function sanitise(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function setJoint(target: JointAngles, x: number, y: number, z: number): void {
  target.x = Math.min(Math.max(sanitise(x, 0), -JOINT_LIMIT), JOINT_LIMIT);
  target.y = Math.min(Math.max(sanitise(y, 0), -JOINT_LIMIT), JOINT_LIMIT);
  target.z = Math.min(Math.max(sanitise(z, 0), -JOINT_LIMIT), JOINT_LIMIT);
}

/**
 * Write the full pose for one frame into `out`. Blends idle ↔ gait by speed, swaps to an
 * airborne tuck while ungrounded, and adds the carry stance (weight shifted, arms up) so the
 * player can read what the character is doing without looking at the HUD.
 */
export function sampleCharacterPose(input: CharacterPoseInput, out: CharacterPose): CharacterPose {
  const walkSpeed = Math.max(sanitise(input.walkSpeed, 1.8), 0.1);
  const runSpeed = Math.max(sanitise(input.runSpeed, walkSpeed * 2), walkSpeed);
  const speed = Math.min(Math.max(sanitise(input.speed, 0), 0), runSpeed);
  const speedFactor = speed / runSpeed;
  const gaitWeight = clamp01(speed / walkSpeed);
  const runBlend = clamp01((speed - walkSpeed) / Math.max(runSpeed - walkSpeed, 1e-3));
  const carrying = input.carrying;
  const aiming = input.aiming && !carrying;
  const phase = sanitise(input.gaitPhase, 0);
  const breath = sanitise(input.breathPhase, 0);

  // Gait swing grows past walk speed, and the arms stop swinging while a part is held
  // or a weapon is drawn (the stance steadies them instead).
  const swing = gaitWeight * (1 + 0.22 * runBlend);
  const armSwing = swing * (carrying || aiming ? 0.15 : 1);
  const lean = 0.07 * swing + 0.17 * runBlend;

  const breathChest = 0.012 * Math.sin(breath);
  const breathRise = 0.005 * Math.sin(breath);

  // Left and right legs are half a cycle apart; knees bend only on the way forward.
  const thighL = -0.04 + THIGH_SWING * swing * Math.sin(phase);
  const thighR = -0.04 + THIGH_SWING * swing * Math.sin(phase + Math.PI);
  const shinL = -0.1 - KNEE_BEND * swing * Math.max(0, Math.sin(phase + KNEE_LEAD));
  const shinR = -0.1 - KNEE_BEND * swing * Math.max(0, Math.sin(phase + KNEE_LEAD + Math.PI));

  const idle = 1 - gaitWeight;
  const armOut = 0.1 * idle + 0.12 * swing;
  const upperArmL = 0.06 + breathChest * 0.5 - ARM_SWING * armSwing * Math.sin(phase);
  const upperArmR = 0.06 + breathChest * 0.5 - ARM_SWING * armSwing * Math.sin(phase + Math.PI);
  const upperArmLZ = -armOut;
  const upperArmRZ = armOut;
  const foreArmL = -0.22 - FOREARM_SWING * swing * Math.max(0, Math.sin(phase));
  const foreArmR = -0.22 - FOREARM_SWING * swing * Math.max(0, Math.sin(phase + Math.PI));

  const spineX = 0.02 + lean - (carrying ? 0.03 : 0) + (aiming ? 0.04 : 0);
  const chestX = -0.5 * lean + 0.02 * swing + breathChest + (carrying ? 0.02 : 0) - (aiming ? 0.03 : 0);
  const neckX = -(spineX + chestX) * 0.7;
  const hipsRise = 0.03 * swing * Math.cos(2 * phase + Math.PI) + breathRise;

  setJoint(out.joints.hips, 0, 0.09 * swing * Math.sin(phase), 0.03 * swing * Math.sin(2 * phase));
  setJoint(out.joints.spine, spineX, 0, -0.02 * swing * Math.sin(2 * phase));
  setJoint(out.joints.chest, chestX, -0.13 * swing * Math.sin(phase), -0.05 * swing * Math.sin(2 * phase));
  setJoint(out.joints.neck, neckX, 0, 0);
  setJoint(out.joints.head, -0.02 + 0.02 * swing * Math.sin(2 * phase), 0.1 * swing * Math.sin(phase), 0);
  setJoint(out.joints.shoulderL, 0.05 * swing * Math.sin(phase), 0, 0);
  setJoint(out.joints.shoulderR, 0.05 * swing * Math.sin(phase + Math.PI), 0, 0);
  // Carrying: both arms up and angled inward (local +Z moves the left arm tip toward +X).
  // Aiming: the same ready shape — the grip IK then pulls the hands apart onto the weapon.
  const readyStance = carrying || aiming;
  setJoint(out.joints.upperArmL, upperArmL - (carrying ? 0.62 : aiming ? 0.52 : 0), 0, readyStance ? 0.06 : upperArmLZ);
  setJoint(out.joints.upperArmR, upperArmR - (carrying ? 0.62 : aiming ? 0.52 : 0), 0, readyStance ? -0.06 : upperArmRZ);
  setJoint(out.joints.foreArmL, foreArmL - (carrying ? 0.55 : aiming ? 0.28 : 0), 0, 0);
  setJoint(out.joints.foreArmR, foreArmR - (carrying ? 0.55 : aiming ? 0.28 : 0), 0, 0);
  setJoint(out.joints.handL, -0.08 - (carrying ? 0.15 : aiming ? 0.1 : 0), 0, 0);
  setJoint(out.joints.handR, -0.08 - (carrying ? 0.15 : aiming ? 0.1 : 0), 0, 0);
  setJoint(out.joints.thighL, thighL, 0, 0);
  setJoint(out.joints.thighR, thighR, 0, 0);
  setJoint(out.joints.shinL, shinL, 0, 0);
  setJoint(out.joints.shinR, shinR, 0, 0);
  // The ankle counter-rotates so the sole stays parallel to the floor over the whole stride.
  setJoint(out.joints.footL, -(thighL + shinL) * FOOT_COMPENSATION, 0, 0);
  setJoint(out.joints.footR, -(thighR + shinR) * FOOT_COMPENSATION, 0, 0);

  if (!input.grounded) {
    // Airborne tuck: the gait is meaningless mid-air, so it is replaced, not blended.
    setJoint(out.joints.thighL, 0.32, 0, 0.06);
    setJoint(out.joints.thighR, -0.14, 0, -0.06);
    setJoint(out.joints.shinL, -0.55, 0, 0);
    setJoint(out.joints.shinR, -0.85, 0, 0);
    setJoint(out.joints.footL, 0.2, 0, 0);
    setJoint(out.joints.footR, 0.25, 0, 0);
    setJoint(out.joints.upperArmL, -0.35, 0, -0.32);
    setJoint(out.joints.upperArmR, -0.35, 0, 0.32);
    setJoint(out.joints.foreArmL, -0.9, 0, 0);
    setJoint(out.joints.foreArmR, -0.9, 0, 0);
    setJoint(out.joints.spine, 0.1, 0, 0);
    setJoint(out.joints.chest, -0.05, 0, 0);
    setJoint(out.joints.neck, -0.03, 0, 0);
    setJoint(out.joints.hips, 0, 0, 0);
  }

  // Mid-air there is no stride to bob with, so the body rides flat.
  out.hipsRise = input.grounded ? hipsRise : 0;
  out.speedFactor = clamp01(speedFactor);
  out.gaitWeight = gaitWeight;
  return out;
}

/**
 * Two-bone arm aim (analytic, no iteration). Returns the rotation the rig must apply so the
 * hand lands on `target`:
 *  - `upper*` is the unit direction the upper arm's local `-Y` points along,
 *  - `axis*` is the unit local-X axis both bones share (it is perpendicular to `upper*`, so a
 *    rotation about it keeps the elbow inside the plane through the target),
 *  - `elbowBend` is a positive rotation of the forearm about that axis.
 *
 * Forward kinematics of the result reproduces the target exactly when it is within reach, which
 * is what the test asserts. A degenerate target (on the shoulder, or a zero-length bone) is
 * reported as `null` so the caller keeps its authored pose instead of getting NaN bones.
 */
export interface LimbAim {
  upperX: number;
  upperY: number;
  upperZ: number;
  axisX: number;
  axisY: number;
  axisZ: number;
  /** Arms: positive elbow bend. Legs: negative knee bend (the knee folds backward). */
  bend: number;
}

export function solveArmAim(
  shoulder: Vec3,
  target: Vec3,
  upperLength: number,
  foreLength: number,
  out: LimbAim
): LimbAim | null {
  // `down × dir` is the arm's bend axis (its y-component is always 0): horizontal and
  // perpendicular to the aim, so the elbows fold downward. -alpha tilts the upper arm off the
  // shoulder→target line in that plane, and the forearm then closes by +beta.
  return solveTwoBone(shoulder, target, upperLength, foreLength, 'arm', out) ? out : null;
}

/**
 * Two-bone leg aim, the leg's mirror of the arm solve: the foot lands on `target` with the knee
 * folding **forward** (the character faces -Z), which is the direction a human knee bends.
 *
 * Same contract as `solveArmAim` — the solved forward kinematics reproduces the target exactly
 * when it is in reach — but the bend signs are mirrored: `bend` is **negative**, applied to the
 * shin about the shared axis.
 */
export function solveLegAim(
  hip: Vec3,
  target: Vec3,
  thighLength: number,
  shinLength: number,
  out: LimbAim
): LimbAim | null {
  // The knee's bend axis is the hip's own lateral axis, so the knee stays in the sagittal plane
  // however the foot is placed. +alpha tilts the thigh forward, the shin then closes by -beta.
  return solveTwoBone(hip, target, thighLength, shinLength, 'leg', out) ? out : null;
}

/**
 * Shared analytic two-bone solve (law of cosines, no iteration). Returns false for degenerate
 * input (zero-length bone, target on the joint) so callers keep their authored pose rather than
 * getting NaN bones.
 */
function solveTwoBone(
  root: Vec3,
  target: Vec3,
  upperLength: number,
  lowerLength: number,
  mode: 'arm' | 'leg',
  out: LimbAim
): boolean {
  const a = sanitise(upperLength, 0);
  const b = sanitise(lowerLength, 0);
  if (!(a > 0) || !(b > 0)) return false;

  let dx = target.x - root.x;
  let dy = target.y - root.y;
  let dz = target.z - root.z;
  const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (!(distance > 1e-4)) return false;

  // Out of reach: aim straight at it with a straight joint (clamping the *distance*, not the
  // direction, keeps the limb pointing at the target instead of snapping to a limit).
  const maxReach = a + b - 1e-3;
  const minReach = Math.abs(a - b) + 1e-3;
  const d = Math.min(Math.max(distance, minReach), maxReach);
  const scale = d / distance;
  dx *= scale;
  dy *= scale;
  dz *= scale;

  const dirX = dx / d;
  const dirY = dy / d;
  const dirZ = dz / d;

  let axisX: number;
  let axisZ: number;
  if (mode === 'arm') {
    axisX = -dirZ;
    axisZ = dirX;
    const axisLength = Math.sqrt(axisX * axisX + axisZ * axisZ);
    if (axisLength < 1e-4) {
      // Aiming straight up or down: any horizontal axis works, pick the player's right.
      axisX = 1;
      axisZ = 0;
    } else {
      axisX /= axisLength;
      axisZ /= axisLength;
    }
  } else {
    axisX = 1;
    axisZ = 0;
  }

  // Law of cosines: alpha tilts the upper bone off the root→target line, beta closes the joint.
  const alpha = Math.acos(Math.min(Math.max((a * a + d * d - b * b) / (2 * a * d), -1), 1));
  const beta = Math.PI - Math.acos(Math.min(Math.max((a * a + b * b - d * d) / (2 * a * b), -1), 1));
  const tilt = mode === 'arm' ? -alpha : alpha;

  out.upperX = rotateAboutAxisComponentX(dirX, dirY, dirZ, axisX, 0, axisZ, tilt, 0);
  out.upperY = rotateAboutAxisComponentX(dirX, dirY, dirZ, axisX, 0, axisZ, tilt, 1);
  out.upperZ = rotateAboutAxisComponentX(dirX, dirY, dirZ, axisX, 0, axisZ, tilt, 2);
  out.axisX = axisX;
  out.axisY = 0;
  out.axisZ = axisZ;
  out.bend = mode === 'arm' ? beta : -beta;
  return true;
}

/**
 * Rodrigues rotation of `v` about the unit axis `(ax, ay, az)` by `angle`, returning component
 * `component` (0=x, 1=y, 2=z). Written out component-wise so the aim solver allocates nothing.
 */
function rotateAboutAxisComponentX(
  vx: number,
  vy: number,
  vz: number,
  ax: number,
  ay: number,
  az: number,
  angle: number,
  component: 0 | 1 | 2
): number {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dot = ax * vx + ay * vy + az * vz;
  const crossX = ay * vz - az * vy;
  const crossY = az * vx - ax * vz;
  const crossZ = ax * vy - ay * vx;
  if (component === 0) return vx * cos + crossX * sin + ax * dot * (1 - cos);
  if (component === 1) return vy * cos + crossY * sin + ay * dot * (1 - cos);
  return vz * cos + crossZ * sin + az * dot * (1 - cos);
}
