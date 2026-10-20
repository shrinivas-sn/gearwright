import { describe, expect, it } from 'vitest';

import { carryGripPoint, carryHoldDistance } from '../../src/core/arm-ik.ts';
import { BOILER_DEF, CRATE_DEF, GEAR_DEF, PLATE_DEF, VALVE_DEF } from '../../src/data/components.ts';
import { DEFAULT_MANIPULATION_TUNING } from '../../src/gameplay/manipulation-system.ts';

/**
 * CARRY GEOMETRY (19/10/2026) — the distance a carried part sits at, and the face the hands
 * close on.
 *
 * Both are pure numbers on purpose: the carry read failed twice as a *rig* problem ("the hands
 * move oddly", "the hands cannot touch the part") when it was a geometry problem — the rig was
 * asked to put a hand on a point 1.35 m from a 0.46 m arm, and on the *centre* of a part that the
 * arm would have had to reach through. These tests pin the geometry itself.
 */

const TUNING = DEFAULT_MANIPULATION_TUNING;

function hold(halfExtents: { readonly x: number; readonly z: number }): number {
  return carryHoldDistance(halfExtents, TUNING.carryReach, TUNING.holdDistanceMin, TUNING.holdDistanceMax);
}

/** Support distance of a yawed box along the xz direction — the geometry the hold is built on. */
function supportDistance(
  halfExtents: { readonly x: number; readonly z: number },
  yaw: number,
  fx: number,
  fz: number
): number {
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  return (
    halfExtents.x * Math.abs(cos * fx - sin * fz) + halfExtents.z * Math.abs(sin * fx + cos * fz)
  );
}

describe('carryHoldDistance — the part its own size, not a constant', () => {
  it('puts the near face of a gear in the hands', () => {
    // The 0.42 m the arm has left with the elbows bent, plus the gear's plan-view circumradius.
    expect(hold(GEAR_DEF.halfExtents)).toBeCloseTo(0.42 + Math.hypot(0.3, 0.3), 6);
  });

  it('holds a bigger part further out, by exactly its own size', () => {
    expect(hold(CRATE_DEF.halfExtents)).toBeCloseTo(0.42 + Math.hypot(0.4, 0.4), 6);
    expect(hold(BOILER_DEF.halfExtents)).toBeCloseTo(0.42 + Math.hypot(0.45, 0.45), 6);
    expect(hold(PLATE_DEF.halfExtents)).toBeCloseTo(0.42 + Math.hypot(0.35, 0.35), 6);
  });

  it('puts every shipped part within a hand of its surface, whichever way it is turned', () => {
    // The 0.55 m a two-handed carry can actually span at chest height (0.464 m arm, elbow bent).
    const HAND_REACH = 0.55;
    for (const definition of [GEAR_DEF, VALVE_DEF, CRATE_DEF, BOILER_DEF, PLATE_DEF]) {
      const distance = hold(definition.halfExtents);
      let worst = 0;
      for (let i = 0; i < 24; i += 1) {
        const yaw = (i / 24) * Math.PI * 2;
        const nearFace = distance - supportDistance(definition.halfExtents, yaw, 0, -1);
        worst = Math.max(worst, nearFace - HAND_REACH);
      }
      expect(worst).toBeLessThan(0.08);
    }
  });

  it('never shortens below the torso clearance, however thin the part', () => {
    // A plate is 0.05 m thick: without the floor its centre would sit inside the player's capsule.
    const veryThin = hold({ x: 0.01, z: 0.01 });
    expect(veryThin).toBe(TUNING.holdDistanceMin);
    expect(TUNING.holdDistanceMin).toBeGreaterThan(0.32 + 0.05);
  });

  it('never exceeds the ceiling the old fixed distance set', () => {
    expect(hold({ x: 2, z: 2 })).toBe(TUNING.holdDistanceMax);
  });

  it('keeps the near face outside the player\'s own capsule for every part and every yaw', () => {
    // A capsule radius of 0.32 m, plus the part's own circumradius, is the closest a hold can be
    // before the body is inside the part it is carrying.
    const CAPSULE_RADIUS = 0.32;
    for (const definition of [GEAR_DEF, VALVE_DEF, CRATE_DEF, BOILER_DEF, PLATE_DEF]) {
      const distance = hold(definition.halfExtents);
      for (let i = 0; i < 24; i += 1) {
        const yaw = (i / 24) * Math.PI * 2;
        const face = distance - supportDistance(definition.halfExtents, yaw, 0, -1);
        expect(face).toBeGreaterThan(CAPSULE_RADIUS);
      }
    }
  });

  it('is rotation-invariant, so turning a part in your hands never lunges it', () => {
    // The function takes no yaw at all: that is the property. A yaw-dependent hold would slide
    // the part toward the chest every time the player rotated it at a socket.
    expect(carryHoldDistance.length).toBe(4);
    expect(hold(VALVE_DEF.halfExtents)).toBe(hold(VALVE_DEF.halfExtents));
  });

  it('ignores malformed input rather than producing a NaN hold', () => {
    const distance = carryHoldDistance(
      { x: Number.NaN, z: 0.4 },
      Number.NaN,
      TUNING.holdDistanceMin,
      TUNING.holdDistanceMax
    );
    expect(Number.isFinite(distance)).toBe(true);
    // A NaN size can only collapse the part to nothing, which the floor catches.
    expect(distance).toBe(TUNING.holdDistanceMin);
  });
});

describe('carryGripPoint — the hands close on the near face', () => {
  const out = { x: 0, y: 0, z: 0 };
  const centre = { x: 0, y: 1.2, z: 0 };

  it('returns the face of the box nearest the player', () => {
    const distance = carryGripPoint(centre, GEAR_DEF.halfExtents, 0, { x: 0, y: 1.2, z: -2 }, out);
    expect(distance).toBeCloseTo(0.3, 6);
    expect(out.x).toBeCloseTo(0, 6);
    expect(out.z).toBeCloseTo(-0.3, 6);
  });

  it('uses the thin face of an elongated part held broadside', () => {
    // A valve is 0.6 m long and 0.24 m across: broadside, the hands meet its 0.12 m face.
    const distance = carryGripPoint(centre, VALVE_DEF.halfExtents, 0, { x: 0, y: 1.2, z: -2 }, out);
    expect(distance).toBeCloseTo(0.12, 6);
    expect(out.z).toBeCloseTo(-0.12, 6);
  });

  it('follows the part yaw, so a rotated part still presents its nearest face', () => {
    // Quarter turn: the 0.3 m axis now points at the player.
    const distance = carryGripPoint(centre, VALVE_DEF.halfExtents, Math.PI / 2, { x: 0, y: 1.2, z: -2 }, out);
    expect(distance).toBeCloseTo(0.3, 6);
    expect(out.z).toBeCloseTo(-0.3, 6);
  });

  it('reaches the top face for a player standing above the part', () => {
    const distance = carryGripPoint(centre, GEAR_DEF.halfExtents, 0, { x: 0, y: 3, z: 0 }, out);
    expect(distance).toBeCloseTo(0.07, 6);
    expect(out.y).toBeCloseTo(1.27, 6);
  });

  it('degrades to the centre for a degenerate observer, without a NaN', () => {
    expect(carryGripPoint(centre, GEAR_DEF.halfExtents, 0, { x: 0, y: 1.2, z: 0 }, out)).toBe(0);
    expect(out).toEqual(centre);
  });

  it('stops at the observer when they are already inside the box', () => {
    const distance = carryGripPoint(centre, GEAR_DEF.halfExtents, 0, { x: 0, y: 1.2, z: -0.1 }, out);
    expect(distance).toBeCloseTo(0.1, 6);
    expect(out.z).toBeCloseTo(-0.1, 6);
  });

  it('survives a non-finite yaw or half extent', () => {
    const distance = carryGripPoint(
      centre,
      { x: Number.NaN, y: 0.07, z: 0.3 },
      Number.NaN,
      { x: 0, y: 1.2, z: -2 },
      out
    );
    expect(Number.isFinite(distance)).toBe(true);
    expect(Number.isFinite(out.x) && Number.isFinite(out.y) && Number.isFinite(out.z)).toBe(true);
  });
});
