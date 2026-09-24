# Project Status — Gearwright

**Branch:** `overhaul` | **Date:** 2026-09-24 | **Phase:** Phase 6 complete / Phase 7 (Production + deployment)

## Completed This Session
- **T6.1 (`b0cb655`):** Keybinding-derived controls table helper ([src/presentation/controls-table.ts](file:///E:/gearwright/src/presentation/controls-table.ts)).
- **T6.2 (`378b2d3`):** Boot title screen with Start/Continue, New Game (2-step confirm), Controls ([src/presentation/title-screen.ts](file:///E:/gearwright/src/presentation/title-screen.ts)).
- **T6.3 (`fa5f2af`):** Pause overlay extra mounting for live controls and New Game ([src/presentation/pause-overlay.ts](file:///E:/gearwright/src/presentation/pause-overlay.ts)).
- **T6.4 (`1ef0eea`):** Settings store & panel for look sensitivity, invert-Y, and master audio volume ([src/adapters/settings-store.ts](file:///E:/gearwright/src/adapters/settings-store.ts), [src/presentation/settings-panel.ts](file:///E:/gearwright/src/presentation/settings-panel.ts)).
- **T6.5 (`3f9832c`):** Touch-only device fallback notice ([src/main.ts](file:///E:/gearwright/src/main.ts)).
- **Checkpoint 6:** Verified full test suite (49 files, 595 tests), build (765.52 kB), browser harness (`boot`, `title`, `hold`, `branch`).

## Verification State
- **Typecheck:** Clean (`tsc --noEmit` code 0).
- **Test Suite:** 49 test files, 595 tests passing (`npx vitest run`).
- **Production Build:** Passes cleanly without warnings (`npm run build`).
- **Browser Harness:** `boot`, `title`, `hold`, `branch` scenarios all pass with zero problems.

## Next up (start here)
1. **T7.1 Production-quiet game log:** Create `src/debug/log.ts` and replace `console.info` with `gameLog` in `src/main.ts`.
2. **T7.2 Global error handler:** Global error toast and unhandledrejection in `src/main.ts`.
3. **T7.3 Three.js chunk split:** Configure `manualChunks` in `vite.config.ts`.
4. **T7.4 & T7.5 GitHub Actions workflows:** Create `.github/workflows/ci.yml` and `deploy.yml`.
5. **T7.6 Harness `--url` mode:** Support live URL testing in `scripts/browser-check.mjs`.
6. **T7.7 - T7.9 Deployment & Closing:** Repo setup, push, Pages deployment, live verification, README, PROJECT_STATE.

