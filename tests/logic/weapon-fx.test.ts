import { describe, expect, it } from 'vitest';

import {
  DEFAULT_WEAPON_EFFECTS_TUNING,
  WeaponEffects
} from '../../src/presentation/weapon-fx.ts';
import type {
  WeaponImpact,
  WeaponShot,
  WeaponStepResult,
  WeaponView
} from '../../src/gameplay/weapon-system.ts';
import { RecordingRenderPort } from './support/recording-render-port.ts';

/**
 * TEST §9 — the L4 weapon presenter (weapons pass, 16/10/2026).
 *
 * It is engine-free by design, so its whole contract is provable headlessly: what a shot
 * draws, how long it stays, that the pools are a budget rather than a queue, and that a
 * steady frame hands the port nothing at all (the discipline the scanner overlay earned).
 *
 * The first test in this file is the one that found a real defect: `present` judged
 * "is there anything to draw" *before* rebuilding its lists, so it read the previous
 * frame's arrays, concluded "nothing", and never handed a freshly fired tracer over.
 * A picture that never leaves the presenter is indistinguishable from a broken weapon.
 */

const TUNING = {
  tracerSeconds: 0.1,
  impactSeconds: 0.3,
  flashSeconds: 0.06,
  missTracerDistance: 35,
  maxTracers: 3,
  maxImpacts: 2
};

function makeShot(overrides: Partial<WeaponShot> = {}): WeaponShot {
  return {
    weaponId: 'w-ar',
    weaponClass: 'ar',
    index: 1,
    origin: { x: 0, y: 1.5, z: 0 },
    direction: { x: 0, y: 0, z: -1 },
    spread: 0.01,
    ...overrides
  };
}

function makeImpact(overrides: Partial<WeaponImpact> = {}): WeaponImpact {
  return {
    weaponId: 'w-ar',
    weaponClass: 'ar',
    origin: { x: 0, y: 1.5, z: 0 },
    point: { x: 0, y: 1.5, z: -12 },
    normal: { x: 0, y: 0, z: 1 },
    hitId: null,
    hitKind: 'world',
    distance: 12,
    ...overrides
  };
}

function makeView(overrides: Partial<WeaponView> = {}): WeaponView {
  return {
    weaponId: 'w-ar',
    name: 'Rivet',
    weaponClass: 'ar',
    classLabel: 'Assault rifle',
    activeSlot: 0,
    slotCount: 3,
    slotNames: ['Rivet', 'Sledge', 'Longshot'],
    magazine: 29,
    magazineSize: 30,
    reserve: 120,
    fireMode: 'auto',
    fireModeLabel: 'AUTO',
    canCycleFireMode: true,
    reloading: false,
    reloadProgress: 0,
    swapping: false,
    adsBlend: 0,
    adsFovScale: 0.7,
    spread: 0.02,
    canFire: true,
    moveScale: 1,
    liveBullets: 1,
    ...overrides
  };
}

function makeResult(overrides: Partial<WeaponStepResult> = {}): WeaponStepResult {
  return {
    shots: [],
    impacts: [],
    reloadStarted: false,
    reloadFinished: false,
    switchedTo: null,
    fireModeChanged: null,
    refused: null,
    recoilKick: { pitch: 0, yaw: 0 },
    view: makeView(),
    ...overrides
  };
}

/** A fresh presenter already aimed from a drawn weapon, which is the live composition's state. */
function makeAimed(render: RecordingRenderPort): WeaponEffects {
  const effects = new WeaponEffects(render, TUNING);
  effects.aim({ x: 0, y: 1.5, z: 0 }, { x: 0, y: 0, z: -1 }, false);
  return effects;
}

describe('WeaponEffects — shot presentation is pooled, timed and visual only', () => {
  it('hands a freshly fired tracer to the port (the hand-off bug this suite pins)', () => {
    const render = new RecordingRenderPort();
    const effects = makeAimed(render);

    // The steady frame before the shot: nothing to draw, so the port is told "nothing".
    effects.present();
    expect(render.shotEffect).toBeNull();

    effects.step(1 / 30, makeResult({ shots: [makeShot()], impacts: [makeImpact()] }), makeView());
    effects.present();

    // A shot fired this step must be visible on this step's frame — not the next one.
    expect(render.shotEffect).not.toBeNull();
    expect(render.shotEffect?.tracers).toHaveLength(1);
    expect(render.shotEffect?.tracers[0]?.to).toEqual({ x: 0, y: 1.5, z: -12 });
    expect(render.shotEffect?.tracers[0]?.strength).toBeCloseTo(1, 6);
    expect(render.shotEffect?.impacts).toHaveLength(1);
    expect(render.shotEffect?.muzzleFlash).toBeCloseTo(1, 6);
  });

  it('draws a miss out to the weapon’s reach, and fades it to nothing', () => {
    const render = new RecordingRenderPort();
    const effects = makeAimed(render);

    effects.step(1 / 30, makeResult({ shots: [makeShot()] }), makeView());
    effects.present();
    // No impact to name: the streak ends at the presenter's own reach, along the shot.
    expect(render.shotEffect?.tracers[0]?.to).toEqual({ x: 0, y: 1.5, z: -TUNING.missTracerDistance });

    effects.step(TUNING.tracerSeconds / 2, makeResult(), makeView());
    effects.present();
    expect(render.shotEffect?.tracers[0]?.strength).toBeCloseTo(0.5, 6);

    // Past the authored lifetime every pool empties and the port is handed a clear.
    effects.step(TUNING.tracerSeconds + 0.01, makeResult(), makeView());
    effects.present();
    expect(render.shotEffect).toBeNull();
  });

  it('never exceeds the pool capacity, however much is fired', () => {
    const render = new RecordingRenderPort();
    const effects = makeAimed(render);

    for (let burst = 0; burst < 20; burst += 1) {
      const shots = [makeShot({ index: 1 }), makeShot({ index: 2 }), makeShot({ index: 3 })];
      const impacts = [makeImpact({ distance: burst }), makeImpact({ distance: burst + 1 })];
      effects.step(1 / 30, makeResult({ shots, impacts }), makeView());
      effects.present();
      // The newest round is always on screen, and the budget is never exceeded.
      expect(render.shotEffect?.tracers.length).toBeLessThanOrEqual(TUNING.maxTracers);
      expect(render.shotEffect?.impacts.length).toBeLessThanOrEqual(TUNING.maxImpacts);
    }
    expect(render.shotEffect?.tracers.length).toBe(TUNING.maxTracers);
    expect(render.shotEffect?.impacts.length).toBe(TUNING.maxImpacts);
  });

  it('writes nothing on a steady holstered frame, but a change is always handed over', () => {
    const render = new RecordingRenderPort();
    const effects = makeAimed(render);

    // A drawn weapon is handed over every frame (its muzzle follows the player), but an
    // empty tracer pool is *cleared* rather than sent as an empty object.
    effects.step(1 / 30, makeResult(), makeView());
    effects.present();
    expect(render.weaponView?.weaponId).toBe('w-ar');
    expect(render.shotEffect).toBeNull();

    // Bringing the sights up is a real change even with no shot in flight.
    effects.step(1 / 30, makeResult(), makeView({ adsBlend: 1 }));
    effects.present();
    expect(render.weaponView?.adsBlend).toBe(1);

    // Holstering it (a part in hand) clears the drawn weapon, and from there a steady
    // frame costs the port nothing at all.
    effects.aim({ x: 0, y: 1.5, z: 0 }, { x: 0, y: 0, z: -1 }, true);
    effects.present();
    expect(render.weaponView).toBeNull();
    const writes = render.weaponViews.length;
    const effectWrites = render.shotEffects.length;
    effects.present();
    effects.present();
    expect(render.weaponViews.length).toBe(writes);
    expect(render.shotEffects.length).toBe(effectWrites);
  });

  it('hands over the muzzle the shot actually left from', () => {
    const render = new RecordingRenderPort();
    const effects = new WeaponEffects(render, TUNING);
    effects.aim({ x: -4.5, y: 1.42, z: 12 }, { x: 0, y: 0, z: 1 }, false);
    effects.present();
    expect(render.weaponView?.muzzle).toEqual({ x: -4.5, y: 1.42, z: 12 });
    expect(render.weaponView?.aimDirection).toEqual({ x: 0, y: 0, z: 1 });
  });
  it('treats a malformed frame delta as one fixed step', () => {
    const render = new RecordingRenderPort();
    const effects = makeAimed(render);
    effects.step(1 / 30, makeResult({ shots: [makeShot()] }), makeView());
    effects.present();

    effects.step(Number.NaN, makeResult(), makeView());
    effects.step(-1, makeResult(), makeView());
    effects.present();
    // The tracer aged by at least one frame rather than being frozen (or living forever).
    expect(render.shotEffect?.tracers[0]?.strength).toBeGreaterThan(0);
    expect(render.shotEffect?.tracers[0]?.strength).toBeLessThan(1);
  });

  it('clears everything on reset, even if the port was last handed a picture', () => {
    const render = new RecordingRenderPort();
    const effects = makeAimed(render);
    effects.step(1 / 30, makeResult({ shots: [makeShot()], impacts: [makeImpact()] }), makeView());
    effects.present();
    expect(render.shotEffect).not.toBeNull();

    effects.reset();
    effects.present();
    expect(render.shotEffect).toBeNull();
  });

  it('ships a pool budget and lifetimes that a shoot-out cannot outgrow', () => {
    expect(DEFAULT_WEAPON_EFFECTS_TUNING.maxTracers).toBeGreaterThanOrEqual(16);
    expect(DEFAULT_WEAPON_EFFECTS_TUNING.maxImpacts).toBeGreaterThanOrEqual(8);
    expect(DEFAULT_WEAPON_EFFECTS_TUNING.tracerSeconds).toBeGreaterThan(0);
    expect(DEFAULT_WEAPON_EFFECTS_TUNING.flashSeconds).toBeGreaterThan(0);
    // A tracer must not outlive a burst's afterimage, or the screen fills with streaks.
    expect(DEFAULT_WEAPON_EFFECTS_TUNING.tracerSeconds).toBeLessThanOrEqual(0.25);
  });
});
