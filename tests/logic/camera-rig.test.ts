import { describe, expect, it } from 'vitest';

import { vec3, type Vec3 } from '../../src/core/vec3.ts';
import {
  DEFAULT_CAMERA_TUNING,
  CameraRig,
  type CameraMode,
  type CameraStepInput
} from '../../src/gameplay/camera-rig.ts';
import type {
  CapsuleSpec,
  InteractionHit,
  InteractableVolume,
  MoveResult,
  PhysicsPort,
  RayHit,
  SocketVolume,
  StaticCollider
} from '../../src/ports/physics-port.ts';

class FakePhysics implements PhysicsPort {
  readonly kind = 'fake';
  hit: RayHit | null = null;
  lastMaxDistance = 0;
  sphereCalls = 0;

  moveAndSlide(_feet: Vec3, _displacement: Vec3, _spec: CapsuleSpec, out: Vec3): MoveResult {
    return { position: out, hitWall: false, hitHead: false, supported: true, groundY: out.y };
  }

  castRay(_origin: Vec3, _direction: Vec3, _maxDistance: number): RayHit | null {
    return null;
  }

  castSphere(_origin: Vec3, _radius: number, _direction: Vec3, maxDistance: number): RayHit | null {
    this.sphereCalls += 1;
    this.lastMaxDistance = maxDistance;
    return this.hit;
  }

  isPoseValid(_feet: Vec3, _spec: CapsuleSpec): boolean {
    return true;
  }

  setStaticColliders(_colliders: ReadonlyArray<StaticCollider>): void {}

  setCarryableColliders(_colliders: ReadonlyArray<StaticCollider>): void {}

  setSocketVolumes(_volumes: ReadonlyArray<SocketVolume>): void {}

  overlapSocketVolumes(_min: Vec3, _max: Vec3): ReadonlyArray<string> {
    return [];
  }

  setInteractableVolumes(_volumes: ReadonlyArray<InteractableVolume>): void {}

  queryInteractionRay(_origin: Vec3, _direction: Vec3, _maxDistance: number): ReadonlyArray<InteractionHit> {
    return [];
  }

  isBoxBlocked(_min: Vec3, _max: Vec3): boolean {
    return false;
  }

  dispose(): void {}
}

const DT = 1 / 30;

interface StepOverrides {
  readonly lookDeltaX?: number;
  readonly lookDeltaY?: number;
  readonly x?: number;
  readonly y?: number;
  readonly z?: number;
  readonly facingYaw?: number;
  readonly mode?: CameraMode;
  readonly idleTime?: number;
}

function step(rig: CameraRig, overrides: StepOverrides = {}) {
  const input: CameraStepInput = {
    lookDeltaX: overrides.lookDeltaX ?? 0,
    lookDeltaY: overrides.lookDeltaY ?? 0,
    player: {
      position: { x: overrides.x ?? 0, y: overrides.y ?? 0, z: overrides.z ?? 0 },
      facingYaw: overrides.facingYaw ?? 0
    },
    mode: overrides.mode ?? 'follow',
    idleTime: overrides.idleTime ?? 0
  };
  return rig.step(DT, input);
}

function eyeDistance(pose: { eye: Vec3; target: Vec3 }): number {
  const dx = pose.eye.x - pose.target.x;
  const dy = pose.eye.y - pose.target.y;
  const dz = pose.eye.z - pose.target.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

describe('CameraRig — initial placement', () => {
  it('snaps to the solved pose on the first step (no damped glide-in)', () => {
    const physics = new FakePhysics();
    const rig = new CameraRig(physics);
    const pose = step(rig);

    expect(pose.target).toEqual({ x: 0, y: DEFAULT_CAMERA_TUNING.targetHeight, z: 0 });
    expect(pose.eye.z).toBeCloseTo(3.9868, 3);
    // Third-person framing: the eye rides ABOVE the torso anchor and looks down. The
    // old pin here was 0.0788 — an ankle-height camera staring up at the player — which
    // is the framing bug the fixed pitch sign removed (see `placeAndCollide`).
    expect(pose.eye.y).toBeCloseTo(2.7212, 3);
    expect(pose.eye.y).toBeGreaterThan(pose.target.y);
    expect(pose.fov).toBe(DEFAULT_CAMERA_TUNING.fov);
    expect(rig.currentYaw).toBe(0);
  });

  it('anchors the look target to the player torso height', () => {
    const rig = new CameraRig(new FakePhysics());
    const pose = step(rig, { x: 1, y: 2, z: 3 });

    expect(pose.target).toEqual({ x: 1, y: 2 + DEFAULT_CAMERA_TUNING.targetHeight, z: 3 });
  });

  it('applies a custom FOV', () => {
    const rig = new CameraRig(new FakePhysics(), { fov: 75 });
    expect(step(rig).fov).toBe(75);
  });
});

describe('CameraRig — look integration', () => {
  it('yaws at the configured speed against look input', () => {
    const rig = new CameraRig(new FakePhysics());
    step(rig, { lookDeltaX: 1 });

    expect(rig.currentYaw).toBeCloseTo(-DEFAULT_CAMERA_TUNING.yawSpeed * DT, 6);
  });

  it('keeps yaw wrapped to [-pi, pi]', () => {
    const rig = new CameraRig(new FakePhysics());
    const swing = 1000;
    step(rig, { lookDeltaX: swing });

    let expected = (-swing * DEFAULT_CAMERA_TUNING.yawSpeed * DT) % (2 * Math.PI);
    if (expected > Math.PI) expected -= 2 * Math.PI;
    if (expected < -Math.PI) expected += 2 * Math.PI;

    expect(rig.currentYaw).toBeGreaterThanOrEqual(-Math.PI);
    expect(rig.currentYaw).toBeLessThanOrEqual(Math.PI);
    expect(rig.currentYaw).toBeCloseTo(expected, 6);
  });

  it('keeps mouse look in a sane sensitivity range (regression guard)', () => {
    const rig = new CameraRig(new FakePhysics());
    step(rig, { lookDeltaX: 100 });

    // A 100 px drag must rotate well under 60 degrees, not spin the camera.
    expect(Math.abs(rig.currentYaw)).toBeLessThan(Math.PI / 3);
  });

  it('clamps at the look-down limit on a mouse-down flick (eye above the target)', () => {
    const rig = new CameraRig(new FakePhysics());
    const pose = step(rig, { lookDeltaY: 1000 });

    const expectedY = DEFAULT_CAMERA_TUNING.targetHeight -
      Math.sin(DEFAULT_CAMERA_TUNING.minPitch) * DEFAULT_CAMERA_TUNING.maxDistance;
    expect(pose.eye.y).toBeCloseTo(expectedY, 3);
    expect(pose.eye.y).toBeGreaterThan(pose.target.y);
  });

  it('clamps at the look-up limit on a mouse-up flick (eye below the target)', () => {
    const rig = new CameraRig(new FakePhysics());
    const pose = step(rig, { lookDeltaY: -1000 });

    const expectedY = DEFAULT_CAMERA_TUNING.targetHeight -
      Math.sin(DEFAULT_CAMERA_TUNING.maxPitch) * DEFAULT_CAMERA_TUNING.maxDistance;
    expect(pose.eye.y).toBeCloseTo(expectedY, 3);
    expect(pose.eye.y).toBeLessThan(pose.target.y);
  });

  it('looks down when the mouse moves down (DOM movementY is positive downward)', () => {
    const level = step(new CameraRig(new FakePhysics()));
    const down = step(new CameraRig(new FakePhysics()), { lookDeltaY: 40 });

    // An eye raised above an unchanged target is a view aimed downward. This is the
    // player-facing contract the inverted build broke: mouse-down used to look up.
    expect(down.eye.y).toBeGreaterThan(level.eye.y);
    expect(down.target.y).toBeCloseTo(level.target.y, 9);
  });

  it('looks up when the mouse moves up', () => {
    const level = step(new CameraRig(new FakePhysics()));
    const up = step(new CameraRig(new FakePhysics()), { lookDeltaY: -40 });

    expect(up.eye.y).toBeLessThan(level.eye.y);
  });
});

describe('CameraRig — recentring', () => {
  it('does not recentre before the idle delay elapses', () => {
    const rig = new CameraRig(new FakePhysics());
    step(rig, { lookDeltaX: 1 });
    const yaw = rig.currentYaw;

    step(rig, { idleTime: 1 });

    expect(rig.currentYaw).toBeCloseTo(yaw, 9);
  });

  it('eases yaw toward the player facing once idle', () => {
    const rig = new CameraRig(new FakePhysics());
    // A swing larger than one recentre step, so the capped step is exercised.
    step(rig, { lookDeltaX: 20 });
    const before = rig.currentYaw;
    expect(Math.abs(before)).toBeGreaterThan(DEFAULT_CAMERA_TUNING.recenterSpeed * DT);

    step(rig, { idleTime: DEFAULT_CAMERA_TUNING.recenterDelay + 0.5 });

    expect(rig.currentYaw).toBeCloseTo(
      before + DEFAULT_CAMERA_TUNING.recenterSpeed * DT,
      6
    );
  });

  it('recentres behind a player facing +90 degrees', () => {
    const rig = new CameraRig(new FakePhysics());
    step(rig);
    step(rig, { idleTime: DEFAULT_CAMERA_TUNING.recenterDelay + 0.5, facingYaw: Math.PI / 2 });

    expect(rig.currentYaw).toBeCloseTo(DEFAULT_CAMERA_TUNING.recenterSpeed * DT, 6);
  });
});

describe('CameraRig — distance and manipulation framing', () => {
  it('solves the follow distance and casts occlusion from the anchor', () => {
    const physics = new FakePhysics();
    const rig = new CameraRig(physics);
    const pose = step(rig);

    expect(physics.sphereCalls).toBe(1);
    expect(physics.lastMaxDistance).toBeCloseTo(
      DEFAULT_CAMERA_TUNING.maxDistance + DEFAULT_CAMERA_TUNING.skin,
      6
    );
    expect(eyeDistance(pose)).toBeCloseTo(DEFAULT_CAMERA_TUNING.maxDistance, 3);
  });

  it('eases into manipulation framing instead of snapping to it (ARCH §17)', () => {
    const rig = new CameraRig(new FakePhysics());
    const framedDistance = DEFAULT_CAMERA_TUNING.maxDistance - DEFAULT_CAMERA_TUNING.manipulationOffset;

    const first = eyeDistance(step(rig, { mode: 'manipulation' }));
    // One step must not jump to the framed distance: the transition is eased.
    expect(first).toBeGreaterThan(framedDistance + 0.02);
    expect(first).toBeLessThan(DEFAULT_CAMERA_TUNING.maxDistance);

    let pose = step(rig, { mode: 'manipulation' });
    for (let i = 0; i < 20; i += 1) pose = step(rig, { mode: 'manipulation' });

    expect(eyeDistance(pose)).toBeCloseTo(framedDistance, 2);
    // "Slightly higher" framing: the look target lifts above the torso anchor.
    expect(pose.target.y).toBeGreaterThan(DEFAULT_CAMERA_TUNING.targetHeight + 0.1);
  });

  it('eases back to follow framing when the manipulation ends', () => {
    const rig = new CameraRig(new FakePhysics());
    let pose = step(rig, { mode: 'manipulation' });
    for (let i = 0; i < 20; i += 1) pose = step(rig, { mode: 'manipulation' });
    expect(eyeDistance(pose)).toBeLessThan(DEFAULT_CAMERA_TUNING.maxDistance - 0.5);

    for (let i = 0; i < 20; i += 1) pose = step(rig, { mode: 'follow' });

    expect(eyeDistance(pose)).toBeCloseTo(DEFAULT_CAMERA_TUNING.maxDistance, 2);
    expect(pose.target.y).toBeCloseTo(DEFAULT_CAMERA_TUNING.targetHeight, 2);
  });
});

describe('CameraRig — occlusion (EC-PC-06, ARCH §17)', () => {
  it('clamps the arm to the first occlusion hit minus the skin', () => {
    const physics = new FakePhysics();
    physics.hit = { distance: 2, point: vec3(), normal: vec3() };
    const rig = new CameraRig(physics);

    const pose = step(rig);

    expect(eyeDistance(pose)).toBeCloseTo(
      2 - DEFAULT_CAMERA_TUNING.skin,
      3
    );
  });

  it('holds the closest occluder while occluded (no strobing outward)', () => {
    const physics = new FakePhysics();
    physics.hit = { distance: 2, point: vec3(), normal: vec3() };
    const rig = new CameraRig(physics);
    step(rig);

    physics.hit = { distance: 3, point: vec3(), normal: vec3() };
    const pose = step(rig);

    expect(eyeDistance(pose)).toBeCloseTo(2 - DEFAULT_CAMERA_TUNING.skin, 3);
  });

  it('smoothly returns to full distance once the occluder clears', () => {
    const physics = new FakePhysics();
    physics.hit = { distance: 2, point: vec3(), normal: vec3() };
    const rig = new CameraRig(physics);
    const pulled = step(rig);
    expect(eyeDistance(pulled)).toBeLessThan(2);

    physics.hit = null;
    let pose = pulled;
    for (let i = 0; i < 60; i += 1) {
      pose = step(rig);
    }

    expect(eyeDistance(pose)).toBeGreaterThan(DEFAULT_CAMERA_TUNING.maxDistance - 0.1);
  });
});

describe('CameraRig — determinism', () => {
  it('reproduces identical poses for identical inputs', () => {
    const inputs: StepOverrides[] = [
      { lookDeltaX: 2 },
      { lookDeltaX: 3, lookDeltaY: 1 },
      { idleTime: 3, facingYaw: 0.4 },
      { lookDeltaX: -1, mode: 'manipulation', x: 1, y: 0.5, z: -2 }
    ];

    const first = new CameraRig(new FakePhysics());
    const second = new CameraRig(new FakePhysics());

    const firstPoses = inputs.map((input) => step(first, input));
    const secondPoses = inputs.map((input) => step(second, input));

    expect(firstPoses).toEqual(secondPoses);
  });
});

describe('CameraRig — previewPose (PLAN T2.2)', () => {
  it('is pure and answers pending look at once', () => {
    const rig = new CameraRig(new FakePhysics());
    const base = step(rig);
    const yawBefore = rig.currentYaw;
    const still = rig.previewPose({ anchor: base.target, pendingLookX: 0, pendingLookY: 0, dt: DT });
    expect(still.target).toEqual(base.target);
    expect(eyeDistance(still)).toBeCloseTo(DEFAULT_CAMERA_TUNING.distance, 6);
    const turned = rig.previewPose({ anchor: base.target, pendingLookX: 60, pendingLookY: 0, dt: DT });
    expect(Math.abs(turned.eye.x - still.eye.x)).toBeGreaterThan(0.1);
    expect(rig.currentYaw).toBe(yawBefore);
  });
});

describe('CameraRig — PLAN T2.4', () => {
  it('does not recentre while the player stands still', () => {
    const rig = new CameraRig(new FakePhysics());
    step(rig, { lookDeltaX: 20 });
    const before = rig.currentYaw;
    rig.step(DT, {
      lookDeltaX: 0,
      lookDeltaY: 0,
      player: { position: vec3(0, 0, 0), facingYaw: 0 },
      mode: 'follow',
      idleTime: DEFAULT_CAMERA_TUNING.recenterDelay + 0.5,
      playerMoving: false
    });
    expect(rig.currentYaw).toBeCloseTo(before, 9);
  });

  it("offsets the look target to the camera's right", () => {
    const rig = new CameraRig(new FakePhysics(), { shoulderOffset: 0.45 });
    const pose = step(rig);
    expect(pose.target.x).toBeCloseTo(0.45, 6);
    expect(pose.target.z).toBeCloseTo(0, 6);
  });
});
