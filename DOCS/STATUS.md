# Project Status — Gearwright

**Branch:** `main` / `overhaul` | **Date:** 2026-09-25 | **Phase:** Post-Overhaul / Future Expansion
**Live Game:** https://shrinivas-sn.github.io/gearwright/
**Repository:** https://github.com/shrinivas-sn/gearwright

## Completed (Overhaul Shipped)
- **Phase 6 (UX Shell):** Title screen, pause overlay with controls, settings (sensitivity/invert-Y/volume), touch notice.
- **Phase 7 (Deploy):** Three.js chunk split, quiet logs, error handler, CI/Pages workflows, live URL verified.
- **Camera & look (25/09/2026, player-reported):** vertical look was inverted — mouse-down looked up — because `CameraRig` placed the eye at `+sin(pitch)` while treating pitch as an elevation offset, contradicting its own documented convention. The eye offset is now `-sin(pitch)`, which fixes the mouse axis *and* the default framing: the eye rides ~1.3 m above the torso anchor looking slightly down (it used to sit at ankle height, 0.08 m, staring up — see the initial-pose test). Pitch clamps now mean what they say: ~63° down, ~31° up. `Invert Y` flips the axis as labelled.
- **First-contact guidance (25/09/2026):** the HUD entry line now carries the control summary (`WASD move · mouse look · E grab · Q/F rotate · R drop · H hint`) and points at `Esc → Controls` for the full table.
- **Verification:** 49 test files / 597 tests green; clean build; CDP harness passes `boot`, `title`, `hold`, `branch` live (as of 24/09 — see Verification State).

## Verification State
- **Typecheck:** Clean (`tsc --noEmit` exit 0).
- **Test Suite:** 49 test files, 597 tests passing (`npx vitest run`).
- **Production Build:** `three` 563.58 kB / `app` 202.17 kB (`npm run build`).
- **Live Harness:** `title`, `boot`, `hold`, `branch` passed against live GitHub Pages as of 24/09/2026 — **not re-run since the 25/09 camera fix**, which changed the aim geometry. `scripts/browser-check.mjs` was updated to the new pitch sign but has not been executed since; re-run `npm run check:browser` before trusting it.

## Next up (start here)
1. **T1.3 Gravity settle on dropped parts:** Reconcile `phase-world.test.ts` release-height invariant with physics settling (`stash@{0}`).
2. **Branch B (Thermal/Steam line):** Design Branch B room layout, unseal door at Hub Stage 1, add thermal line puzzles.
3. **Branch C (Great Crucible):** Design power grid coupling, multi-branch dependencies, and endgame trigger.
4. **Audio & Atmosphere:** Add procedural sound effects (gear ratchets, steam hiss) and subtle particle/visual FX.


