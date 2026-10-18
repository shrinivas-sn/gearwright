# WORK — 18/10/2026

**Goal of this pass (owner-reported):** the firing mechanics are good, but the character's **hands
move oddly — broken movements**. Make the arms and hands move with proper physics and mechanics, in
the shape a battle-royale shooter gives them (BGMI/PUBG): hands that hold the weapon or a part where
a person could, elbows that keep one bending plane, wrists that do not snap, and motion that absorbs
a fast aim change instead of whipping.

Method: read the seams before touching anything (the composition's mount, both bodies' arm IK, the
carry target, the render-ordering in `present`), measure every claim in real Chrome, and fix causes
rather than symptoms. Six real defects came out of that, five of them in the *pose* path and one in
the *frame order*.

## What this session did

1. **The weapon mount read the rendered hand — a closed loop (`src/core/weapon-mount.ts`, new).**
   `main.ts`'s `resolveWeaponMount` took its origin from `characterFacts().handR` on every fixed
   step, put the muzzle 0.32 m along the aim, and the renderer derived the rear-grip IK target
   0.30 m back from that muzzle. So the right hand's target was `handR_prev + 0.02·aim`: the arm
   chased its own output forward until the reach clamp locked it straight, and every wobble in the
   hand re-steered the gun. The mount is now a **pure function of the stance and the camera's aim
   line** (`WEAPON_SHOULDER_HEIGHT`, `WEAPON_SIDE_OFFSET`, `WEAPON_MUZZLE_LEAD`), so a simulated
   weapon cannot depend on a rendered one, and it is testable headlessly.

2. **The hands trailed the body by 6–12 cm at a run (frame ordering + interpolation, `main.ts`).**
   `syncPlayerMarker` drew the body at the *interpolated* position, while the drawn weapon and the
   grip were resolved later, from the *simulated* position, one frame behind. New measurement first:
   the `arms` harness scenario read the two hand positions relative to the body root every 60 ms
   while standing and while walking — 0.119 m of body-relative movement at a walk. The weapon block
   now runs **before** `syncPlayerMarker`, mounted on the same interpolated stance the body is drawn
   with, so the grip the arms solve onto is this frame's. Visual only: the simulated muzzle the
   bullets leave is untouched.

3. **The grip points were outside the imported body's reach (`src/core/weapon-mount.ts`).** Measured
   from `assets/characters/vanguard.glb`'s own bind pose: shoulders at ±0.205 m / 1.454 m, upper arm
   0.227 m + forearm 0.237 m = **0.464 m** shoulder-to-wrist. The mount put the fore-end 0.48 m from
   the left shoulder, so the supporting arm sat **clamped at full extension** for the whole session
   and was dragged around by the chest clip's own sway (0.038 m of body-relative wander, 0.14 m off
   its grip). The gun now sits **0.04 m right of centre with a 0.48 m lead**: rear hand 0.18 m,
   front hand 0.36 m — 0.436 m from the left shoulder, 2.8 cm of margin inside the real arm.

4. **The procedural rig solved the arms from the wrong shoulder and the wrong frame
   (`src/adapters/character-rig.ts`).** `applyHandAim` used the *rest* shoulder offset and inverted
   only the chest × shoulder eulers — ignoring the hips and spine, which the gait rotates every
   frame. The hand therefore orbited its target with the walk cycle. It now reads the **posed**
   shoulder bone's world position and the **actual parent** bone's world rotation out of the
   matrices it already has, so the solve is exact with no bookkeeping.

5. **The imported body's elbow plane flipped (`src/core/arm-ik.ts`, new — `ElbowPole`).**
   `aimArm` reused whichever side the current clip had the elbow on; near full extension that is
   nearly degenerate, so the bend plane flipped between frames and whipped the forearm. Each arm
   now owns an `ElbowPole` — down and away from the body on its own side — that may turn no faster
   than 8 rad/s, so a 180° aim flick becomes a sweep. `clampGripTarget` also clamps every target
   into the arm's reach shell **preserving direction**, so an unreachable part is aimed at instead
   of inventing a pose, and `splitGrip` holds a carried part at two points ±0.17 m either side of
   its centre instead of both hands on one atom.

6. **The torso now squares up to the aim (both bodies, BR-style).** A new `stepAimTwist` turns the
   spine and chest toward the weapon (or the held part) at a bounded rate, clamped to ±0.9 rad, with
   the hips deliberately untouched so the feet keep the walk's own direction. This is what lets both
   arms sit on the gun instead of one crossing the body — and on the imported body it is written
   *after* the `AnimationMixer` and *before* the arms, so the next clip sample replaces it and
   nothing accumulates.

## Verification (all re-run on the final code)

- `npm run typecheck` — exit 0.
- `npx vitest run` — exit 0, **62 files / 792 tests** (769 at HEAD: +14 `arm-ik`, +6 `weapon-mount`,
  +3 rig stability). The three new rig tests fail against the old `applyHandAim`.
- `npm run build` — exit 0, `app` 289.79 kB (gzip 84.97) from 286.35 (83.49): **+3.44 kB raw /
  +1.48 kB gzip** for two new core modules, the twist, and one dev probe hook.
- **New `arms` scenario, real Chrome, dev:** both bodies green.
  - imported body: standing still — muzzle drift **0.0000 m**, hand step **0.0000 m**, hands **0.0000 m**
    off their grips; walking at 3.74 m/s — hand step **0.0001 m**, **0.0000 m** off their grips,
    body-relative spread **0.0000 m**.
  - procedural body: standing **0.0000 / 0.0000 / 0.0000**, walking **0.0002 / 0.0000**.
  - The same scenario on the pre-pass code reported **0.119 m** of body-relative hand movement at a
    walk and a left hand **0.185 m** off its grip.
- **`boot --production`** exit 0 (`{body: "gltf", bones: 49, triangles: 11376}`, body visible).
- **`hold` (dev)** exit 0 — hands 0.939 / 0.925 aligned with the part at 0.576 / 0.484 m (the
  alignment dips slightly from 0.968 / 0.958 because the hands now *bracket* the part, which is the
  point); no problems reported.
- **`guns --production`** exit 0 — 5 slots fire (8 / 11 / 1 / 1 / 1 rounds), every reload refills,
  pools flat (`poolPeak 8`, `poolDrops 0`), 79 → 82 draw calls, ADS 60° → 43.452°, crouch-walk 2.059
  vs 3.736 m/s, `?guns=0` → `weapon: null`.
- Only the documented ANGLE `X4122` / AudioContext lines appear.

## Owed / carried forward

1. **A carried part is still 1.35 m from a 0.46 m arm.** The body now aims at it with a bent elbow
   and a spread grip instead of a locked-straight reach, but the hands cannot touch a part floated
   that far out. Fixing it is a **design decision** (carry distance vs. part size vs. the part
   clipping the torso), not a rig change — `holdDistance` is deliberately untouched by this pass.
2. **The `branch` curve on the 17/10 code** is still the one unproven gate (`DOCS/STATUS.md`).
