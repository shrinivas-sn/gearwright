/**
 * L2 — player locomotion (ARCH §16). Grounded walk/run/turn only: no jump,
 * no climb, no parkour. The controller owns player position/orientation
 * (§12.1) and speaks to the world exclusively through `PhysicsPort`.
 *
 * Deterministic at fixed dt: identical action/state sequences produce identical
 * positions, which later milestones use for replay-style tests (EC-MAN-12).
 */

import {
  vec3,
  vec3Length,
  vec3Sanitize,
  vec3Scale,
  vec3Set,
  type Vec3
} from '../core/vec3.ts';
import type { CapsuleSpec, PhysicsPort } from '../ports/physics-port.ts';

export interface PlayerTuning {
  readonly walkSpeed: number;
  readonly runSpeed: number;
  /** Seconds to reach full speed from rest. */
  readonly accelerationTime: number;
  /** Seconds to stop when input is released. */
  readonly decelerationTime: number;
  /** Capsule spec (feet position, height from feet). */
  readonly capsule: CapsuleSpec;
  readonly gravity: number;
  /** Terminal fall speed. */
  readonly maxFallSpeed: number;
}

export const DEFAULT_PLAYER_TUNING: PlayerTuning = {
  walkSpeed: 2.2,
  runSpeed: 4.2,
  accelerationTime: 0.12,
  decelerationTime: 0.1,
  capsule: { radius: 0.32, height: 1.7, stepHeight: 0.35 },
  gravity: 14,
  maxFallSpeed: 12
};

export interface PlayerDynamicState {
  readonly position: Vec3;
  readonly velocity: Vec3;
  readonly facingYaw: number;
  readonly grounded: boolean;
  readonly groundY: number;
  readonly speed: number;
}

/**
 * Camera-relative move intents. `cameraYaw` is the yaw (radians) of the camera's
 * forward direction around Y: intent (0,1) means "away from camera".
 */
export interface PlayerStepInput {
  readonly moveX: number;
  readonly moveZ: number;
  readonly run: boolean;
  readonly cameraYaw: number;
  /**
   * Multiplier on walk/run speed (M3 addition). ARCH §15 gives the Manipulation
   * context a *slow strafe*, so the manipulation layer scales locomotion instead
   * of the player owning a second speed table.
   */
  readonly speedScale?: number | undefined;
}

export class PlayerController {
  private readonly physics: PhysicsPort;
  private readonly tuning: PlayerTuning;
  private readonly position: Vec3;
  private readonly velocity: Vec3;
  private readonly displacement: Vec3;
  private readonly horizontal: Vec3;
  private readonly resolved: Vec3;

  private facingYaw = 0;
  private grounded = false;
  private groundY: number;
  private spawn: Vec3;

  constructor(physics: PhysicsPort, spawn: Vec3, tuning: Partial<PlayerTuning> = {}) {
    const merged: PlayerTuning = {
      ...DEFAULT_PLAYER_TUNING,
      ...tuning,
      capsule: { ...DEFAULT_PLAYER_TUNING.capsule, ...tuning.capsule }
    };
    if (!(merged.walkSpeed > 0) || !(merged.runSpeed >= merged.walkSpeed)) {
      throw new RangeError('PlayerController: runSpeed must be >= walkSpeed > 0');
    }
    this.physics = physics;
    this.tuning = merged;
    this.position = vec3(spawn.x, spawn.y, spawn.z);
    this.velocity = vec3();
    this.displacement = vec3();
    this.horizontal = vec3();
    this.resolved = vec3();
    this.spawn = vec3(spawn.x, spawn.y, spawn.z);
    this.groundY = spawn.y;
  }

  step(dt: number, input: PlayerStepInput): PlayerDynamicState {
    const clampedDt = Number.isFinite(dt) && dt > 0 && dt <= 0.25 ? dt : 1 / 30;

    // Sanitize owned state every step: a poisoned value never survives into
    // the next step's math (ARCH §38 pose sanitizer, L2 edition).
    vec3Sanitize(this.position, this.position, this.spawn);
    vec3Sanitize(this.velocity, this.velocity, vec3());

    // 1. Intent -> camera-relative horizontal direction.
    const sin = Math.sin(input.cameraYaw);
    const cos = Math.cos(input.cameraYaw);
    // Camera forward on the XZ plane is (-sin(yaw), -cos(yaw)); right is (cos, -sin).
    const forwardX = -sin;
    const forwardZ = -cos;
    const intentX = forwardX * input.moveZ + cos * input.moveX;
    const intentZ = forwardZ * input.moveZ + -sin * input.moveX;
    const intentLength = Math.sqrt(intentX * intentX + intentZ * intentZ);
    const hasIntent = intentLength > 1e-6;

    const maxSpeed = (input.run ? this.tuning.runSpeed : this.tuning.walkSpeed) * clampSpeedScale(input.speedScale);
    if (hasIntent) {
      const inverse = 1 / intentLength;
      vec3Set(this.horizontal, intentX * inverse * maxSpeed, 0, intentZ * inverse * maxSpeed);
    } else {
      vec3Set(this.horizontal, 0, 0, 0);
    }

    // 2. Horizontal velocity approaches the target with an exponential blend
    // (frame-rate-correct smoothing, not a per-frame lerp factor).
    const responseTime = hasIntent ? this.tuning.accelerationTime : this.tuning.decelerationTime;
    const blend = 1 - Math.exp(-clampedDt / Math.max(responseTime, 1e-4));
    this.velocity.x += (this.horizontal.x - this.velocity.x) * blend;
    this.velocity.z += (this.horizontal.z - this.velocity.z) * blend;

    // 3. Face the direction of travel at a capped turn rate (no snapping).
    const currentSpeed = Math.sqrt(
      this.velocity.x * this.velocity.x + this.velocity.z * this.velocity.z
    );
    if (currentSpeed > 0.4) {
      const targetYaw = Math.atan2(-this.velocity.x, -this.velocity.z);
      let diff = targetYaw - this.facingYaw;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      const maxTurn = PLAYER_TURN_RATE * clampedDt;
      this.facingYaw += Math.min(Math.max(diff, -maxTurn), maxTurn);
    }

    // 4. Vertical: stick down while supported; otherwise fall with a terminal speed.
    if (this.grounded) {
      this.velocity.y = Math.min(0, this.velocity.y);
      if (this.velocity.y > -GROUNDED_STICK_SPEED) this.velocity.y = -GROUNDED_STICK_SPEED;
    } else {
      this.velocity.y = Math.max(
        this.velocity.y - this.tuning.gravity * clampedDt,
        -this.tuning.maxFallSpeed
      );
    }

    // 5. Displacement goes through the port; authoritative motion ends here.
    vec3Scale(this.displacement, this.velocity, clampedDt);
    const result = this.physics.moveAndSlide(
      this.position,
      this.displacement,
      this.tuning.capsule,
      this.resolved
    );

    vec3Sanitize(this.resolved, this.resolved, this.spawn);
    this.position.x = this.resolved.x;
    this.position.y = this.resolved.y;
    this.position.z = this.resolved.z;
    this.grounded = result.supported;
    this.groundY = result.groundY;

    return this.snapshot();
  }

  /** Instantly relocate (spawn / checkpoint respawn); zeroes velocity. */
  teleport(position: Vec3): void {
    this.position.x = position.x;
    this.position.y = position.y;
    this.position.z = position.z;
    vec3Set(this.velocity, 0, 0, 0);
    this.grounded = false;
    this.groundY = position.y;
  }

  setSpawn(position: Vec3): void {
    this.spawn = vec3(position.x, position.y, position.z);
  }

  snapshot(): PlayerDynamicState {
    return {
      position: { x: this.position.x, y: this.position.y, z: this.position.z },
      velocity: { x: this.velocity.x, y: this.velocity.y, z: this.velocity.z },
      facingYaw: this.facingYaw,
      grounded: this.grounded,
      groundY: this.groundY,
      speed: vec3Length(this.velocity)
    };
  }
}

/** Speed multiplier sanitizer: absent or malformed input means "full speed". */
function clampSpeedScale(scale: number | undefined): number {
  if (scale === undefined || !Number.isFinite(scale)) return 1;
  return Math.min(Math.max(scale, 0.1), 1);
}

// Radians per second the character may rotate (ARCH §16: face travel, no snapping).
const PLAYER_TURN_RATE = 12;
// Downward stick speed applied while grounded so contact is never marginal.
const GROUNDED_STICK_SPEED = 1;