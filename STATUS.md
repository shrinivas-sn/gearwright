# Project Status — Gearwright

**Branch:** `main` / `overhaul` | **Date:** 2026-09-24 | **Phase:** Post-Overhaul / Future Expansion
**Live Game:** https://shrinivas-sn.github.io/gearwright/
**Repository:** https://github.com/shrinivas-sn/gearwright

## Completed (Overhaul Shipped)
- **Phase 6 (UX Shell):** Title screen, pause overlay with controls, settings (sensitivity/invert-Y/volume), touch notice.
- **Phase 7 (Deploy):** Three.js chunk split, quiet logs, error handler, CI/Pages workflows, live URL verified.
- **Verification:** 49 test files / 595 tests green; clean build; CDP harness passes `boot`, `title`, `hold`, `branch` live.

## Verification State
- **Typecheck:** Clean (`tsc --noEmit` exit 0).
- **Test Suite:** 49 test files, 595 tests passing (`npx vitest run`).
- **Production Build:** `three` 563.58 kB / `app` 201.96 kB (`npm run build`).
- **Live Harness:** `title`, `boot`, `hold`, `branch` all 100% passing against live GitHub Pages.

## Next up (start here)
1. **T1.3 Gravity settle on dropped parts:** Reconcile `phase-world.test.ts` release-height invariant with physics settling (`stash@{0}`).
2. **Branch B (Thermal/Steam line):** Design Branch B room layout, unseal door at Hub Stage 1, add thermal line puzzles.
3. **Branch C (Great Crucible):** Design power grid coupling, multi-branch dependencies, and endgame trigger.
4. **Audio & Atmosphere:** Add procedural sound effects (gear ratchets, steam hiss) and subtle particle/visual FX.


