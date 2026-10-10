# Project Status — Gearwright

**Branch:** `main` | **Date:** 2026-10-10 | **Phase:** Post-Overhaul / Character & Content Expansion
**Worktree:** `E:\gearwright` · **Status file:** `DOCS/STATUS.md` (index: `DOCS/README.md`; this session's log: `DOCS/WORK/2026-10-10/WORK.md`)
**Live Game:** https://shrinivas-sn.github.io/gearwright/
**Repository:** https://github.com/shrinivas-sn/gearwright

## Completed (Overhaul Shipped)
- **Phase 6 (UX Shell):** Title screen, pause overlay with controls, settings (sensitivity/invert-Y/volume), touch notice.
- **Phase 7 (Deploy):** Three.js chunk split, quiet logs, error handler, CI/Pages workflows, live URL verified.
- **Camera & look (25/09/2026, player-reported):** the vertical look axis was inverted because `CameraRig` placed the eye at `+sin(pitch)`; now `-sin(pitch)`, so the eye rides ~1.3 m above the torso anchor. Pitch clamps mean what they say (~63° down, ~31° up).
- **First-contact guidance (25/09/2026):** the HUD entry line carries the control summary; full table behind `Esc → Controls`.
- **T1.3 gravity settle (already shipped 25/09/2026, confirmed 10/10/2026):** released parts fall under gravity onto static geometry or other parts. `phase-world.test.ts` + `manipulation-system.test.ts` are green (67/67) and the failure stash it tracked is gone — the old "next up" line was stale, not the code.
- **The player's body (10/10/2026):** the shipped build previously drew **no player at all** — the capsule marker was created `visible = false` and never unhidden. It is now a **procedural skinned humanoid**: 19 bones, one `SkinnedMesh`, one material, 1440 triangles, no asset and no dependency. Distance-driven gait (feet never slide), walk/run blend, airborne tuck, carry stance, breathing idle, and analytic two-bone **hand IK that grips the held part**. Pose maths is pure (`core/character-pose.ts`, headless-tested); the rig is `adapters/character-rig.ts`; the port gained only an **optional** `characterFacts()`.
- **Browser harness repaired (10/10/2026):** `scripts/browser-check.mjs` had not parsed since 25/09 (a backtick inside the probe template literal ended it), which is why it was never re-run. It parses again, and `boot` now asserts the player's body (bones/triangles/visibility/position) so the visual layer has a live gate.

- **Foot planting & head look-at (10/10/2026, session 2):** `gameplay/foot-grounding.ts` probes the surface under each foot (two rays/frame) and the rig plants the legs on it — ankle one `CHARACTER_ANKLE_HEIGHT` above the surface, sole level, pelvis dropping ≤ 0.12 m so a planted foot always reaches; only the stance foot plants mid-stride. The neck and head also ease onto the focused object (or the camera's aim) and back. Both are presentation-only: no game state reads them.
- **Grip gate & rig preview (10/10/2026, session 3):** `CharacterFacts` now reports live hands + the grip target (optional fields, so every port double still compiles); the `hold` harness scenario asserts the *reach shape* — both hands extended along the chest → part direction (dot > 0.9, > 0.4 m). That gate caught a real design truth on its first run: the carry pose floats the part 1.35 m out while the arms reach 0.56 m, so the hands clamp at full extension rather than touching the part. `?rig=1` mounts a standalone preview (own scene, own rig, speed/carry/grounded/gait-scrub sliders, lazy-loaded into its own 3.69 kB chunk) for animation iteration without playing the level.
- **Shooting feature: assessed, not built** — `DOCS/CONTEXT/SHOOTING-MECHANIC.md`. Cheap in engineering and loading (swept-ray projectiles, procedural, pooled, no engine, no assets, no new dependency); blocked on an explicit decision, because `ARCHITECTURE.md` §3 lists *Combat* as out of scope. Recommended shape: a pneumatic **parts launcher** (fires the carryables the puzzle already uses) plus a URL-flagged test range — not enemies and damage.

## Verification State
- **Typecheck:** Clean (`tsc --noEmit` exit 0).
- **Test Suite:** 53 test files, **628 tests** passing (`npx vitest run`).
- **Production Build:** `three` 567.57 kB / `app` 222.76 kB (gzip 66.66 kB) + lazy `rig-preview` 3.69 kB (gzip 1.65 kB, only loaded with `?rig=1`).
- **Live Harness (re-run 10/10/2026, real Chrome, session 3):** `boot` passes — `character {bones: 19, triangles: 1440, visible: true, x: -4.5, y: 0.002, z: 12}` plus live `handL/handR` equals the spawn. `hold` passes — `{focused: true, state: "Manipulation", held: "gear-a", yaw: 0}` with both hands extended along the chest → part direction (dot > 0.9, > 0.4 m). Both report only the pre-existing ANGLE `X4122` shader precision warning (also present in the 24/09 reports).
- **Not re-run since the camera fix:** `title`, `focus`, `branch`, `bm1`, `press`.

## Next up (start here)
1. **Decide the shooting scope** (`DOCS/CONTEXT/SHOOTING-MECHANIC.md` §5): it needs one explicit call, then an ADR line updating `ARCHITECTURE.md` §3's "Combat out of scope".
2. **Foot sticking through the stride** (`CHARACTER-3D.md` Route A1, second half): planting is vertical-only today, so a planted foot can still slide along a surface.
3. **Branch B (Thermal/Steam line):** design the room layout, unseal the door at Hub Stage 1, add thermal line puzzles.
4. **Branch C (Great Crucible):** power grid coupling, multi-branch dependencies, endgame trigger.
5. **Audio & Atmosphere:** procedural gear ratchets / steam hiss and subtle particle FX.
