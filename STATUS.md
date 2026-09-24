# Project Status — Gearwright

**Branch:** `overhaul` | **Date:** 2026-09-24 | **Phase:** Phase 6 (UX Shell)

## Completed This Session
- **T6.1 (`b0cb655`):** Keybinding-derived controls table helper ([src/presentation/controls-table.ts](file:///E:/gearwright/src/presentation/controls-table.ts)).
- **T6.2 (`378b2d3`):** Boot title screen with Start/Continue, New Game (2-step confirm), Controls ([src/presentation/title-screen.ts](file:///E:/gearwright/src/presentation/title-screen.ts)).
- **T6.3 (`fa5f2af`):** Pause overlay extra mounting for live controls and New Game ([src/presentation/pause-overlay.ts](file:///E:/gearwright/src/presentation/pause-overlay.ts)).
- **T6.4 (`1ef0eea`):** Settings store & panel for look sensitivity, invert-Y, and master audio volume ([src/adapters/settings-store.ts](file:///E:/gearwright/src/adapters/settings-store.ts), [src/presentation/settings-panel.ts](file:///E:/gearwright/src/presentation/settings-panel.ts)).

## Verification State
- **Typecheck:** Clean (`tsc --noEmit` code 0).
- **Test Suite:** 49 test files, 595 tests passing (`npx vitest run`).
- **Production Build:** Passes cleanly without warnings (`npm run build`).
- **Browser Harness:** `boot` and `title` scenarios verified in headless Chrome.

## Next up (start here)
1. **T6.5 Touch-only notice:** Add touch device detection (`touchOnly`) to show a clean fallback banner instead of booting a dead canvas on mobile devices without pointers.
2. **Fix-up 6 / Checkpoint 6:** Run full test suite, verify browser scenarios (`boot`, `title`), fast-forward `main`.
3. **Phase 7 (Production + deployment):** Production logs, global error handler, Three.js chunk splitting, CI/Pages workflow, live verification.
