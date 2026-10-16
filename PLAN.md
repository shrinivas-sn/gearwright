# PLAN — locomotion feel + weapons pass

**Written 16/10/2026** (supersedes the 15/10/2026 version of this file; that plan's Phases 1–2 are
recorded below as done, and its remaining carry-tune phase is folded into Phase A). Temporary file —
deleted when this closes.

**Goal:** the project owner asked for four things, in this order —
1. the character "feels a little bit slow";
2. jump and crouch are not available as controls;
3. shooting, with gun switching, using BGMI-game-style physics and mechanics "properly";
4. a proper phased plan, worked through and logged, without breaking anything.

**Where this lands:** faster + crouchable locomotion, and a deterministic, data-driven weapon system
(aim-down-sights, per-weapon recoil *patterns*, spread/bloom, fire modes, magazines + reloads,
switching, and physically simulated bullets with travel time and drop) — behind the project's real
seams, with headless tests for every rule and a live browser check from `dist/` as the feel gate.

**Documented scope change (owner-authorized):** `ARCHITECTURE.md` §3 lists *Combat* as Out of Scope.
The owner has now explicitly asked for shooting, so this pass records the decision as an ADR entry
(Phase G) narrowing what §3 excludes: **a sandbox weapon range and weapon handling are in scope;
enemies, damage, health and death remain out of scope.** `DOCS/CONTEXT/SHOOTING-MECHANIC.md` already
assessed exactly this route (options A + B) and called the architecture note the only blocker.

**What this changes (by layer):**
- `src/gameplay/player-controller.ts` — faster tuning; a crouch stance (lower capsule, slower, no
  sprint) that is deterministic and additive to the existing walk/run/hop math.
- `src/gameplay/input-system.ts` — new actions: `fire`, `ads`, `reload`, `crouch`, `weaponNext`,
  `weaponSlot`, plus a right-mouse button path. Exploration-only, exactly like the hop.
- `src/ports/input-port.ts` + `src/adapters/dom-input-source.ts` — secondary (right) mouse button.
- `src/data/weapons.ts` (new) — the weapon table: class, fire modes, rpm, magazine, reloads, recoil
  pattern, spread/bloom curve, ADS zoom + move scale, bullet speed/drop, cue ids.
- `src/gameplay/weapon-system.ts` (new) — the L2 weapon state machine + pooled projectile sim.
- `src/gameplay/phase-world.ts` — route the new actions; step the weapon system in ARCH §14 order.
- `src/gameplay/camera-rig.ts` — recoil (accumulated impulses + recovery), ADS framing/FOV.
- `src/presentation/hud.ts` + `src/style.css` — a weapon block, ammo/fire-mode/slot readout and a
  spread-aware crosshair.
- `src/presentation/weapon-fx.ts` (new, L4) — pooled tracer/muzzle-flash/impact timing.
- `src/ports/render-port.ts` + `src/adapters/three-renderer.ts` — a drawn weapon in the hands, tracers,
  muzzle flash, impact pulses.
- `src/ports/audio-port.ts` + `src/adapters/web-audio-bus.ts` — weapon cue recipes (synthesised).
- `src/main.ts` — composition wiring + the `?guns=0` escape hatch.
- `scripts/browser-check.mjs` — a `guns` scenario.
- `DOCS/` — `STATUS.md`, `WORK/2026-10-16/WORK.md`, `README.md` index row, and the §3/ADR note.

**Done means:** `npm run typecheck` clean, `npx vitest run` green with new weapon/locomotion suites,
`npm run build` green, and one real Chrome run from `dist/` showing (a) the faster walk/run, (b) Space
hop, (c) crouch under a low beam, (d) firing, reload, weapon switch and ADS with visible recoil, with
no new console problems beyond the two already documented (ANGLE `X4122`, AudioContext autoplay).

**Out of scope (explicitly):** enemies/AI, damage/health/death, bullet penetration, attachments,
armour, a pick-up/inventory economy for weapons, bullet impulses on puzzle parts (Phase B records why),
new content/branches, save-schema changes, and any change to the LMG's authority. The level's puzzle
experience is unchanged when the weapons are disabled with `?guns=0`.

---

## Read this first

1. Confirm the baseline before touching anything: `npm run typecheck && npx vitest run` → exit 0,
   **678 tests**. `git status --short` must be clean (verified 16/10/2026, `main` == `origin/main`).
2. Read only: this file (your current task + the last Progress Log entry), `DOCS/STATUS.md`, and the
   files your task names. Skip whole: `DOCS/CONTEXT/PROJECT_STATE.md`, `ARCHITECTURE.md` beyond §3,
   §10–§15 and §43.
3. Environment checks are commands, never remembered values:

| Check | Command | Pass looks like |
|---|---|---|
| Baseline | `npm run typecheck && npx vitest run` | exit 0, 678+ tests |
| Production build | `npm run build` | exit 0, `dist/` with the hashed `vanguard-<hash>.glb` |
| Live boot | `node scripts/browser-check.mjs boot` | exit 0, `character.body` reported, no new problems |
| Live weapons | `node scripts/browser-check.mjs guns` | exit 0, shots/reload/switch data in the report |
| Git state | `git status --short` | only the planned files dirty, clean after each checkpoint |

## Facts verified while planning

| Fact | Source | Checked on |
|---|---|---|
| Worktree clean; `main` == `origin/main` (0 ahead / 0 behind after `git fetch`). | `git status`, `git rev-list --left-right --count` | 16/10/2026 |
| Baseline green: typecheck exit 0, 58 files / 678 tests pass. | local run | 16/10/2026 |
| The hop (ADR-019) is fully wired: `PlayerStepInput.jump`, `InputBindings.jump = 'Space'`, `PhaseWorld` passes `jump: actions.jump`. | `player-controller.ts`, `input-system.ts`, `phase-world.ts` | 16/10/2026 |
| `RawInputSample` carries only the **primary** mouse button, so ADS needs a port addition. | `ports/input-port.ts` | 16/10/2026 |
| `PhysicsPort.castRay` hits **static** colliders only (`setCarryableColliders` is capsule-only, deliberately out of `castRay`). A bullet that must hit parts therefore needs its own box test. | `ports/physics-port.ts` comments | 16/10/2026 |
| The camera owns its pose (`CameraRig` is the only writer), so recoil has to be an input to the rig, not a value the weapon system writes. | `camera-rig.ts`, `ARCHITECTURE.md` §12.1 | 16/10/2026 |
| The HUD is a read-model consumer with a fixed literal skeleton and pooled rows; adding a surface means editing the template + the snapshot type, and never interpolating markup. | `presentation/hud.ts` header | 16/10/2026 |
| The audio bus is fully procedural with a closed cue vocabulary (`AudioCueId`), so weapon sound is cue recipes, never assets. | `ports/audio-port.ts`, `adapters/web-audio-bus.ts` | 16/10/2026 |
| The browser harness grabs with `KeyE` (`tapKey(cdp, 'KeyE')`) and reads `window.__gearwrightDev`, so LMB can be given to firing without breaking a single harness scenario. | `scripts/browser-check.mjs` | 16/10/2026 |
| `R` (secondary) is only read in the Manipulation context, so `R` = reload in Exploration is conflict-free (contexts are exclusive). | `input-system.ts`, `ARCHITECTURE.md` §15 | 16/10/2026 |
| Two test files drive *grab* with `primaryPressed` (the mouse-press path): `phase-world.test.ts` (1 site) and `p1-acceptance.test.ts` (1 site). They move to a `KeyE` press — see Plan issue #2. | `grep -rn primaryPressed tests` | 16/10/2026 |

## Rules for every task

- One owner per state. Weapon state is L2 runtime (`WeaponSystem`), exactly like the manipulation SM;
  it writes **no** L1 state and never touches `src/game-state/`, the save codec or `src/levels/`.
- **Determinism is a requirement, not a wish.** No `Math.random()` anywhere in the weapon path: spread
  and recoil come from authored, indexed patterns. Fixed-step only.
- Bullets may never attach, detach, validate or complete anything (SHOOTING-MECHANIC §5 non-negotiable
  1). A shot can only produce an impact *event*; progression is untouched.
- Every new behaviour gets a headless test in the same commit as the code. The browser check is the
  feel gate, never the only gate.
- Budget discipline: projectiles, tracers, flashes and impacts are pooled with a fixed capacity, and
  `stats()` must not grow with how much you shoot (assert it in the `guns` scenario).
- No new console output beyond the two already documented. A new one is a defect.
- Keep the shipped puzzle experience intact: with `?guns=0`, nothing about the game changes.

## Failure handling

| Situation | Do this |
|---|---|
| `npm run typecheck` fails | Fix the type error at the site it names; never widen a type to silence it. |
| An existing test fails after a wiring change | Read the failing assertion. If it encodes a behaviour this plan deliberately changes (Plan issue #2), update the test **and** state why in the Progress Log. Otherwise fix the real cause. |
| The live check shows no shot | Instrument enough to see whether the action reaches `PhaseWorld`; do not litter production code with logs. |
| Anything else fails | Fix and retry at most three times; then set it aside (stash), record the real output, and take the next independent task. Retry once at phase end. |
| The plan itself looks wrong | Append to **Plan issues** and decide by impact — never freeze the whole plan. |

---

## Phase A — Locomotion feel (speed, crouch, controls)

**Purpose:** the owner's first two asks: "the character feels a little bit slow", and "you have not
added any controls for jump or crouch". (Jump exists as ADR-019's hop; it is simply not in the
controls table — that is a real gap and it gets fixed here.)

**Starts when:** the baseline is green and this plan is written.

### Task A.1 — Tune the locomotion speeds

**Goal:** walking and running read as brisk rather than sluggish, without turning the workshop into a
racetrack and without breaking the hazard-telegraph design (ARCH §16: "cannot enter hazard volumes
accidentally at walk pace").

**Where:** `src/gameplay/player-controller.ts` (`DEFAULT_PLAYER_TUNING`).

**Do:** raise `walkSpeed` 3.0 → 3.6, `runSpeed` 6.0 → 7.4, tighten `accelerationTime` 0.09 → 0.07 and
`decelerationTime` 0.08 → 0.06, and raise the turn rate 12 → 14 rad/s. Keep `maxFallSpeed`, the hop
tuning, the capsule and gravity untouched — this is a *speed* pass, not a physics pass. Update the
`walkSpeed`/`runSpeed` numbers the controller tests assert.

**Verify:** `npx vitest run tests/logic/player-controller.test.ts` → exit 0; `npm run typecheck` → exit 0.

### Task A.2 — Crouch

**Goal:** a held crouch that lowers the stance, slows the player, forbids sprinting, improves weapon
stability (Phase B reads `crouched`) and lets the player pass under low geometry.

**Where:** `src/gameplay/player-controller.ts`, `src/gameplay/input-system.ts`.

**Do:** add `crouch: boolean` (held) to `PlayerStepInput` and `crouch: 'KeyC'` to the bindings; add a
`crouchCapsule`/`crouchScale` to `PlayerTuning` (height 1.7 → 1.15, `crouchSpeedScale` 0.5); in `step`,
choose the capsule *before* `moveAndSlide` from the crouch flag (with a stand-up check so the player
cannot stand inside geometry — the port's `isPoseValid` decides). A crouched player never runs, and a
crouch input while airborne does nothing. Expose `crouched` on `PlayerDynamicState`. Keep the hop
working while crouched (it is still grounded-only).

**Test first:** crouching lowers the reported eye/body height and the capsule actually used; crouch +
run does not exceed the crouch speed; standing is refused under a low ceiling (fake physics: a box
above the head) and the player stays crouched.

### Task A.3 — Put jump and crouch (and the new weapon keys) in the controls table

**Goal:** the controls the game actually has are the controls it shows.

**Where:** `src/main.ts` (`controlRows`), `src/presentation/hud.ts` (entry line).

**Do:** add Jump, Crouch, and (Phase D) Fire/ADS/Reload/Switch rows, spelled from the live binding map
— never hard-coded keys (§15's rule, already followed by this function). Mention jump + crouch in the
one-shot HUD entry line.

### Checkpoint — Phase A
- [ ] `npx vitest run` exit 0 with the new crouch tests.
- [ ] `npm run typecheck` exit 0.
- [ ] Commit; `DOCS/STATUS.md` records the speed + crouch change.

---

## Phase B — The weapon system (L2, headless-first)

**Purpose:** the whole mechanical heart of the owner's third ask, provable without a browser.

### Task B.1 — Weapon data

**Where:** `src/data/weapons.ts` (new).

**Do:** a `WeaponDefinition` table with a closed vocabulary: `class` (`'ar' | 'smg' | 'dmr' | 'sniper' |
'shotgun' | 'pistol'`), `fireModes` (auto / single / burst), `rpm`, `burstCount`, `magazineSize`,
`reserveAmmo`, `reloadTime`, `reloadEmptyTime` (BGMI's tactical-vs-empty distinction), `bulletSpeed`,
`bulletDrop` (m/s²), `pellets` (shotguns), `recoilPattern` (per-shot vertical + horizontal radians),
`recoilRecovery`, `spreadBase`/`spreadPerShot`/`spreadMax`/`spreadRecovery`, `adsSpreadScale`,
`crouchSpreadScale`, `moveSpreadScale`, `adsFovScale`, `adsMoveScale`, `swapTime`, `range`, and a
`fireCue`/`reloadCue` pair from the audio vocabulary. **Six weapons**, one per class, with numbers that
make the classes *read* differently (an SMG that blooms and a DMR that does not, a sniper that cycles,
a shotgun that throws pellets). Authored, not guessed — each number is commented with the behaviour it
buys.

### Task B.2 — `WeaponSystem`

**Where:** `src/gameplay/weapon-system.ts` (new).

**Do:** the L2 runtime owner (runtime state only, never saved):
- **Loadout + switching:** an ordered slot list, `activeSlot`, a `swapTimer` that must elapse before
  the new weapon can fire, `selectSlot`, `cycleSlot`.
- **Fire control:** `fireHeld`/`firePressed` + the weapon's fire mode → a shot only when the `rpm`
  cooldown has elapsed (auto keeps firing while held, single needs an edge, burst fires N and stops).
- **Ammo:** magazine + reserve, `reload` (edge), the two reload durations, `dry-fire` on an empty
  magazine, and a reload interrupted by a switch.
- **Aim:** `adsBlend` eased toward the ADS input, `moveScale` (ADS + crouch aware — the value the
  composition hands the player step), and the *converged* aim direction it is given by the caller.
- **Recoil:** each shot consumes the next entry of the weapon's authored pattern, scaled down by ADS
  and crouch; the accumulated kick is reported as a **one-step impulse** for the camera (the rig owns
  the accumulator — §12.1).
- **Spread/bloom:** the current spread radius in radians, grown per shot and by movement, shrunk by
  ADS/crouch and over time; applied to each shot from a deterministic indexed pattern, never `random`.
- **Projectiles:** a fixed-capacity pool. Each step: apply `bulletDrop`, integrate, **sweep** the
  segment with `PhysicsPort.castRay`, and test the same segment against the loose part boxes the caller
  passes in (the port's `castRay` deliberately ignores carryables). A hit produces an `impact` event
  (point, normal, and the component id when a part was struck) and the bullet is recycled. Nearest hit
  wins, so a bullet cannot pass through a part to reach a wall behind it.
- **Report:** a read-only view for the HUD/camera/renderer + the events for the L4 side.

**Test first (all in `tests/logic/weapon-system.test.ts`, fake physics):**
- rpm gates the rate (a held auto trigger produces one shot per interval, not one per step);
- single fires once per press, burst fires exactly N and stops, auto continues while held and stops on
  release;
- magazine empties → dry fire; reload refills from reserve; an empty reload takes the longer time; a
  switch cancels a reload;
- the recoil impulse walks in the authored pattern's order and shrinks while ADS/crouched;
- spread grows with consecutive shots and shrinks when the trigger is released, and two identical
  input sequences produce **identical** shot directions (determinism);
- a bullet drops over distance, a bullet at a wall spawns exactly one impact and despawns, a bullet
  that would pass a part is stopped by it, and the pool never exceeds its capacity.

### Task B.3 — A short note on part impulses

**Do:** record in the code (and in `DOCS/CONTEXT/SHOOTING-MECHANIC.md`) that a bullet currently
*reports* a hit on a loose part but does not move it: pushing parts is a `ManipulationSystem`
capability (`ARCH §20.1`) and adding force on a shared pose owner is exactly the kind of change this
plan refuses to make blind. The impact event is the seam a later pass plugs into.

### Checkpoint — Phase B
- [ ] `npx vitest run tests/logic/weapon-system.test.ts` exit 0.
- [ ] `npx vitest run` exit 0 (no regression).
- [ ] `npm run typecheck` exit 0. Commit.

---

## Phase C — Input, world and camera wiring

### Task C.1 — The raw sample gains a right mouse button

**Where:** `src/ports/input-port.ts`, `src/adapters/dom-input-source.ts`, `neutralSample`/`emptyRawSample`.

**Do:** add `secondaryHeld`/`secondaryPressed`/`secondaryReleased` (button 2), tracked exactly like the
primary button, released by `clearAll()`. Update every factory and the DOM adapter test double.

### Task C.2 — The action set

**Where:** `src/gameplay/input-system.ts`.

**Do:** add `fire` (LMB, held + edge), `ads` (RMB, held), `reload` (`KeyR`), `crouch` (`KeyC`,
held), `weaponNext` (`KeyQ`), `weaponSlot` (`0…4`/none), all Exploration-only. **Choose the mouse
mapping deliberately:** `fire` owns the left button and the interact action keeps `KeyE`, because the
HUD prompt already reads `[E] Grab` (§33.2 rule 1) and because holding the trigger must not also mean
"grab whatever is under the reticle". The Manipulation context is unchanged — LMB still confirms while
carrying, and carrying never fires (you cannot shoot with your hands full).

**Test first:** each action appears only in its context; LMB sets `fire` and not `primary` in
Exploration; LMB still sets `primary` in Manipulation.

### Task C.3 — Route through the world step

**Where:** `src/gameplay/phase-world.ts`.

**Do:** step the weapon system in ARCH §14 order — after the player/camera (so it aims where the
player is looking) and **before** interaction/manipulation (so a shot cannot be confused with a grab).
Pass the player's speed/crouch/ADS move scale into the player step so ADS and crouch really slow the
player. Feed the weapon's recoil impulse into the camera step. Return the weapon view in
`WorldStepResult`.

### Task C.4 — Camera: recoil + ADS

**Where:** `src/gameplay/camera-rig.ts`.

**Do:** the rig owns a recoil accumulator (§12.1: only the rig writes its pose): `recoilKick` adds to
it, a recovery rate bleeds it back toward zero, and the effective view direction is the input pitch/yaw
**plus** the accumulator. ADS eases the arm shorter and the FOV in (`adsFovScale`) — `currentFov()` is
used by both `snapshot()` and `previewPose()` so the render preview cannot disagree with the sim.

**Test first:** a kick moves the view and then recovers; the accumulator is clamped; ADS shortens the
FOV/arm and releasing restores it; the same kick sequence reproduces the same pose.

### Checkpoint — Phase C
- [ ] `npx vitest run` exit 0 (input, camera, phase-world suites included).
- [ ] `npm run typecheck` exit 0. Commit.

---

## Phase D — Presentation (HUD, viewmodel, effects)

### Task D.1 — HUD weapon block + crosshair

**Where:** `src/presentation/hud.ts`, `src/style.css`, `src/main.ts` (the read-model).

**Do:** a weapon surface (name + class, `mag / reserve`, fire mode, slot chips, RELOAD/ADS state) built
from the literal template and addressed through `textContent`, plus a spread-aware crosshair. The
spread readout uses **shape + text**, never colour alone (§33.2 rule 4). A `dry-fire`/`reloading`
refusal is spoken, because a trigger that does nothing is indistinguishable from a broken one.

### Task D.2 — The weapon in the hands, tracers, muzzle flash, impacts

**Where:** `src/ports/render-port.ts`, `src/adapters/three-renderer.ts`, `src/presentation/weapon-fx.ts`.

**Do:** add an optional `setWeaponView(state | null)` (drawn weapon + muzzle point) and
`setShotEffects(state | null)` (pooled tracer segments + muzzle flash), and keep the flash/tracer
lifetimes in an L4 presenter exactly as `scanner-overlay.ts` does. The weapon mesh is procedural and
pooled (one geometry, one material, one draw call), positioned from `characterFacts().handR` so both
bodies (imported humanoid and procedural rig) hold it. Impacts reuse the existing pulse vocabulary
plus a new `impact` kind.

**Verify:** `node scripts/browser-check.mjs boot` still reports the body and draw calls inside budget.

### Checkpoint — Phase D
- [ ] `tests/dom/hud.test.ts` + `tests/boundary/*` exit 0; full suite exit 0.
- [ ] `npm run build` exit 0. Commit.

---

## Phase E — Weapon audio

**Where:** `src/ports/audio-port.ts`, `src/adapters/web-audio-bus.ts`, `src/presentation/feedback-composer.ts`.

**Do:** add the recipe cues (per-class gunshot, magazine out/in, bolt cycle, dry fire, weapon switch,
metal impact) as **synthesised** recipes on the existing bus — no assets, no downloads — and let the
composer map weapon events to them. Keep audio presentation-only: nothing in gameplay branches on it.

### Checkpoint — Phase E
- [ ] `tests/logic/web-audio-bus.test.ts` + full suite exit 0. Commit.

---

## Phase F — Live proof

### Task F.1 — `?guns=0` and the `guns` harness scenario

**Do:** weapons are on by default (the owner asked for them); `?guns=0` restores the pre-pass game
exactly. Add a `guns` scenario to `scripts/browser-check.mjs` that: boots, selects each weapon in turn,
fires a magazine, reloads, switches mid-reload, ads, crouches, and reports — per weapon — shots fired,
ammo before/after, the reload duration, whether a tracer/impact was produced, the recoil seen by the
camera, and the render budget (`drawCalls`/`triangles`, to prove the pool is flat).

### Task F.2 — Real Chrome from `dist/`

**Do:** `npm run build`, then boot `boot` and `guns` from `dist/` and record the **actual output** in
the Progress Log. Watch the numbers rather than a screenshot: hunt for a new console problem, an ammo
count that does not add up, a recoil that does not recover, or a draw-call count that grows with
shots.

### Checkpoint — Phase F
- [ ] `npm run build` exit 0 from the final code.
- [ ] `boot` (default body) and `guns` both exit 0 from `dist/`, with the raw numbers in the log.
- [ ] `?guns=0` verified: the pre-pass behaviour is intact.

---

## Phase G — Documentation

**Do:** `DOCS/STATUS.md` (shipped state + next up), a `DOCS/WORK/2026-10-16/WORK.md`, the
`DOCS/README.md` index row, and the `ARCHITECTURE.md` §3 / ADR note that narrows "Combat out of scope"
to "no enemies, damage, health or death" while admitting weapon handling and a sandbox range. Also
update `DOCS/CONTEXT/SHOOTING-MECHANIC.md` with what actually shipped.

### Checkpoint — Phase G
- [ ] `DOCS/README.md` starts with the structure marker and its index row is current.
- [ ] A new session can resume from the Progress Log alone.

---

## Plan issues

Append-only. Record every place reality differs from this plan **before** starting, or during a task.

| # | When | Task | Plan said | Reality (evidence) | Impact | Action taken |
|---|---|---|---|---|---|---|
| 1 | 16/10 | all | "the character feels slow" implied a speed bump only | The hop (jump) was already fully implemented and tested in the 15/10 session; the real gap is that neither jump nor crouch appeared in the controls table, so the owner believed jump was missing. | None on scope — it corrects the framing. | Phase A covers the real gaps: speed, crouch, and the controls table. Jump itself is unchanged (verified by the existing 20 hop tests). |
| 2 | 16/10 | C.2 | Keep `primary` = `KeyE` **or** LMB in Exploration | The left button must be free for firing (BGMI's trigger), but two existing suites grab with `primaryPressed` instead of a `KeyE` press: `phase-world.test.ts` and `p1-acceptance.test.ts`. | 2 test sites change to a real `KeyE` press. The behaviour is unchanged — only the *input path the test uses* is corrected to the one the game documents. | Tests updated in the same commit as the action split, with the reason recorded in the Progress Log. `Manipulation`-context confirm keeps both LMB and `KeyE`, so docking tests are untouched. |
| 3 | 16/10 | B.2 | — | `PhysicsPort.castRay` deliberately ignores carryable colliders, so bullets need their own segment-vs-box test against the part boxes the caller supplies (the same live poses the renderer draws). | Contained: one pure test-math helper in the weapon system, no port change. | Implemented as described; the part list crosses as a plain read-only array, so the weapon system still owns nothing but its own state. |

## Owner inputs

- Whether the firing key should be LMB (this plan's choice, BGMI-like) or a dedicated key. Planned
  default: LMB fires, `E` interacts, and the HUD already prompts `[E] Grab`, so nothing the player
  reads becomes untrue.
- Whether weapons should ship **on** by default. Planned default: **on** (the owner asked for them),
  with `?guns=0` as the documented escape hatch to the pre-pass game.
- Whether bullets should push loose parts. Planned default: **no** — they report the hit; moving parts
  belongs to the manipulation owner and is deliberately deferred (Phase B.3).

## Decisions

- Weapon state is L2 **runtime** state, never saved and never canonical: no save-codec, schema or
  `src/game-state/` change in this pass. *(assumed — keeps the LMG the sole progression authority.)*
- Recoil/spread are authored **patterns indexed by shot number**, never `Math.random()`. *(assumed —
  ARCH §2's "determinism before realism" and the harness's replay requirement.)*
- The camera owns its recoil accumulator; the weapon system only *asks* for a kick. *(assumed —
  ARCH §12.1's single-writer rule for camera pose.)*
- ADS and crouch slow the player by scaling the existing locomotion, not by adding a second speed
  table. *(assumed — same shape the manipulation context already uses for its slow strafe.)*
- Bullets hit static geometry and loose parts; they never touch the graph. *(required —
  SHOOTING-MECHANIC §5.1.)*

## Progress Log

### 15/10/2026 — god-mode completion (previous session, recorded here for continuity)
Done: Phase 1 (controller hop state + grounded Space edge + coyote/buffer timing) in `139b9ff` +
`a151896`; Phase 2 (Space jump edge exposed in `InputBindings`/`ActionState` and routed through
`PhaseWorld.step`) in `991b8b3`. Verified: typecheck exit 0; `npx vitest run` exit 0, 678 tests;
`npm run build` exit 0; `node scripts/browser-check.mjs boot --production` exit 0 from `dist/`.
Owed from that plan and folded into this one: carry feel tuning (hold blend / carry lift /
run-while-carrying) — see Phase A's follow-ups if the budget allows after Phase F.

### 16/10/2026 — session start
Recon: worktree clean, `main` == `origin/main` (0/0 after `git fetch`); `npm run typecheck` exit 0;
`npx vitest run` exit 0 with **678 tests** in 58 files. Read the architecture contract's scope line
(§3), `SHOOTING-MECHANIC.md`'s assessment, and the seams this pass touches (`input-system`,
`phase-world`, `player-controller`, `camera-rig`, `hud`, the render/audio ports, the harness).
Plan written with Phases A–G above and three Plan issues recorded before any code.
