import { describe, expect, it, vi } from 'vitest';

import { vec3, vec3Length, type Vec3 } from '../../src/core/vec3.ts';
import {
  WEAPON_DEFINITIONS,
  weaponDefinitionOf,
  type WeaponDefinition
} from '../../src/data/weapons.ts';
import {
  DEFAULT_WEAPON_TUNING,
  WeaponSystem,
  segmentBoxEntry,
  type HitVolume,
  type WeaponStepInput,
  type WeaponTuning
} from '../../src/gameplay/weapon-system.ts';
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
 * Bullets need a *world* hit to stop on, so the fake is a plane perpendicular to −Z at
 * `planeZ` (bullets leave `MUZZLE` aimed down −Z). Distances are metres along the swept
 * segment, matching the real port's contract: `direction` need not be normalized and
 * `maxDistance` is metres, so the weapon system's integration is exercised for real.
 */
class FakePhysics implements PhysicsPort {
  readonly kind = 'fake';
  /** World plane at this z, or null for open air. */
  planeZ: number | null = null;
  castCalls = 0;

  castRay(origin: Vec3, direction: Vec3, maxDistance: number): RayHit | null {
    this.castCalls += 1;
    if (this.planeZ === null) return null;
    const length = vec3Length(direction);
    if (!(length > 1e-9)) return null;
    // Unit direction, then metres to the plane.
    const unitZ = direction.z / length;
    if (Math.abs(unitZ) < 1e-9) return null;
    const distance = (this.planeZ - origin.z) / unitZ;
    if (!(distance >= 0) || distance > maxDistance) return null;
    return {
      distance,
      point: vec3(
        origin.x + (direction.x / length) * distance,
        origin.y + (direction.y / length) * distance,
        origin.z + (direction.z / length) * distance
      ),
      normal: vec3(0, 0, 1)
    };
  }

  castSphere(_origin: Vec3, _radius: number, _direction: Vec3, _maxDistance: number): RayHit | null {
    return null;
  }

  moveAndSlide(feet: Vec3, displacement: Vec3, _spec: CapsuleSpec, out: Vec3): MoveResult {
    out.x = feet.x + displacement.x;
    out.y = feet.y + displacement.y;
    out.z = feet.z + displacement.z;
    return { position: out, hitWall: false, hitHead: false, supported: true, groundY: out.y };
  }

  isPoseValid(_feet: Vec3, _spec: CapsuleSpec): boolean {
    return true;
  }

  setStaticColliders(_colliders: ReadonlyArray<StaticCollider>): void {}

  setCarryableColliders(_colliders: ReadonlyArray<StaticCollider>): void {}

  setInteractableVolumes(_volumes: ReadonlyArray<InteractableVolume>): void {}

  setSocketVolumes(_volumes: ReadonlyArray<SocketVolume>): void {}

  overlapSocketVolumes(_min: Vec3, _max: Vec3): ReadonlyArray<string> {
    return [];
  }

  queryInteractionRay(
    _origin: Vec3,
    _direction: Vec3,
    _maxDistance: number
  ): ReadonlyArray<InteractionHit> {
    return [];
  }

  isBoxBlocked(_min: Vec3, _max: Vec3): boolean {
    return false;
  }

  dispose(): void {}
}

const DT = 1 / 30;
/** Every bullet in this suite leaves here, aimed down −Z. */
const MUZZLE = vec3(0, 1.2, 0);
const AHEAD = vec3(0, 0, -1);

function definitionOf(id: string): WeaponDefinition {
  const definition = weaponDefinitionOf(id);
  if (definition === null) throw new Error(`test needs a definition for ${id}`);
  return definition;
}

const AR = definitionOf('weapon/ar-vanguard');
const DMR = definitionOf('weapon/dmr-longline');
const SHOTGUN = definitionOf('weapon/shotgun-yardboss');

function input(overrides: Partial<WeaponStepInput> = {}): WeaponStepInput {
  return {
    firePressed: false,
    fireHeld: false,
    ads: false,
    reload: false,
    fireModeNext: false,
    switchNext: false,
    slot: null,
    crouched: false,
    grounded: true,
    speed: 0,
    walkSpeed: 3.6,
    muzzle: MUZZLE,
    aimDirection: AHEAD,
    hitVolumes: [],
    ...overrides
  };
}

function makeSystem(options: {
  loadout?: ReadonlyArray<string>;
  tuning?: Partial<WeaponTuning>;
  physics?: FakePhysics;
} = {}): { system: WeaponSystem; physics: FakePhysics } {
  const physics = options.physics ?? new FakePhysics();
  const system = new WeaponSystem(
    physics,
    WEAPON_DEFINITIONS,
    options.loadout ?? ['weapon/ar-vanguard'],
    options.tuning
  );
  return { system, physics };
}

/** Steps the system and returns the per-step results, in order. */
function run(
  system: WeaponSystem,
  steps: number,
  overrides: Partial<WeaponStepInput> = {}
): ReturnType<WeaponSystem['step']>[] {
  const results: ReturnType<WeaponSystem['step']>[] = [];
  for (let index = 0; index < steps; index += 1) {
    results.push(system.step(DT, input(overrides)));
  }
  return results;
}

const shotCount = (results: ReadonlyArray<ReturnType<WeaponSystem['step']>>): number =>
  results.reduce((total, result) => total + result.shots.length, 0);

describe('segmentBoxEntry — the pure segment/box test', () => {
  const box = { min: vec3(-1, -1, -3), max: vec3(1, 1, -2) };

  it('reports the entry distance along a unit segment', () => {
    const hit = segmentBoxEntry(vec3(0, 0, 0), vec3(0, 0, -1), box, 10);
    expect(hit?.distance).toBeCloseTo(2, 6);
    expect(hit?.axis).toBe('z');
    // The bullet crosses the box's z = −2 face, whose outward normal is +Z.
    expect(hit?.sign).toBe(1);
  });

  it('returns null for a segment that misses the box', () => {
    expect(segmentBoxEntry(vec3(5, 0, 0), vec3(0, 0, -1), box, 10)).toBeNull();
  });

  it('returns null when the entry lies beyond maxDistance', () => {
    expect(segmentBoxEntry(vec3(0, 0, 0), vec3(0, 0, -1), box, 1.5)).toBeNull();
  });

  it('reports distance 0 for an origin already inside the box', () => {
    const hit = segmentBoxEntry(vec3(0, 0, -2.5), vec3(0, 0, -1), box, 10);
    expect(hit?.distance).toBe(0);
  });
});

describe('WeaponSystem — construction', () => {
  it('opens on the first loadout slot with a full magazine', () => {
    const { system } = makeSystem({ loadout: ['weapon/ar-vanguard', 'weapon/dmr-longline'] });
    const view = system.snapshot();
    expect(view.weaponId).toBe(AR.id);
    expect(view.activeSlot).toBe(0);
    expect(view.slotCount).toBe(2);
    expect(view.magazine).toBe(AR.magazineSize);
    expect(view.reserve).toBe(AR.reserveAmmo);
    expect(view.classLabel).toBe('Assault rifle');
    expect(view.canFire).toBe(true);
  });

  it('skips a loadout entry the table does not hold, and warns', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { system } = makeSystem({ loadout: ['weapon/nope', 'weapon/ar-vanguard'] });
      expect(system.snapshot().slotCount).toBe(1);
      expect(system.snapshot().weaponId).toBe(AR.id);
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('throws when the loadout resolves to nothing usable', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(() => makeSystem({ loadout: ['weapon/nope'] })).toThrow(/no usable weapons/);
    } finally {
      warn.mockRestore();
    }
  });
});

describe('WeaponSystem — fire control and cadence', () => {
  it('gates full auto at the authored rpm rather than the step rate', () => {
    const { system } = makeSystem();
    // 630 rpm → 0.0952 s between rounds; at 1/30 s steps that is one round every 3rd step.
    const results = run(system, 10, { fireHeld: true });
    expect(shotCount(results)).toBe(4);
    expect(shotCount(results)).toBeLessThan(10);
    // The steps in between are honest about why nothing happened.
    expect(results[1]?.refused).toBe('cooldown');
    expect(results[1]?.shots).toHaveLength(0);
  });

  it('fires a semi-auto weapon once per press and never on a hold', () => {
    const { system } = makeSystem({ loadout: ['weapon/dmr-longline'] });
    const first = system.step(DT, input({ firePressed: true }));
    expect(first.shots).toHaveLength(1);

    const held = run(system, 12, { fireHeld: true });
    expect(shotCount(held)).toBe(0);

    const second = system.step(DT, input({ firePressed: true }));
    expect(second.shots).toHaveLength(1);
  });

  it('fires exactly a burst and stops, even with the trigger held', () => {
    const burst: WeaponDefinition = {
      ...AR,
      id: 'test/burst',
      name: 'Test Burst',
      fireModes: ['burst'],
      burstCount: 3,
      rpm: 600
    };
    const physics = new FakePhysics();
    const system = new WeaponSystem(physics, [burst, ...WEAPON_DEFINITIONS], ['test/burst']);
    // One press starts the burst; the held trigger must not start another.
    const start = system.step(DT, input({ firePressed: true, fireHeld: true }));
    const held = run(system, 20, { fireHeld: true });
    expect(shotCount([start, ...held])).toBe(3);
  });

  it('cycles fire modes on B and reports the change', () => {
    const { system } = makeSystem();
    expect(system.snapshot().fireMode).toBe('auto');

    const toSingle = system.step(DT, input({ fireModeNext: true }));
    expect(toSingle.fireModeChanged).toBe('single');
    expect(toSingle.view.fireModeLabel).toBe('SINGLE');

    const backToAuto = run(system, 1, {});
    expect(backToAuto[0]?.fireModeChanged).toBeNull();
    expect(system.step(DT, input({ fireModeNext: true })).fireModeChanged).toBe('auto');
  });

  it('will not cycle the mode of a single-mode weapon', () => {
    const { system } = makeSystem({ loadout: ['weapon/dmr-longline'] });
    const result = system.step(DT, input({ fireModeNext: true }));
    expect(result.fireModeChanged).toBeNull();
    expect(result.view.canCycleFireMode).toBe(false);
  });
});

describe('WeaponSystem — ammo', () => {
  it('refuses an empty trigger and says why', () => {
    const { system } = makeSystem();
    // 30 rounds on full auto, one every 3 steps.
    const results = run(system, 30 * 3, { fireHeld: true });
    expect(shotCount(results)).toBe(AR.magazineSize);
    const after = system.step(DT, input({ fireHeld: true }));
    expect(after.shots).toHaveLength(0);
    expect(after.refused).toBe('empty');
    expect(after.view.canFire).toBe(false);
  });

  it('reloads from reserve over the tactical duration when a round is chambered', () => {
    const { system } = makeSystem();
    system.step(DT, input({ firePressed: true }));
    const start = system.step(DT, input({ reload: true }));
    expect(start.reloadStarted).toBe(true);
    expect(start.view.reloading).toBe(true);

    const steps = Math.ceil(AR.reloadTime / DT);
    const finished = run(system, steps);
    expect(finished[steps - 1]?.reloadFinished).toBe(true);
    expect(system.snapshot().magazine).toBe(AR.magazineSize);
    // One round was fired before the reload, so exactly one came out of the reserve.
    expect(system.snapshot().reserve).toBe(AR.reserveAmmo - 1);
  });

  it('takes the longer, empty reload when the magazine is dry', () => {
    const { system } = makeSystem();
    run(system, 30 * 3, { fireHeld: true });
    expect(system.snapshot().magazine).toBe(0);

    const started = system.step(DT, input({ reload: true }));
    expect(started.reloadStarted).toBe(true);

    // Count the steps to completion: a dry reload must outlast the tactical duration.
    const ceiling = Math.ceil(AR.reloadEmptyTime / DT) + 5;
    let steps = 0;
    let finished = false;
    while (!finished && steps < ceiling) {
      finished = run(system, 1)[0]?.reloadFinished ?? false;
      steps += 1;
    }
    expect(finished).toBe(true);
    expect(steps).toBeGreaterThan(AR.reloadTime / DT);
    expect(steps).toBeLessThanOrEqual(AR.reloadEmptyTime / DT + 1);
    expect(system.snapshot().magazine).toBe(AR.magazineSize);
    expect(system.snapshot().reserve).toBe(AR.reserveAmmo - AR.magazineSize);
  });

  it('cancels a reload when the player switches weapon', () => {
    const { system } = makeSystem({ loadout: ['weapon/ar-vanguard', 'weapon/dmr-longline'] });
    system.step(DT, input({ firePressed: true }));
    system.step(DT, input({ reload: true }));
    expect(system.snapshot().reloading).toBe(true);

    const switched = system.step(DT, input({ slot: 1 }));
    expect(switched.switchedTo).toBe(1);
    expect(switched.view.reloading).toBe(false);

    // Back to the rifle: the cancelled reload never topped the magazine up.
    run(system, Math.ceil(DMR.swapTime / DT) + 1, {});
    const back = system.step(DT, input({ slot: 0 }));
    expect(back.view.reloading).toBe(false);
    run(system, Math.ceil(AR.swapTime / DT) + 1, {});
    expect(system.snapshot().magazine).toBe(AR.magazineSize - 1);
  });

  it('refuses a reload it cannot pay for, and refuses one while reloading', () => {
    const { system } = makeSystem();
    run(system, 30 * 3, { fireHeld: true });
    // Burn the reserve dry first (the tactical path tops up from it), then fail to reload.
    const dry = new WeaponSystem(new FakePhysics(), WEAPON_DEFINITIONS, ['weapon/ar-vanguard']);
    for (let cycle = 0; cycle < 8; cycle += 1) {
      run(dry, 30 * 3, { fireHeld: true });
      dry.step(DT, input({ reload: true }));
      run(dry, Math.ceil(AR.reloadEmptyTime / DT));
    }
    expect(dry.snapshot().reserve).toBe(0);
    const refused = dry.step(DT, input({ reload: true }));
    expect(refused.reloadStarted).toBe(false);

    system.step(DT, input({ reload: true }));
    expect(system.step(DT, input({ reload: true })).reloadStarted).toBe(false);
  });
});

describe('WeaponSystem — recoil', () => {
  it('walks the authored pattern in order, one entry per shot', () => {
    const { system } = makeSystem();
    const kicks = run(system, AR.recoilPattern.length * 3, { fireHeld: true })
      .map((result) => result.recoilKick)
      .filter((kick) => kick.pitch !== 0 || kick.yaw !== 0);

    expect(kicks).toHaveLength(AR.recoilPattern.length);
    kicks.forEach((kick, index) => {
      const expected = AR.recoilPattern[index];
      expect(kick.pitch).toBeCloseTo(expected?.pitch ?? 0, 10);
      expect(kick.yaw).toBeCloseTo(expected?.yaw ?? 0, 10);
    });
  });

  it('shrinks the kick while aiming and while crouched', () => {
    const standing = makeSystem();
    const standingKick = standing.system.step(DT, input({ firePressed: true })).recoilKick;

    const aiming = makeSystem();
    // Settle the ADS blend first, then fire: the stance is a property of the shot.
    run(aiming.system, 30, { ads: true });
    const aimedKick = aiming.system.step(DT, input({ ads: true, firePressed: true })).recoilKick;
    expect(Math.abs(aimedKick.pitch)).toBeLessThan(Math.abs(standingKick.pitch));
    expect(Math.abs(aimedKick.pitch)).toBeCloseTo(
      Math.abs(standingKick.pitch) * AR.adsRecoilScale,
      2
    );

    const crouched = makeSystem();
    const crouchKick = crouched.system.step(DT, input({ crouched: true, firePressed: true }))
      .recoilKick;
    expect(Math.abs(crouchKick.pitch)).toBeLessThan(Math.abs(standingKick.pitch));
  });

  it('reports no kick on a step that fired nothing', () => {
    const { system } = makeSystem();
    system.step(DT, input({ firePressed: true }));
    expect(system.step(DT, input({})).recoilKick).toEqual({ pitch: 0, yaw: 0 });
  });
});

describe('WeaponSystem — spread and bloom', () => {
  const AR_STEP = 3;

  it('opens the cone with each shot and closes it when the trigger is released', () => {
    const { system } = makeSystem();
    const spreads: number[] = [];
    for (let step = 0; step < AR_STEP * 3; step += 1) {
      const result = system.step(DT, input({ fireHeld: true }));
      for (const shot of result.shots) spreads.push(shot.spread);
    }
    expect(spreads[0]).toBeCloseTo(AR.spread.base, 6);
    expect(spreads[1]).toBeGreaterThan(spreads[0] ?? 0);
    expect(spreads[2]).toBeGreaterThan(spreads[1] ?? 0);

    const opened = system.snapshot().spread;
    const quiet = run(system, 20, {});
    expect(system.snapshot().spread).toBeLessThan(opened);
    expect(quiet.every((result) => result.shots.length === 0)).toBe(true);
  });

  it('starts the next spray precise again after a release', () => {
    const { system } = makeSystem();
    run(system, AR_STEP * 3, { fireHeld: true });
    const lateShot = system.step(DT, input({ fireHeld: true })).shots[0];
    expect(lateShot?.spread).toBeGreaterThan(AR.spread.base);

    run(system, 4, {}); // release long enough to clear the cooldown
    const fresh = system.step(DT, input({ firePressed: true }));
    expect(fresh.shots).toHaveLength(1);
    expect(fresh.shots[0]?.spread).toBeLessThan(lateShot?.spread ?? 0);

    // With the trigger quiet, the bloom bleeds all the way back to the base cone.
    run(system, 60, {});
    const rested = system.step(DT, input({ firePressed: true }));
    expect(rested.shots[0]?.spread).toBeCloseTo(AR.spread.base, 6);
  });

  it('blooms wider on the move and in the air, and tighter while aiming', () => {
    const firstShotCone = (system: WeaponSystem, overrides: Partial<WeaponStepInput>) =>
      system.step(DT, input(overrides)).shots[0]?.spread ?? -1;

    const still = makeSystem();
    const stillSpread = firstShotCone(still.system, { firePressed: true });
    expect(stillSpread).toBeCloseTo(AR.spread.base, 6);

    const moving = makeSystem();
    const movingSpread = firstShotCone(moving.system, { speed: 3.6, firePressed: true });
    expect(movingSpread).toBeGreaterThan(stillSpread);

    const airborne = makeSystem();
    const airSpread = firstShotCone(airborne.system, { grounded: false, firePressed: true });
    expect(airSpread).toBeGreaterThan(stillSpread);

    const crouched = makeSystem();
    const crouchSpread = firstShotCone(crouched.system, { crouched: true, firePressed: true });
    expect(crouchSpread).toBeLessThan(stillSpread);

    const aiming = makeSystem();
    run(aiming.system, 30, { ads: true });
    const adsSpread = firstShotCone(aiming.system, { ads: true, firePressed: true });
    expect(adsSpread).toBeLessThan(crouchSpread);
  });

  it('is deterministic: the same input sequence produces the same shot directions', () => {
    const sequence: Partial<WeaponStepInput>[] = [];
    for (let step = 0; step < 40; step += 1) {
      sequence.push({
        fireHeld: step % 9 !== 8,
        firePressed: step % 9 === 0,
        ads: step > 20,
        crouched: step % 7 === 0,
        speed: step % 3 === 0 ? 3.6 : 0
      });
    }

    const first = makeSystem();
    const second = makeSystem();
    const directions = (system: WeaponSystem) =>
      sequence.flatMap((overrides) =>
        system.step(DT, input(overrides)).shots.map((shot) => shot.direction)
      );
    const a = directions(first.system);
    const b = directions(second.system);
    expect(a.length).toBeGreaterThan(5);
    expect(b).toEqual(a);
  });
});

describe('WeaponSystem — bullets', () => {
  it('drops a bullet over a long flight', () => {
    const { system, physics } = makeSystem({
      loadout: ['weapon/sniper-tallpine'],
      tuning: { poolSize: 8 }
    });
    physics.planeZ = -150;
    const start = system.step(DT, input({ firePressed: true }));
    expect(start.shots).toHaveLength(1);

    let impact: ReturnType<WeaponSystem['step']>['impacts'][number] | null = null;
    let impactSteps = 0;
    for (let step = 0; step < 40 && impact === null; step += 1) {
      const result = system.step(DT, input({}));
      impactSteps += 1;
      if (result.impacts.length > 0) impact = result.impacts[0] ?? null;
    }
    expect(impact).not.toBeNull();
    expect(impact?.hitKind).toBe('world');
    // 150 m at 300 m/s (10 m a step): the plane is crossed on the 15th step of flight.
    expect(impactSteps).toBeGreaterThanOrEqual(14);
    expect(impactSteps).toBeLessThanOrEqual(15);
    expect(impact?.point.z).toBeCloseTo(-150, 3);
    // The bullet has fallen: the impact is metres below the muzzle line.
    expect(impact?.point.y).toBeLessThan(MUZZLE.y - 0.4);
  });

  it('spawns exactly one impact for a wall hit and recycles the bullet', () => {
    const { system, physics } = makeSystem({ tuning: { poolSize: 8 } });
    physics.planeZ = -3;
    // A 165 m/s round sweeps 5.5 m in one step, so the 3 m wall is crossed on the shot's own
    // step: the shot and its impact are reported together.
    const firing = system.step(DT, input({ firePressed: true }));
    expect(firing.shots).toHaveLength(1);
    expect(firing.impacts).toHaveLength(1);
    expect(firing.impacts[0]?.distance).toBeCloseTo(3, 4);
    expect(firing.impacts[0]?.origin).toEqual({ x: MUZZLE.x, y: MUZZLE.y, z: MUZZLE.z });
    expect(system.liveBullets).toBe(0);

    const after = run(system, 5, {});
    expect(shotCount(after)).toBe(0);
    expect(after.every((result) => result.impacts.length === 0)).toBe(true);
  });

  it('stops a bullet on a loose part the static ray cannot see, and names it', () => {
    const { system, physics } = makeSystem({ tuning: { poolSize: 8 } });
    // A wall far behind the part proves the nearer answer wins.
    physics.planeZ = -40;
    const part: HitVolume = {
      id: 'gear-a',
      kind: 'part',
      min: vec3(-0.5, 0.5, -2.6),
      max: vec3(0.5, 1.8, -1.4)
    };
    const firing = system.step(DT, input({ firePressed: true, hitVolumes: [part] }));

    expect(firing.impacts).toHaveLength(1);
    expect(firing.impacts[0]?.hitKind).toBe('part');
    expect(firing.impacts[0]?.hitId).toBe('gear-a');
    // The near face is 1.4 m ahead of the muzzle, reported in metres (not as a fraction of
    // the 5.5 m step the bullet swept).
    expect(firing.impacts[0]?.distance).toBeGreaterThan(1.3);
    expect(firing.impacts[0]?.distance).toBeLessThan(1.5);
    expect(firing.impacts[0]?.point.z).toBeCloseTo(-1.4, 3);
    expect(firing.impacts[0]?.normal.z).toBeCloseTo(1, 6);
    expect(system.liveBullets).toBe(0);
  });

  it('keeps the pool a fixed budget, reporting each refused spawn', () => {
    const { system } = makeSystem({
      loadout: ['weapon/shotgun-yardboss'],
      tuning: { poolSize: 4 }
    });
    const result = system.step(DT, input({ firePressed: true }));
    expect(result.shots).toHaveLength(1);
    // Eight pellets asked for, four slots: the pool refuses the rest rather than growing.
    expect(system.stats().poolDrops).toBe(SHOTGUN.pellets - 4);
    expect(system.liveBullets).toBe(4);
    expect(system.stats().poolPeak).toBe(4);
  });

  it('expires a bullet at the weapon range and returns it to the pool', () => {
    const { system } = makeSystem({
      loadout: ['weapon/shotgun-yardboss'],
      tuning: { poolSize: 8 }
    });
    system.step(DT, input({ firePressed: true }));
    expect(system.liveBullets).toBeGreaterThan(0);
    // 30 m at 95 m/s is ~9.5 steps of flight; 25 is comfortably past it.
    run(system, 25, {});
    expect(system.liveBullets).toBe(0);
    expect(system.stats().shotsFired).toBe(1);
  });

  it('never exceeds the pool, however much is fired', () => {
    const { system, physics } = makeSystem({
      loadout: ['weapon/shotgun-yardboss'],
      tuning: { poolSize: DEFAULT_WEAPON_TUNING.poolSize }
    });
    physics.planeZ = -20;
    // 20 shells, each waited out at the pump-action's own rpm and topped up from reserve.
    for (let shell = 0; shell < 20; shell += 1) {
      system.step(DT, input({ firePressed: true }));
      run(system, Math.ceil(60 / SHOTGUN.rpm / DT) + 1);
      system.step(DT, input({ reload: true }));
      run(system, Math.ceil(SHOTGUN.reloadTime / DT) + 1);
    }
    expect(system.stats().shotsFired).toBeGreaterThan(10);
    expect(system.stats().poolPeak).toBeLessThanOrEqual(DEFAULT_WEAPON_TUNING.poolSize);
    expect(system.stats().poolDrops).toBe(0);
    expect(system.liveBullets).toBeLessThanOrEqual(DEFAULT_WEAPON_TUNING.poolSize);
  });
});

describe('WeaponSystem — aim stance and switching', () => {
  it('eases the aim blend in and out and publishes a locomotion scale', () => {
    const { system } = makeSystem();
    expect(system.snapshot().adsBlend).toBe(0);
    expect(system.snapshot().moveScale).toBeCloseTo(1, 6);

    run(system, 30, { ads: true });
    expect(system.snapshot().adsBlend).toBeGreaterThan(0.9);
    expect(system.snapshot().moveScale).toBeCloseTo(AR.adsMoveScale, 2);

    run(system, 30, {});
    expect(system.snapshot().adsBlend).toBeLessThan(0.01);
    expect(system.snapshot().moveScale).toBeCloseTo(1, 3);
  });

  it('costs the swap time before the new weapon will fire', () => {
    const { system } = makeSystem({ loadout: ['weapon/ar-vanguard', 'weapon/dmr-longline'] });
    const switched = system.step(DT, input({ switchNext: true }));
    expect(switched.switchedTo).toBe(1);
    expect(switched.view.swapping).toBe(true);

    const early = system.step(DT, input({ firePressed: true }));
    expect(early.shots).toHaveLength(0);
    expect(early.refused).toBe('swapping');

    const steps = Math.ceil(DMR.swapTime / DT);
    run(system, steps, {});
    const ready = system.step(DT, input({ firePressed: true }));
    expect(ready.shots).toHaveLength(1);
    expect(ready.view.weaponId).toBe(DMR.id);
    expect(system.stats().switches).toBe(1);
  });

  it('ignores a slot key it has no weapon for, and a switch to the held slot', () => {
    const { system } = makeSystem({ loadout: ['weapon/ar-vanguard'] });
    expect(system.step(DT, input({ slot: 4 })).switchedTo).toBeNull();
    expect(system.step(DT, input({ slot: 0 })).switchedTo).toBeNull();
    expect(system.stats().switches).toBe(0);
  });

  it('drops in-flight bullets and timers on reset', () => {
    const { system } = makeSystem();
    system.step(DT, input({ firePressed: true }));
    expect(system.liveBullets).toBe(1);
    system.reset();
    expect(system.liveBullets).toBe(0);
    expect(system.snapshot().reloading).toBe(false);
    expect(system.snapshot().adsBlend).toBe(0);
  });
});

describe('WeaponSystem — the read model', () => {
  it('reports the magazine, reserve and slots the HUD prints', () => {
    const { system } = makeSystem({ loadout: ['weapon/ar-vanguard', 'weapon/smg-rumble'] });
    const view = system.snapshot();
    expect(view.slotNames).toEqual(['Vanguard AR', 'Rumble SMG']);
    expect(view.magazineSize).toBe(AR.magazineSize);
    expect(view.reloadProgress).toBe(0);
    expect(view.liveBullets).toBe(0);
  });

  it('progresses a reload from 0 to 1', () => {
    const { system } = makeSystem();
    system.step(DT, input({ firePressed: true }));
    system.step(DT, input({ reload: true }));
    run(system, Math.ceil(AR.reloadTime / DT / 2));
    const middle = system.snapshot().reloadProgress;
    expect(middle).toBeGreaterThan(0.2);
    expect(middle).toBeLessThan(0.9);
  });
});
