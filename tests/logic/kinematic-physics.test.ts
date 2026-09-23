import { describe, expect, it } from 'vitest';

import { KinematicPhysics } from '../../src/adapters/kinematic-physics.ts';
import { vec3, type Vec3 } from '../../src/core/vec3.ts';
import type { CapsuleSpec, PhysicsPort, StaticCollider } from '../../src/ports/physics-port.ts';

const CAPSULE: CapsuleSpec = { radius: 0.32, height: 1.7, stepHeight: 0.35 };
const SKIN = 0.002;

function box(min: readonly [number, number, number], max: readonly [number, number, number]): StaticCollider {
  return { min: vec3(min[0], min[1], min[2]), max: vec3(max[0], max[1], max[2]) };
}

function floorOnly(): KinematicPhysics {
  const physics = new KinematicPhysics();
  physics.setStaticColliders([box([-10, -1, -10], [10, 0, 10])]);
  return physics;
}

function move(
  physics: PhysicsPort,
  from: readonly [number, number, number],
  displacement: readonly [number, number, number]
) {
  const out = vec3();
  const result = physics.moveAndSlide(
    vec3(from[0], from[1], from[2]),
    vec3(displacement[0], displacement[1], displacement[2]),
    CAPSULE,
    out
  );
  return { result, out };
}

describe('KinematicPhysics — identity and world data', () => {
  it('reports its kind and starts empty', () => {
    const physics = new KinematicPhysics();
    expect(physics.kind).toBe('kinematic');
    expect(physics.isPoseValid(vec3(0, 0, 0), CAPSULE)).toBe(true);
  });

  it('deep-copies collider definitions so external mutation cannot move the world', () => {
    const physics = new KinematicPhysics();
    const floor = box([-10, -1, -10], [10, 0, 10]);
    physics.setStaticColliders([floor]);

    floor.max.y = 100;

    const hit = physics.castRay(vec3(0, 5, 0), vec3(0, -1, 0), 10);
    expect(hit?.distance).toBeCloseTo(5, 6);
    expect(physics.isPoseValid(vec3(0, 5, 0), CAPSULE)).toBe(true);
  });
});

describe('KinematicPhysics — moveAndSlide on ground', () => {
  it('walks along a flat floor and stays supported', () => {
    const physics = floorOnly();
    const { result, out } = move(physics, [0, SKIN, 0], [1, 0, 0]);

    expect(out.x).toBeCloseTo(1, 6);
    expect(out.y).toBeCloseTo(SKIN, 6);
    expect(result.supported).toBe(true);
    expect(result.groundY).toBe(0);
    expect(result.hitWall).toBe(false);
  });

  it('lands from a fall exactly on the surface (never embedded)', () => {
    const physics = floorOnly();
    const { result, out } = move(physics, [0, 3, 0], [0, -5, 0]);

    expect(out.y).toBeCloseTo(SKIN, 6);
    expect(result.supported).toBe(true);
    expect(result.groundY).toBe(0);
    expect(physics.isPoseValid(out, CAPSULE)).toBe(true);
  });
});

describe('KinematicPhysics — walls and sliding', () => {
  it('reports a wall hit and stops at the surface minus the capsule radius', () => {
    const physics = floorOnly();
    physics.setStaticColliders([box([-10, -1, -10], [10, 0, 10]), box([20, 0, -20], [21, 4, 20])]);

    const { result, out } = move(physics, [19, SKIN, 0], [1, 0, 0]);

    expect(result.hitWall).toBe(true);
    expect(out.x).toBeLessThan(20 - CAPSULE.radius + 1e-6);
    expect(out.x).toBeGreaterThan(19.5);
  });

  it('slides along a wall, preserving the tangential component', () => {
    const physics = floorOnly();
    physics.setStaticColliders([box([-10, -1, -10], [10, 0, 10]), box([20, 0, -20], [21, 4, 20])]);

    const { result, out } = move(physics, [19, SKIN, 0], [1, 0, 1]);

    expect(result.hitWall).toBe(true);
    expect(out.x).toBeLessThan(20 - CAPSULE.radius + 1e-6);
    expect(out.z).toBeCloseTo(1, 5);
  });
});

describe('KinematicPhysics — step-up', () => {
  const withStep = (topY: number): KinematicPhysics => {
    const physics = new KinematicPhysics();
    physics.setStaticColliders([box([-10, -1, -10], [10, 0, 10]), box([3, 0, -5], [5, topY, 5])]);
    return physics;
  };

  it('climbs a low ledge within the step height', () => {
    const { result, out } = move(withStep(0.2), [2.5, SKIN, 0], [1, 0, 0]);

    expect(result.hitWall).toBe(false);
    expect(out.y).toBeCloseTo(0.2 + SKIN, 3);
    expect(out.x).toBeGreaterThan(3);
  });

  it('climbs a ledge exactly at the step-height limit', () => {
    const { result, out } = move(withStep(CAPSULE.stepHeight), [2.5, SKIN, 0], [1, 0, 0]);

    expect(result.hitWall).toBe(false);
    expect(out.y).toBeCloseTo(CAPSULE.stepHeight + SKIN, 3);
  });

  it('treats a ledge taller than the step height as a wall', () => {
    const { result, out } = move(withStep(0.5), [2.5, SKIN, 0], [1, 0, 0]);

    expect(result.hitWall).toBe(true);
    expect(out.y).toBeCloseTo(SKIN, 3);
    expect(out.x).toBeLessThan(3);
  });
});

describe('KinematicPhysics — ceilings', () => {
  it('reports a head hit and clamps the climb under a low ceiling', () => {
    const physics = new KinematicPhysics();
    physics.setStaticColliders([box([-10, -1, -10], [10, 0, 10]), box([-5, 2, -5], [5, 3, 5])]);

    const { result, out } = move(physics, [0, SKIN, 0], [0, 1, 0]);

    expect(result.hitHead).toBe(true);
    // Sub-stepping stops at the last non-overlapping pose, so the capsule halts
    // at or below the ceiling limit and never embeds in it.
    expect(out.y).toBeLessThanOrEqual(2 - CAPSULE.height - SKIN + 1e-9);
    expect(out.y).toBeGreaterThan(0.2);
    expect(physics.isPoseValid(out, CAPSULE)).toBe(true);
  });
});

describe('KinematicPhysics — queries', () => {
  it('casts a ray against the nearest surface', () => {
    const physics = floorOnly();
    const hit = physics.castRay(vec3(0, 5, 0), vec3(0, -1, 0), 10);

    expect(hit).not.toBeNull();
    expect(hit?.distance).toBeCloseTo(5, 6);
    expect(hit?.normal.y).toBeCloseTo(1, 6);
    expect(hit?.point.y).toBeCloseTo(0, 6);
  });

  it('normalises the ray direction and honours maxDistance', () => {
    const physics = floorOnly();
    expect(physics.castRay(vec3(0, 5, 0), vec3(0, -2, 0), 10)?.distance).toBeCloseTo(5, 6);
    expect(physics.castRay(vec3(0, 5, 0), vec3(0, -1, 0), 3)).toBeNull();
    expect(physics.castRay(vec3(0, 5, 0), vec3(0, 1, 0), 10)).toBeNull();
  });

  it('returns null for degenerate or non-finite queries instead of throwing', () => {
    const physics = floorOnly();
    expect(physics.castRay(vec3(0, 5, 0), vec3(0, 0, 0), 10)).toBeNull();
    expect(physics.castRay(vec3(Number.NaN, 5, 0), vec3(0, -1, 0), 10)).toBeNull();
    expect(physics.castSphere(vec3(0, 5, 0), Number.NaN, vec3(0, -1, 0), 10)?.distance).toBeCloseTo(5, 6);
  });

  it('sweeps a sphere against radius-grown boxes', () => {
    const physics = floorOnly();
    expect(physics.castSphere(vec3(0, 5, 0), 0.5, vec3(0, -1, 0), 10)?.distance).toBeCloseTo(4.5, 6);
  });

  it('validates poses against embedding', () => {
    const physics = new KinematicPhysics();
    physics.setStaticColliders([box([-10, -1, -10], [10, 0, 10]), box([3, 0, -5], [5, 0.2, 5])]);

    expect(physics.isPoseValid(vec3(0, SKIN, 0), CAPSULE)).toBe(true);
    expect(physics.isPoseValid(vec3(4, 0.1, 0), CAPSULE)).toBe(false);
    expect(physics.isPoseValid(vec3(Number.NaN, 0, 0), CAPSULE)).toBe(false);
  });
});

describe('KinematicPhysics — robustness and determinism', () => {
  it('clamps absurd displacements to the per-axis limit', () => {
    const physics = new KinematicPhysics();
    const positive = move(physics, [0, 0, 0], [1000, 0, 0]);
    const negative = move(physics, [0, 0, 0], [-1000, 0, 0]);

    expect(positive.out.x).toBeCloseTo(60, 5);
    expect(negative.out.x).toBeCloseTo(-60, 5);
  });

  it('sanitises non-finite feet positions to a finite pose', () => {
    const physics = new KinematicPhysics();
    const { out } = move(physics, [Number.NaN, Number.NaN, 0], [0, 0, 0]);

    expect(Number.isFinite(out.x)).toBe(true);
    expect(Number.isFinite(out.y)).toBe(true);
    expect(Number.isFinite(out.z)).toBe(true);
  });

  it('is deterministic for identical inputs', () => {
    const build = (): KinematicPhysics => {
      const physics = new KinematicPhysics();
      physics.setStaticColliders([box([-10, -1, -10], [10, 0, 10]), box([3, 0, -5], [5, 0.2, 5])]);
      return physics;
    };

    const first = move(build(), [2.5, SKIN, 0], [2, 0.5, 0.5]);
    const second = move(build(), [2.5, SKIN, 0], [2, 0.5, 0.5]);

    expect(first.out).toEqual(second.out);
    expect(first.result).toEqual(second.result);
  });

  it('clears colliders on dispose', () => {
    const physics = floorOnly();
    physics.dispose();
    expect(physics.castRay(vec3(0, 5, 0), vec3(0, -1, 0), 10)).toBeNull();
  });
});

describe('KinematicPhysics — Vec3 output identity', () => {
  it('writes the resolved feet into the provided out vector', () => {
    const physics = floorOnly();
    const out: Vec3 = vec3(123, 456, 789);
    const result = physics.moveAndSlide(vec3(0, SKIN, 0), vec3(1, 0, 0), CAPSULE, out);

    expect(result.position).toBe(out);
    expect(out.x).toBeCloseTo(1, 6);
  });
});
