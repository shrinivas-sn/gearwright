/**
 * L4 — the weapons presenter (ARCH §32.1's "who decides what / who decides how" split, §40
 * `presentation/`).
 *
 * `WeaponSystem` decides *what happened*: a round left the muzzle, a bullet stopped on a
 * wall. This file decides *how long that stays on screen*: tracers, the muzzle flash and the
 * impacts are pooled, aged here, and handed to the render port once per frame. Nothing in
 * this file is read back into logic, and nothing here can attach, detach, validate or
 * complete anything (§5.1 non-negotiable 1) — the presenter's only output is a picture.
 *
 * Two disciplines, both borrowed from the pulse clock and the scanner overlay because they
 * are what keep a shoot-out from costing frames:
 *
 *   1. **Fixed pools, fixed capacity.** A tracer and an impact have an authored lifetime; a
 *      pool that fills drops its oldest entry instead of growing. So "fire forever" costs the
 *      same as "fire once", which is exactly what the plan's budget rule demands and what the
 *      `guns` harness scenario asserts.
 *   2. **Nothing is allocated per step or per frame.** The pools hold pre-built state objects
 *      and the arrays handed to the port are the pools themselves, truncated by `length`.
 *
 * The presenter runs in two halves, like the composer: `step` on the fixed step (so the
 * lifetimes are deterministic and replayable) and `present` once per rendered frame (so the
 * drawn frame matches the interpolation the rest of the frame is using).
 */

import type {
  ImpactRenderState,
  RenderPort,
  ShotEffectsRenderState,
  TracerRenderState,
  WeaponRenderState
} from '../ports/render-port.ts';
import type { Vec3 } from '../core/vec3.ts';
import type { WeaponStepResult, WeaponView } from '../gameplay/weapon-system.ts';

/** Presentation tuning. Feel, not content: recorded with the other tuning numbers. */
export interface WeaponEffectsTuning {
  /** Seconds a tracer is drawn for. */
  readonly tracerSeconds: number;
  /** Seconds an impact pulse is drawn for. */
  readonly impactSeconds: number;
  /** Seconds the muzzle flash is drawn for. */
  readonly flashSeconds: number;
  /** Metres a tracer from a shot that hit nothing is drawn out to. */
  readonly missTracerDistance: number;
  readonly maxTracers: number;
  readonly maxImpacts: number;
}

export const DEFAULT_WEAPON_EFFECTS_TUNING: WeaponEffectsTuning = {
  // A tracer is a gesture, not a projectile: at 30 Hz three steps is a visible streak.
  tracerSeconds: 0.1,
  impactSeconds: 0.3,
  flashSeconds: 0.06,
  missTracerDistance: 35,
  maxTracers: 24,
  maxImpacts: 16
};

interface TracerEntry {
  readonly from: Vec3;
  readonly to: Vec3;
  readonly view: TracerRenderState & { from: Vec3; to: Vec3 };
  remaining: number;
}

interface ImpactEntry {
  readonly view: ImpactRenderState & { point: Vec3; normal: Vec3 };
  remaining: number;
}

export class WeaponEffects {
  private readonly port: RenderPort;
  private readonly tuning: WeaponEffectsTuning;
  private readonly tracers: TracerEntry[] = [];
  private readonly impacts: ImpactEntry[] = [];
  private readonly tracerList: TracerRenderState[] = [];
  private readonly impactList: ImpactRenderState[] = [];
  private readonly shotEffects: ShotEffectsRenderState & {
    tracers: TracerRenderState[];
    impacts: ImpactRenderState[];
    flashPoint: Vec3;
  };
  private readonly weaponView: WeaponRenderState & { muzzle: Vec3; aimDirection: Vec3 };
  private flashRemaining = 0;
  /** Last hand-off, so a steady frame writes nothing (the scanner's own discipline). */
  private lastWasEmpty: boolean | null = null;

  constructor(port: RenderPort, tuning: WeaponEffectsTuning = DEFAULT_WEAPON_EFFECTS_TUNING) {
    this.port = port;
    this.tuning = { ...DEFAULT_WEAPON_EFFECTS_TUNING, ...tuning };

    for (let index = 0; index < this.tuning.maxTracers; index += 1) {
      const from = { x: 0, y: 0, z: 0 };
      const to = { x: 0, y: 0, z: 0 };
      this.tracers.push({ from, to, view: { from, to, strength: 0 }, remaining: 0 });
    }
    for (let index = 0; index < this.tuning.maxImpacts; index += 1) {
      const point = { x: 0, y: 0, z: 0 };
      const normal = { x: 0, y: 0, z: 0 };
      this.impacts.push({ view: { point, normal, strength: 0 }, remaining: 0 });
    }

    this.shotEffects = {
      tracers: this.tracerList,
      impacts: this.impactList,
      muzzleFlash: 0,
      flashPoint: { x: 0, y: 0, z: 0 }
    };
    this.weaponView = {
      weaponId: '',
      weaponClass: '',
      adsBlend: 0,
      holstered: true,
      muzzle: { x: 0, y: 0, z: 0 },
      aimDirection: { x: 0, y: 0, z: -1 }
    };
  }

  /**
   * One fixed step: age the pools, then take this step's shots and impacts. A drawn tracer
   * ends where the bullet actually stopped when there is an impact to name (so the streak
   * agrees with the mark it left), and at the weapon's own reach when it hit nothing.
   */
  step(dt: number, result: WeaponStepResult | null, view: WeaponView | null): void {
    const clampedDt = Number.isFinite(dt) && dt > 0 && dt <= 0.25 ? dt : 1 / 30;

    this.age(clampedDt);

    if (result !== null && view !== null) {
      const impacts = result.impacts;
      for (let index = 0; index < result.shots.length; index += 1) {
        const shot = result.shots[index];
        if (shot === undefined) continue;
        const impact = impacts[index] ?? null;
        const end =
          impact === null
            ? {
                x: shot.origin.x + shot.direction.x * this.tuning.missTracerDistance,
                y: shot.origin.y + shot.direction.y * this.tuning.missTracerDistance,
                z: shot.origin.z + shot.direction.z * this.tuning.missTracerDistance
              }
            : impact.point;
        this.addTracer(shot.origin, end);
      }
      for (const impact of impacts) {
        this.addImpact(impact.point, impact.normal);
      }
      if (result.shots.length > 0) {
        this.flashRemaining = this.tuning.flashSeconds;
        this.shotEffects.flashPoint.x = result.shots[0]?.origin.x ?? 0;
        this.shotEffects.flashPoint.y = result.shots[0]?.origin.y ?? 0;
        this.shotEffects.flashPoint.z = result.shots[0]?.origin.z ?? 0;
      }
    }

    this.weaponView.weaponId = view?.weaponId ?? '';
    this.weaponView.weaponClass = view?.weaponClass ?? '';
    this.weaponView.adsBlend = view?.adsBlend ?? 0;
    this.weaponView.holstered = view === null;
  }

  /** Where the drawn weapon is, and where it points. Called with the mount the sim fired from. */
  aim(muzzle: Vec3, aimDirection: Vec3, holstered: boolean): void {
    this.weaponView.muzzle.x = muzzle.x;
    this.weaponView.muzzle.y = muzzle.y;
    this.weaponView.muzzle.z = muzzle.z;
    this.weaponView.aimDirection.x = aimDirection.x;
    this.weaponView.aimDirection.y = aimDirection.y;
    this.weaponView.aimDirection.z = aimDirection.z;
    this.weaponView.holstered = holstered;
  }

  /** Once per rendered frame: hand the port this frame's picture, or clear it once. */
  present(): void {
    const empty =
      this.tracerList.length === 0 &&
      this.impactList.length === 0 &&
      this.shotEffects.muzzleFlash <= 0;

    this.tracerList.length = 0;
    for (const tracer of this.tracers) {
      if (tracer.remaining <= 0) continue;
      tracer.view.strength = tracer.remaining / this.tuning.tracerSeconds;
      this.tracerList.push(tracer.view);
    }
    this.impactList.length = 0;
    for (const impact of this.impacts) {
      if (impact.remaining <= 0) continue;
      impact.view.strength = impact.remaining / this.tuning.impactSeconds;
      this.impactList.push(impact.view);
    }
    this.shotEffects.muzzleFlash =
      this.flashRemaining > 0 ? this.flashRemaining / this.tuning.flashSeconds : 0;

    if (this.lastWasEmpty === true && empty) return;
    this.lastWasEmpty = empty;
    this.port.setShotEffects?.(empty ? null : this.shotEffects);
    this.port.setWeaponView?.(this.weaponView.holstered ? null : this.weaponView);
  }

  /** Drop everything: a respawn or a fresh level must not draw the last fight's tracers. */
  reset(): void {
    for (const tracer of this.tracers) tracer.remaining = 0;
    for (const impact of this.impacts) impact.remaining = 0;
    this.flashRemaining = 0;
    this.lastWasEmpty = null;
  }

  private age(dt: number): void {
    for (const tracer of this.tracers) {
      if (tracer.remaining > 0) tracer.remaining = Math.max(0, tracer.remaining - dt);
    }
    for (const impact of this.impacts) {
      if (impact.remaining > 0) impact.remaining = Math.max(0, impact.remaining - dt);
    }
    if (this.flashRemaining > 0) this.flashRemaining = Math.max(0, this.flashRemaining - dt);
  }

  /** Oldest-wins-the-slot: the pool is a budget, so a full pool replaces, never grows. */
  private addTracer(from: Vec3, to: Vec3): void {
    let slot = this.tracers.find((tracer) => tracer.remaining <= 0) ?? null;
    if (slot === null) {
      slot = this.tracers.reduce(
        (oldest, tracer) => (tracer.remaining < oldest.remaining ? tracer : oldest),
        this.tracers[0] as TracerEntry
      );
    }
    slot.remaining = this.tuning.tracerSeconds;
    slot.from.x = from.x;
    slot.from.y = from.y;
    slot.from.z = from.z;
    slot.to.x = to.x;
    slot.to.y = to.y;
    slot.to.z = to.z;
  }

  private addImpact(point: Vec3, normal: Vec3): void {
    let slot = this.impacts.find((impact) => impact.remaining <= 0) ?? null;
    if (slot === null) {
      slot = this.impacts.reduce(
        (oldest, impact) => (impact.remaining < oldest.remaining ? impact : oldest),
        this.impacts[0] as ImpactEntry
      );
    }
    slot.remaining = this.tuning.impactSeconds;
    slot.view.point.x = point.x;
    slot.view.point.y = point.y;
    slot.view.point.z = point.z;
    slot.view.normal.x = normal.x;
    slot.view.normal.y = normal.y;
    slot.view.normal.z = normal.z;
  }
}
