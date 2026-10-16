/**
 * CONTENT — the weapon table (16/10/2026 weapons pass).
 *
 * Pure data (ARCH §40 `data/`): the L2 `WeaponSystem` reads these and never invents a
 * number. Six weapons, one per class, so the classes *read* differently in the hand: an
 * SMG that blooms and a DMR that does not, a rifle whose pattern walks up and sideways, a
 * bolt-action that cycles, a shotgun that throws pellets.
 *
 * ## Where the "BGMI-style" mechanics live
 *
 * The feel of a modern mobile/PC battle-royale weapon, in terms the engine already
 * understands:
 *
 * - **A fixed recoil pattern, not noise.** `recoilPattern[i]` is the kick of shot *i+1*
 *   of a spray — a small vertical climb plus a horizontal component that alternates, which
 *   is the shape that makes a spray *learnable* instead of random. The camera accumulates
 *   the kick (the rig owns its own pose, ARCH §12.1) and recovers it over time, so a burst
 *   walks the muzzle up and the player pulls back down.
 * - **A fixed spread pattern.** `SPREAD_PATTERN` is a unit-disc walk whose first entry is
 *   exactly the centre: the first shot of a trigger pull is precise, and every following
 *   shot is pushed further out. Spread is *scaled* by the current bloom, never randomised —
 *   no `Math.random()` anywhere, so a shot sequence replays identically (ARCH §2,
 *   determinism before realism).
 * - **Bloom that grows with fire and movement, and shrinks with stillness, ADS and
 *   crouch.** Four authored knobs (`perShot`, `move`, `ads`, `crouch`) plus a recovery
 *   rate, which is what makes tap-firing at range better than holding the trigger.
 * - **Two reload lengths.** A reload with a round still in the chamber is faster than one
 *   from empty — the "tactical vs full" distinction, expressed as the difference between
 *   `reloadTime` and `reloadEmptyTime`.
 * - **Bullets are simulated, not hitscan.** `bulletSpeed` (m/s) and `bulletDrop` (m/s²)
 *   give every weapon a real lead and a real drop, and each class trades them off: the
 *   sniper reaches far and flat, the SMG cannot reach at all.
 * - **ADS changes three things at once** — the field of view, how fast you can move, and
 *   how tight the shots group — which is the whole reason to aim.
 *
 * ## What is deliberately absent
 *
 * No damage, no health, no enemies (SHOOTING-MECHANIC §5: a shot may never attach, detach,
 * validate or complete anything). The weapons are a sandbox capability over the parts and
 * targets the level already has, and `range` is the distance a bullet simply expires at.
 */

export type WeaponClass = 'ar' | 'smg' | 'dmr' | 'sniper' | 'shotgun' | 'pistol';

export type FireMode = 'auto' | 'single' | 'burst';

/** The human-readable name of each fire mode (the HUD speaks data's words, §33.2 rule 1). */
export const FIRE_MODE_LABEL: Readonly<Record<FireMode, string>> = {
  auto: 'AUTO',
  single: 'SINGLE',
  burst: 'BURST'
};

export const WEAPON_CLASS_LABEL: Readonly<Record<WeaponClass, string>> = {
  ar: 'Assault rifle',
  smg: 'Submachine gun',
  dmr: 'Marksman rifle',
  sniper: 'Sniper rifle',
  shotgun: 'Shotgun',
  pistol: 'Pistol'
};

/**
 * One shot's camera impulse, radians: `pitch` climbs (positive raises the aim, matching the
 * rig's own convention where a positive view pitch looks up), `yaw` walks sideways.
 */
export interface RecoilStep {
  readonly pitch: number;
  readonly yaw: number;
}

export interface WeaponSpread {
  /** Radians of cone at rest, stationary, from the hip — the first-shot cone. */
  readonly base: number;
  /** Added per shot: what holding the trigger costs. */
  readonly perShot: number;
  /** Ceiling of the bloom, radians. */
  readonly max: number;
  /** Radians per second the bloom bleeds back toward `base`. */
  readonly recovery: number;
  /** Extra radians while moving at walk pace (scaled by speed, so a sprint blooms more). */
  readonly move: number;
}

export interface WeaponDefinition {
  readonly id: string;
  readonly name: string;
  readonly class: WeaponClass;
  /** Fire modes in cycle order; index 0 is the mode the weapon is drawn in. */
  readonly fireModes: ReadonlyArray<FireMode>;
  /** Rounds per minute. The fixed 30 Hz step fires at most one shot per step (1800 rpm). */
  readonly rpm: number;
  /** Rounds per burst when a burst mode is selected. */
  readonly burstCount?: number | undefined;
  readonly magazineSize: number;
  readonly reserveAmmo: number;
  /** Seconds: reload with a round still in the chamber (tactical). */
  readonly reloadTime: number;
  /** Seconds: reload from empty (the bolt is back and the magazine is off). */
  readonly reloadEmptyTime: number;
  /** Bullets per trigger pull. 1 everywhere except the shotgun. */
  readonly pellets: number;
  /** m/s at the muzzle. */
  readonly bulletSpeed: number;
  /** m/s² downward on a bullet in flight. */
  readonly bulletDrop: number;
  /** Metres a bullet flies before it expires. */
  readonly range: number;
  /** Per-shot kick, walked in order. A short pattern repeats when it runs out. */
  readonly recoilPattern: ReadonlyArray<RecoilStep>;
  /**
   * The cone: how precise the weapon is at rest, how fast firing costs accuracy, and how
   * fast it comes back. Radians throughout, so `spread.base` is directly the half-angle a
   * shot can deviate by. Rough calibration: 0.0017 rad ≈ 0.1°, 0.05 rad ≈ 2.9°.
   */
  readonly spread: WeaponSpread;
  /** Seconds to bring the weapon up; nothing fires until it elapses. */
  readonly swapTime: number;
  /** Field of view multiplier while aiming (1 = unchanged, lower = zoomed in). */
  readonly adsFovScale: number;
  /** Locomotion multiplier while aiming. */
  readonly adsMoveScale: number;
  /** Spread multiplier while aiming (ADS is what makes range shots possible). */
  readonly adsSpreadScale: number;
  /** Spread multiplier while crouched (a steady stance). */
  readonly crouchSpreadScale: number;
  /** Recoil multiplier while aiming. */
  readonly adsRecoilScale: number;
  /** Recoil multiplier while crouched. */
  readonly crouchRecoilScale: number;
}

/**
 * The spread walk: index 0 is dead centre (that is "first shot accuracy"), and the rest
 * spiral outward so a spray spreads into a disc rather than a line. Magnitudes are 0…1 of
 * the *current* bloom, so one table serves every weapon and every stance.
 */
export const SPREAD_PATTERN: ReadonlyArray<{ readonly x: number; readonly y: number }> = [
  { x: 0.0, y: 0.0 },
  { x: 0.0, y: -1.0 },
  { x: 0.86, y: -0.5 },
  { x: 0.7, y: 0.71 },
  { x: -0.18, y: 0.98 },
  { x: -0.92, y: 0.39 },
  { x: -0.87, y: -0.49 },
  { x: -0.28, y: -0.96 },
  { x: 0.52, y: -0.33 },
  { x: 0.5, y: 0.42 },
  { x: -0.06, y: 0.55 },
  { x: -0.4, y: 0.05 },
  { x: 0.24, y: 0.16 },
  { x: 0.12, y: -0.2 },
  { x: -0.15, y: -0.08 },
  { x: 0.05, y: 0.06 }
];

/**
 * A spray's pattern is 8 shots for most weapons: the first four walk up hard, the back half
 * drifts sideways and settles — the shape a player learns to compensate for.
 */
const RIFLE_PATTERN: ReadonlyArray<RecoilStep> = [
  { pitch: 0.0125, yaw: 0.0009 },
  { pitch: 0.0148, yaw: -0.0021 },
  { pitch: 0.0156, yaw: 0.0016 },
  { pitch: 0.0162, yaw: 0.0031 },
  { pitch: 0.0158, yaw: -0.0027 },
  { pitch: 0.0151, yaw: -0.0035 },
  { pitch: 0.0143, yaw: 0.0013 },
  { pitch: 0.0135, yaw: -0.0006 }
];

export const WEAPON_DEFINITIONS: ReadonlyArray<WeaponDefinition> = [
  {
    // 7.62 rifle: the all-rounder, and the weapon the loadout opens with. High per-shot
    // kick, a real pattern, usable on single or full auto.
    id: 'weapon/ar-vanguard',
    name: 'Vanguard AR',
    class: 'ar',
    fireModes: ['auto', 'single'],
    rpm: 630,
    magazineSize: 30,
    reserveAmmo: 120,
    reloadTime: 1.9,
    reloadEmptyTime: 2.6,
    pellets: 1,
    bulletSpeed: 165,
    bulletDrop: 9.8,
    range: 90,
    recoilPattern: RIFLE_PATTERN,
    // A rifle is precise for the first round and pays for a spray.
    spread: { base: 0.004, perShot: 0.0055, max: 0.05, recovery: 0.055, move: 0.014 },
    swapTime: 0.55,
    adsFovScale: 0.72,
    adsMoveScale: 0.52,
    adsSpreadScale: 0.32,
    crouchSpreadScale: 0.62,
    adsRecoilScale: 0.68,
    crouchRecoilScale: 0.72
  },
  {
    // 9 mm SMG: fastest cycle, mildest kick per shot, but the bloom is punishing — the
    // class lesson is "close, and keep the bursts short".
    id: 'weapon/smg-rumble',
    name: 'Rumble SMG',
    class: 'smg',
    fireModes: ['auto'],
    rpm: 900,
    magazineSize: 25,
    reserveAmmo: 100,
    reloadTime: 1.6,
    reloadEmptyTime: 2.2,
    pellets: 1,
    bulletSpeed: 120,
    bulletDrop: 11.5,
    range: 55,
    recoilPattern: [
      { pitch: 0.0061, yaw: 0.0011 },
      { pitch: 0.0072, yaw: -0.0018 },
      { pitch: 0.008, yaw: 0.0022 },
      { pitch: 0.0086, yaw: 0.0026 },
      { pitch: 0.0091, yaw: -0.0023 },
      { pitch: 0.0088, yaw: -0.0029 },
      { pitch: 0.0084, yaw: 0.0017 },
      { pitch: 0.008, yaw: -0.0012 }
    ],
    // An SMG's lesson: the cone opens almost immediately and stays open.
    spread: { base: 0.0075, perShot: 0.0075, max: 0.075, recovery: 0.085, move: 0.02 },
    swapTime: 0.4,
    adsFovScale: 0.82,
    adsMoveScale: 0.6,
    adsSpreadScale: 0.45,
    crouchSpreadScale: 0.7,
    adsRecoilScale: 0.75,
    crouchRecoilScale: 0.78
  },
  {
    // 7.62 marksman rifle: heavy first shot, slow recovery, and a *tight* aimed cone — the
    // weapon that rewards single taps at distance.
    id: 'weapon/dmr-longline',
    name: 'Longline DMR',
    class: 'dmr',
    fireModes: ['single'],
    rpm: 200,
    magazineSize: 10,
    reserveAmmo: 60,
    reloadTime: 2.2,
    reloadEmptyTime: 2.9,
    pellets: 1,
    bulletSpeed: 220,
    bulletDrop: 7.4,
    range: 130,
    recoilPattern: [
      { pitch: 0.0285, yaw: 0.0014 },
      { pitch: 0.0246, yaw: -0.0032 },
      { pitch: 0.0218, yaw: 0.0028 },
      { pitch: 0.0195, yaw: -0.0019 }
    ],
    // Tight from the hip, and the *aimed* cone (adsSpreadScale) is what it is for.
    spread: { base: 0.0016, perShot: 0.014, max: 0.045, recovery: 0.035, move: 0.018 },
    swapTime: 0.6,
    adsFovScale: 0.58,
    adsMoveScale: 0.45,
    adsSpreadScale: 0.14,
    crouchSpreadScale: 0.55,
    adsRecoilScale: 0.6,
    crouchRecoilScale: 0.68
  },
  {
    // Bolt-action: one shot, then a long cycle (the rpm *is* the bolt). Enormous kick, and
    // the only weapon whose aimed cone is effectively zero.
    id: 'weapon/sniper-tallpine',
    name: 'Tallpine Bolt',
    class: 'sniper',
    fireModes: ['single'],
    rpm: 45,
    magazineSize: 5,
    reserveAmmo: 25,
    reloadTime: 2.8,
    reloadEmptyTime: 3.6,
    pellets: 1,
    bulletSpeed: 300,
    bulletDrop: 5.6,
    range: 200,
    recoilPattern: [{ pitch: 0.062, yaw: 0.0042 }],
    // One shot: whatever precision you had is the shot you took.
    spread: { base: 0.0004, perShot: 0.05, max: 0.06, recovery: 0.02, move: 0.03 },
    swapTime: 0.75,
    adsFovScale: 0.4,
    adsMoveScale: 0.36,
    adsSpreadScale: 0.06,
    crouchSpreadScale: 0.5,
    adsRecoilScale: 0.55,
    crouchRecoilScale: 0.6
  },
  {
    // Pump shotgun: eight pellets, one big cone, two shells. Devastating close, useless past
    // the end of the room — the class exists to make `pellets` and a wide `base` mean
    // something.
    id: 'weapon/shotgun-yardboss',
    name: 'Yardboss 12',
    class: 'shotgun',
    fireModes: ['single'],
    rpm: 70,
    magazineSize: 2,
    reserveAmmo: 24,
    reloadTime: 2.4,
    reloadEmptyTime: 3.1,
    pellets: 8,
    bulletSpeed: 95,
    bulletDrop: 12,
    range: 30,
    recoilPattern: [{ pitch: 0.055, yaw: 0.0035 }],
    // A wide cone is the whole weapon; ADS narrows it without ever making it a rifle.
    spread: { base: 0.055, perShot: 0.02, max: 0.09, recovery: 0.06, move: 0.022 },
    swapTime: 0.65,
    adsFovScale: 0.94,
    adsMoveScale: 0.68,
    adsSpreadScale: 0.62,
    crouchSpreadScale: 0.78,
    adsRecoilScale: 0.85,
    crouchRecoilScale: 0.86
  },
  {
    // Sidearm: always there, quick to draw, quick to empty. The fallback when a magazine is
    // gone and something is still standing.
    id: 'weapon/pistol-fitter',
    name: 'Fitter P9',
    class: 'pistol',
    fireModes: ['single'],
    rpm: 400,
    magazineSize: 15,
    reserveAmmo: 60,
    reloadTime: 1.3,
    reloadEmptyTime: 1.8,
    pellets: 1,
    bulletSpeed: 140,
    bulletDrop: 10.4,
    range: 45,
    recoilPattern: [
      { pitch: 0.0132, yaw: 0.0011 },
      { pitch: 0.0118, yaw: -0.0016 },
      { pitch: 0.0109, yaw: 0.0014 }
    ],
    spread: { base: 0.006, perShot: 0.009, max: 0.05, recovery: 0.07, move: 0.016 },
    swapTime: 0.3,
    adsFovScale: 0.88,
    adsMoveScale: 0.72,
    adsSpreadScale: 0.4,
    crouchSpreadScale: 0.7,
    adsRecoilScale: 0.78,
    crouchRecoilScale: 0.8
  }
];

/** Definition lookup by id — null for an id the table does not hold (never throws). */
export function weaponDefinitionOf(id: string): WeaponDefinition | null {
  return WEAPON_DEFINITIONS.find((definition) => definition.id === id) ?? null;
}

/**
 * The shipped loadout, in slot order (slot 0 is what the player starts holding). Authored
 * here rather than in the composition so the harness, the HUD and the tests read one list.
 */
export const LOADOUT: ReadonlyArray<string> = [
  'weapon/ar-vanguard',
  'weapon/smg-rumble',
  'weapon/dmr-longline',
  'weapon/sniper-tallpine',
  'weapon/shotgun-yardboss'
];

