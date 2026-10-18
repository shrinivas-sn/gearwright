import { describe, expect, it } from 'vitest';

import {
  CARRY_HAND_SPREAD,
  ElbowPole,
  aimYawOf,
  clampGripTarget,
  clampTwist,
  splitGrip,
  wrapAngle,
  type GripPoint
} from '../../src/core/arm-ik.ts';

function point(x: number, y: number, z: number): GripPoint {
  return { x, y, z };
}

function angleBetween(a: GripPoint, b: GripPoint): number {
  const dot = a.x * b.x + a.y * b.y + a.z * b.z;
  return Math.acos(Math.min(Math.max(dot, -1), 1));
}

describe('clampGripTarget — a hand never goes past the arm', () => {
  it('leaves a target inside reach exactly where it is', () => {
    const out = point(0, 0, 0);
    const reach = clampGripTarget(point(0, 1.46, 0), point(0.1, 1.3, -0.3), 0.04, 0.56, out);
    expect(reach).toBeCloseTo(Math.hypot(0.1, -0.16, -0.3), 6);
    expect(out.x).toBeCloseTo(0.1, 6);
    expect(out.y).toBeCloseTo(1.3, 6);
    expect(out.z).toBeCloseTo(-0.3, 6);
  });

  it('clamps a far target along its own direction instead of dropping it', () => {
    const root = point(0, 1.46, 0);
    const target = point(0.2, 1.5, -3);
    const out = point(0, 0, 0);
    const reach = clampGripTarget(root, target, 0.04, 0.56, out);

    // At full reach, a hair inside it (an exactly straight arm reads as locked).
    expect(reach).toBeCloseTo(0.56 - 1e-3, 6);
    const length = Math.hypot(out.x - root.x, out.y - root.y, out.z - root.z);
    expect(length).toBeCloseTo(reach, 6);
    // Still aiming at the target: the direction is what a reaching arm keeps.
    const wanted = point(target.x - root.x, target.y - root.y, target.z - root.z);
    const solved = point(out.x - root.x, out.y - root.y, out.z - root.z);
    const dot =
      (wanted.x * solved.x + wanted.y * solved.y + wanted.z * solved.z) /
      (Math.hypot(wanted.x, wanted.y, wanted.z) * length);
    expect(dot).toBeCloseTo(1, 6);
  });

  it('pushes a too-close target out to the minimum the elbow can fold', () => {
    const root = point(0, 1.46, 0);
    const out = point(0, 0, 0);
    const reach = clampGripTarget(root, point(0, 1.46, -0.01), 0.04, 0.56, out);
    expect(reach).toBeCloseTo(0.04, 6);
    expect(Math.hypot(out.x, out.y - 1.46, out.z)).toBeCloseTo(0.04, 6);
  });

  it('survives a non-finite target without writing a NaN', () => {
    const out = point(0, 0, 0);
    const reach = clampGripTarget(point(0, 1, 0), point(Number.NaN, 1, 0), 0.04, 0.56, out);
    expect(reach).toBe(0);
    expect(Number.isFinite(out.x) && Number.isFinite(out.y) && Number.isFinite(out.z)).toBe(true);
  });
});

describe('splitGrip — two hands bracket a part', () => {
  it('places the hands either side of the centre, on the body’s lateral axis', () => {
    const left = point(0, 0, 0);
    const right = point(0, 0, 0);
    splitGrip(point(0, 1.1, -0.7), 1, 0, CARRY_HAND_SPREAD, left, right);
    expect(left.x).toBeCloseTo(-CARRY_HAND_SPREAD, 6);
    expect(right.x).toBeCloseTo(CARRY_HAND_SPREAD, 6);
    expect(left.y).toBeCloseTo(1.1, 6);
    expect(right.z).toBeCloseTo(-0.7, 6);
    // Both hands on the centre is the old behaviour; a carry has to have width.
    expect(right.x - left.x).toBeGreaterThan(0.2);
  });

  it('normalises the axis and keeps the centre when the axis is degenerate', () => {
    const left = point(0, 0, 0);
    const right = point(0, 0, 0);
    splitGrip(point(1, 2, 3), 0, 0, CARRY_HAND_SPREAD, left, right);
    expect(left.x).toBe(1);
    expect(right.x).toBe(1);

    // A +Z lateral axis: the left hand is offset toward -Z, the right toward +Z.
    splitGrip(point(1, 2, 3), 0, 4, 0.2, left, right);
    expect(left.z).toBeCloseTo(3 - 0.2, 6);
    expect(right.z).toBeCloseTo(3 + 0.2, 6);
  });
});

describe('torso twist — the chest squares up to the aim', () => {
  it('maps a forward direction to a body-relative yaw', () => {
    expect(aimYawOf(0, -1)).toBeCloseTo(0, 6); // dead ahead
    expect(aimYawOf(-1, 0)).toBeCloseTo(Math.PI / 2, 6); // the character’s left
    expect(aimYawOf(1, 0)).toBeCloseTo(-Math.PI / 2, 6); // the character’s right
    expect(aimYawOf(0, Number.NaN)).toBe(0);
  });

  it('takes the short way round and clamps at the torso limit', () => {
    expect(wrapAngle((3 * Math.PI) / 2)).toBeCloseTo(-Math.PI / 2, 6);
    expect(wrapAngle(-(3 * Math.PI) / 2)).toBeCloseTo(Math.PI / 2, 6);
    // Directly behind is the boundary case: either extreme is a valid "as far as the torso goes".
    expect(Math.abs(clampTwist(Math.PI, 0.9))).toBeCloseTo(0.9, 6);
    expect(Math.abs(clampTwist(-Math.PI, 0.9))).toBeCloseTo(0.9, 6);
    // An aim behind the character resolves to a small twist, never a 2π spin.
    expect(Math.abs(clampTwist(Math.PI * 1.98, 0.9))).toBeLessThan(0.9);
    expect(clampTwist(Number.NaN, 0.9)).toBe(0);
  });
});

describe('ElbowPole — one bending plane, turned at a bounded rate', () => {
  const DOWN = { x: 0, y: -1, z: 0 };
  const UP = { x: 0, y: 1, z: 0 };

  function poleOf(pole: ElbowPole, out: GripPoint): GripPoint {
    return pole.current(out);
  }

  it('starts from the preferred bend direction, projected off the aim', () => {
    const pole = new ElbowPole();
    const out = point(0, 0, 0);
    pole.update({ x: 0, y: 0, z: -1 }, DOWN, 1 / 60, 8, out);
    expect(out.x).toBeCloseTo(0, 6);
    expect(out.y).toBeCloseTo(-1, 6);
    expect(out.z).toBeCloseTo(0, 6);
  });

  it('sets the elbow down and out when the preferred direction is off-axis', () => {
    const pole = new ElbowPole();
    const out = point(0, 0, 0);
    pole.update({ x: 0, y: 0, z: -1 }, { x: 0.4, y: -1, z: 0 }, 1 / 60, 8, out);
    // Perpendicular to the aim (z = 0), pointing down and to the right.
    expect(out.z).toBeCloseTo(0, 6);
    expect(out.y).toBeLessThan(-0.8);
    expect(out.x).toBeGreaterThan(0.2);
    expect(Math.hypot(out.x, out.y, out.z)).toBeCloseTo(1, 6);
  });

  it('turns the bending plane at a bounded rate as the preferred side changes', () => {
    const pole = new ElbowPole();
    const out = point(0, 0, 0);
    const previous = point(0, 0, 0);
    const dt = 1 / 60;
    const turnRate = 6;
    let worst = 0;

    // The aim holds dead ahead; the preferred bend direction walks a full circle (a character
    // turning and leaning through a combat cycle).
    for (let i = 0; i <= 120; i += 1) {
      const angle = (i / 120) * Math.PI * 2;
      const preferred = { x: Math.sin(angle), y: -Math.cos(angle), z: 0 };
      pole.update({ x: 0, y: 0, z: -1 }, preferred, dt, turnRate, out);
      if (i > 0) worst = Math.max(worst, angleBetween(previous, out));
      // Perpendicular to the aim every frame, and unit length.
      expect(out.z).toBeCloseTo(0, 6);
      expect(Math.hypot(out.x, out.y, out.z)).toBeCloseTo(1, 6);
      previous.x = out.x;
      previous.y = out.y;
      previous.z = out.z;
    }

    // No frame moved the plane further than the rate limit allows (plus one rounding hair), so a
    // fast aim change can never flip the elbow from one side to the other in a single frame.
    expect(worst).toBeLessThanOrEqual(turnRate * dt + 1e-6);
    expect(worst).toBeGreaterThan(0.05);
  });

  it('survives an aim swept through vertical without a NaN pole', () => {
    const pole = new ElbowPole();
    const out = point(0, 0, 0);
    for (let i = 0; i <= 60; i += 1) {
      const pitch = (i / 60) * Math.PI - Math.PI / 2;
      const dir = { x: 0, y: Math.sin(pitch), z: -Math.cos(pitch) };
      pole.update(dir, DOWN, 1 / 60, 6, out);
      const length = Math.hypot(out.x, out.y, out.z);
      expect(Number.isFinite(length)).toBe(true);
      expect(length).toBeCloseTo(1, 6);
      expect(out.x * dir.x + out.y * dir.y + out.z * dir.z).toBeCloseTo(0, 6);
    }
  });

  it('holds its plane when dt is zero, and keeps a unit pole for an invented fallback', () => {
    const pole = new ElbowPole();
    const out = point(0, 0, 0);
    pole.update({ x: 0, y: 0, z: -1 }, { x: 0.4, y: -1, z: 0 }, 1 / 60, 8, out);
    const held = poleOf(pole, point(0, 0, 0));
    pole.update({ x: 0, y: 0, z: -1 }, { x: -1, y: 0, z: 0 }, 0, 8, out);
    expect(angleBetween(held, out)).toBeCloseTo(0, 6);

    // Aiming straight up with a preferred direction parallel to it: the fallback must still be a
    // unit vector perpendicular to the aim (never NaN, never zero).
    const fresh = new ElbowPole();
    fresh.update(UP, UP, 1 / 60, 8, out);
    expect(Math.hypot(out.x, out.y, out.z)).toBeCloseTo(1, 6);
    expect(out.y).toBeCloseTo(0, 6);
  });

  it('resets back to a first solve', () => {
    const pole = new ElbowPole();
    const out = point(0, 0, 0);
    pole.update({ x: 0, y: 0, z: -1 }, { x: 1, y: 0, z: 0 }, 1 / 60, 8, out);
    const before = point(out.x, out.y, out.z);
    pole.reset();
    pole.update({ x: 0, y: 0, z: -1 }, DOWN, 1 / 60, 8, out);
    expect(out.y).toBeCloseTo(-1, 6);
    expect(angleBetween(before, out)).toBeGreaterThan(0.5);
  });
});
