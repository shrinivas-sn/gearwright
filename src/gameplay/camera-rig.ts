/**
 * L2 — third-person orbit camera (ARCH §17): spring-arm rig with deterministic
 * damping, sphere-cast occlusion resolve, occlusion hysteresis, manipulation
 * framing mode, and recentring. Consumes `PhysicsPort` only; owns camera pose.
 *
 * Fixed-step pure: every intermediate value is stored, nothing is allocated
 * per step beyond small scratch tuples, and identical inputs reproduce poses.
 */

import { vec3, vec3Cross, vec3Normalize, type Vec3 } from '../core/vec3.ts';
import type { PhysicsPort } from '../ports/physics-port.ts';

export type CameraMode = 'follow' | 'manipulation';

export interface CameraPoseState {
  readonly eye: Vec3;
  readonly target: Vec3;
  readonly fov: number;
}

export interface CameraPlayerState {
  readonly position: Vec3;
  readonly facingYaw: number;
}

export interface CameraTuning {
  /** Shoulder height of the look target above the player position (feet). */
  readonly targetHeight: number;
  readonly distance: number;
  readonly minDistance: number;
  readonly maxDistance: number;
  /** Pitch limits, radians (negative looks down). */
  readonly minPitch: number;
  readonly maxPitch: number;
  /**
   * Mouse-look sensitivity: radians of rotation per pixel of travel, expressed
   * as `value * fixedDt` (so `value` is rad/s at the 30 Hz step). Full sweep
   * feel: ~`fixedDt / value` px per radian — see the sensitivity test.
   */
  readonly yawSpeed: number;
  readonly pitchSpeed: number;
  /** Exponential convergence rates (1/s). */
  readonly positionBlend: number;
  readonly targetBlend: number;
  readonly skin: number;
  readonly collisionRadius: number;
  readonly recenterDelay: number;
  readonly recenterSpeed: number;
  readonly manipulationOffset: number;
  /** Extra target height while framing a manipulation (ARCH §17 "slightly higher"). */
  readonly manipulationLift: number;
  /**
   * Convergence rate (1/s) of the mode blend. The manipulation framing is eased
   * over ~0.25 s and never snaps (ARCH §17); rate 12 reaches ~95% in that time.
   */
  readonly modeBlendRate: number;
  readonly fov: number;
}

export const DEFAULT_CAMERA_TUNING: CameraTuning = {
  targetHeight: 1.4,
  distance: 4.2,
  minDistance: 0.8,
  maxDistance: 4.2,
  minPitch: -1.1,
  maxPitch: 0.55,
  yawSpeed: 0.25,
  pitchSpeed: 0.18,
  positionBlend: 14,
  targetBlend: 18,
  skin: 0.18,
  collisionRadius: 0.3,
  recenterDelay: 2.5,
  recenterSpeed: 1.6,
  manipulationOffset: 0.9,
  manipulationLift: 0.2,
  modeBlendRate: 12,
  fov: 60
};

export interface CameraStepInput {
  readonly lookDeltaX: number;
  readonly lookDeltaY: number;
  readonly player: CameraPlayerState;
  readonly mode: CameraMode;
  /** Seconds since look input was last non-zero (drives auto-recentre). */
  readonly idleTime: number;
}

const FULL_CIRCLE = Math.PI * 2;

function wrapAngle(angle: number): number {
  let wrapped = angle % FULL_CIRCLE;
  if (wrapped > Math.PI) wrapped -= FULL_CIRCLE;
  if (wrapped < -Math.PI) wrapped += FULL_CIRCLE;
  return wrapped;
}
export class CameraRig {
  private readonly physics: PhysicsPort;
  private readonly tuning: CameraTuning;
  private readonly eye: Vec3;
  private readonly desired: Vec3;
  private readonly target: Vec3;
  private readonly desiredTarget: Vec3;
  private readonly direction: Vec3;
  private readonly right: Vec3;
  private readonly up: Vec3;

  private yaw = 0;
  private pitch = -0.32;
  private distance: number;
  private armLength: number;
  private occludedDistance: number | null = null;
  /** 0 = follow framing, 1 = fully in manipulation framing (eased, never snapped). */
  private modeBlend = 0;
  private initialised = false;

  constructor(physics: PhysicsPort, tuning: Partial<CameraTuning> = {}) {
    this.physics = physics;
    this.tuning = { ...DEFAULT_CAMERA_TUNING, ...tuning };
    this.distance = this.tuning.distance;
    this.armLength = this.tuning.distance;
    this.eye = vec3();
    this.desired = vec3();
    this.target = vec3();
    this.desiredTarget = vec3();
    this.direction = vec3();
    this.right = vec3();
    this.up = vec3(0, 1, 0);
  }

  /**
   * One fixed step. Returns copies of the pose; L4 applies them via
   * `RenderPort.setView` — nothing here touches the renderer.
   */
  step(dt: number, input: CameraStepInput): CameraPoseState {
    const clampedDt = Number.isFinite(dt) && dt > 0 && dt <= 0.25 ? dt : 1 / 30;

    this.integrateLook(input, clampedDt);
    this.recentreBehindPlayer(input, clampedDt);
    this.advanceModeBlend(input, clampedDt);
    this.solveDistances();
    this.desiredTarget.x = input.player.position.x;
    this.desiredTarget.y =
      input.player.position.y + this.tuning.targetHeight + this.tuning.manipulationLift * this.modeBlend;
    this.desiredTarget.z = input.player.position.z;
    this.placeAndCollide();

    if (!this.initialised) {
      this.eye.x = this.desired.x;
      this.eye.y = this.desired.y;
      this.eye.z = this.desired.z;
      this.target.x = this.desiredTarget.x;
      this.target.y = this.desiredTarget.y;
      this.target.z = this.desiredTarget.z;
      this.initialised = true;
    } else {
      this.damp(this.eye, this.desired, this.tuning.positionBlend, clampedDt);
      this.damp(this.target, this.desiredTarget, this.tuning.targetBlend, clampedDt);
    }

    return this.snapshot();
  }

  snapshot(): CameraPoseState {
    return {
      eye: { x: this.eye.x, y: this.eye.y, z: this.eye.z },
      target: { x: this.target.x, y: this.target.y, z: this.target.z },
      fov: this.tuning.fov
    };
  }

  /** Current yaw — consumed by `PlayerController` for camera-relative motion. */
  get currentYaw(): number {
    return this.yaw;
  }

  /**
   * Render-time pose (presentation only, never fed back into the sim): the rig's current
   * yaw/pitch plus look deltas the next fixed step has not consumed yet, orbiting the given
   * (interpolated) anchor at the current arm length. It mutates nothing, so the simulation
   * stays deterministic — but the view answers the mouse every rendered frame.
   */
  previewPose(input: {
    readonly anchor: Vec3;
    readonly pendingLookX: number;
    readonly pendingLookY: number;
    readonly dt: number;
  }): CameraPoseState {
    const dt = Number.isFinite(input.dt) && input.dt > 0 ? input.dt : 1 / 30;
    const lookX = Number.isFinite(input.pendingLookX) ? input.pendingLookX : 0;
    const lookY = Number.isFinite(input.pendingLookY) ? input.pendingLookY : 0;
    const yaw = wrapAngle(this.yaw - lookX * this.tuning.yawSpeed * dt);
    const pitch = Math.min(
      this.tuning.maxPitch,
      Math.max(this.tuning.minPitch, this.pitch - lookY * this.tuning.pitchSpeed * dt)
    );
    const cosPitch = Math.cos(pitch);
    const direction = { x: Math.sin(yaw) * cosPitch, y: Math.sin(pitch), z: Math.cos(yaw) * cosPitch };
    let arm = this.armLength;
    const hit = this.physics.castSphere(input.anchor, this.tuning.collisionRadius, direction, arm + this.tuning.skin);
    if (hit) arm = Math.min(arm, Math.max(this.tuning.minDistance, hit.distance - this.tuning.skin));
    return {
      eye: {
        x: input.anchor.x + direction.x * arm,
        y: input.anchor.y + direction.y * arm,
        z: input.anchor.z + direction.z * arm
      },
      target: { x: input.anchor.x, y: input.anchor.y, z: input.anchor.z },
      fov: this.tuning.fov
    };
  }

  private integrateLook(input: CameraStepInput, dt: number): void {
    this.yaw = wrapAngle(this.yaw - input.lookDeltaX * this.tuning.yawSpeed * dt);
    const nextPitch = this.pitch - input.lookDeltaY * this.tuning.pitchSpeed * dt;
    this.pitch = Math.min(this.tuning.maxPitch, Math.max(this.tuning.minPitch, nextPitch));
  }

  private recentreBehindPlayer(input: CameraStepInput, dt: number): void {
    if (input.idleTime < this.tuning.recenterDelay) return;
    // Camera yaw aligns with the player's facing so the eye sits behind them
    // (yaw 0 = looking toward -Z, three.js convention).
    const targetYaw = wrapAngle(input.player.facingYaw);
    const diff = wrapAngle(targetYaw - this.yaw);
    const maxStep = this.tuning.recenterSpeed * dt;
    this.yaw = wrapAngle(this.yaw + Math.min(Math.max(diff, -maxStep), maxStep));
  }

  private advanceModeBlend(input: CameraStepInput, dt: number): void {
    const goal = input.mode === 'manipulation' ? 1 : 0;
    const blend = 1 - Math.exp(-this.tuning.modeBlendRate * dt);
    this.modeBlend += (goal - this.modeBlend) * blend;
    if (this.modeBlend < 1e-4) this.modeBlend = 0;
  }

  /** Framing target: closer (ARCH §17) and slightly higher while manipulating. */
  private solveDistances(): void {
    const framed = this.tuning.distance - this.tuning.manipulationOffset * this.modeBlend;
    this.distance = Math.max(this.tuning.minDistance, framed);
  }

  private placeAndCollide(): void {
    const cosPitch = Math.cos(this.pitch);
    const sinPitch = Math.sin(this.pitch);

    // Direction from the look target out to the camera: with yaw 0 the eye sits
    // on +Z behind a player facing -Z, and the camera looks toward -Z (three.js
    // convention). `view = -direction` is what camera-relative movement follows.
    this.direction.x = Math.sin(this.yaw) * cosPitch;
    this.direction.y = sinPitch;
    this.direction.z = Math.cos(this.yaw) * cosPitch;
    vec3Normalize(this.direction, this.direction);

    const anchor = this.desiredTarget;
    const previousOccluded = this.occludedDistance;
    const hit = this.physics.castSphere(
      anchor,
      this.tuning.collisionRadius,
      this.direction,
      this.distance + this.tuning.skin
    );

    // Occlusion hysteresis (EC-PC-06): entering is eager, leaving is a smoothed
    // return (ARCH §17) that only releases past a clearance margin, so the
    // camera never strobes between two occluders and never sticks once clear.
    if (hit) {
      const pulled = Math.max(this.tuning.minDistance, hit.distance - this.tuning.skin);
      this.occludedDistance = previousOccluded === null ? pulled : Math.min(previousOccluded, pulled);
    } else if (previousOccluded !== null) {
      const recovered = previousOccluded + this.tuning.skin * 2;
      this.occludedDistance = recovered >= this.distance - this.tuning.skin * 2 ? null : recovered;
    }

    const effective = this.occludedDistance ?? this.distance;
    const clamped = Math.min(Math.max(effective, this.tuning.minDistance), this.tuning.maxDistance);
    this.armLength = clamped;

    this.desired.x = anchor.x + this.direction.x * clamped;
    this.desired.y = anchor.y + this.direction.y * clamped;
    this.desired.z = anchor.z + this.direction.z * clamped;

    // Camera-right = up × (target→eye), kept hot for manipulation framing (Phase 4).
    vec3Cross(this.right, this.up, this.direction);
    vec3Normalize(this.right, this.right);
  }

  private damp(current: Vec3, goal: Vec3, rate: number, dt: number): void {
    const blend = 1 - Math.exp(-rate * dt);
    current.x += (goal.x - current.x) * blend;
    current.y += (goal.y - current.y) * blend;
    current.z += (goal.z - current.z) * blend;
  }
}