# 10/10/2026 — the player's body: a procedural 3D human, and a dead harness brought back

Session opened as a `/recap` ("where did we leave it?") plus a research ask ("how do we develop
this further in an optimised way, with a proper 3D human"). The recap surfaced two things worth
acting on immediately, both verifiable in seconds:

1. `DOCS/STATUS.md` lists **T1.3 (gravity settle on dropped parts)** as the next-up item. It is
   already implemented and merged (`1c8af76`, "enable gravity fall on dropped parts");
   `src/gameplay/manipulation-system.ts` has `startFall`/`stepFalling`/`FALL_GRAVITY`, the stash it
   was tracking is gone, and the two tests that were expected to fight it pass:
   `phase-world.test.ts` (20) + `manipulation-system.test.ts` (47) = 67/67 green.
2. `scripts/browser-check.mjs` — the committed browser harness, the project's only end-to-end
   proof — **did not parse**. `node --check` died on an unterminated template literal: the last
   session's pitch comment inside `PROBE_SOURCE` used backticks, and one backtick ends the
   template. It had been broken since 25/09, which is exactly why `STATUS.md` admitted "not
   re-run since the camera fix".

## Plan

- Fix the harness so the live check path works again (backticks in probe comments → plain quotes).
- Build the player a real body, as *computed* geometry rather than an imported asset, because the
  project has no art pipeline, no asset budget on a GitHub Pages cold load, and a strong
  headless-test culture that an imported model would bypass.
- Keep the layering: pose maths in `core/` (no `three`), the rig in `adapters/`, the port
  unchanged so app/renderer fakes in `tests/` do not churn.
- Verify in a real browser, not just in unit tests.
- Write the research/roadmap note for the "proper 3D human" question rather than guess at it.

Deliberately **not** done: no new npm dependency, no glTF asset downloaded, no physics-engine
swap, and nothing touched outside this project.

## Execution

**New — `src/core/character-pose.ts` (L0, pure).** Joint table (19 joints, parent-relative rest
offsets, limb lengths in one place), `sampleCharacterPose(input, out)` (idle ↔ gait blend by
speed, run lean, airborne tuck, carry stance, ankle compensation, breathing), `GaitDriver`
(gait phase advanced by **distance travelled** so feet do not slide; its own breath clock so a
standing character is not frozen), and `solveArmAim` — the analytic two-bone solve returning the
upper arm's aim direction, the shared bend axis and the elbow bend. Everything writes into caller
buffers (`out` convention from `vec3.ts`); every output is clamped to ±1.5 rad and sanitised, so
`NaN` in means finite out.

**New — `src/adapters/character-rig.ts` (L4).** Builds the bone hierarchy from that table, one
merged skinned geometry for the whole body (box/cylinder/sphere primitives, per-part bone index,
vertex colours for steel/limb/brass/visor so the detail costs no extra draw call), and animates
from a single mutable `CharacterUpdate` buffer. While a part is held it blends the arms onto the
IK solve, converting the solved root-space basis into the chest/shoulder's frame so the elbows
always fold through the target. Hides the body when the spring arm is pulled inside it, and keeps
the old run/carry emissive feedback.

**Changed — `src/adapters/three-renderer.ts`.** The capsule marker is gone (it was also
`visible = false` and never unhidden: the shipped build drew no player). `syncPlayerMarker` now
fills the update buffer — including the camera distance and the held part it last saw in
`setCarryables` (a 33 ms lag on the grip, never fed back into logic) — and `characterFacts()`
implements the new optional port method.

**Changed — `src/ports/render-port.ts`.** `CharacterFacts` + optional `characterFacts?()`.
Optional on purpose: every test double keeps compiling, and a port with no body simply omits it.

**Changed — `src/main.ts`.** `__gearwrightDev.character()` reads the facts live (a boot-time
snapshot would have reported the body before its first frame).

**Changed — `scripts/browser-check.mjs`.** Harness now parses; the probe grew a `character()`
reader; `scenarioBoot` asserts bones = 19, triangles ≥ 500, visible, and that the body stands on
the simulation's own position (≤ 0.5 m), pushing to `problems` on failure. The probe comment now
also warns about the template-literal trap that killed it.

**Docs.** New `DOCS/CONTEXT/CHARACTER-3D.md`: what shipped, the measured cost, three routes to a
*proper* 3D human (improve the procedural rig / import a Mixamo-class humanoid with a meshopt +
KTX2 pipeline / keep the procedural body as the contract with a glTF behind the same
`CharacterUpdate` seam), development-process optimisations, and why the physics engine should not
be swapped for a WASM controller.

## Verification (real commands, real output)

| Check | Command | Result |
|---|---|---|
| Typecheck | `npm run typecheck` | clean (exit 0) |
| Tests | `npx vitest run` | **618 passed / 51 files** (was 597/49; +21 tests, +2 files) |
| Build | `npm run build` | green — app 215.35 kB (gzip 64.23 kB), `three` 567.56 kB |
| Harness syntax | `node --check scripts/browser-check.mjs` | OK (previously a `SyntaxError` at line 302) |
| Live boot | `npm run check:browser -- boot` | `character: {bones: 19, triangles: 1440, visible: true, x: -4.5, y: 0.002, z: 12}` == the player's spawn; lifecycle paused→running, 516 frames |
| Live hold | `npm run check:browser -- hold` | `{focused: true, state: "Manipulation", held: "gear-a", yaw: 0}` — the PLAN T1.1 human-length `E` grab still holds, re-verified after the camera fix for the first time |

Both harness runs report exactly one `problems` entry: the pre-existing ANGLE `X4122` shader
precision warning, which is also present in the 24/09 `title`/`hold` reports — i.e. not introduced
by the skinned mesh, and not a failure.

New tests: `tests/logic/character-pose.test.ts` (13) — IK proven by forward kinematics (the wrist
lands on the target to 1e-6 inside reach, aims at it when beyond), skeleton symmetry and height,
gait/blend/air/carry behaviour, distance-driven phase, hostile-input sanitising.
`tests/dom/character-rig.test.ts` (6) — the built skeleton stands on the floor with a human
height, the stride moves the legs and freezes when standing, both hands converge on a held part
(< 8 cm) and release back, the body hides when the camera arm closes, and non-finite state cannot
poison a bone matrix.

## Session 2 — feet on the ground, head on the target, and a shooting verdict

Asked to keep improving mechanics and to assess a shooting feature. Two mechanic upgrades landed,
plus the assessment (not the implementation) for shooting.

**Foot planting (leg IK).** New `src/gameplay/foot-grounding.ts` casts two rays per presented frame
(`PhysicsPort.castRay`) from the feet and reports the surface under each one; `PlayerMarkerState`
gained an **optional** `footGroundY`, so no port double changed. The core module gained
`solveLegAim` — the mirror of the arm solve (same triangle, bend axis on the character's lateral
axis, knee folding forward) — and the rig plants each leg on its own surface: the ankle sits one
`CHARACTER_ANKLE_HEIGHT` above it, the sole stays level, and the **pelvis drops** (≤ 0.12 m) so a
planted foot always reaches its surface instead of floating. Only the **stance** foot is planted
while walking (the swing foot keeps the gait's lift), and both are planted when standing.

**Head look-at.** The neck and head ease onto a look target — the focused object if there is one,
otherwise the camera's aim — split between neck and head, clamped (+/-0.6 rad yaw, +/-0.4 pitch),
and easing back to the posed direction when the target goes. The renderer had both values already
(the focus marker and `setView`), so this needed no new port surface.

The arm solve was generalised into one shared two-bone solver (`LimbAim.bend`, positive for elbows,
negative for knees) rather than duplicating the triangle maths; the arm tests kept their exact
assertions.

**Verification this session:** typecheck clean; **626 tests / 52 files** green (was 618/51); build
`app` 220.58 kB (gzip 65.73 kB), `three` unchanged; live Chrome `boot` -> `character {bones: 19,
triangles: 1440, visible: true, x: -4.5, z: 12}` with foot probing running every frame and **no new
console problems**, and `hold` -> `{focused: true, held: "gear-a", yaw: 0}` still passing with carry
+ planting + look-at all active.

**Shooting:** assessed, not built — `DOCS/CONTEXT/SHOOTING-MECHANIC.md`. Short version: technically
cheap (swept-ray projectiles, procedural geometry, pooled, no engine, no assets, no new dependency),
blocked only by `ARCHITECTURE.md` §3 listing *Combat* as out of scope, and best shaped as a
**pneumatic parts launcher** (shooting the carryables the puzzle already uses) plus a flagged test
range rather than enemies and damage.

## Session 3 — the harness learns to see hands, and the rig gets a preview room

Closed the remaining item from session 2's "next up": the hands-on-part harness check plus the
`?rig=1` preview mode (STATUS.md item 3, CHARACTER-3D.md §6 items 2b + 3).

**Grip facts (additive port surface).** `CharacterFacts` gained optional `handL/handR`
(world-space), `holding`, and `hold` (the grip target) — optional so every existing port double
keeps compiling. `CharacterRig` snapshots the grip each frame (facts-only, never read back into
the pose) and reports world hand positions; a new rig test pins it (free hands → `holding: false`,
`hold: null`, hands still reported; gripping → both hands within 8 cm of a reachable target).

**The gate that caught a design truth.** The first version of the `hold` check asserted raw
proximity (hands within 0.35 m of the part) and failed live at 0.87 m — correctly. The carry pose
floats the part 1.35 m ahead of the torso (`DEFAULT_MANIPULATION_TUNING.holdDistance`) while the
arms reach 0.56 m (`CHARACTER_ARM`), so the analytic IK clamps at full extension along the reach
direction by construction. The shipped gate asserts the *reach shape* instead: each hand extended
along the chest → part direction (dot > 0.9) and out from the body (> 0.4 m), yaw-independent.
Live `hold` now passes with `held: "gear-a"` and both hands reaching; `boot` also reports the
live hands. Only the pre-existing ANGLE `X4122` warning remains.

**`?rig=1` preview.** New `src/adapters/rig-preview.ts` (L4, so the import-boundary gate stays
green — the first draft lived in `debug/` and the gate correctly rejected it): a standalone
scene + own `CharacterRig` + slider panel (speed, gait scrub, carrying, grounded), lazy-imported
from `main.ts` only when the flag is present, so production without the flag is byte-identical
apart from the import stub. Its own chunk (`rig-preview` 3.69 kB / gzip 1.65 kB) keeps the
shipped `app` chunk clean. Pinned by a jsdom test (no WebGL there: mount reports `ok: false`,
adds nothing, never throws) and appended-only CSS (the stylesheet boundary test stays green).

**Verification this session:** typecheck clean; **628 tests / 53 files** green (was 626/52);
production build splits `rig-preview` into its own lazy chunk; live Chrome `boot` + `hold` both
pass with the new grip data. No gameplay, layering, or bundle-default change: the port addition
is optional, the preview is flag-gated and lazy, the harness only gained assertions.

## Known loose ends (recorded, not fixed)

- Rigid one-bone-per-vertex skinning leaves visible joints (intended: mechanical, not fleshy).
- The grip solves in character space, so the torso's own rotation leaves the hand a couple of
  centimetres off the ideal point (asserted as ≤ 8 cm in the test).
- Foot planting is vertical only: the ankle keeps its rest fore/aft position, so a foot can still
  slide along a surface while the stride plays. Real foot sticking needs a locked world-space plant
  through the stride, which is the next step if the skating ever reads badly.
- Nothing consumes the shooter assessment yet; it needs the owner's call (see that doc's §5).
- `STATUS.md`'s T1.3 "next up" line was stale for two weeks; corrected in this session rather
  than left to mislead the next one.
- The camera still recentres by pivoting (a pinned-as-intended behaviour), which is now more
  visible with a body on screen — worth a play-test opinion, not a change in this session.
