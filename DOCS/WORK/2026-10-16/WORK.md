# WORK — 16/10/2026

Focus: finish the in-flight **locomotion feel + weapons** pass (`PLAN.md`, written this morning):
Phases D–G. Phases A–C landed earlier in the day (locomotion speed + crouch + the controls table;
the weapon table and `WeaponSystem`; input/world/camera wiring). This session closed the pass —
presentation, sound, the live proof, and the documentation.

## What this session did

1. **Repaired a broken typecheck, then a real defect inside the same file.** `82d9dba` (the
   previous session's last commit) left `tsc --noEmit` failing: `weapon-fx.ts` assigned to
   properties the render port declares `readonly`, because it intersected the port's read-only view
   types with mutable ones. Fixed properly — the presenter now owns private *mutable mirrors* of the
   port's view shapes (structurally assignable to the read-only ones), rather than the port
   loosening its contract.
2. **Found and fixed a second defect in `WeaponEffects.present` by reading it**: it decided "is
   there anything to draw?" *before* rebuilding its pools, so it read the previous frame's arrays,
   concluded "nothing", and never handed a freshly fired tracer to the renderer. On top of that, the
   hand-off skipped whenever the effects were empty — which also swallowed the *drawn weapon*, so the
   gun could not appear until something was shot. Both are fixed (effects and weapon are cleared
   with `null` independently, and the "nothing to draw" shortcut covers both halves), and pinned by
   `tests/logic/weapon-fx.test.ts` (**8 tests**), whose first case exists precisely to pin the bug.
3. **Composed the pass in the running game** (`src/main.ts`): `WeaponSystem` + the `WeaponEffects`
   presenter + a mount resolver (muzzle from `characterFacts().handR` when a body is drawn, aimed
   from the camera's line to a 60 m convergence point, chest-height fallback), the HUD weapon block's
   read model (including the *words* for a refusal held for 1.4 s), the effect presenter's `step`
   on the fixed step and `present` on the frame, and **`?guns=0`** as the documented escape hatch.
4. **Weapon audio (Phase E)**: 12 new cue ids in the closed vocabulary (`AudioCueId`) and their
   synthesised recipes — one gunshot per *class*, magazine out/in, bolt cycle, dry fire, weapon
   switch, bullet impact. `FeedbackComposer.updateWeapon(result)` maps a step's own events to them.
   Two rules recorded in code: a shot is **one cue per trigger pull** (never per pellet), and
   player-caused cues bypass the intent-level retrigger guard, because the weapon's own rpm already
   bounds them and the guard would otherwise silently swallow rounds at high rates.
5. **Phase F — the live proof.** A `guns` scenario in `scripts/browser-check.mjs` fires every slot
   through the real input path, reloads, switches mid-reload, aims, crouches, dumps four magazines
   to measure the pools, checks the action split (LMB fires, `KeyE` still grabs), and finally
   re-boots the page with `?guns=0` to verify the pre-pass game.
6. **A budget fix the harness found.** Measuring draw calls showed impacts were one mesh each, so the
   frame grew with how many marks were fading (79 → 86 during a burst). Impacts are now a single
   **`InstancedMesh`**, so the whole pool is one draw call: 79 idle → 82 firing (tracer + flash +
   the instanced marks), and the per-mark fade rides size + the strongest mark's opacity.
7. **Tooling honesty.** Two harness faults surfaced while running the checks and were fixed rather
   than tolerated: an unattributed `404` (the probe probing the game's TypeScript sources on a
   production build) is now both avoided and *attributable* (`log.<level>: … <- <url>`), and the
   carry scenarios now report `route planning unavailable` + `inconclusive` instead of a false
   verdict when the harness cannot plan a route around the level's colliders.

## Verification (all re-run on the final code)

| Check | Result |
|---|---|
| `npm run typecheck` | exit 0 |
| `npx vitest run` | exit 0 — 60 files, **754 tests** (was 736: +8 weapon-fx, +6 composer weapons, +4 HUD weapon block) |
| `npm run build` | exit 0 — `three` 624.62 kB (gzip 158.35) / `app` 285.04 kB (gzip 83.09); the weapons pass is **+35.3 kB raw / +10.3 kB gzip** on the app chunk, no new asset and no new dependency |
| `boot --production` | exit 0 — imported body (49 bones / 11 376 tris), hands reported, no new problems |
| `guns --production` | exit 0 — see the numbers below; the only problem is the documented ANGLE `X4122` warning |
| `hold` (dev) | exit 0 — the reach-shape gate still passes on the imported body with weapons on (left dot 0.967 @ 0.555 m, right 0.958 @ 0.464 m) |
| `dock` (dev) | exit 0 — green (first vantage compatible) |

`guns` numbers as measured (real Chrome, `dist/`):

- **Every slot fires and reloads**: AR 30/120 → 8 rounds in 50 frames (630 rpm), refills to 30/112;
  SMG 11 rounds in 60 frames (900 rpm); DMR/sniper 1 round each (single fire, by design); shotgun
  1 trigger pull = **8 pellets** (`rounds: 8`, `roundsSpent` counts pellets, `shots` counts pulls).
- **Tracers and impacts** are produced by every class (peak 2 tracers / 8 impacts drawn for the
  shotgun blast) — this is the reading that caught the `present` defect.
- **ADS**: blend 0.989, lens 60° → 43.45°, restored to 60°; `moveScale` 0.525 (the walk really slows).
- **Crouch**: 2.06 m/s crouched vs 3.74 m/s standing, stance flag true/false on the real key.
- **Pools**: 82 rounds / 4 magazine dumps → `poolPeak 8`, `poolDrops 0`, `liveBullets 0`, tracers ≤ 2
  of 24 drawn; draw calls 79 idle → 82 firing.
- **Action split**: LMB leaves the player `Empty-handed`; `KeyE` grabs `gear-a`.
- **`?guns=0`**: `weapon: null`, HUD weapon block hidden, no tracers after firing, lifecycle `running`
  — the pre-pass game, verified by navigating a fresh page rather than by trusting a flag.

## Known gaps and limits (recorded, not hidden)

- **The hands do not grip the drawn weapon yet.** The weapon is placed at the muzzle resolved from
  `handR`, so the barrel is in the right place for both bodies, but neither rig *poses* a two-handed
  hold (the procedural rig's carry stance is a puzzle-part reach). A weapon grip pose is the obvious
  next polish pass; it is presentation-only.
- **The body does not turn with the mouse while a weapon is drawn** — unrelated to this pass.
- **Carry scenarios need the dev server**: a production build does not serve the TS sources the
  harness's route planner reads, so `dock`/`branch` runs there are `inconclusive`, not green (the
  `guns` scenario is source-independent and fully green in both modes).
- **No enemy, damage or health anything** — ADR-020 keeps that out of scope deliberately.

## Files changed this session

`src/main.ts`, `src/presentation/weapon-fx.ts`, `src/presentation/feedback-composer.ts`,
`src/adapters/three-renderer.ts`, `src/adapters/web-audio-bus.ts`, `src/ports/audio-port.ts`,
`tests/logic/weapon-fx.test.ts` (new), `tests/logic/feedback-composer.test.ts`,
`tests/dom/hud.test.ts`, `tests/logic/support/recording-render-port.ts`,
`scripts/browser-check.mjs`, `DOCS/CONTEXT/ARCHITECTURE.md`, `DOCS/CONTEXT/SHOOTING-MECHANIC.md`,
`DOCS/STATUS.md`, `DOCS/README.md`, `PLAN.md`.
