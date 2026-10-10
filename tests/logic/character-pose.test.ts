import { describe, expect, it } from 'vitest';

import {
  BREATH_RATE,
  CHARACTER_ANKLE_HEIGHT,
  CHARACTER_JOINTS,
  CHARACTER_LEG,
  CHARACTER_PARENTS,
  CHARACTER_REST_OFFSETS,
  JOINT_LIMIT,
  STRIDE_RUN,
  STRIDE_WALK,
  createCharacterPose,
  GaitDriver,
  sampleCharacterPose,
  solveArmAim,
  solveLegAim,
  type LimbAim,
  type CharacterJointId,
  type CharacterPose,
  type CharacterPoseInput
} from '../../src/core/character-pose.ts';

const WALK = 1.8;
const RUN = 4.6;

/** Expected skeleton shape, written out here so a wrong export cannot pass its own test. */
const EXPECTED_PARENTS: Record<CharacterJointId, CharacterJointId | null> = {
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

function input(overrides: Partial<CharacterPoseInput> = {}): CharacterPoseInput {
  return {
    speed: 0,
    walkSpeed: WALK,
    runSpeed: RUN,
    grounded: true,
    carrying: false,
    gaitPhase: 0,
    breathPhase: 0,
    ...overrides
  };
}

function pose(overrides: Partial<CharacterPoseInput> = {}, out = createCharacterPose()): CharacterPose {
  return sampleCharacterPose(input(overrides), out);
}

/** Rest height of a joint above the feet, walked up the expected parent table. */
function restHeight(joint: CharacterJointId): number {
  let y = 0;
  let cursor: CharacterJointId | null = joint;
  while (cursor !== null) {
    y += CHARACTER_REST_OFFSETS[cursor].y;
    cursor = EXPECTED_PARENTS[cursor];
  }
  return y;
}

/** Independent Rodrigues rotation: the test's own maths, not the module's helper. */
function rotate(
  v: readonly [number, number, number],
  axis: readonly [number, number, number],
  angle: number
): readonly [number, number, number] {
  const [vx, vy, vz] = v;
  const [ax, ay, az] = axis;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dot = ax * vx + ay * vy + az * vz;
  const cx = ay * vz - az * vy;
  const cy = az * vx - ax * vz;
  const cz = ax * vy - ay * vx;
  return [
    vx * cos + cx * sin + ax * dot * (1 - cos),
    vy * cos + cy * sin + ay * dot * (1 - cos),
    vz * cos + cz * sin + az * dot * (1 - cos)
  ];
}

function aim(): LimbAim {
  return { upperX: 0, upperY: 0, upperZ: 0, axisX: 0, axisY: 0, axisZ: 0, bend: 0 };
}

describe('character pose — rig declarations', () => {
  it('declares a complete, symmetric skeleton that stands on its feet', () => {
    expect(CHARACTER_JOINTS.length).toBe(19);
    expect(CHARACTER_PARENTS).toEqual(EXPECTED_PARENTS);

    // Mirror symmetry: every left joint has a right twin at the negated X offset.
    for (const joint of CHARACTER_JOINTS) {
      if (!joint.endsWith('L')) continue;
      const twin = `${joint.slice(0, -1)}R` as CharacterJointId;
      expect(CHARACTER_REST_OFFSETS[twin].x).toBeCloseTo(-CHARACTER_REST_OFFSETS[joint].x, 9);
      expect(CHARACTER_REST_OFFSETS[twin].y).toBeCloseTo(CHARACTER_REST_OFFSETS[joint].y, 9);
    }

    // A human silhouette: ankles at the floor, head well above 1.6 m.
    expect(restHeight('footL')).toBeGreaterThan(0);
    expect(restHeight('footL')).toBeLessThan(0.12);
    expect(restHeight('head')).toBeGreaterThan(1.55);
  });
});

describe('character pose — idle, gait, air and carry', () => {
  it('reuses the caller’s buffer and never allocates a new pose', () => {
    const buffer = createCharacterPose();
    const first = sampleCharacterPose(input(), buffer);
    const second = sampleCharacterPose(input({ speed: RUN, gaitPhase: 1 }), buffer);
    expect(first).toBe(buffer);
    expect(second).toBe(buffer);
  });

  it('stands still at zero speed: no gait, no swing, breathing still moves the chest', () => {
    const still = pose({ gaitPhase: 1.1 });
    const otherPhase = pose({ gaitPhase: 3.7 });
    expect(still.gaitWeight).toBe(0);
    expect(still.joints.thighL.x).toBeCloseTo(-0.04, 9);
    expect(otherPhase.joints.thighL.x).toBeCloseTo(still.joints.thighL.x, 9);

    const inhale = pose({ breathPhase: Math.PI / 2 });
    const exhale = pose({ breathPhase: -Math.PI / 2 });
    expect(Math.abs(inhale.joints.chest.x - exhale.joints.chest.x)).toBeGreaterThan(0.01);
  });

  it('walks the legs half a cycle apart, knees never folding backwards', () => {
    const half = pose({ speed: WALK, gaitPhase: Math.PI / 2 });
    expect(half.joints.thighL.x).toBeGreaterThan(0.4);
    expect(half.joints.thighR.x).toBeLessThan(-0.5);
    expect(half.joints.shinL.x).toBeLessThanOrEqual(-0.1);
    expect(half.joints.shinR.x).toBeLessThanOrEqual(-0.1);

    const left = pose({ speed: WALK, gaitPhase: 0.4 });
    const right = pose({ speed: WALK, gaitPhase: 0.4 + Math.PI });
    expect(left.joints.thighL.x).toBeCloseTo(right.joints.thighR.x, 9);
    expect(left.joints.upperArmL.x).toBeCloseTo(right.joints.upperArmR.x, 9);
    // Arms swing against the legs: the left arm travels forward while the left leg trails back.
    expect(Math.sign(left.joints.upperArmL.x - 0.06)).toBe(-Math.sign(left.joints.thighL.x + 0.04));
  });

  it('leans and swings further as speed rises, and adds a stride bob', () => {
    const walking = pose({ speed: WALK, gaitPhase: Math.PI / 4 });
    const running = pose({ speed: RUN, gaitPhase: Math.PI / 4 });
    expect(walking.gaitWeight).toBe(1);
    expect(running.speedFactor).toBe(1);
    expect(running.joints.spine.x).toBeGreaterThan(walking.joints.spine.x);
    expect(Math.abs(running.hipsRise)).toBeGreaterThan(Math.abs(walking.hipsRise));
  });

  it('tucks in the air instead of running the stride', () => {
    const jump = pose({ speed: 0, grounded: false, gaitPhase: Math.PI / 2 });
    expect(jump.joints.thighL.x).toBeGreaterThan(0.2);
    expect(jump.joints.shinL.x).toBeLessThan(-0.4);
    expect(jump.joints.upperArmL.x).toBeLessThan(-0.2);
    expect(jump.hipsRise).toBe(0);
  });

  it('raises both arms, bends the elbows and brings the hands inward while carrying', () => {
    const free = pose({ speed: WALK, gaitPhase: 0 });
    const loaded = pose({ speed: WALK, gaitPhase: 0, carrying: true });
    expect(loaded.joints.upperArmL.x).toBeLessThan(free.joints.upperArmL.x - 0.4);
    expect(loaded.joints.upperArmR.x).toBeLessThan(free.joints.upperArmR.x - 0.4);
    expect(loaded.joints.foreArmL.x).toBeLessThan(free.joints.foreArmL.x - 0.4);
    expect(loaded.joints.upperArmL.z).toBeGreaterThan(free.joints.upperArmL.z);
    expect(loaded.joints.upperArmR.z).toBeLessThan(free.joints.upperArmR.z);
  });

  it('stays finite and inside the joint limits for hostile input', () => {
    const hostile: ReadonlyArray<Partial<CharacterPoseInput>> = [
      { speed: Number.NaN, gaitPhase: Number.NaN, breathPhase: Number.NaN },
      { speed: Number.POSITIVE_INFINITY, walkSpeed: 0, runSpeed: Number.NaN },
      { speed: -12, walkSpeed: -1, runSpeed: -1, gaitPhase: 1e9 },
      { speed: 2, walkSpeed: 1, runSpeed: 1, grounded: false },
      { speed: 2, gaitPhase: Number.NEGATIVE_INFINITY }
    ];
    for (const overrides of hostile) {
      const result = pose(overrides);
      expect(Number.isFinite(result.hipsRise)).toBe(true);
      expect(result.speedFactor).toBeGreaterThanOrEqual(0);
      expect(result.speedFactor).toBeLessThanOrEqual(1);
      expect(result.gaitWeight).toBeGreaterThanOrEqual(0);
      expect(result.gaitWeight).toBeLessThanOrEqual(1);
      for (const joint of CHARACTER_JOINTS) {
        const angles = result.joints[joint];
        for (const value of [angles.x, angles.y, angles.z]) {
          expect(Number.isFinite(value)).toBe(true);
          expect(Math.abs(value)).toBeLessThanOrEqual(JOINT_LIMIT);
        }
      }
    }
  });
});

describe('GaitDriver — distance-driven phases', () => {
  it('advances the gait by distance, not by time, and never slides a standing foot', () => {
    const driver = new GaitDriver();
    driver.advance(STRIDE_WALK, 0, 0);
    expect(driver.phase).toBeCloseTo(0, 6); // a full cycle returns to the start
    driver.advance(STRIDE_WALK / 2, 0, 0);
    expect(driver.phase).toBeCloseTo(Math.PI, 6);

    const held = driver.phase;
    driver.advance(0, 1, 0);
    expect(driver.phase).toBe(held);
    expect(driver.breathPhase).toBeCloseTo(BREATH_RATE, 6);
  });

  it('takes a longer stride when running, and ignores non-finite input', () => {
    const walker = new GaitDriver();
    const runner = new GaitDriver();
    walker.advance(STRIDE_WALK / 2, 0, 0);
    runner.advance(STRIDE_RUN / 2, 0, 1);
    expect(runner.phase).toBeCloseTo(walker.phase, 9);

    const driver = new GaitDriver();
    driver.advance(Number.NaN, Number.NaN, 0.5);
    expect(driver.phase).toBe(0);
    expect(driver.breathPhase).toBe(0);
    driver.advance(10, 0.1, 0.5);
    driver.reset();
    expect(driver.phase).toBe(0);
    expect(driver.breathPhase).toBe(0);
  });
});

describe('solveArmAim — two-bone hand placement', () => {
  const upper = 0.3;
  const fore = 0.26;

  /** Forward kinematics of a solved aim: where the wrist actually ends up. */
  function handAt(shoulder: { x: number; y: number; z: number }, solved: LimbAim): readonly [number, number, number] {
    const upperDir = [solved.upperX, solved.upperY, solved.upperZ] as const;
    const foreDir = rotate(upperDir, [solved.axisX, solved.axisY, solved.axisZ] as const, solved.bend);
    return [
      shoulder.x + upper * upperDir[0] + fore * foreDir[0],
      shoulder.y + upper * upperDir[1] + fore * foreDir[1],
      shoulder.z + upper * upperDir[2] + fore * foreDir[2]
    ];
  }

  it('puts the hand exactly on a reachable target (forward kinematics of the result)', () => {
    const shoulder = { x: -0.23, y: 1.46, z: 0 };
    // Every target sits inside the 0.56 m reach; the last one nearly at full extension.
    const targets = [
      { x: 0, y: 1.25, z: -0.4 },
      { x: -0.3, y: 1.1, z: -0.3 },
      { x: -0.2, y: 1.5, z: -0.2 },
      { x: -0.35, y: 1, z: -0.25 },
      { x: -0.1, y: 1.44, z: -0.45 }
    ];
    for (const target of targets) {
      const solved = solveArmAim(shoulder, target, upper, fore, aim());
      expect(solved).not.toBeNull();
      if (solved === null) continue;
      // The bend axis must stay perpendicular to the aimed bone, or the elbow leaves the plane.
      expect(solved.axisX * solved.upperX + solved.axisY * solved.upperY + solved.axisZ * solved.upperZ).toBeCloseTo(0, 9);
      expect(Math.hypot(solved.axisX, solved.axisY, solved.axisZ)).toBeCloseTo(1, 9);

      const hand = handAt(shoulder, solved);
      expect(hand[0]).toBeCloseTo(target.x, 6);
      expect(hand[1]).toBeCloseTo(target.y, 6);
      expect(hand[2]).toBeCloseTo(target.z, 6);
      // Elbows fold, never hyperextend.
      expect(solved.bend).toBeGreaterThanOrEqual(0);
      expect(solved.bend).toBeLessThanOrEqual(Math.PI);
    }
  });

  it('points at a target beyond reach with a straight elbow', () => {
    const shoulder = { x: 0.23, y: 1.46, z: 0 };
    const solved = solveArmAim(shoulder, { x: 0.23, y: 1.4, z: -3 }, upper, fore, aim());
    expect(solved).not.toBeNull();
    if (solved === null) return;
    expect(solved.bend).toBeLessThan(0.2);
    expect(solved.upperX).toBeCloseTo(0, 6);
    expect(solved.upperZ).toBeLessThan(-0.9);
  });

  it('reports degenerate input as null instead of producing NaN bones', () => {
    const shoulder = { x: 0.23, y: 1.46, z: 0 };
    expect(solveArmAim(shoulder, { x: 0.23, y: 1.46, z: 0 }, upper, fore, aim())).toBeNull();
    expect(solveArmAim(shoulder, { x: 0, y: 1, z: 0 }, 0, fore, aim())).toBeNull();
    expect(solveArmAim(shoulder, { x: 0, y: 1, z: 0 }, upper, Number.NaN, aim())).toBeNull();
    // Straight up is the axis-degenerate case: it must still resolve and still hit the target.
    const overhead = solveArmAim(shoulder, { x: 0.23, y: 1.8, z: 0 }, upper, fore, aim());
    expect(overhead).not.toBeNull();
    if (overhead === null) return;
    const hand = handAt(shoulder, overhead);
    expect(hand[0]).toBeCloseTo(0.23, 6);
    expect(hand[1]).toBeCloseTo(1.8, 6);
    expect(hand[2]).toBeCloseTo(0, 6);
  });
});

describe('solveLegAim — two-bone foot planting', () => {
  const thigh = CHARACTER_LEG.thigh;
  const shin = CHARACTER_LEG.shin;

  /** Forward kinematics of a solved leg: where the ankle lands, and where the knee went. */
  function legAt(hip: { x: number; y: number; z: number }, solved: LimbAim) {
    const upperDir = [solved.upperX, solved.upperY, solved.upperZ] as const;
    const lowerDir = rotate(upperDir, [solved.axisX, solved.axisY, solved.axisZ] as const, solved.bend);
    return {
      knee: [
        hip.x + thigh * upperDir[0],
        hip.y + thigh * upperDir[1],
        hip.z + thigh * upperDir[2]
      ] as readonly [number, number, number],
      ankle: [
        hip.x + thigh * upperDir[0] + shin * lowerDir[0],
        hip.y + thigh * upperDir[1] + shin * lowerDir[1],
        hip.z + thigh * upperDir[2] + shin * lowerDir[2]
      ] as readonly [number, number, number]
    };
  }

  it('plants the ankle on the surface, with the knee folding forward', () => {
    const hip = { x: -0.105, y: 0.91, z: 0 };
    // Flat ground, a low crate, a tall crate and a step up — all inside the 0.9 m leg.
    for (const groundY of [0, 0.06, 0.18, 0.3]) {
      const target = { x: -0.105, y: groundY + CHARACTER_ANKLE_HEIGHT, z: 0 };
      const solved = solveLegAim(hip, target, thigh, shin, aim());
      expect(solved).not.toBeNull();
      if (solved === null) continue;
      const { knee, ankle } = legAt(hip, solved);
      expect(ankle[0]).toBeCloseTo(target.x, 6);
      expect(ankle[1]).toBeCloseTo(target.y, 6);
      expect(ankle[2]).toBeCloseTo(target.z, 6);
      // Knees bend backward from straight (never hyperextend) and always toward the facing (-Z).
      expect(solved.bend).toBeLessThanOrEqual(0);
      expect(solved.bend).toBeGreaterThanOrEqual(-Math.PI);
      expect(knee[2]).toBeLessThan(-0.05);
      expect(knee[0]).toBeCloseTo(hip.x, 6);
    }
  });

  it('keeps the knee inside the leg plane and reaches no further than the leg', () => {
    const hip = { x: 0.105, y: 0.91, z: 0 };
    // Through the floor, and a crate top far too high to stand on: both clamp, never NaN.
    const deep = solveLegAim(hip, { x: 0.105, y: -2, z: 0 }, thigh, shin, aim());
    expect(deep).not.toBeNull();
    if (deep !== null) {
      const { ankle } = legAt(hip, deep);
      expect(Math.hypot(ankle[0] - hip.x, ankle[1] - hip.y, ankle[2] - hip.z)).toBeLessThanOrEqual(thigh + shin);
      expect(ankle[1]).toBeLessThan(-0.88 + hip.y);
    }
    const high = solveLegAim(hip, { x: 0.105, y: 1.4, z: 0 }, thigh, shin, aim());
    expect(high).not.toBeNull();

    // Degenerate input is reported, never turned into NaN bones.
    expect(solveLegAim(hip, { ...hip }, thigh, shin, aim())).toBeNull();
    expect(solveLegAim(hip, { x: 0, y: 0.2, z: 0 }, 0, shin, aim())).toBeNull();
    expect(solveLegAim(hip, { x: 0, y: 0.2, z: 0 }, thigh, Number.NaN, aim())).toBeNull();
  });
});
