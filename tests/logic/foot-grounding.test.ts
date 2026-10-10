import { describe, expect, it } from 'vitest';

import { vec3, type Vec3 } from '../../src/core/vec3.ts';
import { DEFAULT_FOOT_GROUNDING_TUNING, FootGrounding } from '../../src/gameplay/foot-grounding.ts';
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

/**
 * Scripted ground: every ray hits the plane `groundY`, unless it starts on a foot whose x is in
 * `holes`, which stands over a void. Records the origins so the Y-rotation can be asserted.
 */
class ScriptedGround implements PhysicsPort {
  readonly kind = 'scripted';
  groundY = 0;
  holes: ReadonlyArray<number> = [];
  readonly origins: Vec3[] = [];

  castRay(origin: Vec3, _direction: Vec3, _maxDistance: number): RayHit | null {
    this.origins.push(vec3(origin.x, origin.y, origin.z));
    if (this.holes.some((x) => Math.abs(origin.x - x) < 0.02)) return null;
    return { distance: 10, point: vec3(origin.x, this.groundY, origin.z), normal: vec3(0, 1, 0) };
  }

  castSphere(): RayHit | null {
    return null;
  }

  moveAndSlide(_feet: Vec3, _d: Vec3, _spec: CapsuleSpec, out: Vec3): MoveResult {
    return { position: out, hitWall: false, hitHead: false, supported: true, groundY: out.y };
  }

  isPoseValid(): boolean {
    return true;
  }

  setStaticColliders(_c: ReadonlyArray<StaticCollider>): void {}
  setCarryableColliders(_c: ReadonlyArray<StaticCollider>): void {}
  setSocketVolumes(_v: ReadonlyArray<SocketVolume>): void {}
  setInteractableVolumes(_v: ReadonlyArray<InteractableVolume>): void {}
  overlapSocketVolumes(): ReadonlyArray<string> {
    return [];
  }
  queryInteractionRay(): ReadonlyArray<InteractionHit> {
    return [];
  }
  isBoxBlocked(): boolean {
    return false;
  }
  dispose(): void {}
}

describe('FootGrounding — where the ground is under each foot', () => {
  it('reports nothing before the first probe', () => {
    const grounding = new FootGrounding(new ScriptedGround());
    expect(grounding.leftGroundY).toBeNull();
    expect(grounding.rightGroundY).toBeNull();
    expect(grounding.snapshot()).toEqual({ left: null, right: null });
  });

  it('finds the surface under each foot, independently', () => {
    const physics = new ScriptedGround();
    const grounding = new FootGrounding(physics);
    physics.groundY = 0;
    grounding.step(vec3(0, 0, 0), 0);
    expect(grounding.snapshot()).toEqual({ left: 0, right: 0 });

    // A crate top under one foot only: the other keeps the floor.
    physics.groundY = 0.6;
    grounding.step(vec3(0, 0, 0), 0);
    expect(grounding.leftGroundY).toBeCloseTo(0.6, 9);
    physics.holes = [];
    physics.groundY = 0;
    grounding.step(vec3(0, 0, 0), 0);
    expect(grounding.leftGroundY).toBe(0);
  });

  it('fires its probes at the feet, rotated with the facing yaw', () => {
    const physics = new ScriptedGround();
    const grounding = new FootGrounding(physics);
    grounding.step(vec3(1, 0, 2), 0);
    const atZero = physics.origins.slice(-2);
    // Facing -Z at yaw 0: the left foot (-x local) sits at world x - 0.105.
    expect(atZero[0]?.x).toBeCloseTo(1 - 0.105, 9);
    expect(atZero[1]?.x).toBeCloseTo(1 + 0.105, 9);
    expect(atZero[0]?.z).toBeCloseTo(2, 9);

    // Quarter turn: the same offsets now stretch along Z.
    grounding.step(vec3(1, 0, 2), Math.PI / 2);
    const atQuarter = physics.origins.slice(-2);
    expect(atQuarter[0]?.x).toBeCloseTo(1, 9);
    expect(atQuarter[0]?.z).toBeCloseTo(2 + 0.105, 9);
    expect(atQuarter[1]?.z).toBeCloseTo(2 - 0.105, 9);
    // The probe starts above the feet, so a step up is inside its span.
    expect((atQuarter[0]?.y ?? 0) - 0).toBeGreaterThan(0.5);
  });

  it('reports a void as null, and ignores a surface level with the foot itself', () => {
    const physics = new ScriptedGround();
    const grounding = new FootGrounding(physics);
    physics.holes = [-0.105];
    grounding.step(vec3(0, 0, 0), 0);
    expect(grounding.leftGroundY).toBeNull();
    expect(grounding.rightGroundY).toBe(0);

    // A hit at the foot's own resting depth is not a step: nothing to plant on.
    const flat = new FootGrounding(physics);
    physics.holes = [];
    physics.groundY = 0 + DEFAULT_FOOT_GROUNDING_TUNING.probeAbove;
    flat.step(vec3(0, 0, 0), 0);
    expect(flat.snapshot()).toEqual({ left: null, right: null });
  });
});
