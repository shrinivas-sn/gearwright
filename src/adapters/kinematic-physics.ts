/**
 * L4 ADAPTER — custom kinematic physics (ADR-004, ARCH §20).
 *
 * No solver, no impulses: capsules are moved explicitly and resolved against a
 * static AABB list with axis-separated sliding, step-up, sub-stepping, and a
 * final de-penetration pass. Resting objects are not simulated at all.
 */

import { vec3, vec3IsFinite, type Vec3 } from '../core/vec3.ts';
import type {
  CapsuleSpec,
  InteractionHit,
  InteractableVolume,
  MoveResult,
  PhysicsPort,
  RayHit,
  SocketVolume,
  StaticCollider
} from '../ports/physics-port.ts';

const SKIN = 0.002;
const SUBSTEP_LENGTH = 0.08;
const WORLD_MIN = -1000;
const WORLD_MAX = 1000;
const DEPENETRATE_ITERATIONS = 4;

interface InternalCollider {
  readonly min: Vec3;
  readonly max: Vec3;
}

interface InternalInteractable {
  readonly id: string;
  readonly min: Vec3;
  readonly max: Vec3;
}

interface ResolvedSpec {
  readonly radius: number;
  readonly height: number;
  readonly stepHeight: number;
}

function clampWorld(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(value, WORLD_MIN), WORLD_MAX);
}

function clampFinite(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

function sanitiseSpec(spec: CapsuleSpec): ResolvedSpec {
  return {
    radius: clampFinite(spec.radius, 0.05, 2),
    height: clampFinite(spec.height, 0.3, 5),
    stepHeight: clampFinite(spec.stepHeight, 0, 1)
  };
}

function boxesOverlap(
  minAx: number, minAy: number, minAz: number,
  maxAx: number, maxAy: number, maxAz: number,
  minBx: number, minBy: number, minBz: number,
  maxBx: number, maxBy: number, maxBz: number
): boolean {
  return (
    minAx < maxBx && maxAx > minBx &&
    minAy < maxBy && maxAy > minBy &&
    minAz < maxBz && maxAz > minBz
  );
}

function capsuleOverlapsAt(
  x: number, y: number, z: number, spec: ResolvedSpec, colliders: ReadonlyArray<InternalCollider>
): boolean {
  const minX = x - spec.radius;
  const minZ = z - spec.radius;
  const maxX = x + spec.radius;
  const maxZ = z + spec.radius;
  for (const collider of colliders) {
    if (
      boxesOverlap(
        minX, y, minZ, maxX, y + spec.height, maxZ,
        collider.min.x, collider.min.y, collider.min.z,
        collider.max.x, collider.max.y, collider.max.z
      )
    ) {
      return true;
    }
  }
  return false;
}
export class KinematicPhysics implements PhysicsPort {
  readonly kind = 'kinematic';

  private colliders: InternalCollider[] = [];
  private carryables: InternalCollider[] = [];
  /** Static + carryable, rebuilt on either change: what the player capsule collides with. */
  private solids: InternalCollider[] = [];
  private interactables: InternalInteractable[] = [];
  private sockets: InternalInteractable[] = [];

  setStaticColliders(colliders: ReadonlyArray<StaticCollider>): void {
    // Deep copy: external mutation of definition data must never move the world.
    this.colliders = colliders.map((collider) => ({
      min: vec3(collider.min.x, collider.min.y, collider.min.z),
      max: vec3(collider.max.x, collider.max.y, collider.max.z)
    }));
    this.rebuildSolids();
  }

  setCarryableColliders(colliders: ReadonlyArray<StaticCollider>): void {
    this.carryables = colliders.map((collider) => ({
      min: vec3(collider.min.x, collider.min.y, collider.min.z),
      max: vec3(collider.max.x, collider.max.y, collider.max.z)
    }));
    this.rebuildSolids();
  }

  setInteractableVolumes(volumes: ReadonlyArray<InteractableVolume>): void {
    this.interactables = volumes.map((volume) => ({
      id: volume.id,
      min: vec3(volume.min.x, volume.min.y, volume.min.z),
      max: vec3(volume.max.x, volume.max.y, volume.max.z)
    }));
  }

  setSocketVolumes(volumes: ReadonlyArray<SocketVolume>): void {
    this.sockets = volumes.map((volume) => ({
      id: volume.id,
      min: vec3(volume.min.x, volume.min.y, volume.min.z),
      max: vec3(volume.max.x, volume.max.y, volume.max.z)
    }));
  }

  overlapSocketVolumes(min: Vec3, max: Vec3): ReadonlyArray<string> {
    if (!vec3IsFinite(min) || !vec3IsFinite(max)) return [];
    const ids: string[] = [];
    for (const socket of this.sockets) {
      if (
        boxesOverlap(
          min.x, min.y, min.z, max.x, max.y, max.z,
          socket.min.x, socket.min.y, socket.min.z,
          socket.max.x, socket.max.y, socket.max.z
        )
      ) {
        ids.push(socket.id);
      }
    }
    return ids;
  }

  queryInteractionRay(
    origin: Vec3,
    direction: Vec3,
    maxDistance: number
  ): ReadonlyArray<InteractionHit> {
    if (!vec3IsFinite(origin) || !vec3IsFinite(direction)) return [];
    const max = clampFinite(maxDistance, 0, WORLD_MAX);
    const dir = normalisedOrNull(direction);
    if (!dir) return [];

    const hits: InteractionHit[] = [];
    for (const volume of this.interactables) {
      const hit = rayVsAabb(origin, dir, volume, max);
      if (hit) {
        hits.push({ id: volume.id, distance: hit.distance, point: hit.point, normal: hit.normal });
      }
    }
    return hits;
  }

  isBoxBlocked(min: Vec3, max: Vec3): boolean {
    if (!vec3IsFinite(min) || !vec3IsFinite(max)) return false;
    for (const collider of this.colliders) {
      if (
        boxesOverlap(
          min.x, min.y, min.z, max.x, max.y, max.z,
          collider.min.x, collider.min.y, collider.min.z,
          collider.max.x, collider.max.y, collider.max.z
        )
      ) {
        return true;
      }
    }
    return false;
  }

  dispose(): void {
    this.colliders = [];
    this.carryables = [];
    this.solids = [];
    this.interactables = [];
    this.sockets = [];
  }

  moveAndSlide(feet: Vec3, displacement: Vec3, spec: CapsuleSpec, out: Vec3): MoveResult {
    const resolved = sanitiseSpec(spec);
    const from = vec3(clampWorld(feet.x), clampWorld(feet.y), clampWorld(feet.z));
    const total = vec3(
      clampFinite(displacement.x, -60, 60),
      clampFinite(displacement.y, -60, 60),
      clampFinite(displacement.z, -60, 60)
    );

    const length = Math.sqrt(total.x * total.x + total.y * total.y + total.z * total.z);
    const substeps = Math.max(1, Math.ceil(length / SUBSTEP_LENGTH));
    const sub = vec3(total.x / substeps, total.y / substeps, total.z / substeps);

    let hitWall = false;
    let hitHead = false;
    let supported = false;
    let groundY = from.y;

    const position = vec3(from.x, from.y, from.z);
    for (let i = 0; i < substeps; i += 1) {
      const stepResult = slideOne(position, sub, resolved, this.solids);
      position.x = stepResult.x;
      position.y = stepResult.y;
      position.z = stepResult.z;
      hitWall = hitWall || stepResult.hitWall;
      hitHead = hitHead || stepResult.hitHead;
      if (stepResult.supported) {
        supported = true;
        groundY = stepResult.groundY;
      }
    }

    // Final de-penetration pass: guarantee the reported pose is never embedded.
    depenetrate(position, resolved, this.solids);
    const probe = probeDown(position, resolved, this.solids);
    if (!supported && probe.supported) {
      supported = true;
      groundY = probe.groundY;
    }

    out.x = clampWorld(position.x);
    out.y = clampWorld(position.y);
    out.z = clampWorld(position.z);

    return { position: out, hitWall, hitHead, supported, groundY };
  }

  isPoseValid(feet: Vec3, spec: CapsuleSpec): boolean {
    if (!vec3IsFinite(feet)) return false;
    return !capsuleOverlapsAt(feet.x, feet.y, feet.z, sanitiseSpec(spec), this.solids);
  }

  private rebuildSolids(): void {
    this.solids = this.carryables.length === 0 ? this.colliders : [...this.colliders, ...this.carryables];
  }

  castRay(origin: Vec3, direction: Vec3, maxDistance: number): RayHit | null {
    if (!vec3IsFinite(origin) || !vec3IsFinite(direction)) return null;
    const max = clampFinite(maxDistance, 0, WORLD_MAX);
    const dir = normalisedOrNull(direction);
    if (!dir) return null;

    let best: RayHit | null = null;
    for (const collider of this.colliders) {
      const hit = rayVsAabb(origin, dir, collider, max);
      if (hit && (!best || hit.distance < best.distance)) {
        best = hit;
      }
    }
    return best;
  }

  castSphere(origin: Vec3, radius: number, direction: Vec3, maxDistance: number): RayHit | null {
    // Minkowski expansion: sweep the sphere centre against radius-grown boxes.
    if (!Number.isFinite(radius) || radius <= 0) {
      return this.castRay(origin, direction, maxDistance);
    }
    if (!vec3IsFinite(origin) || !vec3IsFinite(direction)) return null;
    const max = clampFinite(maxDistance, 0, WORLD_MAX);
    const dir = normalisedOrNull(direction);
    if (!dir) return null;

    const grownMin = vec3();
    const grownMax = vec3();
    let best: RayHit | null = null;
    for (const collider of this.colliders) {
      grownMin.x = collider.min.x - radius;
      grownMin.y = collider.min.y - radius;
      grownMin.z = collider.min.z - radius;
      grownMax.x = collider.max.x + radius;
      grownMax.y = collider.max.y + radius;
      grownMax.z = collider.max.z + radius;
      const hit = rayVsAabb(origin, dir, { min: grownMin, max: grownMax }, max);
      if (hit && (!best || hit.distance < best.distance)) {
        best = hit;
      }
    }
    return best;
  }
}
interface SlideStep {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly hitWall: boolean;
  readonly hitHead: boolean;
  readonly supported: boolean;
  readonly groundY: number;
}

function normalisedOrNull(direction: Vec3): Vec3 | null {
  const lengthSq = direction.x * direction.x + direction.y * direction.y + direction.z * direction.z;
  if (!(lengthSq > 0)) return null;
  const inverse = 1 / Math.sqrt(lengthSq);
  return vec3(direction.x * inverse, direction.y * inverse, direction.z * inverse);
}

/** One sub-step: resolve X, then Z (slide), then Y (land or head). */
function slideOne(
  position: Vec3, delta: Vec3, spec: ResolvedSpec, colliders: ReadonlyArray<InternalCollider>
): SlideStep {
  let x = position.x;
  let y = position.y;
  let z = position.z;
  let hitWall = false;
  let hitHead = false;
  let supported = false;
  let groundY = y;

  for (const axis of ['x', 'z'] as const) {
    const moved = axis === 'x' ? x + delta.x : z + delta.z;
    const candidateX = axis === 'x' ? moved : x;
    const candidateZ = axis === 'z' ? moved : z;

    if (!capsuleOverlapsAt(candidateX, y, candidateZ, spec, colliders)) {
      x = candidateX;
      z = candidateZ;
      continue;
    }

    // Blocked: try stepping onto the ledge before reporting a wall hit.
    const landed = tryStepUp(x, y, z, axis, moved, spec, colliders);
    if (landed !== null) {
      x = landed.x;
      y = landed.y;
      z = landed.z;
      supported = true;
      groundY = landed.groundY;
    } else {
      hitWall = true;
    }
  }

  const movedY = y + delta.y;
  if (!capsuleOverlapsAt(x, movedY, z, spec, colliders)) {
    y = movedY;
  } else if (delta.y <= 0) {
    const support = landOnSupport(x, y, z, spec, colliders);
    y = support.y;
    supported = true;
    groundY = support.groundY;
  } else {
    y = clampHead(x, y, z, spec, colliders);
    hitHead = true;
  }

  return { x, y, z, hitWall, hitHead, supported, groundY };
}

/** Step onto an obstacle top no taller than `stepHeight` (stairs/ledges). */
function tryStepUp(
  x: number, y: number, z: number, axis: 'x' | 'z', moved: number,
  spec: ResolvedSpec, colliders: ReadonlyArray<InternalCollider>
): { x: number; y: number; z: number; groundY: number } | null {
  if (spec.stepHeight <= 0) return null;
  const aheadX = axis === 'x' ? moved : x;
  const aheadZ = axis === 'z' ? moved : z;
  for (const collider of colliders) {
    const top = collider.max.y;
    if (top <= y + SKIN || top - y > spec.stepHeight) continue;
    if (capsuleOverlapsAt(aheadX, top + SKIN, aheadZ, spec, colliders)) continue;
    return { x: aheadX, y: top + SKIN, z: aheadZ, groundY: top };
  }
  return null;
}

function landOnSupport(
  x: number, y: number, z: number, spec: ResolvedSpec, colliders: ReadonlyArray<InternalCollider>
): { y: number; groundY: number } {
  let best: number | null = null;
  for (const collider of colliders) {
    if (collider.max.y > y + SKIN * 2) continue;
    if (collider.max.y < y - spec.height * 2) continue;
    const overlapsXZ =
      x + spec.radius > collider.min.x && x - spec.radius < collider.max.x &&
      z + spec.radius > collider.min.z && z - spec.radius < collider.max.z;
    if (!overlapsXZ) continue;
    if (best === null || collider.max.y > best) {
      best = collider.max.y;
    }
  }
  const groundY = best ?? y;
  return { y: groundY + SKIN, groundY };
}

function clampHead(
  x: number, y: number, z: number, spec: ResolvedSpec, colliders: ReadonlyArray<InternalCollider>
): number {
  let ceiling: number | null = null;
  for (const collider of colliders) {
    const overlapsXZ =
      x + spec.radius > collider.min.x && x - spec.radius < collider.max.x &&
      z + spec.radius > collider.min.z && z - spec.radius < collider.max.z;
    if (!overlapsXZ) continue;
    if (collider.min.y >= y + spec.height - SKIN && (ceiling === null || collider.min.y < ceiling)) {
      ceiling = collider.min.y;
    }
  }
  return ceiling === null ? y : Math.min(y, ceiling - spec.height - SKIN);
}

function probeDown(
  position: Vec3, spec: ResolvedSpec, colliders: ReadonlyArray<InternalCollider>
): { supported: boolean; groundY: number } {
  const support = landOnSupport(position.x, position.y, position.z, spec, colliders);
  const gap = position.y - support.groundY;
  return { supported: gap <= SKIN * 4, groundY: support.groundY };
}
function depenetrate(
  position: Vec3, spec: ResolvedSpec, colliders: ReadonlyArray<InternalCollider>
): void {
  for (let iteration = 0; iteration < DEPENETRATE_ITERATIONS; iteration += 1) {
    const blocker = firstOverlap(position, spec, colliders);
    if (!blocker) return;

    // Push out along the axis of least penetration (minimum-translation vector).
    const minX = position.x - spec.radius;
    const maxX = position.x + spec.radius;
    const minY = position.y;
    const maxY = position.y + spec.height;
    const minZ = position.z - spec.radius;
    const maxZ = position.z + spec.radius;

    const candidates = [
      { amount: maxX - blocker.min.x, axis: 0, sign: 1 },
      { amount: blocker.max.x - minX, axis: 0, sign: -1 },
      { amount: maxY - blocker.min.y, axis: 1, sign: 1 },
      { amount: blocker.max.y - minY, axis: 1, sign: -1 },
      { amount: maxZ - blocker.min.z, axis: 2, sign: 1 },
      { amount: blocker.max.z - minZ, axis: 2, sign: -1 }
    ];
    let chosen = candidates[0]!;
    for (let i = 1; i < candidates.length; i += 1) {
      const candidate = candidates[i]!;
      if (candidate.amount < chosen.amount) chosen = candidate;
    }

    const push = chosen.amount + SKIN;
    if (chosen.axis === 0) position.x += push * chosen.sign;
    else if (chosen.axis === 1) position.y += push * chosen.sign;
    else position.z += push * chosen.sign;
  }
}

function firstOverlap(
  position: Vec3, spec: ResolvedSpec, colliders: ReadonlyArray<InternalCollider>
): InternalCollider | null {
  const minX = position.x - spec.radius;
  const minZ = position.z - spec.radius;
  const maxX = position.x + spec.radius;
  const maxZ = position.z + spec.radius;
  for (const collider of colliders) {
    if (
      boxesOverlap(
        minX, position.y, minZ, maxX, position.y + spec.height, maxZ,
        collider.min.x, collider.min.y, collider.min.z,
        collider.max.x, collider.max.y, collider.max.z
      )
    ) {
      return collider;
    }
  }
  return null;
}

/** Slab-method ray vs AABB. Returns the entry hit, or null. */
function rayVsAabb(origin: Vec3, direction: Vec3, box: InternalCollider, maxDistance: number): RayHit | null {
  let tMin = 0;
  let tMax = maxDistance;
  let normal = vec3(0, 1, 0);

  const ox = [origin.x, origin.y, origin.z] as const;
  const dx = [direction.x, direction.y, direction.z] as const;
  const bMin = [box.min.x, box.min.y, box.min.z] as const;
  const bMax = [box.max.x, box.max.y, box.max.z] as const;

  for (let axis = 0; axis < 3; axis += 1) {
    const o = ox[axis]!;
    const d = dx[axis]!;
    if (Math.abs(d) < 1e-12) {
      // Parallel: inside the slab means the axis never clips the ray.
      if (o < bMin[axis]! || o > bMax[axis]!) return null;
      continue;
    }
    let t1 = (bMin[axis]! - o) / d;
    let t2 = (bMax[axis]! - o) / d;
    let faceSign = -1;
    if (t1 > t2) {
      const swap = t1;
      t1 = t2;
      t2 = swap;
      faceSign = 1;
    }
    if (t1 > tMin) {
      tMin = t1;
      normal = vec3(
        axis === 0 ? faceSign : 0,
        axis === 1 ? faceSign : 0,
        axis === 2 ? faceSign : 0
      );
    }
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return null;
  }

  if (tMin < 0 || tMin > maxDistance) return null;
  return {
    distance: tMin,
    point: vec3(
      origin.x + direction.x * tMin,
      origin.y + direction.y * tMin,
      origin.z + direction.z * tMin
    ),
    normal
  };
}