import { describe, expect, it } from 'vitest';

import {
  AIM_CONVERGENCE_M,
  WEAPON_MUZZLE_LEAD,
  WEAPON_SHOULDER_HEIGHT,
  WEAPON_SHOULDER_HEIGHT_CROUCHED,
  WEAPON_SIDE_OFFSET,
  createWeaponMount,
  resolveWeaponMount
} from '../../src/core/weapon-mount.ts';

const STANDING = { position: { x: 0, y: 0, z: 0 }, facingYaw: 0, crouched: false };

/** A camera a metre behind the player, looking level along -Z. */
const LEVEL_AIM = { eye: { x: 0, y: 1.62, z: 2.5 }, target: { x: 0, y: 1.62, z: -12 } };

describe('resolveWeaponMount — the gun is a function of stance and aim, never of the renderer', () => {
  it('rides at shoulder height, right of the aim line, with the muzzle a lead ahead', () => {
    const out = resolveWeaponMount(LEVEL_AIM, STANDING, createWeaponMount());
    expect(out.muzzle.x).toBeCloseTo(WEAPON_SIDE_OFFSET, 6);
    expect(out.muzzle.y).toBeCloseTo(WEAPON_SHOULDER_HEIGHT, 6);
    expect(out.muzzle.z).toBeCloseTo(-WEAPON_MUZZLE_LEAD, 6);
  });

  it('is deterministic, and independent of where the body is facing', () => {
    const a = resolveWeaponMount(LEVEL_AIM, STANDING, createWeaponMount());
    const b = resolveWeaponMount(LEVEL_AIM, STANDING, createWeaponMount());
    expect(a.muzzle).toEqual(b.muzzle);
    expect(a.aimDirection).toEqual(b.aimDirection);

    // The character can be mid-turn while the camera holds still: the mount does not move, so the
    // grip targets do not swim under the hands.
    const turned = resolveWeaponMount(
      LEVEL_AIM,
      { ...STANDING, facingYaw: 1.1 },
      createWeaponMount()
    );
    expect(turned.muzzle).toEqual(a.muzzle);
  });

  it('drops with a crouch, by exactly the stance’s height difference', () => {
    const standing = resolveWeaponMount(LEVEL_AIM, STANDING, createWeaponMount());
    const crouched = resolveWeaponMount(
      LEVEL_AIM,
      { ...STANDING, crouched: true },
      createWeaponMount()
    );
    expect(standing.muzzle.y - crouched.muzzle.y).toBeCloseTo(
      WEAPON_SHOULDER_HEIGHT - WEAPON_SHOULDER_HEIGHT_CROUCHED,
      6
    );
  });

  it('converges the shot onto the camera’s line from the muzzle', () => {
    const aim = { eye: { x: 0.4, y: 1.7, z: 1.2 }, target: { x: -3, y: 1.2, z: -9 } };
    const out = resolveWeaponMount(aim, STANDING, createWeaponMount());

    let dx = aim.target.x - aim.eye.x;
    let dy = aim.target.y - aim.eye.y;
    let dz = aim.target.z - aim.eye.z;
    const length = Math.hypot(dx, dy, dz);
    dx /= length;
    dy /= length;
    dz /= length;
    const wantedX = aim.eye.x + dx * AIM_CONVERGENCE_M - out.muzzle.x;
    const wantedY = aim.eye.y + dy * AIM_CONVERGENCE_M - out.muzzle.y;
    const wantedZ = aim.eye.z + dz * AIM_CONVERGENCE_M - out.muzzle.z;
    const wantedLength = Math.hypot(wantedX, wantedY, wantedZ);
    const dot =
      (out.aimDirection.x * wantedX +
        out.aimDirection.y * wantedY +
        out.aimDirection.z * wantedZ) /
      wantedLength;
    expect(dot).toBeCloseTo(1, 6);
  });

  it('keeps both grip points inside each body’s arm reach (the bug this mount replaced)', () => {
    const out = resolveWeaponMount(LEVEL_AIM, STANDING, createWeaponMount());

    // The same derivation the renderer uses for the two-handed grip: back along the shot line.
    const rear = {
      x: out.muzzle.x - out.aimDirection.x * 0.3,
      y: out.muzzle.y - out.aimDirection.y * 0.3,
      z: out.muzzle.z - out.aimDirection.z * 0.3
    };
    const front = {
      x: out.muzzle.x - out.aimDirection.x * 0.12,
      y: out.muzzle.y - out.aimDirection.y * 0.12,
      z: out.muzzle.z - out.aimDirection.z * 0.12
    };
    const gap = (point: { x: number; y: number; z: number }, sx: number, sy: number) =>
      Math.hypot(point.x - sx, point.y - sy, point.z);

    // 1. The imported body, measured from `assets/characters/vanguard.glb`'s own bind pose:
    //    shoulders at ±0.205 m and 1.454 m up, upper arm 0.227 m + forearm 0.237 m = 0.464 m.
    //    The old mount (lead 0.55, side 0.12) put the fore-end 0.48 m from the left shoulder, so
    //    the supporting arm sat clamped at full extension and was dragged by the chest clip.
    const gltfReach = ((23.16 + 24.07) / 183.18) * 1.8;
    expect(gltfReach).toBeCloseTo(0.464, 3);
    expect(gap(rear, 0.205, 1.454)).toBeGreaterThan(0.18);
    expect(gap(rear, 0.205, 1.454)).toBeLessThan(gltfReach);
    expect(gap(front, -0.205, 1.454)).toBeLessThan(gltfReach - 0.02);
    // The live `arms` harness scenario confirms this end to end: both hands sit exactly on their
    // grips (0.000 m error) standing and walking, instead of the left hand being clamped.

    // 2. The procedural fallback: wider shoulders (±0.23) and a longer arm (0.56), so it reaches
    //    the same grip with even more margin.
    const rigReach = 0.3 + 0.26;
    expect(gap(rear, 0.23, 1.46)).toBeLessThan(rigReach);
    expect(gap(front, -0.23, 1.46)).toBeLessThan(rigReach - 0.02);
  });

  it('falls back to the body’s facing for a degenerate camera line, without NaN', () => {
    const out = resolveWeaponMount(
      { eye: { x: 0, y: 1.6, z: 0 }, target: { x: 0, y: 1.6, z: 0 } },
      { ...STANDING, facingYaw: Math.PI / 2 },
      createWeaponMount()
    );
    expect(Number.isFinite(out.muzzle.x)).toBe(true);
    expect(Number.isFinite(out.aimDirection.z)).toBe(true);
    // Facing +X (yaw π/2): the fallback aim is (-sin(yaw), 0, -cos(yaw)) = left of the body.
    expect(out.aimDirection.x).toBeLessThan(-0.9999);
  });
});
