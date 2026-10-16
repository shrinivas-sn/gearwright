/**
 * L2 — player locomotion (ARCH §16 + GOD-MODE ADR-019: grounded walk/run/turn +
 * a small utility hop). The controller owns player position/orientation
 * (§12.1) and speaks to the world exclusively through `PhysicsPort`.
 *
 * Deterministic at fixed dt: identical action/state sequences produce identical
 * positions, which later milestones use for replay-style tests (EC-MAN-12).
 *
 * GOD-MODE (ADR-019): the hop is a short, low, locomotion-grade vertical bump —
 * enough to clear low clutter / feel responsive on the workshop floor, never a
 * parkour system. It is edge-triggered (`jump: true` = "pressed this step"),
 * grounded-only, coyote/buffer assisted, and fully deterministic at fixed dt.
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
  /**
   * Stance pass (16/10/2026): the capsule used while crouched. Same feet, a lower
   * top — which is what lets a crouched player pass under low geometry.
   */
  readonly crouchCapsule: CapsuleSpec;
  /** Multiplier on walk speed while crouched (sprinting is unavailable crouched). */
  readonly crouchSpeedScale: number;
  readonly gravity: number;
  /** Terminal fall speed. */
  readonly maxFallSpeed: number;
  /** GOD-MODE ADR-019: hop take-off velocity (m/s). ~4.6 clears low clutter. */
  readonly jumpSpeed: number;
  /** Seconds after leaving ground a buffered press still fires. */
  readonly coyoteTime: number;
  /** Seconds a pressed edge is remembered before landing. */
  readonly jumpBufferTime: number;
}

export const DEFAULT_PLAYER_TUNING: PlayerTuning = {
  // Speed pass (16/10/2026, owner request: "the character feels a little bit slow").
  // Values are deliberately still *workshop* speeds, not shooter speeds: ARCH §16's
  // traversal-safety rule (a hazard telegraph must remain readable at walk pace) is
  // the ceiling, and 7.4 m/s of sprint is the top of it.
  walkSpeed: 3.6,
  runSpeed: 7.4,
  accelerationTime: 0.07,
  decelerationTime: 0.06,
  capsule: { radius: 0.32, height: 1.7, stepHeight: 0.35 },
  // Crouch: head roughly a metre lower, half pace. The radius is unchanged on purpose —
  // a crouched player is shorter, never thinner, so a crouch cannot squeeze through a gap
  // that a stand-up check would then refuse to let them leave.
  crouchCapsule: { radius: 0.32, height: 1.15, stepHeight: 0.35 },
  crouchSpeedScale: 0.5,
  gravity: 16,
  maxFallSpeed: 14,
  jumpSpeed: 4.6,
  coyoteTime: 0.12,
  jumpBufferTime: 0.15
};

export interface PlayerDynamicState {
  readonly position: Vec3;
  readonly velocity: Vec3;
  readonly facingYaw: number;
  readonly grounded: boolean;
  readonly groundY: number;
  readonly speed: number;
  /** Stance pass: true while the crouched capsule is the one being simulated. */
  readonly crouched: boolean;
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
  /**
   * GOD-MODE ADR-019: Space was pressed this step. Edge, not hold — a held jump
   * never re-fires; the hop is a single grounded-only vertical bump per press.
   */
  readonly jump: boolean;
  /**
   * Stance pass: crouch is *held*, not toggled (BGMI's PC crouch), so it is plain
   * state with no latch to get out of step with the key. While crouched the player
   * uses `crouchCapsule`, cannot sprint, and walks at `crouchSpeedScale`. Releasing
   * the key only stands the player up where standing is legal.
   */
  readonly crouch: boolean;
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
  /** Stance pass: true while the crouched capsule is the one being simulated. */
  private crouched = false;

  // GOD-MODE ADR-019 hop state: grounded-only, coyote/buffer assisted, one hop per press.
  private timeSinceGrounded = 0;
  private jumpBuffer = 0;
  private jumpCooldown = 0;

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

    // 0. Stance (16/10/2026): resolve the capsule *before* any motion, so the step is
    //    simulated in exactly one shape. Crouch is held; releasing it stands the player
    //    up only where standing is legal, which is checked against the port's own
    //    `isPoseValid` rather than a second collision implementation.
    const wantsCrouch = input.crouch === true;
    if (wantsCrouch) this.crouched = true;
    else if (this.crouched && this.canStand()) this.crouched = false;
    const capsule = this.crouched ? this.tuning.crouchCapsule : this.tuning.capsule;

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

    // Sprinting is a standing stance: crouched, the run modifier is simply ignored
    // rather than scaled, so "crouch-walk" is one unambiguous speed.
    const sprinting = input.run && !this.crouched;
    const stanceScale = this.crouched ? this.tuning.crouchSpeedScale : 1;
    const maxSpeed =
      (sprinting ? this.tuning.runSpeed : this.tuning.walkSpeed) *
      stanceScale *
      clampSpeedScale(input.speedScale);
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
    // NOTE: `this.grounded` here is still last step's value (the authoritative update is at 5b),
    // so this branch is the *continuous* effect — it keeps a continuously-supported player from
    // drifting upward and enforces the grounded-stick floor while you were already on the ground.
    // The *landing* damping (killing a fast fall the step you touch down) is applied in the 5b
    // grounded branch, which runs after `this.grounded` is set from `result.supported`.
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
      capsule,
      this.resolved
    );

    vec3Sanitize(this.resolved, this.resolved, this.spawn);
    this.position.x = this.resolved.x;
    this.position.y = this.resolved.y;
    this.position.z = this.resolved.z;

    // 5b. GOD-MODE ADR-019: grounded-only hop, edge-triggered with coyote + buffer.
    // The hop reads `result` (the authoritative post-move grounding), so it lives after the
    // port call. It is deterministic at fixed dt.
    //
    // Contract:
    //   - grounded Space edge this step -> hop now.
    //   - airborne Space edge this step while coyote still open -> hop now.
    //   - airborne Space edge this step with nothing open -> seed the buffer for a future landing.
    //   - on landing (was airborne, now grounded) with a live buffer -> fire once this step.
    // The coyote window is real time since leaving the ground, not a position delta (which goes
    // negative after falling past the spawn height). The buffer is real time and counts down every
    // airborne step. A short post-hop cooldown keeps a fake physics that spuriously re-reports
    // `supported` from double-firing the same press.
    const wasGrounded = this.grounded;
    this.grounded = result.supported;
    this.groundY = result.groundY;

    // Landing: was airborne, now grounded. A live buffer fires once on this step,
    // before the grounded/airborne branches clear it.
    if (!wasGrounded && this.grounded && this.jumpBuffer > 0 && this.jumpCooldown <= 0) {
      this.velocity.y = this.tuning.jumpSpeed;
      this.jumpBuffer = 0;
      this.jumpCooldown = 1e-3;
    }

    if (this.grounded) {
      // On the ground: refresh the coyote timer and clear any buffer that did not land in time.
      this.timeSinceGrounded = 0;
      this.jumpBuffer = 0;
      this.jumpCooldown = 0;

      // Landing damping: kill a fast fall the step you actually touch down. The continuous
      // grounded-stick branch above used last step's grounding, so a terminal landing would
      // otherwise keep its -14 m/s into the floor on the landing step (the next step is the first
      // one that sees `this.grounded` as true from last step). God-mode ADR-019 is a *utility* hop,
      // not a parkour system, so a hard clamp to the grounded stick on landing is the right shape —
      // it feels like the floor catching you, not a bounce.
      if (this.velocity.y < -GROUNDED_STICK_SPEED) {
        this.velocity.y = -GROUNDED_STICK_SPEED;
      }

      if (input.jump && this.jumpCooldown <= 0) {
        this.velocity.y = this.tuning.jumpSpeed;
        this.jumpCooldown = 1e-3;
      }
    } else {
      // Airborne: advance the coyote timer in real time.
      this.timeSinceGrounded += clampedDt;
      const coyoteOpen = this.timeSinceGrounded < this.tuning.coyoteTime;

      if (input.jump && this.jumpCooldown <= 0) {
        if (coyoteOpen) {
          // Coyote: Space pressed shortly after leaving the ledge.
          this.velocity.y = this.tuning.jumpSpeed;
          this.jumpBuffer = 0;
          this.jumpCooldown = 1e-3;
        } else {
          // Nothing to fire right now: seed the buffer for a future landing.
          // The buffer lives in real time and counts down every airborne step.
          this.jumpBuffer = this.tuning.jumpBufferTime;
        }
      } else if (!input.jump && this.jumpCooldown <= 0 && this.jumpBuffer > 0) {
        // No edge this step: the buffer counts down in real time.
        this.jumpBuffer = Math.max(0, this.jumpBuffer - clampedDt);
      }
    }

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
    // A respawn is a fresh stance: keeping a crouch across a teleport could strand the
    // player crouched in a tight spot they never crouched into.
    this.crouched = false;
  }

  /**
   * Can the player stand up *here*? Asked of the port, never re-implemented: standing is
   * legal exactly when the tall capsule has a valid pose at the current feet position.
   */
  private canStand(): boolean {
    return this.physics.isPoseValid(this.position, this.tuning.capsule);
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
      speed: vec3Length(this.velocity),
      crouched: this.crouched
    };
  }
}

/** Speed multiplier sanitizer: absent or malformed input means "full speed". */
function clampSpeedScale(scale: number | undefined): number {
  if (scale === undefined || !Number.isFinite(scale)) return 1;
  return Math.min(Math.max(scale, 0.1), 1);
}

// Radians per second the character may rotate (ARCH §16: face travel, no snapping).
// Raised 12 -> 14 in the 16/10 speed pass: at the faster walk/run the old rate read as the
// character turning *after* the input, which is half of what "feels slow" meant.
const PLAYER_TURN_RATE = 14;
// Downward stick speed applied while grounded so contact is never marginal.
const GROUNDED_STICK_SPEED = 1;