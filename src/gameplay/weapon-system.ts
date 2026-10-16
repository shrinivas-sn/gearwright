/**
 * L2 — weapons (16/10/2026 weapons pass).
 *
 * The runtime owner of everything the player's weapon is doing: which slot is up, what is
 * in the magazine, whether the trigger is cycling, how far the aim has drifted, and where
 * every bullet currently in flight is. It owns **runtime** state only — nothing here is
 * saved, and nothing here can touch the Logical Machine Graph (SHOOTING-MECHANIC §5.1: a
 * shot may never attach, detach, validate or complete anything; a bullet can only report
 * *what it hit*).
 *
 * ## Shape of the thing
 *
 * ARCH §20's model, extended exactly one step. The world is still static colliders plus
 * kinematic carries; a bullet is the first object in the game with a *free* velocity, so it
 * is simulated the way §20.3 says everything else must be: fixed-step, swept (a 300 m/s
 * bullet travels 10 m in one 30 Hz step, so a point test would tunnel through the world
 * entirely — a segment sweep cannot), clamped to a fixed pool, and deterministic. There is
 * no `Math.random()` in this file: spread and recoil are authored patterns walked by index.
 *
 * ## Why the port's `castRay` is not the whole story
 *
 * `PhysicsPort.castRay` hits **static** colliders only — carryable colliders are
 * deliberately excluded from it (see the port). A bullet therefore asks two questions per
 * step and takes the nearer answer: the world ray, and a segment test against the *hit
 * volumes* the caller supplies (loose parts from the manipulation layer, range targets from
 * the level). That keeps the port unchanged and still lets a shot stop on a crate.
 *
 * ## Ownership
 *
 * - `WeaponSystem` owns slots, ammo, timers, bloom, the projectile pool and its counters.
 * - The **camera rig** owns its pose, so recoil leaves here as a one-step *impulse*
 *   (`recoilKick`); the rig accumulates and recovers it (ARCH §12.1's single-writer rule).
 * - The **player controller** owns locomotion, so ADS/crouch speed is published as a
 *   `moveScale` the composition multiplies into the player step.
 * - Presentation (tracers, flashes, sound, HUD) is an L4 concern and never reads back.
 */

import {
  vec3,
  vec3Copy,
  vec3Cross,
  vec3Normalize,
  vec3Sanitize,
  vec3Scale,
  vec3Set,
  type Vec3
} from '../core/vec3.ts';
import type { PhysicsPort } from '../ports/physics-port.ts';
import {
  FIRE_MODE_LABEL,
  SPREAD_PATTERN,
  WEAPON_CLASS_LABEL,
  weaponDefinitionOf,
  type FireMode,
  type WeaponClass,
  type WeaponDefinition
} from '../data/weapons.ts';

/**
 * A volume a bullet can strike that the physics port's static ray cannot name: a loose part
 * (owned by the manipulation layer) or a range target (owned by the level). The caller
 * resolves ids to world boxes; this system only tests and reports.
 */
export interface HitVolume {
  readonly id: string;
  readonly kind: 'part' | 'target';
  readonly min: Vec3;
  readonly max: Vec3;
}

export interface WeaponStepInput {
  /** Left mouse button pressed this step (an edge: what a semi-auto weapon fires on). */
  readonly firePressed: boolean;
  /** Left mouse button held this step (what an automatic weapon cycles on). */
  readonly fireHeld: boolean;
  /** Right mouse button held: aim down sights. */
  readonly ads: boolean;
  /** `R` edge. */
  readonly reload: boolean;
  /** `B` edge: cycle the current weapon's fire mode. */
  readonly fireModeNext: boolean;
  /** `Q` edge: move to the next slot. */
  readonly switchNext: boolean;
  /** Digit key this step as a 0-based slot, or null. */
  readonly slot: number | null;
  /** Stance facts (the player controller's own state, read-only here). */
  readonly crouched: boolean;
  /** True while the player is supported; an airborne shot blooms like a moving one. */
  readonly grounded: boolean;
  /** Horizontal speed, m/s. */
  readonly speed: number;
  /** The player's walk speed, so "moving" is a fraction rather than a raw number. */
  readonly walkSpeed: number;
  /** World point bullets leave from (the composition resolves it from the drawn weapon). */
  readonly muzzle: Vec3;
  /** Normalised aim direction the composition already converged on the reticle. */
  readonly aimDirection: Vec3;
  /** Part/target boxes a bullet may strike (see the file header). */
  readonly hitVolumes: ReadonlyArray<HitVolume>;
}

/** One trigger pull: the round the player asked for, and where it went. */
export interface WeaponShot {
  readonly weaponId: string;
  readonly weaponClass: WeaponClass;
  /** 1-based index within the current spray (resets when the trigger is released). */
  readonly index: number;
  readonly origin: Vec3;
  readonly direction: Vec3;
  /** Cone radius this round was fired with, radians. */
  readonly spread: number;
}

export interface WeaponImpact {
  readonly weaponId: string;
  readonly weaponClass: WeaponClass;
  /** Where the bullet came from — enough for the L4 tracer to draw its own segment. */
  readonly origin: Vec3;
  readonly point: Vec3;
  readonly normal: Vec3;
  /** The volume struck, or null for static world geometry. */
  readonly hitId: string | null;
  readonly hitKind: 'world' | 'part' | 'target';
  readonly distance: number;
}

/** The HUD/renderer read model. Read-only semantics: consumers must treat it as frozen. */
export interface WeaponView {
  readonly weaponId: string;
  readonly name: string;
  readonly weaponClass: WeaponClass;
  readonly classLabel: string;
  readonly activeSlot: number;
  readonly slotCount: number;
  readonly slotNames: ReadonlyArray<string>;
  readonly magazine: number;
  readonly magazineSize: number;
  readonly reserve: number;
  readonly fireMode: FireMode;
  readonly fireModeLabel: string;
  readonly canCycleFireMode: boolean;
  readonly reloading: boolean;
  /** 0…1 while reloading, 0 otherwise. */
  readonly reloadProgress: number;
  readonly swapping: boolean;
  readonly adsBlend: number;
  /** Field-of-view multiplier at full aim — the camera rig reads it (it owns the lens). */
  readonly adsFovScale: number;
  /** Current cone radius in radians — what the crosshair's gap is drawn from. */
  readonly spread: number;
  /** False while the weapon cannot fire (empty, reloading, or still coming up). */
  readonly canFire: boolean;
  /** Locomotion multiplier the player step applies (ADS slows the walk). */
  readonly moveScale: number;
  readonly liveBullets: number;
}

export interface WeaponStepResult {
  readonly shots: ReadonlyArray<WeaponShot>;
  readonly impacts: ReadonlyArray<WeaponImpact>;
  readonly reloadStarted: boolean;
  readonly reloadFinished: boolean;
  readonly switchedTo: number | null;
  readonly fireModeChanged: FireMode | null;
  /** A trigger pull that could not fire, and why (the honest answer to a dead trigger). */
  readonly refused: 'empty' | 'reloading' | 'swapping' | 'cooldown' | null;
  /**
   * One-step camera impulse, radians. The rig owns the accumulator and the recovery
   * (ARCH §12.1), so this is a request, not a pose write.
   */
  readonly recoilKick: { readonly pitch: number; readonly yaw: number };
  readonly view: WeaponView;
}

export interface WeaponStats {
  readonly shotsFired: number;
  readonly roundsSpent: number;
  readonly reloads: number;
  readonly switches: number;
  readonly impacts: number;
  readonly liveBullets: number;
  /** Highest simultaneous live bullets seen — the pool's real high-water mark. */
  readonly poolPeak: number;
  /** Bullets the pool refused to spawn because it was full (must stay 0 in practice). */
  readonly poolDrops: number;
}

export interface WeaponTuning {
  /** Fixed pool capacity. A shotgun's 8 pellets fit several times over. */
  readonly poolSize: number;
  /** Rate (1/s) the aiming stance blends in and out. */
  readonly adsBlendRate: number;
  /** Bloom added by a *crouched* shot vs a standing one (multiplier). */
  readonly crouchBloomScale: number;
}

export const DEFAULT_WEAPON_TUNING: WeaponTuning = {
  poolSize: 96,
  adsBlendRate: 9,
  crouchBloomScale: 0.6
};

interface SlotState {
  readonly definition: WeaponDefinition;
  magazine: number;
  reserve: number;
}

interface Bullet {
  active: boolean;
  readonly position: Vec3;
  readonly velocity: Vec3;
  /** Origin kept per bullet so an impact can draw its own tracer. */
  readonly origin: Vec3;
  travelled: number;
  weaponId: string;
  weaponClass: WeaponClass;
}

/** A read model mutated in place; the public surface is the readonly `WeaponView`. */
interface MutableView {
  weaponId: string;
  name: string;
  weaponClass: WeaponClass;
  classLabel: string;
  activeSlot: number;
  slotCount: number;
  slotNames: ReadonlyArray<string>;
  magazine: number;
  magazineSize: number;
  reserve: number;
  fireMode: FireMode;
  fireModeLabel: string;
  canCycleFireMode: boolean;
  reloading: boolean;
  reloadProgress: number;
  swapping: boolean;
  adsBlend: number;
  adsFovScale: number;
  spread: number;
  canFire: boolean;
  moveScale: number;
  liveBullets: number;
}

/** A box entry test's answer: distance along the segment, plus the face that was crossed. */
export interface BoxEntry {
  readonly distance: number;
  readonly axis: 'x' | 'y' | 'z';
  /** +1 when the face points along the axis, −1 against it. */
  readonly sign: number;
}

const EMPTY_SHOTS: ReadonlyArray<WeaponShot> = [];
const EMPTY_IMPACTS: ReadonlyArray<WeaponImpact> = [];
const ORIGIN_FALLBACK = vec3();

export class WeaponSystem {
  private readonly physics: PhysicsPort;
  private readonly tuning: WeaponTuning;
  private readonly slots: SlotState[];
  private readonly bullets: Bullet[];
  private readonly slotNames: ReadonlyArray<string>;
  private readonly view: MutableView;

  private activeSlot = 0;
  private fireModeIndex = 0;
  /** Counts down between rounds; ≤ 0 means the weapon may fire. */
  private fireCooldown = 0;
  private swapTimer = 0;
  private reloadTimer = 0;
  private reloadDuration = 0;
  private reloading = false;
  /** Rounds still owed to a burst the player has already asked for. */
  private burstRemaining = 0;
  private adsBlend = 0;
  /** Extra cone above the weapon's base, grown per shot and bled off over time. */
  private bloom = 0;
  /** Index into the recoil pattern *and* the spread walk: one spray, one walk. */
  private patternIndex = 0;
  private triggerHeldLastStep = false;
  /** This step's stance-scaled recoil, written by `fireShot` and read by `step`. */
  private kickPitch = 0;
  private kickYaw = 0;

  // Scratch (no per-step allocation in the hot path).
  private readonly scratchRight = vec3();
  private readonly scratchUp = vec3(0, 1, 0);
  private readonly scratchForward = vec3();
  private readonly scratchSegment = vec3();
  /** The same sweep as a unit vector, so the box test's distances come back in metres. */
  private readonly scratchUnitSegment = vec3();
  private readonly scratchNormal = vec3();

  private shotsFired = 0;
  private roundsSpent = 0;
  private reloads = 0;
  private switches = 0;
  private impacts = 0;
  private poolPeak = 0;
  private poolDrops = 0;

  constructor(
    physics: PhysicsPort,
    definitions: ReadonlyArray<WeaponDefinition>,
    loadout: ReadonlyArray<string>,
    tuning: Partial<WeaponTuning> = {}
  ) {
    this.physics = physics;
    this.tuning = { ...DEFAULT_WEAPON_TUNING, ...tuning };

    this.slots = [];
    for (const id of loadout) {
      const definition =
        definitions.find((entry) => entry.id === id) ?? weaponDefinitionOf(id) ?? null;
      if (definition === null) {
        // A loadout naming a weapon the table does not hold is a content bug, not a crash:
        // the slot is skipped and the game keeps a working weapon list (R-9's shape).
        console.warn(`[weapons] loadout entry has no definition: ${id}`);
        continue;
      }
      this.slots.push({
        definition,
        magazine: definition.magazineSize,
        reserve: definition.reserveAmmo
      });
    }
    if (this.slots.length === 0) {
      throw new Error('WeaponSystem: the loadout resolved to no usable weapons');
    }

    this.bullets = [];
    for (let index = 0; index < this.tuning.poolSize; index += 1) {
      this.bullets.push({
        active: false,
        position: vec3(),
        velocity: vec3(),
        origin: vec3(),
        travelled: 0,
        weaponId: '',
        weaponClass: 'ar'
      });
    }

    this.slotNames = this.slots.map((entry) => entry.definition.name);
    const first = this.definition;
    this.view = {
      weaponId: first.id,
      name: first.name,
      weaponClass: first.class,
      classLabel: WEAPON_CLASS_LABEL[first.class],
      activeSlot: 0,
      slotCount: this.slots.length,
      slotNames: this.slotNames,
      magazine: this.slot().magazine,
      magazineSize: first.magazineSize,
      reserve: this.slot().reserve,
      fireMode: this.fireMode,
      fireModeLabel: FIRE_MODE_LABEL[this.fireMode],
      canCycleFireMode: first.fireModes.length > 1,
      reloading: false,
      reloadProgress: 0,
      swapping: false,
      adsBlend: 0,
      adsFovScale: first.adsFovScale,
      spread: first.spread.base,
      canFire: true,
      moveScale: 1,
      liveBullets: 0
    };
  }

  /** The slot currently held. */
  get definition(): WeaponDefinition {
    return this.slot().definition;
  }

  get activeSlotIndex(): number {
    return this.activeSlot;
  }

  /** True while a reload is running (the HUD's progress bar reads it). */
  get isReloading(): boolean {
    return this.reloading;
  }

  /** Live bullets in flight (the harness reads this to prove the pool stays bounded). */
  get liveBullets(): number {
    let count = 0;
    for (const bullet of this.bullets) if (bullet.active) count += 1;
    return count;
  }

  stats(): WeaponStats {
    return {
      shotsFired: this.shotsFired,
      roundsSpent: this.roundsSpent,
      reloads: this.reloads,
      switches: this.switches,
      impacts: this.impacts,
      liveBullets: this.liveBullets,
      poolPeak: this.poolPeak,
      poolDrops: this.poolDrops
    };
  }

  /** Current read model without stepping (the HUD/renderer read this between steps). */
  snapshot(): WeaponView {
    this.refreshView();
    return this.view;
  }

  /**
   * Select a slot directly (a digit key). Returns true when the slot exists *and* changed;
   * a switch costs `swapTime` before the weapon will fire, which is what makes swapping
   * during a fight a decision rather than a detail.
   */
  selectSlot(index: number): boolean {
    if (!Number.isInteger(index) || index < 0 || index >= this.slots.length) return false;
    if (index === this.activeSlot) return false;
    this.activeSlot = index;
    this.fireModeIndex = 0;
    this.swapTimer = this.definition.swapTime;
    this.cancelReload();
    this.burstRemaining = 0;
    this.bloom = 0;
    this.patternIndex = 0;
    this.fireCooldown = 0;
    this.switches += 1;
    return true;
  }

  /** Drop every runtime state that must not survive a respawn or a fresh load. */
  reset(): void {
    for (const bullet of this.bullets) bullet.active = false;
    this.swapTimer = 0;
    this.fireCooldown = 0;
    this.cancelReload();
    this.burstRemaining = 0;
    this.bloom = 0;
    this.patternIndex = 0;
    this.adsBlend = 0;
    this.triggerHeldLastStep = false;
    this.kickPitch = 0;
    this.kickYaw = 0;
    this.refreshView();
  }

  step(dt: number, input: WeaponStepInput): WeaponStepResult {
    const clampedDt = Number.isFinite(dt) && dt > 0 && dt <= 0.25 ? dt : 1 / 30;

    // ---- 1. Slot selection (the only thing that outranks the trigger) ----------------
    let switchedTo: number | null = null;
    if (input.slot !== null && this.selectSlot(input.slot)) switchedTo = this.activeSlot;
    if (input.switchNext && this.selectSlot((this.activeSlot + 1) % this.slots.length)) {
      switchedTo = this.activeSlot;
    }

    // ---- 2. Fire-mode cycle ----------------------------------------------------------
    let fireModeChanged: FireMode | null = null;
    if (input.fireModeNext && this.definition.fireModes.length > 1) {
      this.fireModeIndex = (this.fireModeIndex + 1) % this.definition.fireModes.length;
      this.burstRemaining = 0;
      fireModeChanged = this.fireMode;
    }

    // ---- 3. Aim stance ---------------------------------------------------------------
    const adsGoal = input.ads && !this.reloading ? 1 : 0;
    const adsBlendStep = 1 - Math.exp(-this.tuning.adsBlendRate * clampedDt);
    this.adsBlend += (adsGoal - this.adsBlend) * adsBlendStep;
    if (this.adsBlend < 1e-4) this.adsBlend = 0;

    // ---- 4. Timers -------------------------------------------------------------------
    if (this.swapTimer > 0) this.swapTimer = Math.max(0, this.swapTimer - clampedDt);
    if (this.fireCooldown > 0) this.fireCooldown = Math.max(0, this.fireCooldown - clampedDt);
    let reloadFinished = false;
    if (this.reloading) {
      this.reloadTimer -= clampedDt;
      if (this.reloadTimer <= 0) reloadFinished = this.finishReload();
    }

    // ---- 5. Reload request -----------------------------------------------------------
    let reloadStarted = false;
    if (input.reload && !this.reloading && this.swapTimer <= 0) {
      const slot = this.slot();
      if (slot.magazine < slot.definition.magazineSize && slot.reserve > 0) {
        reloadStarted = this.beginReload();
      }
    }

    // ---- 6. The trigger --------------------------------------------------------------
    // Intent first, then readiness: the order matters, because the answer to "nothing
    // happened" has to name the *reason* (`refused`), and an empty magazine is the one
    // refusal the player genuinely caused by pulling a trigger.
    const triggerActive = this.wantsToFire(input);
    if (triggerActive && !this.triggerHeldLastStep) {
      // A fresh pull starts the spray over: the first shot is precise and begins the
      // recoil pattern at its first entry, which is the discipline tap-firing rewards.
      this.patternIndex = 0;
    }
    this.triggerHeldLastStep = triggerActive || input.fireHeld || input.firePressed;

    this.kickPitch = 0;
    this.kickYaw = 0;
    const shots: WeaponShot[] = [];
    let refused: WeaponStepResult['refused'] = null;
    if (triggerActive) {
      if (this.swapTimer > 0) {
        refused = 'swapping';
        this.burstRemaining = 0;
      } else if (this.reloading) {
        refused = 'reloading';
        this.burstRemaining = 0;
      } else if (this.slot().magazine <= 0) {
        refused = 'empty';
        this.burstRemaining = 0;
      } else if (this.fireCooldown > 0) {
        refused = 'cooldown';
      } else {
        this.fireShot(input, shots);
        // One round per fixed step is the ceiling (1800 rpm at 30 Hz). Every authored
        // weapon is far below it, and this assignment keeps the cadence honest if one is
        // ever authored above it.
        this.fireCooldown = 60 / Math.max(this.definition.rpm, 1);
      }
    }

    // Bloom recovers only while the trigger is quiet, so sustained fire keeps its cost.
    if (shots.length === 0) {
      const recovery = this.definition.spread.recovery * clampedDt;
      if (this.bloom > 0) this.bloom = Math.max(0, this.bloom - recovery);
    }

    // ---- 7. Bullets ------------------------------------------------------------------
    const impacts: WeaponImpact[] = [];
    this.stepBullets(clampedDt, input.hitVolumes, impacts);

    // ---- 8. Report -------------------------------------------------------------------
    this.refreshView(input);
    return {
      shots: shots.length === 0 ? EMPTY_SHOTS : shots,
      impacts: impacts.length === 0 ? EMPTY_IMPACTS : impacts,
      reloadStarted,
      reloadFinished,
      switchedTo,
      fireModeChanged,
      refused,
      recoilKick: { pitch: this.kickPitch, yaw: this.kickYaw },
      view: this.view
    };
  }

  // ---------------------------------------------------------------------------------
  // Firing
  // ---------------------------------------------------------------------------------

  private get fireMode(): FireMode {
    const modes = this.definition.fireModes;
    return modes[this.fireModeIndex] ?? modes[0] ?? 'single';
  }

  /** Is the trigger asking for a round right now? (Intent only — readiness is checked next.) */
  private wantsToFire(input: WeaponStepInput): boolean {
    const mode = this.fireMode;
    if (mode === 'auto') return input.fireHeld || input.firePressed;
    if (mode === 'burst') {
      if (input.firePressed) {
        this.burstRemaining = Math.max(this.burstRemaining, this.definition.burstCount ?? 3);
      }
      return this.burstRemaining > 0;
    }
    return input.firePressed;
  }

  private fireShot(input: WeaponStepInput, out: WeaponShot[]): void {
    const definition = this.definition;
    const slot = this.slot();
    slot.magazine -= 1;
    this.shotsFired += 1;
    if (this.burstRemaining > 0) this.burstRemaining -= 1;

    const spread = this.currentSpread(input);
    const index = this.patternIndex + 1;

    // Aim basis: a small-angle tilt of the converged aim direction, so the cone is a real
    // cone in world space rather than a yaw/pitch pair that would skew near the poles.
    vec3Copy(this.scratchForward, input.aimDirection);
    vec3Normalize(this.scratchForward, this.scratchForward);
    vec3Cross(this.scratchRight, this.scratchUp, this.scratchForward);
    vec3Normalize(this.scratchRight, this.scratchRight);
    vec3Cross(this.scratchUp, this.scratchForward, this.scratchRight);
    vec3Normalize(this.scratchUp, this.scratchUp);

    const pellets = Math.max(1, Math.floor(definition.pellets));
    let centre: Vec3 = input.aimDirection;
    let rounds = 0;
    for (let pellet = 0; pellet < pellets; pellet += 1) {
      const walk = this.patternIndex + pellet;
      const entry = SPREAD_PATTERN[walk % SPREAD_PATTERN.length] ?? { x: 0, y: 0 };
      const offsetX = entry.x * spread;
      const offsetY = entry.y * spread;
      const direction = vec3(
        this.scratchForward.x + this.scratchRight.x * offsetX + this.scratchUp.x * offsetY,
        this.scratchForward.y + this.scratchRight.y * offsetX + this.scratchUp.y * offsetY,
        this.scratchForward.z + this.scratchRight.z * offsetX + this.scratchUp.z * offsetY
      );
      vec3Normalize(direction, direction);
      if (pellet === 0) centre = direction;
      if (this.spawnBullet(definition, input.muzzle, direction)) rounds += 1;
    }
    this.roundsSpent += rounds;

    // --- recoil: the pattern's next entry, scaled by stance ---------------------------
    const pattern = definition.recoilPattern;
    const step = pattern[this.patternIndex % Math.max(pattern.length, 1)] ?? { pitch: 0, yaw: 0 };
    const stanceScale =
      (1 + (definition.adsRecoilScale - 1) * this.adsBlend) *
      (input.crouched ? definition.crouchRecoilScale : 1);
    this.kickPitch = step.pitch * stanceScale;
    this.kickYaw = step.yaw * stanceScale;

    // --- bloom ------------------------------------------------------------------------
    const bloomScale = input.crouched ? this.tuning.crouchBloomScale : 1;
    const ceiling = Math.max(0, definition.spread.max - definition.spread.base);
    this.bloom = Math.min(ceiling, this.bloom + definition.spread.perShot * bloomScale);
    this.patternIndex += 1;

    out.push({
      weaponId: definition.id,
      weaponClass: definition.class,
      index,
      origin: { x: input.muzzle.x, y: input.muzzle.y, z: input.muzzle.z },
      direction: { x: centre.x, y: centre.y, z: centre.z },
      spread
    });
  }

  /** The cone radius right now: base + bloom + movement, scaled by stance. */
  private currentSpread(input: WeaponStepInput): number {
    const definition = this.definition;
    const movingRatio = Math.min(1, Math.max(0, input.speed / Math.max(input.walkSpeed, 0.01)));
    const airborne = input.grounded ? 0 : 1;
    const movement = definition.spread.move * Math.max(movingRatio, airborne * 0.8);
    const raw = definition.spread.base + this.bloom + movement;
    const adsScale = 1 + (definition.adsSpreadScale - 1) * this.adsBlend;
    const crouchScale = input.crouched ? definition.crouchSpreadScale : 1;
    return raw * adsScale * crouchScale;
  }

  // ---------------------------------------------------------------------------------
  // Ammo
  // ---------------------------------------------------------------------------------

  private beginReload(): boolean {
    const slot = this.slot();
    const empty = slot.magazine <= 0;
    this.reloading = true;
    this.reloadDuration = empty ? slot.definition.reloadEmptyTime : slot.definition.reloadTime;
    this.reloadTimer = this.reloadDuration;
    this.burstRemaining = 0;
    this.reloads += 1;
    return true;
  }

  private finishReload(): boolean {
    const slot = this.slot();
    this.reloading = false;
    this.reloadTimer = 0;
    this.reloadDuration = 0;
    const needed = slot.definition.magazineSize - slot.magazine;
    const taken = Math.min(needed, slot.reserve);
    slot.magazine += taken;
    slot.reserve -= taken;
    return true;
  }

  private cancelReload(): void {
    this.reloading = false;
    this.reloadTimer = 0;
    this.reloadDuration = 0;
  }

  // ---------------------------------------------------------------------------------
  // Projectiles
  // ---------------------------------------------------------------------------------

  private spawnBullet(definition: WeaponDefinition, origin: Vec3, direction: Vec3): boolean {
    for (const bullet of this.bullets) {
      if (bullet.active) continue;
      bullet.active = true;
      vec3Sanitize(bullet.origin, origin, ORIGIN_FALLBACK);
      vec3Copy(bullet.position, bullet.origin);
      bullet.velocity.x = direction.x * definition.bulletSpeed;
      bullet.velocity.y = direction.y * definition.bulletSpeed;
      bullet.velocity.z = direction.z * definition.bulletSpeed;
      bullet.travelled = 0;
      bullet.weaponId = definition.id;
      bullet.weaponClass = definition.class;
      const live = this.liveBullets;
      if (live > this.poolPeak) this.poolPeak = live;
      return true;
    }
    // The pool is a budget, not a hope: a full pool reports the drop instead of growing.
    this.poolDrops += 1;
    return false;
  }

  private stepBullets(
    dt: number,
    volumes: ReadonlyArray<HitVolume>,
    impacts: WeaponImpact[]
  ): void {
    for (const bullet of this.bullets) {
      if (!bullet.active) continue;

      const definition = weaponDefinitionOf(bullet.weaponId);
      const drop = definition?.bulletDrop ?? 9.8;
      const range = definition?.range ?? 90;

      bullet.velocity.y -= drop * dt;
      const segmentX = bullet.velocity.x * dt;
      const segmentY = bullet.velocity.y * dt;
      const segmentZ = bullet.velocity.z * dt;
      const segmentLength = Math.sqrt(
        segmentX * segmentX + segmentY * segmentY + segmentZ * segmentZ
      );
      if (segmentLength <= 1e-6) {
        bullet.active = false;
        continue;
      }
      vec3Set(this.scratchSegment, segmentX, segmentY, segmentZ);
      vec3Scale(this.scratchUnitSegment, this.scratchSegment, 1 / segmentLength);

      // 1. Static world.
      const worldHit = this.physics.castRay(bullet.position, this.scratchSegment, segmentLength);
      let bestDistance = worldHit === null ? segmentLength : worldHit.distance;
      let bestNormal: Vec3 | null = worldHit === null ? null : worldHit.normal;
      let bestVolume: HitVolume | null = null;

      // 2. Volumes: loose parts and range targets, which the static ray cannot name. The box
      //    test is parametric, so it is handed the *unit* sweep: its answers are then metres,
      //    the same units as the world hit above and the impact point below.
      for (const volume of volumes) {
        const hit = segmentBoxEntry(bullet.position, this.scratchUnitSegment, volume, bestDistance);
        if (hit === null) continue;
        bestDistance = hit.distance;
        bestVolume = volume;
        const sign = hit.sign;
        vec3Set(
          this.scratchNormal,
          hit.axis === 'x' ? sign : 0,
          hit.axis === 'y' ? sign : 0,
          hit.axis === 'z' ? sign : 0
        );
        bestNormal = this.scratchNormal;
      }

      if (bestNormal !== null) {
        impacts.push({
          weaponId: bullet.weaponId,
          weaponClass: bullet.weaponClass,
          origin: { x: bullet.origin.x, y: bullet.origin.y, z: bullet.origin.z },
          point: {
            x: bullet.position.x + (segmentX / segmentLength) * bestDistance,
            y: bullet.position.y + (segmentY / segmentLength) * bestDistance,
            z: bullet.position.z + (segmentZ / segmentLength) * bestDistance
          },
          normal: { x: bestNormal.x, y: bestNormal.y, z: bestNormal.z },
          hitId: bestVolume === null ? null : bestVolume.id,
          hitKind: bestVolume === null ? 'world' : bestVolume.kind,
          distance: bestDistance
        });
        this.impacts += 1;
        bullet.active = false;
        continue;
      }

      // 3. Still flying.
      bullet.position.x += segmentX;
      bullet.position.y += segmentY;
      bullet.position.z += segmentZ;
      bullet.travelled += segmentLength;
      if (bullet.travelled > range) bullet.active = false;
    }
  }

  // ---------------------------------------------------------------------------------
  // Read model
  // ---------------------------------------------------------------------------------

  private slot(): SlotState {
    return this.slots[this.activeSlot] ?? (this.slots[0] as SlotState);
  }

  private refreshView(input?: WeaponStepInput): void {
    const definition = this.definition;
    const slot = this.slot();
    this.view.weaponId = definition.id;
    this.view.name = definition.name;
    this.view.weaponClass = definition.class;
    this.view.classLabel = WEAPON_CLASS_LABEL[definition.class];
    this.view.activeSlot = this.activeSlot;
    this.view.slotCount = this.slots.length;
    this.view.slotNames = this.slotNames;
    this.view.magazine = slot.magazine;
    this.view.magazineSize = definition.magazineSize;
    this.view.reserve = slot.reserve;
    this.view.fireMode = this.fireMode;
    this.view.fireModeLabel = FIRE_MODE_LABEL[this.fireMode];
    this.view.canCycleFireMode = definition.fireModes.length > 1;
    this.view.reloading = this.reloading;
    this.view.reloadProgress =
      this.reloading && this.reloadDuration > 0
        ? Math.min(1, Math.max(0, 1 - this.reloadTimer / this.reloadDuration))
        : 0;
    this.view.swapping = this.swapTimer > 0;
    this.view.adsBlend = this.adsBlend;
    this.view.adsFovScale = definition.adsFovScale;
    // Between steps the last *stepped* cone is the honest one; the base cone is only the
    // pre-first-step answer, and even that is a real cone the first shot would use.
    this.view.spread = input === undefined ? this.view.spread : this.currentSpread(input);
    this.view.canFire = this.swapTimer <= 0 && !this.reloading && slot.magazine > 0;
    this.view.moveScale = 1 + (definition.adsMoveScale - 1) * this.adsBlend;
    this.view.liveBullets = this.liveBullets;
  }
}

/**
 * Slab test: where a segment enters an axis-aligned box, or null when it misses or enters
 * beyond `maxDistance`. A bullet that starts *inside* the box reports 0. Pure,
 * allocation-free, and the only collision code this system owns — the port's own queries
 * cannot see carryables (see the file header).
 *
 * Distances are measured in units of `segment`, so **pass a unit-length segment** to read
 * them as metres — which is what the caller does, because a castRay result and the impact
 * point are both metres (a 165 m/s bullet sweeps 5.5 m per step, so mixing the two units
 * would silently push every part hit to a fraction of where it happened).
 */
export function segmentBoxEntry(
  origin: Vec3,
  segment: Vec3,
  box: { readonly min: Vec3; readonly max: Vec3 },
  maxDistance: number
): BoxEntry | null {
  let enter = 0;
  let exit = maxDistance;
  let axis: 'x' | 'y' | 'z' = 'x';
  let sign = 1;

  for (const candidate of ['x', 'y', 'z'] as const) {
    const direction = segment[candidate];
    const start = origin[candidate];
    const low = box.min[candidate];
    const high = box.max[candidate];

    if (!Number.isFinite(direction) || Math.abs(direction) < 1e-9) {
      // Parallel to this slab: either always inside it or never.
      if (start < low || start > high) return null;
      continue;
    }

    const inverse = 1 / direction;
    let near = (low - start) * inverse;
    let far = (high - start) * inverse;
    let nearSign = -1;
    if (near > far) {
      const swap = near;
      near = far;
      far = swap;
      nearSign = 1;
    }
    if (far < exit) exit = far;
    if (near > enter) {
      enter = near;
      axis = candidate;
      sign = nearSign;
    }
    if (enter > exit) return null;
  }

  if (enter > maxDistance) return null;
  // Starting inside the box: there is no crossed face, so the answer takes the entry face
  // the slabs agree on (or a stable default) rather than inventing a normal.
  return { distance: Math.max(0, enter), axis, sign: enter === 0 ? 1 : sign };
}
