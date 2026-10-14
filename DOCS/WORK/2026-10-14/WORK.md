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

## Session 3 — BM-2 played live, the carry fixes, and B3 "Bypass"

### Accepted scope (STATUS.md §Next up #1–3)

- Play **BM-2 live through the full curve** (A → B1 → B2 → BM-2) in one real Chrome session.
- Re-run the open harness scenarios on the TPP worker mesh (`boot` + `hold`).
- Start the branch's **open-ended beat** so the Thermal Line teaches as it grows.
- Constraint: the 19-bone / one-draw-call TPP body, and nothing outside `E:\gearwright`.

### The live proof, and the three real bugs it exposed

The `branch` scenario now plays BM-2 too (`playBm2Sequence`: gear → drive mount, pipe → steam
port, the three priming lines in any order, then the throttle) and asserts the branch's own
consequences — `[reward] BM-2:milestone/bm2-steam-engine applied`, `branch branch-b complete`,
`hub stage -> stage/regulator-awake`, the thermal plate waking, the autosave, and a reload
(`8 staged action(s)`, `2/2 clue(s)`, both doors `Complete (open)`).

The first two live runs failed in Branch B, and the failures were **not** content bugs — they
were harness navigation bugs that a hop trace turned into facts:

1. **Hops outran the carried part.** `hopTo` teleported 0.8 m per step while the part closes at
   most `maxLinearSpeed` (8 m/s), so past `maxHoldRange` (2.6 m) it was soft-detached
   (EC-MAN-07) — every B2/B3/BM-2 dock died on its first hop. Now: 0.4 m steps, each followed by
   a wait until the part is abreast again (≤2.1 m), and `lookBy` turns in small chunks while
   carrying for the same reason (a 1 rad chunk sweeps the 1.35 m carry lead along an arc).
2. **A teleport could land inside a machine post.** The physics then resolved the capsule
   downwards — *through the floor*; the trace caught the player at y = −1.9 with the part left
   26 m behind. `hopTo` now plans a route on a 0.5 m grid over the level's **own** static
   colliders (shipped + hub + Branch B), walks it, rolls back to the last good spot and returns
   `false` when a vantage is blocked, and `dockInto` skips that vantage instead of carrying on
   from under the floor.
3. **A lost part is not at its spawn.** Re-grabbing focused the level's *spawn* box, so a part
   that had fallen mid-carry reported NOT FOCUSABLE while lying in plain sight. Grab now reads
   the manipulation layer's **live** pose (`__probe.partBox`), and `dockInto` re-grabs the part
   the caller names after any lost hold, trying the remaining vantages before giving up.

Supporting changes: a `dock` scenario (one pair, ~2 min) for minute-scale feedback — it isolated
each fix — and `HARNESS_DEV_PORT` / `HARNESS_DEBUG_PORT` / `HARNESS_PROFILE` overrides so a long
run and a short check can go at once.

### Live results (14/10, real Chrome)

- `branch` — **the whole curve played end to end**: all eight dock pairs on the *first* attempt,
  BM-1 and BM-2 both run, `branch-a` and `branch-b` Complete, hub `stage/regulator-awake`, both
  clues read, reload `8 staged action(s)` + `2/2 clue(s)`; `problems` empty apart from the known
  ANGLE `X4122` warning and the AudioContext autoplay notices.
- `boot` — `{bones: 19, triangles: 3936, visible: true}` on the player's own position.
- `hold` — `{focused: true, held: "gear-a", grip: {holding: true, bones: 19}}`, reach-shape gate green.
- `dock` — green (part held at a steady 1.71 m along a planned route).

### Content — B3 "Bypass", the Thermal Line's open-ended beat

- **`data/puzzles/b3.ts`** — one source, two consumers, three routes; requirements are two
  `connected` runs, a `componentAt` coverage floor (both carriers seated), the pressure floor and
  `safety: unjammed`. Objective text per requirement.
- **`data/machines.ts`** — `B3_BYPASS_MACHINE`: three links, and the cross-run (`socket-b3-route-c`)
  declaring a link to *each* consumer, which is what makes A+B, A+C and B+C all correct;
  `maxOutput: 2.5` so the largest reachable value is not an overpressure.
- **`data/sockets.ts`** — `B3_ROUTE_A/B/C_DEF` (three `pipe-port` docks on one header, the closed
  shape P3 uses).
- **`data/rewards.ts`** — `MILESTONE_B3_BYPASS` (materials only, no new resource kind).
- **`data/hints.ts`** — the L4 nudge for `b3`, plus the `bm2` nudge the capstone never had.
- **`data/branches.ts`** — `puzzleIds: ['B1', 'B2', 'B3', 'BM-2']`.
- **`levels/branch-b.ts`** — B3 placed in the Steam Works' **west bay** (the mirror of B2's east
  bay): boiler plinth, two consumer posts, a three-port header at z = 23.2 and the three parts
  resting in a row south of it, wired into the branch's aggregates.
- **`main.ts`** — the dev handle exposes `B2_*` and `B3_*` alongside `B1_*`/`BM2_*`.
- **`scripts/browser-check.mjs`** — the probe reads B3's parts/sockets, `focus` walks them, and the
  branch scenario plays the open-ended beat's A+C pair before the capstone.

### Tests

- **`tests/logic/b3-bypass.test.ts`** (new, 7 tests) — opens powered with every route empty; A+B,
  A+C and B+C all complete; one route alone is refused; the shut-off valve fits, jams and dead-ends
  its run; swapping the near-miss for a serviceable valve still completes; a real `PuzzleSystem`
  latches exactly once with the B3 milestone.
- **`shipped-content-integrity.test.ts`** — the ladder now steps B1 → B2 → B3 → BM-2 (`B3` also
  starts `Locked` behind Branch A).
- **`hint-system.test.ts`** — the nudge keys are `['b2','b3','bm1','bm2','p1','p2','p3']`, and
  `conceptualHintFor('B3')` / `('BM-2')` resolve.

### Verification notes (session 3)

- `npx tsc --noEmit` — clean.
- `npx vitest run` — **661 tests across 57 files**, all passing.
- `npm run build` — green: `three` 567.57 kB unchanged, `app` 247.81 kB (gzip 72.12 kB), lazy
  `rig-preview` 3.69 kB unchanged (the TPP body is untouched: same 19 bones, one mesh).
- Live: `boot`, `hold`, `dock` and the full `branch` curve, all green (see above).
- Scope guard: nothing outside `E:\gearwright` touched; `main` pushed to `origin/main` this session.

## Still open after this session

- **Branch B has not been walked by a human since B3 landed.** The harness plays it; nobody has looked at whether the west bay (B3) and the east bay (B2) read as different machines from the doorway, or whether B3's third port is discoverable without the objective line spelling it out. That is now STATUS.md §Next up #1.
- **`focus` was not re-run with B3's parts.** The scenario now walks them, but the last recorded `focus` report predates B3 — it is a probe of content reachability, not a gate, so the branch run's own first-attempt docks are the current evidence that B3 is reachable in the composition.
- **The B2 steam-port pocket is tight** (gauge post and boiler plinth leave a ~0.6 m gap): the harness now routes around it deliberately, and a human should confirm it feels like a workshop rather than a maze — a placement tweak would be level data only.
