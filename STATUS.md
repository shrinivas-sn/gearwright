# Project Status — Gearwright

**Branch:** `overhaul` | **Date:** 2026-09-24 | **Phase:** All Phases Complete (0–7) — Shipped & Deployed

**Live Game:** https://shrinivas-sn.github.io/gearwright/

## Completed This Session
- **Phase 6 (UX Shell):**
  - T6.1: Keybinding-derived controls table ([src/presentation/controls-table.ts](file:///E:/gearwright/src/presentation/controls-table.ts)).
  - T6.2: Boot title screen with Start/Continue, New Game (2-step confirm), Controls ([src/presentation/title-screen.ts](file:///E:/gearwright/src/presentation/title-screen.ts)).
  - T6.3: Pause overlay extra mounting for live controls and New Game ([src/presentation/pause-overlay.ts](file:///E:/gearwright/src/presentation/pause-overlay.ts)).
  - T6.4: Settings store & panel for look sensitivity, invert-Y, and volume ([src/adapters/settings-store.ts](file:///E:/gearwright/src/adapters/settings-store.ts), [src/presentation/settings-panel.ts](file:///E:/gearwright/src/presentation/settings-panel.ts)).
  - T6.5: Touch-only device fallback notice ([src/main.ts](file:///E:/gearwright/src/main.ts)).
  - Checkpoint 6: Full suite verified (49 files, 595 tests), fast-forwarded to `main`.
- **Phase 7 (Production & Deployment):**
  - T7.1: Production-quiet game log via `gameLog` ([src/debug/log.ts](file:///E:/gearwright/src/debug/log.ts)).
  - T7.2: Global error handler & toast ([src/main.ts](file:///E:/gearwright/src/main.ts)).
  - T7.3: Three.js vendor chunk split in [vite.config.ts](file:///E:/gearwright/vite.config.ts) (`three` 563.58 kB / app 201.96 kB).
  - T7.4: CI workflow in [.github/workflows/ci.yml](file:///E:/gearwright/.github/workflows/ci.yml).
  - T7.5: GitHub Pages deployment workflow in [.github/workflows/deploy.yml](file:///E:/gearwright/.github/workflows/deploy.yml).
  - T7.6: Browser harness live URL mode in [scripts/browser-check.mjs](file:///E:/gearwright/scripts/browser-check.mjs).
  - T7.7: GitHub repository created (`shrinivas-sn/gearwright`), branches pushed, Pages enabled and deployed green via Actions.
  - T7.8: Live URL verification with harness scenarios (`title`, `boot`, `hold`, `branch`) all passing.
  - T7.9: [README.md](file:///E:/gearwright/README.md), [PROJECT_STATE.md](file:///E:/gearwright/PROJECT_STATE.md) CHK-13 entry, and final CHECKPOINT 7.

## Verification State
- **Typecheck:** Clean (`tsc --noEmit` exit 0).
- **Test Suite:** 49 test files, 595 tests passing (`npx vitest run`).
- **Production Build:** Passes cleanly without warnings (`npm run build`).
- **Browser Harness:** `boot`, `title`, `hold`, `branch` pass both locally and against the live GitHub Pages URL.

## Next up (start here)
- **Plan execution completed.**
- **Open backlog item:** T1.3 (dropped parts gravity fall) remains stashed (`stash@{0}`) pending relaxation or reconciliation of the `tests/logic/phase-world.test.ts` release-height invariant.


