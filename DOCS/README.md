<!-- docs-structure: v1 -->

# DOCS — index

Work-log index: one row per `WORK/<date>/` folder. Dates are **DD/MM/YYYY**; the folder name stays `YYYY-MM-DD` (disk and git sort order).

| Date | Summary | Status | Load-bearing | Touches | Continues |
|---|---|---|---|---|---|
| 25/09/2026 | Restructured the root docs into docs-structure v1 (`STATUS.md` → `DOCS/`, `PROJECT_STATE.md` / `GAME_ARCHITECTURE.md` / `TEST_SUITE_PLAN.md` → `DOCS/CONTEXT/`); then fixed the player-reported inverted vertical look and the ankle-height camera it exposed, and put the control summary in the HUD entry line | done | yes | `DOCS/`, `package.json`, `src/gameplay/camera-rig.ts`, `src/presentation/hud.ts`, `tests/`, `scripts/browser-check.mjs` | — |

**Elsewhere in DOCS:** `STATUS.md` is where things stand right now (its `## Next up (start here)` list is the resume point); `CONTEXT/PROJECT_STATE.md` is the deep history (milestone status, CHK-1…CHK-13 checkpoints, files-changed logs, human checks, known problems); `CONTEXT/ARCHITECTURE.md` is the architecture contract; `CONTEXT/TEST-SUITE-PLAN.md` is the test / acceptance spec. `README.md` and `PLAN.md` stay at the project root — `PLAN.md` is work in flight and is deleted when it closes.

Work in flight (T1.3, gravity settle on dropped parts) lives in `STATUS.md` + `PLAN.md`, not in a `WORK/` folder, until it closes.
