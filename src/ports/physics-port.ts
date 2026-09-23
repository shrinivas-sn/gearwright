/**
 * L3 PORT — physics. Interface only: no engine imports, no logic (ARCH §9/§10, §20).
 *
 * Phase 2 scope is the kinematic subset of ADR-004: static axis-aligned colliders,
 * capsule move-and-slide, ray/sphere queries, ground probing. There is deliberately
 * no dynamics surface (no forces, masses, joints) — gameplay in the MVP needs
 * placement reliability, not rigid-body simulation.
 */

import type { Vec3 } from '../core/vec3.ts';

/** Axis-aligned static collider. The only shape the world is authored in (ARCH §34.3). */
export interface StaticCollider {
  readonly min: Vec3;
  readonly max: Vec3;
  /** Optional tag for debugging / future filtering (e.g. floor vs wall). */
  readonly tag?: string;
}

/** Vertical capsule used for the player (feet position + height). */
export interface CapsuleSpec {
  readonly radius: number;
  readonly height: number;
  /** Maximum ledge height that is stepped over instead of colliding. */
  readonly stepHeight: number;
}

export interface RayHit {
  /** Distance from the query origin along a normalized direction. */
  readonly distance: number;
  readonly point: Vec3;
  /** Face normal of the struck surface. */
  readonly normal: Vec3;
}

export interface MoveResult {
  /** Feet position after resolution (always a valid, non-embedded pose). */
  readonly position: Vec3;
  /** True if horizontal motion was altered by a wall (slid or blocked). */
  readonly hitWall: boolean;
  /** True if upward motion hit a ceiling. */
  readonly hitHead: boolean;
  /** True if the capsule is supported from below after the move. */
  readonly supported: boolean;
  /** Highest walkable surface height found beneath the capsule. */
  readonly groundY: number;
}

/** Axis-aligned volume an interaction ray can select (ARCH §18 interactable layer). */
export interface InteractableVolume {
  readonly id: string;
  readonly min: Vec3;
  readonly max: Vec3;
}

/** Axis-aligned socket detection volume (ARCH §21.2 snap volume query). */
export interface SocketVolume {
  readonly id: string;
  readonly min: Vec3;
  readonly max: Vec3;
}

/** One interactable hit along an interaction ray (distance from the ray origin). */
export interface InteractionHit {
  readonly id: string;
  readonly distance: number;
  readonly point: Vec3;
  readonly normal: Vec3;
}

export interface PhysicsPort {
  readonly kind: string;

  /** Replace the static world colliders (called on level load). */
  setStaticColliders(colliders: ReadonlyArray<StaticCollider>): void;

  /**
   * Replace the kinematic carryable boxes (ARCH §20.1: "carryables are kinematic
   * while held; resting carryables are static until grabbed"). M3 addition.
   *
   * These are solid to the **player capsule** only. They are deliberately absent
   * from `castRay`/`castSphere` (interest: the camera never chases a carried part,
   * §17) and from `isBoxBlocked` (release/depenetration is judged against world
   * geometry, never against the object being placed).
   */
  setCarryableColliders(colliders: ReadonlyArray<StaticCollider>): void;

  /** Replace the interaction-layer volumes (called on level load; ARCH §18). */
  setInteractableVolumes(volumes: ReadonlyArray<InteractableVolume>): void;

  /**
   * Replace the socket detection volumes (called on level load; ARCH §21.2). M4
   * addition: the snap pipeline asks which sockets a component's box touches.
   */
  setSocketVolumes(volumes: ReadonlyArray<SocketVolume>): void;

  /**
   * Ids of socket volumes overlapping an axis-aligned box, unordered (M4 addition).
   * The caller applies compatibility, occupancy and ranking (L1 `snap-rules`).
   */
  overlapSocketVolumes(min: Vec3, max: Vec3): ReadonlyArray<string>;

  /**
   * Every interactable volume entered by a ray within `maxDistance`, unordered.
   * The caller ranks/filters candidates (range, LOS, priority, context).
   */
  queryInteractionRay(origin: Vec3, direction: Vec3, maxDistance: number): ReadonlyArray<InteractionHit>;

  /** Does an axis-aligned box overlap any static collider? (embedded-target filter.) */
  isBoxBlocked(min: Vec3, max: Vec3): boolean;

  /**
   * Move a capsule by `displacement` with axis-separated sliding, step-up
   * handling and sub-stepping. Displacement is assumed already clamped to sane
   * speeds by the caller. Deterministic for identical inputs.
   *
   * @param feet   current feet position (mutated value is never read back; use the result)
   * @param out    scratch vector receiving the resulting feet position
   */
  moveAndSlide(feet: Vec3, displacement: Vec3, spec: CapsuleSpec, out: Vec3): MoveResult;

  /**
   * Nearest static hit along a ray, or null. `direction` need not be normalized;
   * zero-length or non-finite directions yield null (never throw).
   */
  castRay(origin: Vec3, direction: Vec3, maxDistance: number): RayHit | null;

  /** Nearest static hit for a swept sphere (camera occlusion probe). */
  castSphere(origin: Vec3, radius: number, direction: Vec3, maxDistance: number): RayHit | null;

  /** Is this feet pose valid (non-embedded) for the given capsule? */
  isPoseValid(feet: Vec3, spec: CapsuleSpec): boolean;

  dispose(): void;
}