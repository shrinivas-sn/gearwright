<!-- docs-structure: v1 -->

# DOCS — index

Work-log index: one row per `WORK/<date>/` folder. Dates are **DD/MM/YYYY**; the folder name stays `YYYY-MM-DD` (disk and git sort order).

| Date | Summary | Status | Load-bearing | Touches | Continues |
|---|---|---|---|---|---|
| 10/10/2026 | Gave the player a body: replaced the never-visible capsule marker with a procedural 19-bone skinned humanoid (distance-driven gait, carry stance, two-bone hand IK) driven by new pure pose maths in `core/`; repaired the browser harness, which had not parsed since 25/09; `boot` now asserts the body from the live composition | done | yes | `src/core/character-pose.ts`, `src/adapters/character-rig.ts`, `src/adapters/three-renderer.ts`, `src/ports/render-port.ts`, `src/main.ts`, `scripts/browser-check.mjs`, `tests/` | continues the 25/09 restructure (same docs layout) |
| 10/10/2026 | Grip gate + rig preview (session 3): `CharacterFacts` reports live hands/grip target (optional fields), `hold` asserts the reach shape live (caught the 1.35 m carry vs 0.56 m arm design truth), `?rig=1` lazy preview (own chunk) for animation iteration | done | yes | `src/ports/render-port.ts`, `src/adapters/character-rig.ts`, `src/adapters/rig-preview.ts`, `src/main.ts`, `src/style.css`, `scripts/browser-check.mjs`, `tests/` | continues the 10/10/2026 body row above |
| 25/09/2026 | Restructured the root docs into docs-structure v1 (`STATUS.md` → `DOCS/`, `PROJECT_STATE.md` / `GAME_ARCHITECTURE.md` / `TEST_SUITE_PLAN.md` → `DOCS/CONTEXT/`); then fixed the player-reported inverted vertical look and the ankle-height camera it exposed, and put the control summary in the HUD entry line | done | yes | `DOCS/`, `package.json`, `src/gameplay/camera-rig.ts`, `src/presentation/hud.ts`, `tests/`, `scripts/browser-check.mjs` | — |

**Elsewhere in DOCS:** `STATUS.md` is where things stand right now (its `## Next up (start here)` list is the resume point); `CONTEXT/PROJECT_STATE.md` is the deep history (milestone status, CHK-1…CHK-13 checkpoints, files-changed logs, human checks, known problems); `CONTEXT/ARCHITECTURE.md` is the architecture contract; `CONTEXT/TEST-SUITE-PLAN.md` is the test / acceptance spec; `CONTEXT/CHARACTER-3D.md` is the player-body research note (what shipped, measured cost, and the routes to an imported animated humanoid); `CONTEXT/SHOOTING-MECHANIC.md` assesses a shooting feature (feasible, cheap to load, but an architecture-scope decision first). `README.md` and `PLAN.md` stay at the project root — `PLAN.md` is work in flight and is deleted when it closes.

There is no work in flight: T1.3 (gravity settle on dropped parts) shipped on 25/09 and was confirmed on 10/10; `PLAN.md` stays at the root as the closed overhaul plan's scaffolding.
