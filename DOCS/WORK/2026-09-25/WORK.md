# 25/09/2026 — DOCS restructure into docs-structure v1

Housekeeping session, no game code touched. Scope came from the standard at
`E:\dev-recipes\docs-structure-standard\README.md`; the mapping below was proposed,
shown, and approved by the user before a single file moved.

## Plan

Migrate the scattered root docs into the canonical `DOCS/` layout, non-destructively
(no deletions, content preserved verbatim, `git mv` so history survives):

| Old path | New path | Why |
|---|---|---|
| `README.md` | stays at root | Project readme; `DOCS/README.md` is a *different* file (this index) |
| `PLAN.md` | stays at root | Standard: plan scaffolding for work in flight, deleted when the work closes — T1.3 is still open |
| `STATUS.md` | `DOCS/STATUS.md` | The running status file → the standard's `STATUS.md` |
| `PROJECT_STATE.md` | `DOCS/CONTEXT/PROJECT_STATE.md` | Context / history doc; kept whole so its internal anchors ("see CHK-8.1 below") stay valid |
| `GAME_ARCHITECTURE.md` | `DOCS/CONTEXT/ARCHITECTURE.md` | The project's own contract doc → `CONTEXT/` |
| `TEST_SUITE_PLAN.md` | `DOCS/CONTEXT/TEST-SUITE-PLAN.md` | Test / acceptance spec → `CONTEXT/` |
| — | `DOCS/README.md` (new) | The index, first line `<!-- docs-structure: v1 -->` |
| — | `DOCS/WORK/2026-09-25/WORK.md` (new) | This session |

Judgement calls taken at approval time:

- **`PROJECT_STATE.md` is not split** into per-day `WORK/<date>/WORK.md` files. Most
  CHK checkpoints carry no defensible single date, and splitting would break the
  file's internal cross-references; that is a separate migration if it is ever wanted.
- **The index starts with exactly one row** (this session). No rows were invented from
  git history — `WORK/` folders appear only when a session produces loggable output.
- **No PRD migration proposed**: this project has no legacy `DOCS/CONTEXT/PRD.md`, so
  that trigger does not fire and the `CONTEXT/` PRD slot stays empty.

## Execution

Done exactly as planned — nothing more, nothing less:

- Four history-preserving renames (`git mv`), shown as `R` by `git status`:
  `STATUS.md` → `DOCS/STATUS.md`; `PROJECT_STATE.md` → `DOCS/CONTEXT/PROJECT_STATE.md`;
  `GAME_ARCHITECTURE.md` → `DOCS/CONTEXT/ARCHITECTURE.md`;
  `TEST_SUITE_PLAN.md` → `DOCS/CONTEXT/TEST-SUITE-PLAN.md`.
- `DOCS/STATUS.md` moved **byte-identical** — its `Date: 2026-09-24` header and its
  `## Next up (start here)` block (owned by `/save-check`) were deliberately left alone.
- Created `DOCS/README.md` (conformance marker + the one-row index) and this `WORK.md`.
- One code-adjacent path fix: `package.json`'s description string now reads
  `See DOCS/CONTEXT/ARCHITECTURE.md.` The 297 `ARCH §NN` citations across 95 files in
  `src/` and `tests/` are by *section number*, never by filename, so they needed no change.
- The 13 gitignored `.tmp-*` root artifacts (harness / build output) were flagged as
  removal candidates and left in place: not docs, not this session's business.
- Nothing was deleted, no historical content rewritten, and the renames were left
  **uncommitted** for the user's own commit.
- Known loose end, recorded rather than fixed: `PLAN.md`'s internal mentions of
  `PROJECT_STATE.md` (lines 4, 9, 29 and the closing procedure at 2687) still use the
  old bare filename. `PLAN.md` is live scaffolding deliberately kept at the root, and
  its Progress Log is historical record, so it was left verbatim — the file it names now
  resolves at `DOCS/CONTEXT/PROJECT_STATE.md`.

## Plan — session 2: the player's first-contact report (mouse look + playability)

Reported by the user playing the live build: vertical look was **inverted** (mouse-down
looked up; left/right correct), movement felt odd, and nothing taught the controls
("I don't know how to play this game"). The screenshot in the report was the intended P1
opening — First Mesh, `Parts 0 / 11`, the loose gear and plate, the mesh socket, scanner
locked, hint at L0 — so nothing in the scene was wrong.

Diagnosis before any edit:

| Symptom | Root cause | Evidence |
|---|---|---|
| Mouse-down looks up | `CameraRig.placeAndCollide` placed the eye at `+sin(pitch)`, so a *decreasing* pitch (mouse-down, the DOM reports `+movementY` downward) dropped the eye below the anchor and tilted the view **up** — the opposite of the file's own comment ("negative looks down") | `camera-rig.ts`, `dom-input-source.ts` |
| Movement / aiming felt odd | The same sign: the default pose put the eye at **y = 0.0788 m** against a 1.4 m anchor — an ankle-height camera staring up 18°. The pitch clamps also ran backwards (~63° of *up*, ~31° of *down*) | the project's own pin, `tests/logic/camera-rig.test.ts:110` |
| No idea how to play | The HUD entry line explained only mouse capture; the control summary lived behind the title screen and `Esc → Controls` | `hud.ts` `renderEntry` |

**Immediate workaround given to the player:** `Esc → Settings → Invert vertical look`
already produced mouse-down-looks-down in the shipped build (the flag flips the same axis).

Planned fix: one sign in the rig (both integration sites), tests updated to the corrected
convention plus a mouse-direction regression test, the control summary added to the entry
line, and the browser harness's own copy of the old sign updated.

## Execution — session 2

- `src/gameplay/camera-rig.ts` — `direction.y = -sinPitch` in `placeAndCollide` and
  `-Math.sin(pitch)` in the render-time `previewPose`; the pitch-limit contract and the look
  integration now document pitch as the *view* angle (negative = down, eye above the anchor).
- `tests/logic/camera-rig.test.ts` — initial-pose pin 0.0788 → **2.7212** plus an explicit
  `eye.y > target.y` framing assertion; the two clamp tests re-stated as look-down /
  look-up; two new regressions (mouse-down looks down, mouse-up looks up).
- `src/presentation/hud.ts` — the entry line now carries `WASD move · mouse look · E grab ·
  Q/F rotate · R drop · H hint · all keys in Esc → Controls`.
- `tests/logic/phase-world.test.ts` — three `lookDeltaY: -120` → `+120`; its helper comment
  now states the convention instead of implying the opposite.
- `tests/logic/p1-acceptance.test.ts` — `focusPart` aims, lets the rig arrive, then re-aims if
  the reticle slid off the part, and the detach stance searches stand-offs; the stale
  "clamped ~31°" geometry note was corrected. This is fragility the camera fix *exposed*
  rather than caused: a mid-glide aim used to look settled because the old framing gave the
  eye almost nowhere to travel.
- `scripts/browser-check.mjs` — its aim math stores a *view* pitch (positive = down) while the
  rig stores the opposite sign: `pitchTo` now drives `-pitch` and the goal clamps read
  `[-0.55, 1.1]`. **Not executed since** (no browser available this session) — run
  `npm run check:browser` next session before trusting the harness.
- Evidence: typecheck clean, **597/597 tests (49 files)**, build green (`three` 563.58 kB /
  `app` 202.17 kB), `DOCS/STATUS.md` updated in place. Nothing but the rig's pitch sign
  changed in L1–L3, and it restores the documented convention rather than inventing one, so
  no ADR.

Deliberately not done (each needs its own decision): the auto-recentre carousel (strafing
for >2.5 s swings the camera behind the player and curves the path — currently *pinned as
intended* by a test), the dead `lookSensitivity` binding, dropped parts still hanging at
release height (PLAN T1.3), and the audio mix audit.
