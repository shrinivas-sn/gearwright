import { describe, expect, it } from 'vitest';

import { vec3, type Vec3 } from '../../src/core/vec3.ts';
import { PlayerController, type PlayerStepInput } from '../../src/gameplay/player-controller.ts';
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

/** Records/collapses motion: the controller owns velocity, the port owns placement. */
class FakePhysics implements PhysicsPort {
  readonly kind = 'fake';
  supported = true;
  calls = 0;
  lastDisplacement: Vec3 = vec3();

  moveAndSlide(feet: Vec3, displacement: Vec3, _spec: CapsuleSpec, out: Vec3): MoveResult {
    this.calls += 1;
    this.lastDisplacement = vec3(displacement.x, displacement.y, displacement.z);
    out.x = feet.x + displacement.x;
    out.y = feet.y + displacement.y;
    out.z = feet.z + displacement.z;
    return { position: out, hitWall: false, hitHead: false, supported: this.supported, groundY: out.y };
  }

  castRay(_origin: Vec3, _direction: Vec3, _maxDistance: number): RayHit | null {
    return null;
  }

  castSphere(_origin: Vec3, _radius: number, _direction: Vec3, _maxDistance: number): RayHit | null {
    return null;
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
const NEUTRAL: PlayerStepInput = { moveX: 0, moveZ: 0, run: false, cameraYaw: 0 };

function run(controller: PlayerController, steps: number, input: PlayerStepInput) {
  let snapshot = controller.snapshot();
  for (let i = 0; i < steps; i += 1) {
    snapshot = controller.step(DT, input);
  }
  return snapshot;
}

describe('PlayerController — construction', () => {
  it('rejects tuning where run speed is below walk speed', () => {
    const physics = new FakePhysics();
    expect(() => new PlayerController(physics, vec3(), { walkSpeed: 2, runSpeed: 1 })).toThrow(RangeError);
  });

  it('rejects a non-positive walk speed', () => {
    const physics = new FakePhysics();
    expect(() => new PlayerController(physics, vec3(), { walkSpeed: 0 })).toThrow(RangeError);
  });
});

describe('PlayerController — camera-relative intent (ARCH §16)', () => {
  it('moves toward -Z for forward intent at camera yaw 0', () => {
    const physics = new FakePhysics();
    const controller = new PlayerController(physics, vec3(0, 0, 0));

    const state = run(controller, 90, { ...NEUTRAL, moveZ: 1 });

    expect(state.position.z).toBeLessThan(-1);
    expect(Math.abs(state.position.x)).toBeLessThan(0.001);
  });

  it('rotates the forward vector with camera yaw', () => {
    const physics = new FakePhysics();
    const controller = new PlayerController(physics, vec3(0, 0, 0));

    // yaw = +90deg -> forward is (-1, 0): movement goes toward -X.
    const state = run(controller, 90, { ...NEUTRAL, moveZ: 1, cameraYaw: Math.PI / 2 });

    expect(state.position.x).toBeLessThan(-1);
    expect(Math.abs(state.position.z)).toBeLessThan(0.05);
  });

  it('moves right (+X) for right intent at camera yaw 0', () => {
    const physics = new FakePhysics();
    const controller = new PlayerController(physics, vec3(0, 0, 0));

    const state = run(controller, 90, { ...NEUTRAL, moveX: 1 });

    expect(state.position.x).toBeGreaterThan(1);
    expect(Math.abs(state.position.z)).toBeLessThan(0.05);
  });

  it('sends all motion through the physics port', () => {
    const physics = new FakePhysics();
    const controller = new PlayerController(physics, vec3(0, 0, 0));

    run(controller, 10, { ...NEUTRAL, moveZ: 1 });

    expect(physics.calls).toBe(10);
    expect(physics.lastDisplacement.z).toBeLessThan(0);
  });
});

describe('PlayerController — speed and acceleration', () => {
  it('approaches the walk speed without overshooting it', () => {
    const physics = new FakePhysics();
    const controller = new PlayerController(physics, vec3(0, 0, 0));

    const horizontal = (state: { velocity: Vec3 }): number =>
      Math.sqrt(state.velocity.x * state.velocity.x + state.velocity.z * state.velocity.z);

    const early = run(controller, 1, { ...NEUTRAL, moveZ: 1 });
    expect(horizontal(early)).toBeLessThan(2.2);

    const settled = run(controller, 120, { ...NEUTRAL, moveZ: 1 });
    expect(horizontal(settled)).toBeGreaterThan(2.19);
    expect(horizontal(settled)).toBeLessThanOrEqual(2.2 + 1e-9);
  });

  it('moves faster while running', () => {
    const physics = new FakePhysics();
    const controller = new PlayerController(physics, vec3(0, 0, 0));

    const state = run(controller, 120, { ...NEUTRAL, moveZ: 1, run: true });
    const horizontal = Math.sqrt(state.velocity.x * state.velocity.x + state.velocity.z * state.velocity.z);

    expect(horizontal).toBeGreaterThan(4.19);
    expect(horizontal).toBeLessThanOrEqual(4.2 + 1e-9);
  });
});

describe('PlayerController — rotation', () => {
  it('caps the turn rate at 12 rad/s (faces travel without snapping)', () => {
    const physics = new FakePhysics();
    const controller = new PlayerController(physics, vec3(0, 0, 0));

    const state = controller.step(DT, { ...NEUTRAL, moveX: 1 });

    expect(state.facingYaw).toBeCloseTo(-12 * DT, 6);
  });

  it('converges toward the direction of travel', () => {
    const physics = new FakePhysics();
    const controller = new PlayerController(physics, vec3(0, 0, 0));

    const state = run(controller, 90, { ...NEUTRAL, moveX: 1 });

    expect(state.facingYaw).toBeCloseTo(-Math.PI / 2, 2);
  });
});

describe('PlayerController — gravity and grounding', () => {
  it('sticks to the ground while supported', () => {
    const physics = new FakePhysics();
    const controller = new PlayerController(physics, vec3(0, 0, 0));

    run(controller, 1, NEUTRAL);
    const state = run(controller, 1, NEUTRAL);

    expect(state.grounded).toBe(true);
    expect(state.velocity.y).toBeCloseTo(-1, 6);
  });

  it('falls under gravity with a terminal speed when unsupported', () => {
    const physics = new FakePhysics();
    physics.supported = false;
    const controller = new PlayerController(physics, vec3(0, 10, 0));

    const state = run(controller, 120, NEUTRAL);

    expect(state.grounded).toBe(false);
    expect(state.velocity.y).toBeCloseTo(-12, 5);
  });
});

describe('PlayerController — state hygiene and determinism', () => {
  it('clamps an invalid dt to the default fixed step', () => {
    const input = { ...NEUTRAL, moveZ: 1 };
    const invalid = new PlayerController(new FakePhysics(), vec3(0, 0, 0)).step(
      Number.NaN,
      input
    );
    const zero = new PlayerController(new FakePhysics(), vec3(0, 0, 0)).step(0, input);
    const reference = new PlayerController(new FakePhysics(), vec3(0, 0, 0)).step(DT, input);

    expect(Number.isFinite(invalid.position.x)).toBe(true);
    expect(invalid.position.z).toBeCloseTo(reference.position.z, 12);
    expect(zero.position.z).toBeCloseTo(reference.position.z, 12);
  });

  it('produces identical states for identical input sequences', () => {
    const sequence: PlayerStepInput[] = [
      { ...NEUTRAL, moveZ: 1 },
      { ...NEUTRAL, moveZ: 1, moveX: 1 },
      { ...NEUTRAL, moveX: 1, run: true },
      NEUTRAL,
      { ...NEUTRAL, moveZ: 1, run: true }
    ];

    const first = new PlayerController(new FakePhysics(), vec3(0, 0, 0));
    const second = new PlayerController(new FakePhysics(), vec3(0, 0, 0));

    const firstStates = sequence.map((input) => first.step(DT, input));
    const secondStates = sequence.map((input) => second.step(DT, input));

    expect(firstStates).toEqual(secondStates);
  });

  it('teleports instantly, zeroing velocity and grounding', () => {
    const physics = new FakePhysics();
    const controller = new PlayerController(physics, vec3(0, 0, 0));
    run(controller, 30, { ...NEUTRAL, moveZ: 1 });

    controller.teleport(vec3(5, 2, 3));
    const state = controller.snapshot();

    expect(state.position).toEqual({ x: 5, y: 2, z: 3 });
    expect(state.speed).toBe(0);
    expect(state.grounded).toBe(false);
    expect(state.groundY).toBe(2);
  });
});
