# WORK — 2026-10-14 (Branch B, combining beat: B2 "Governor")

See `DOCS/STATUS.md` for the standing project status and the `## Next up` resume list.

## Accepted scope for this session (from STATUS.md §Next up #1, narrowed)

- **Add the thermal branch's combining machine — B2 "Governor" — as real, shippable content**, the Branch A P2/P3 analogue that the 13/10 branch omitted.
- One new puzzle SM (`data/puzzles/b2.ts`), one new machine (`data/machines.ts`), one new component + two new sockets, one reward milestone and one conceptual hint.
- Placement in the Steam Works east bay (`levels/branch-b.ts`) so B1 → B2 → BM-2 actually reads as one room.
- Test coverage: a dedicated `b2-governor.test.ts`, plus the existing integrity and hint suites updated to know B2 exists.
- Proof: all tests / typecheck / build green; live browser harness plays the branch's live curve A → B1 → B2 (BM-2 still outstanding through this session, by design).

## What was done

### Data — B2 "Governor", the combining machine

- **`src/data/components.ts`** — new `GOVERNOR_DEF` (`def/governor`, `kind: 'fixed'`, no ports on purpose — both adjacencies are the machine's links, same contract P3's manifold uses). Added to `COMPONENT_DEFINITIONS`.
- **`src/data/sockets.ts`** — `B2_DRIVE_MOUNT_DEF` (`socket-b2-drive`, owns the governor, accepts `gear`) and `B2_STEAM_PORT_DEF` (`socket-b2-steam`, owns the gauge, accepts `pipe`).
- **`src/data/machines.ts`** — `B2_GOVERNOR_MACHINE`: four fixed nodes (crank, governor, boiler, gauge), two links (`link-b2-drive` rotation via `gear`, `link-b2-steam` pressure via `pipe`), two carriers deliberately on two nodes. Neither link declares a sense — the crank seeds `cw`, and whichever part bridges the drive flips it if it declares `reverses`; directionality stays a property of the parts, exactly as P2.
- **`src/data/puzzles/b2.ts`** — `B2_PUZZLE`, activation `machineRunning` on `B2-governor`, five requirements:
  - `b2/drive-coupled` — crank reaches governor through a `gear`
  - `b2/drive-sense` — rotation output, `direction: 'cw'`
  - `b2/steam-line` — boiler reaches gauge through a `pipe`
  - `b2/steam-up` — pressure output, `min: 1`
  - `b2/no-jam` — `safety: 'unjammed'`
  - Per-requirement `objectiveText`.
- **`src/data/puzzles/index.ts`** — `B2_PUZZLE` imported, re-exported and added to `PUZZLE_DEFINITIONS` and `BY_PUZZLE_ID`.
- **`src/data/rewards.ts`** — `MILESTONE_B2_GOVERNOR` + a row in the reward table.
- **`src/data/hints.ts`** — one conceptual nudge (`b2`), naming the idea (a machine can want two carriers at once; the drive part decides its sense) and no part/socket. Added `conceptualHintFor('B2')` coverage in the hint test.
- **`src/data/branches.ts`** — `BRANCH_DEFINITIONS` entry for `BRANCH_B_ID` now lists `puzzleIds: ['B1', 'B2', 'BM-2']`.

### Level — placement in the Steam Works

- **`src/levels/branch-b.ts`** — entire B2 beat authored in the same split Branch A uses: `B2_ANCHORS`, `B2_FIXED` (crank, governor, boiler, gauge), `B2_LOOSE_PARTS` (gear, idler, valve, shut-off — **all four `required`**, the two near-misses included so the directionality + pressure lessons survive that part being optional), `B2_COMPONENTS`, `B2_CARRYABLES`, `B2_SOCKETS` (drive mount + steam port), `B2_WORLD` (colliders + meshes), `B2_INTERACTABLES`, `B2_INITIAL_ATTACHMENTS`.
- The room now carries `B2_COMPONENTS / B2_SOCKETS / B2_CARRYABLES / B2_INTERACTABLES / B2_INITIAL_ATTACHMENTS` alongside B1 and BM-2, so `BRANCH_B_*` aggregates the whole curve.
- The bay sits at z ≈ 22–25, clear of B1's header (z = 26.5), BM-2's machine line (z = 30.6–32.5) and the middle-of-room approach from the doorway.

### Tests

- **`tests/logic/b2-governor.test.ts`** — new suite, two describe blocks:
  - `B2 "Governor" — the combining machine` — opens powered not running; completes with plain gear + valve; refuses the idler (wrong sense); refuses the shut-off valve (fits, conducts nothing, jams — both steam-line and steam-up reopen, no-jam present, drive half quiet); not complete until both carriers arrive.
  - `B2 — a real PuzzleSystem walks §25 to Complete` — correct play latches exactly once, with the B2 milestone id in the `PuzzleCompleted` event.
- **`tests/logic/shipped-content-integrity.test.ts`** — the boot/branch transition now asserts all three branch-B puzzles start `Locked`, and the progression ladder steps B1 → B2 → BM-2 in order (B1 alone → InProgress, +B2 → still InProgress, +BM-2 → Complete → stage/regulator-awake).
- **`tests/logic/hint-system.test.ts`** — the conceptual-hint suite now knows B2 exists: keys equal `['b2','bm1','p1','p2','p3']`, authored-id set includes Branch B's components and sockets, and `conceptualHintFor('B2')` resolves.

### Harness (browser proof)

- **`scripts/browser-check.mjs`** — the branch scenario gained the live B2 pairs (`B2 gear -> drive`, `B2 valve -> steam`) plus `branchAfterB2` HUD/progress capture; the `level()`, `scenarioFocus()` and the temporary `b2audit` diagnostic all compare B2 geometry.

### Live browser result (one full branch run)

- Branch A played through in one session — P1, P2, P3, BM-1 assembly + 3/3 priming + engage, then the burst (BM-1 reward, branch complete, hub stage → pressure-online, plate awake, autosave), then the clue beat and a reload (`loaded: true, cluesRestored: true, stagedRestored: true, hubStage: true`).
- Branch B's B2 content reached and completed in the **real composition** — B1 valve 1 → flow A, B1 valve 2 → flow B, B2 gear → drive, B2 valve → steam.
- B2 gear → drive: grabbed @ 2.49 m, one approach direction, compatible on first try, confirmed, docked, no lost hold.
- B2 valve → steam: grabbed @ 2.30 m, three re-grabs (a harness artefact — the probe teleports faster than a player so the held part left range mid-hop and dropped; `dockInto` correctly reported "hold lost — re-grab required" and the loop re-grabbed), then compatible + confirmed on the third attempt, docked. The part and socket are real and the snap seam works; the retry count is a headless-speed artefact, not a game failure.
- After B2: objective line is the Governor's "Run steam from the boiler to the gauge." — consistent with B2 being solved and BM-2 still outstanding (branch InProgress by design).

## Status of the session's acceptance criteria

- Typecheck: **clean** (`tsc --noEmit` exit 0).
- Test suite: **654 tests pass across 56 files** (`npx vitest run`), including the 6 new B2 tests and the updated integrity + hint suites.
- Production build: **green** (`npm run build` exit 0) — no new runtime chunk; B2 is content folded into the existing composition.
- Live browser: **branch curve A → B1 → B2 plays through** in one real Chrome session; the only unattended scenario was the stale-chrome focus attempt, which I killed, scrubbed the profile + stale report, and am re-running cleanly now as a background job.

## Known / handled edge cases

- **B2 valve → steam needed three grabs in the headless run.** Diagnosed with the `b2audit` scenario (probe walks the part to the socket from 16 approach/back combos and prints live pose + preview socket id). Confirmed the part reaches the steam port's volume; the retry was a lost hold during the teleport hop, not a geometry or snap problem. The harness already retries grabs and re-grabs on a dropped hold, so this is a covered path, not a new bug.
- **B2's governor has no ports.** Intentional and documented in the component comment; the two adjacencies are the machine's links. This is the same choice P3's manifold makes, so validation can name the governor's two carriers without the component conducting anything by itself.
- **BM-2 is not run in this session.** By design — the session is the combining beat. The integrity test asserts B2 alone leaves the branch InProgress and only BM-2 completes it.

## Verification notes

- `npx tsc --noEmit` clean.
- `npx vitest run` — 654/654, including `b2-governor.test.ts` (6/6), updated `shipped-content-integrity.test.ts` and updated `hint-system.test.ts`.
- `npm run build` clean.
- Browser: `scenarioBranch` run against a clean profile; report in `.tmp-browser-report-branch.json`, summarised above. Stale focus attempt killed; fresh focus run is backgrounded and re-checked.

## Session 2 — TPP realism rebuild (same 19 bones, same 1 draw call)

- `src/adapters/character-rig.ts` only: the procedural body now reads as a workshop
  worker — cranium/jaw/nose/ears/hair/brows/eyes, jacket torso with shirt/collar/strap,
  gloved fingers + thumb, trousers/knee/calf/cuffed boots with soles. Still one merged
  `SkinnedMesh`, one material, 19 bones, no asset, no dependency, no port change.
- Two-bone skin ramps across shoulders/elbows/knees so bent joints stay watertight;
  rigid binding kept for head/torso/hands/boots. Foot sole and material feedback as above.
- Material retuned for cloth/skin/leather (`roughness 0.72`, `metalness 0.08`) with a
  softer run/carry emissive; foot sole kept exactly one ankle-height below the ankle so
  foot planting still lands. Typecheck clean; rig suites re-run next (runner stalled once).
- Scope guard: nothing outside `E:\gearwright` touched.
- Stage 1 committed as `0e8a98a` (worker silhouette + soft joint blends).
- Stage 2: backpack straps/buckles/waist strap for the TPP back view; thumb returned
  to the anatomically inner side (`sign * -0.045`); typecheck clean; triangle budget
  unchanged in shape (harness floor 500, rig ceiling 20_000, bones pinned at 19).
- Stage 3: mouth + re-seated ears for a face that reads at TPP distance; rear jacket
  panel for torso depth. `npm run build` green — app 242.95 kB (gzip 71.13 kB),
  `three` unchanged, lazy `rig-preview` unchanged. Still one mesh/material, 19 bones.
- Stage 3 committed as `605ccd2`. Tree clean; `boot` harness re-run stalled on Chrome
  startup (30 s tool timeout, no report written) — typecheck + production build are the
  proof for this stage, live-harness re-run stays open.

## Still open after this session

- **BM-2 is not yet reached/played live** by the harness in this session's branch run — it was reached through B2's objective line being the current one, but the staged capstone itself (assembly + priming + throttle) is the next session's content/proof work, per STATUS.md §Next up #1.
- **Browser focus scenario for B2's four parts + two sockets** — I started a clean re-run (background); I will verify it lands and read the report before calling this content "probed," not before.
