# PLAN — locomotion + carry feel pass (ADR-019 god-mode completion)

**Written 15/10/2026.** Temporary file — deleted when this closes.

**Goal:** finish the in-progress god-mode mechanics pass so Space hops, carry lift, slower drops, and snap/feedback juice all land behind a headless-first gate and a real-browser feel check, without changing the puzzle graph, save schema, progression or Branch B content.

**Why:** the controller + tuning were already edited (walk 3.0 / run 6.0, gravity 16, hop tuning present) and the stale player-controller test assertions were just fixed. The next thing the project owner asked for is gameplay feel that reads as a real workshop worker, not more content. The project's own `DOCS/STATUS.md` lists exactly this as the open god-mode item, and it explicitly says the hop wiring is the first step.

**What this changes:**
- `src/gameplay/player-controller.ts` — add the hop state + grounded-only Space edge; export a tiny tuning seam for the hop.
- `src/gameplay/phase-world.ts` — route a `jump` edge into the player step through `WorldStepInput`.
- `src/gameplay/input-system.ts` — expose the Space edge as a first-class action only where the feel pass consumes it.
- `src/gameplay/manipulation-system.ts` — carry tuning + run-while-carrying scale + a small lift assist while a part is held.
- `src/presentation/feedback-composer.ts` / `src/presentation/hud.ts` / `src/gameplay/feedback-model.ts` — a light `Hop` intent only if we want a hop cue; otherwise no UI change.
- `tests/logic/player-controller.test.ts`, `tests/logic/phase-world.test.ts`, `tests/logic/manipulation-system.test.ts` — new/extended cases for the hop and carry tuning.
- `DOCS/STATUS.md` — record what landed and what is still owed (human eye on the imported body).

**Done means:** `npx vitest run` green and `npm run build` green, and one real Chrome boot from `dist/` shows the player hop on Space and the carry tuning, with no new console problems beyond the two already documented (ANGLE `X4122` and AudioContext autoplay).

**Out of scope:**
- Branch C, the reward consumer/upgrade pipeline, the shooting-scope decision, and any new content. Those stay on `DOCS/STATUS.md`'s existing next-up list.
- Anything that touches `src/game-state/`, the save codec, `src/levels/`, `data/`, or the deployment pipeline.
- Foot planting on crate tops/slopes, head look-at, airborne tuck, crouch — those are the next realism items *after* this pass, per the current status file.

---

## Read this first

1. Bring the workspace up to date: `git pull` is not needed unless you know the remote moved; this plan assumes the working copy is the commit you just fixed. Confirm with `git status --short` — the only expected dirty file before execution starts is `tests/logic/player-controller.test.ts`.
2. Read only:
   - `DOCS/STATUS.md` — the standing status and the god-mode next-up item.
   - This file's rules, your current task, and the last Progress Log entry.
   - Do **not** read `PLAN.md` at the root — that is the closed overhaul plan's scaffolding, not this work.
   - Large/historical files to skip whole: `DOCS/CONTEXT/PROJECT_STATE.md`, `src/gameplay/manipulation-system.ts` (read only the parts your task names).
3. Detect the environment with commands, never remembered values:

| Check | Command | Pass looks like |
|---|---|---|
| Clean baseline | `npm run typecheck && npx vitest run` | exit 0, 671 tests pass |
| Production build | `npm run build` | exit 0, `dist/` rebuilt with the hashed `vanguard-<hash>.glb` |
| Live boot from dist | `node scripts/browser-check.mjs boot` | exit 0, `character.body` reported, no new console problems |
| Git state | `git status --short` | only the planned files dirty, or clean after each checkpoint |

## Facts verified while planning

| Fact | Source | Checked on |
|---|---|---|
| The controller already has the god-mode tuning and the new `PlayerTuning` fields (`jumpSpeed 4.6`, `coyoteTime 0.12`, `jumpBufferTime 0.15`), walk 3.0 / run 6.0, gravity 16. | `src/gameplay/player-controller.ts` — `DEFAULT_PLAYER_TUNING` | 15/10/2026 |
| The hop wiring is NOT implemented yet: `PlayerStepInput` has no `jump`, and `PlayerController.step` does not read one. | `src/gameplay/player-controller.ts` — `PlayerStepInput` and `step` | 15/10/2026 |
| The world step does not pass a jump edge into the player. | `src/gameplay/phase-world.ts` — `step` and `WorldStepResult`/`WorldSystems` | 15/10/2026 |
| The Space key is already `KeyE`-adjacent in the binding map only for primary; there is no dedicated jump action today. | `src/gameplay/input-system.ts` — `DEFAULT_BINDINGS` | 15/10/2026 |
| Branch B is complete and the branch harness can still be driven from the same harness script. | `DOCS/STATUS.md` verification block + `scripts/browser-check.mjs` | 15/10/2026 |
| The deployment pipeline is intact: `.github/workflows/deploy.yml` builds from `dist`, and `dist/` already builds locally. | `.github/workflows/deploy.yml`, `npm run build` | 15/10/2026 |
| The only known console output is the ANGLE `X4122` warning and, in `branch` only, the AudioContext autoplay notices. | `DOCS/STATUS.md` verification block | 15/10/2026 |

## Rules for every task

- Never touch `src/game-state/`, the save codec, `src/levels/`, `data/`, `src/adapters/three-renderer.ts` beyond what a task names, or `.github/workflows/`.
- Every new behavior gets a headless test before or alongside the code; the live browser check is the feel gate, not the only gate.
- Keep the hop locomotion-grade and low: it is a utility bump for clutter and feel, never a parkour system. Document that intent where the code is read.
- Keep determinism: the hop must be edge-triggered, grounded-only with coyote/buffer, and deterministic at the fixed dt the controller already is.
- No new console output beyond the two already documented. If a new one appears, treat it as a defect, not a pass.

## Failure handling

| Situation | Do this |
|---|---|
| `npm run typecheck` fails | Fix the type error at the site it names; do not widen types just to silence it. Re-run typecheck alone first. |
| A player/phase-world test fails after the hop lands | Read the failure at the assertion it names; the likely cause is a stale expectation, a missing `jump` edge in the test's input, or a coyote/buffer case the test did not set up. Fix the real cause. |
| The live boot from `dist/` fails to hop | Instrument `scripts/browser-check.mjs` only enough to see whether the edge reaches the player; do not litter production code with logs. |
| Anything else fails | Fix and retry at most three times; then set the work aside (stash), record the real output in the Progress Log, and continue with the next independent task. Retry once at phase end. |
| The plan itself looks wrong | Follow **Plan issues** below — decide by impact, never freeze the whole plan. |

---

## Phase 1 — Hop + grounded edge in the controller

**Purpose:** make Space a grounded-only utility hop that matches the tuning already in `DEFAULT_PLAYER_TUNING`, and prove it headlessly before any browser feel check.

**Starts when:** this plan is approved and the baseline `npm run typecheck && npx vitest run` is green.

**Re-check first:** confirm the controller still has `jumpSpeed 4.6`, `coyoteTime 0.12`, `jumpBufferTime 0.15` and walk 3.0 / run 6.0 / gravity 16. If any of those moved since planning, update the test values here to match, and log it under Plan issues.

### Task 1.1 — Add the jump edge to the player step

**Goal:** the controller hops exactly once per grounded Space edge, with coyote + buffer, and never hops in the air.

**Why:** this is the whole point of the open god-mode item in `DOCS/STATUS.md`. Without it, the tuning already in the file is dead code.

**Where:** `src/gameplay/player-controller.ts` (search text: `interface PlayerStepInput` and `export class PlayerController`).

**Do:**
- Add `readonly jump: boolean` to `PlayerStepInput`. Its meaning is "Space was pressed this step", not "held".
- Add the hop state the step needs: a groundY tracker for coyote time, a buffer timer for a pressed-but-not-yet-landed edge, and a small landing-time record so the buffer window is measured against landing, not against step clocks in a way that drifts.
- In `step`, after the vertical stick/fall math and before `moveAndSlide`, if `jump` is true and either the player is grounded now or coyote time is still open, set an upward velocity from `this.tuning.jumpSpeed` and consume the buffer; otherwise, if grounded, clear any buffered jump.
- Keep the hop a single vertical bump: do not add horizontal launch, do not double-jump, do not let the hop change the horizontal blend or facing logic.
- Do not change the existing walk/run/turn/grounding math; the hop is additive vertical only.

**Test first:**
- New test in `tests/logic/player-controller.test.ts`: grounded Space edge → one step later the player is airborne with an upward velocity near `jumpSpeed`, then falls back under the existing gravity/terminal-speed math.
- New test: pressing Space while airborne does nothing (no hop, no velocity change).
- New test: coyote time — pressing Space a little after leaving a ledge still fires once; pressing after the coyote window does not.
- New test: jump buffer — pressing Space before landing and landing inside the buffer window fires once; the same press outside the window does not.
- Keep all three existing failing-style assertions already corrected (walk 3.0, run 6.0, terminal -14); they stay green.

**Verify:** `npx vitest run tests/logic/player-controller.test.ts` → exit 0, the new hop/coyote/buffer tests pass, and the settled-speed and terminal-speed tests still pass at the tuned values. Then `npm run typecheck` → exit 0.

**Don't touch:** `src/gameplay/phase-world.ts`, `src/gameplay/input-system.ts`, `src/game-state/`, `tests/` other than the player-controller suite and the assertions this task is allowed to touch.

**If it fails:** re-read the failure at the exact assertion. Most likely: the coyote/buffer window was measured against wall-clock or step count instead of against landing time; fix it to be deterministic at fixed dt. If a type error appears on `PlayerStepInput`, that is expected — fix the one new field, do not widen unrelated types.

**Commit:** `` `god-mode: wire the grounded Space hop into the player controller` ``

### Checkpoint — Phase 1

- [ ] `npx vitest run tests/logic/player-controller.test.ts` exit 0 with the new hop/coyote/buffer/grounded-only tests green.
- [ ] `npm run typecheck` exit 0.
- [ ] `npx vitest run` exit 0, 671 tests pass (no regression).
- [ ] Commit made for Task 1.1.
- [ ] Status file updated: `DOCS/STATUS.md` should now say the controller hop is implemented and headlessly verified, and that the world routing + carry tuning + live feel check are still owed.

---

## Phase 2 — Route the jump edge through the world step and input

**Purpose:** the real sim receives the Space edge through the same ARCH §14 wiring the rest of the game uses, and the edge is only visible where the feel pass means to consume it.

**Starts when:** Phase 1 checkpoint is done and committed.

**Re-check first:** confirm `PhaseWorld.step` still takes `RawInputSample` and still returns `WorldStepResult`. If the signature changed since planning, adapt the routing to the real shape and log it.

### Task 2.1 — Expose the Space edge where the world step can see it

**Goal:** the world step can pass a `jump` flag into the player without leaking a new action into unrelated systems.

**Why:** the hop must reach the controller through the existing pipeline, and it should not become a global action that other systems accidentally consume.

**Where:** `src/gameplay/phase-world.ts` (search text: `const player = this.systems.player.step`) and `src/gameplay/input-system.ts` (search text: `readonly primary: boolean`).

**Do:**
- Decide the source of the edge. The cleanest option that fits this project's existing `InputSystem.sample(raw)` shape is to derive a `jump` edge from a dedicated binding (for example a `jump` binding defaulting to `Space`) inside `sample`, in the same way `primary` already becomes a pressed edge. Do not invent a new input port; reuse the existing raw sample's pressed set.
- Add the binding and the derived `jump: boolean` to the action state the world step reads. Keep it Exploration/Moving-aware in the same sense as the other movement actions — it is a locomotion command, not a menu action.
- In `phase-world.ts`, pass that edge into the player step as part of the `PlayerStepInput` constructed there.
- Do not route `jump` into the manipulation layer, the camera, or the feedback model from this task — only the player controller sees it yet.

**Test first:**
- New test in `tests/logic/phase-world.test.ts` (or extend an existing locomotion case): given a raw sample with the Space binding pressed, the world step produces a player state that reflects an airborne hop after the controller's coyote/buffer rules allow it, using the same fake physics the suite already has.
- The test must not assert feel numbers that belong to Phase 3; it asserts only that the edge reaches the controller and changes vertical motion in the allowed cases.

**Verify:** `npx vitest run tests/logic/phase-world.test.ts` → exit 0, plus the full `npx vitest run` → exit 0, 671 tests pass. `npm run typecheck` → exit 0.

**Don't touch:** `src/gameplay/manipulation-system.ts`, `src/presentation/`, `src/game-state/`, `src/levels/`.

**If it fails:** if the raw sample does not yet carry a clean "Space pressed this step" signal in the test fake, fix the fake to match the real `DomInputSource` semantics, not the other way around.

**Commit:** `` `god-mode: route the Space jump edge through the world step` ``

### Checkpoint — Phase 2

- [ ] `npx vitest run tests/logic/phase-world.test.ts` exit 0 with the new routing case.
- [ ] `npx vitest run` exit 0, 671 tests pass.
- [ ] `npm run typecheck` exit 0.
- [ ] Commit made for Task 2.1.
- [ ] Status file updated: `DOCS/STATUS.md` should now say the hop edge is wired through the world step, and that carry tuning + live feel check are still owed.

---

## Phase 3 — Carry feel: lift, run-while-carrying, and snap/feedback juice

**Purpose:** while a part is held, the carry should feel lighter on the vertical and calmer in the hands, and the snap assist should still guide without taking over.

**Starts when:** Phase 2 checkpoint is done and committed.

**Re-check first:** confirm the manipulation tuning still has `holdDistance 1.35`, `holdBlend 14`, `maxLinearSpeed 8`, `assistEnabled true`. If those moved, match them.

### Task 3.1 — Tune the carry motion and allow running while carrying at a reduced scale

**Goal:** a held part follows the player with a calmer vertical and a slightly stronger hold blend, and the player may still run while carrying at a reduced speed so the workshop traversal does not stop dead the moment something is picked up.

**Why:** the status file explicitly lists carry tuning (holdBlend up, rotate faster, allow run-while-carrying) as part of this pass. This is where that becomes real behavior, not a bullet.

**Where:** `src/gameplay/manipulation-system.ts` (search text: `export const DEFAULT_MANIPULATION_TUNING`) and `src/gameplay/phase-world.ts` (search text: `const MANIPULATION_MOVE_SCALE = 0.55`).

**Do:**
- Raise the carry tuning from the defaults in a controlled way: a stronger `holdBlend` so the held part tracks the hold target with less lag, and a modest carry lift so the part sits a touch higher while held (this is a feel lift on the held object, not a player jump — the player capsule is unchanged).
- Allow run-while-carrying at a reduced scale: when holding, the exploration run modifier still applies but at a fraction of the full run speed, so carrying does not pin the player to walk speed. Keep the existing `MANIPULATION_MOVE_SCALE` idea, but let the run modifier still add a little.
- Keep the max linear speed clamp on the held object so the part cannot be flung by moving fast; the player moves faster, not the part.
- Do not change the snap assist contract: assist is still proportional to proximity and still below 1, and a held part can still be pulled out of the volume.

**Test first:**
- Extend `tests/logic/manipulation-system.test.ts`: a carried part tracks the hold target more tightly under the new `holdBlend`, and the part's vertical sits at the new carry lift while held.
- New test: while carrying, the player step can still move faster than walk when the run modifier is present, but the held part's max linear speed stays clamped.
- No test should assert the hop here; hop + carry is an integration feeling, verified in the browser in Phase 4, not in the headless carry suite.

**Verify:** `npx vitest run tests/logic/manipulation-system.test.ts` → exit 0, plus full `npx vitest run` → exit 0, 671 tests pass. `npm run typecheck` → exit 0.

**Don't touch:** `src/game-state/`, `src/levels/`, `data/`, `src/presentation/hud.ts` except a possible tiny carry-related HUD cue only if a later task explicitly adds one.

**If it fails:** if the held part starts jittering or the snap assist fights the new lift, reduce the lift and/or the blend increase; the goal is calmer carry, not more motion.

**Commit:** `` `god-mode: tune carry lift, hold blend, and run-while-carrying` ``

### Task 3.2 — Small feedback cue for the hop and for the carry lift (only if it earns its screen space)

**Goal:** if a hop or a carry-lift cue is worth showing, add the smallest possible read-model cue; if it is not worth a cue, do nothing and skip this task.

**Why:** HUD toasts/sound are explicitly listed in the status file's god-mode pass, but only if they earn it. A hop that is purely locomotion may not need a toast; a carry lift might only deserve a subtle audio cue through the existing audio port.

**Where:** `src/gameplay/feedback-model.ts` (search text: `FeedbackIntent`) and, only if needed, `src/presentation/feedback-composer.ts`.

**Do:**
- Decide, with evidence, whether a hop cue is warranted. The default answer for this plan is **no toast for a normal hop**: a hop is a movement action, not an event that needs announcing. If we do add a cue, it should be the existing audio-bus gesture path or a tiny compatibility cue only when the hop is refused (for example landing on a part that cannot be hopped over — but only if that case actually exists after Phase 1/2 are real).
- If a carry-lift cue is wanted, keep it to the existing SFX vocabulary already composed; do not invent a new audio event this plan does not own.
- If neither cue earns its screen space, this task is a no-op and is committed as such with an explicit "no cue added, feel verified in browser" note.

**Test first:**
- If a cue is added, the headless test is the feedback model or composer test that already exists; the cue is verified as "emitted in the right edge case" or "not emitted for a normal hop", whichever is chosen. If no cue is added, no new test is needed.

**Verify:** `npx vitest run` → exit 0, 671 tests pass. `npm run typecheck` → exit 0. If a cue was added, the existing feedback/composer test still passes and the new one does too.

**Don't touch:** `src/game-state/`, `src/levels/`, `data/`.

**If it fails:** if a cue creates noise, remove it. The default outcome for this plan is "no cue", and reverting a noisy cue is the right fix, not silencing a test.

**Commit:** `` `god-mode: add or deliberately skip the hop/carry feedback cue` ``

### Checkpoint — Phase 3

- [ ] `npx vitest run tests/logic/manipulation-system.test.ts` exit 0.
- [ ] `npx vitest run` exit 0, 671 tests pass.
- [ ] `npm run typecheck` exit 0.
- [ ] Commit made for Task 3.1 and, if anything was done, Task 3.2.
- [ ] Status file updated: `DOCS/STATUS.md` should now say the carrier tuning landed (hold blend, carry lift, run-while-carrying), and that only the live feel check is still owed.

---

## Phase 4 — Live feel check from `dist/`

**Purpose:** prove the new feel in a real browser from the production build, not only in headless fakes.

**Starts when:** Phase 3 checkpoint is done and committed.

**Re-check first:** confirm `npm run build` still emits `dist/assets/vanguard-<hash>.glb` and the hashed app chunks. If the hash names moved, use the real `dist/index.html` and the real asset names.

### Task 4.1 — Browser feel check

**Goal:** in a real Chrome session from `dist/`, Space hops when grounded and does nothing when airborne, a held part tracks calmer and sits a touch higher, and running while carrying still works at the reduced scale.

**Why:** headless fakes cannot answer whether the import reads right while hopping or carrying. This is the feel gate the status file already owes.

**Where:** `scripts/browser-check.mjs` is the existing harness; use it, or drive the built page by hand. Do not invent a new harness unless the existing one truly cannot express the check.

**Test first:**
- There is no headless test that can decide feel; the pass criterion is the real Chrome observation from Task 4.1, recorded in the Progress Log. The headless suite is still required to stay green first, and it is the gate that proves the hop and carry math exist — the browser check answers only whether they *feel* right on the imported body.

**Do:**
- Build with `npm run build`.
- From `dist/`, boot the game and verify Space hops from the ground and does nothing in the air, using the live interaction model (focus a part, grab, carry, hop, release).
- Verify the held part tracks more tightly and sits a touch higher while carried.
- Verify running while carrying still moves the player, at a reduced scale.
- Note in the Progress Log whether the imported body still looked right during hops and carries. If it looked wrong, record that as a finding and keep `?body=proc` as the documented fallback; do not block the pass on an aesthetic judgement that the owner has not made.

**Verify:** Manual, real Chrome from `dist/`. Pass looks like: hop works only when grounded, carry tracks calmer and higher, run-while-carrying works, and the console shows only the two already-documented expected outputs. Record the actual observation in the Progress Log rather than claiming it.

**Don't touch:** `src/game-state/`, `src/levels/`, `data/`, `.github/workflows/`.

**If it fails:** if the hop still does not fire live, instrument the harness just enough to see whether the edge reaches `PhaseWorld`; if it does, the issue is in the controller wiring, not the harness. If the carry feels worse, reduce the tuning change before changing anything else.

**Commit:** `` `god-mode: live feel check result recorded` `` — or none, if nothing code-side changed in this phase; in that case record the result only in the Progress Log and STATUS.md.

### Checkpoint — Phase 4

- [ ] `npm run build` exit 0 from the final code.
- [ ] Real Chrome from `dist/` shows the hop and carry tuning behaving as intended; the observation is recorded in the Progress Log.
- [ ] STATUS.md updated to say the god-mode pass landed (or, honestly, what still felt off), and to keep the known console outputs as the only expected ones.
- [ ] Commit made for the phase (either Task 4.1 if anything code-side changed, or a documentation-only commit recording the live result).
- [ ] A new session can resume from this checkpoint's Progress Log entry.

---

## Plan issues

| # | When | Task | Plan said | Reality (evidence) | Impact | Action taken | Owner decision |
|---|---|---|---|---|---|---|---|
| — | — | — | — | — | — | — | — |

Append-only. The executor records every place where reality differs from this plan before starting, or during a task.

## Owner inputs

- Whether the imported body should keep being the default if it looks wrong while hopping/carrying. Planned default: keep `vanguard.glb` as default, `?body=proc` as documented fallback, and record any read-misleading observation in STATUS.md rather than switching the default without a decision.
- Whether a hop cue is wanted at all. Planned default: no toast for a normal hop; a cue only if a real refusal case appears and earns it.

## Decisions

- The hop is grounded-only with coyote + buffer and is a vertical bump only. *(assumed — matches the existing ADR-019 comment block already in `player-controller.ts`.)*
- The carry lift is a held-part feel lift, not a player jump; the player capsule physics is unchanged. *(assumed — keeps the hop and the carry independent and deterministic.)*
- No new input port is added; the Space edge is derived from the existing raw sample + binding map. *(assumed — fits the existing `InputSystem.sample` shape and avoids a new port.)*
- No new content, save schema, progression, or graph change in this plan. *(assumed — explicit scope from the status file's god-mode item.)*

## Progress Log

### god-mode completion — 15/10/2026
Done: plan written, baseline fixed (controller tuning live, stale player-controller assertions corrected to 3.0 / 6.0 / -14, typecheck/build/tests green).
Verified: `npm run typecheck` exit 0; `npx vitest run` exit 0, 671 tests; `npm run build` exit 0 with `dist/assets/vanguard-CNkOLTHg.glb` and the hashed app chunks; `node scripts/browser-check.mjs boot` exit 0 from the built artifact.
Surprises: none yet — the only regression this session was the stale test numbers, now matched to the tuned controller.
Next: approve this plan, then start Phase 1 (Task 1.1) — add the jump edge to `PlayerStepInput` and the grounded-only hop state to `PlayerController.step`.
Commit: `not committed — plan phase`.
