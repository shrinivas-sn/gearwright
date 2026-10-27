# Project Status — Gearwright

**Branch:** `main` | **Date:** 2026-10-24 | **Phase:** Post-Overhaul · Branch C shipped (three branches), its ceiling readable
**Worktree:** `E:\gearwright` · **Status:** `DOCS/STATUS.md` (index `DOCS/README.md`; log + numbers `DOCS/WORK/2026-10-24/WORK.md`; previous pass `DOCS/WORK/2026-10-22/WORK.md`; text moved out `DOCS/WORK/archive.md`)
**Live:** https://shrinivas-sn.github.io/gearwright/ · **Repository:** https://github.com/shrinivas-sn/gearwright

## Shipped state

- **Branch C — "Great Crucible" — ships.** The third branch, built on the §6 expansion path with no
  core change: a room behind the hall's north wall (east of the Steam Works), four machines, four
  puzzles, four rewards, a third clue plate, hints and staged actions. It is **gated behind Branch
  B** (`requiresBranches: [A, B]`), and completing it reaches the stage data had always carried:
  `stage/crucible-restored`.
- **Its new teaching is a ceiling.** Every earlier machine wanted a connection; C's want *not too
  much of one*, and it is the first content to use `safety: 'overpressure'` as a **player-visible
  objective** rather than a latent warning.
  - **C1 "Tuyere"** — two parallel blast ports: one open valve reads 1 and lights the tuyere; two
    read 2 and trip the 1.5 ceiling; a shut-off valve fits, conducts nothing and jams. Three failure
    modes with three different reasons.
  - **C2 "Quench"** — the combining beat: the vessel must turn **clockwise** (plain gear vs idler)
    *and* be fed from exactly one of two quench ports.
  - **C3 "Slag Run"** — the open-ended beat: one furnace, two consumers, three routes. **A+B** and
    **C alone** both complete; **A+C** / **B+C** stack a run on the cross-run and over-pressure.
  - **CM-3 "Great Crucible"** — the third staged machine (ADR-018): assembly → three priming lines
    (any order) → an ordered pour, with the branch's direction lesson folded in.
- **An arithmetic fact caught by the suite.** A cross-run's two declared links share one bridge, and
  `MachineGraph` sums the carrier **at the bridge** — so C3's route C alone reads **2** per consumer
  (exactly what P3's cross-run does). C3's ceiling is therefore **2.5**, which accepts the
  cross-run's own value and refuses stacking another run on it (3). A 1.5 ceiling would have made
  the one-part answer a failure.
- **The hub's Branch C door moved from x = 6 to x = 12.** At x = 6 it opened into the Steam Works'
  own floor — inside another branch's room. The Crucible sits east of the Steam Works, sharing its
  east wall, and `levels/game-room.ts` now cuts both doorways as real gaps.
- **The snap-assist / SlotJudge decision is stated, not guessed.** `DOCS/CONTEXT/SNAP-ASSIST.md`
  pins the shipped behaviour (assist starts at 0.975 m, caps at 0.85, **orientation is not a gate**
  — any realisable yaw attaches), defines reward/punish as feedback bands over distance and yaw, and
  lists the four sign-off points. **No weight was changed**; changing it on a guess is the thing the
  17/10 note refused.
- **Two harness defects fixed while proving the new room.** `hopTo` used to stop after 0.4 m when
  **empty-handed** (the step loop broke on `heldId === null`), so a "walk there" check could report
  success while still at the spawn pose; and route planning could not see Branch C at all (Branch
  B's colliders only, grid bounded at x = 9). Both fixed. A new **`crucible`** scenario lands the
  player in the room and proves C1's ceiling live: first valve → `pressure 1`, no warnings; second
  valve → `pressure 2`, `["overpressure"]`, nothing dropped.
- **All three branches complete in one live session.** `branch` no longer stops at its reload:
  with A and B restored Complete (C `Available`), it plays the Crucible's own curve — C1, C2,
  C3, CM-3 — and the reward burst follows: all four C milestones applied, `branch-c complete
  (Great Crucible)`, hub `stage/crucible-restored`, the third plate awake and discovered, and the
  final probe reads **A/B/C Complete, hub stage 3, 3/3 clues**. That is the first proof Branch C
  *completes* in the real composition, not only in the logic suite. It also proves the ordered
  stage **refuses and recovers** live: the pour lever pulled before priming leaves
  `reasonCodes ['cm3/primed','cm3/staged']`, priming clears `cm3/primed`, and a second pour (the
  earliest-match recovery ADR-018 depends on) completes it. The reloaded session also shows the
  new meter on an unlocked puzzle: `Tuyere / InProgress`, `Pressure 0 / 1.5`.
- **The Crucible now plays end to end in the harness.** `crucible` already proved C1's ceiling;
  it now also plays **C2** (the **idler** → `ccw`, the wrong-way near-miss; one quench feed →
  pressure 1, the second feed → 2 and `overpressure`), **C3** (the cross-run alone → both consumers 2, under the 2.5
  ceiling; adding route A → the casting floor 3 and `overpressure`) and **CM-3** (gear + pipe
  install the staged panel, the three priming lines open in any order, the pour lever engages).
  A fresh save keeps every one of them `Locked`, so the scenario proves the machines and the
  rig, not the rewards — and asserts `branch-c: Locked` on the way out, so the gate stays honest.
- **The `branch` curve still plays A→B end to end on this code** — 10/10 docks, both capstones,
  both clue plates, and a reload that restores 2/3 clues (C's plate correctly asleep), 8 staged
  actions and hub stage 2. Its assertion needed updating from `2/2` clues to `2/3`: the run plays
  two branches, and the third plate belongs to a branch that is only `Available`.
- **The ceiling now reads in the world and on the HUD.** An over-fed machine is still
  `running`, so it used to draw the same healthy glow and spin as a working one — the
  validator could see `overpressure`, the player could not. Mounted parts in that state now
  redline (`CarryableRenderState.overpressured`, set from the graph's own warning), and the
  objective surface carries the machine's highest live output against the ceiling its data
  declares: `Pressure 1 / 1.5`, then `Pressure 2 / 1.5 — over ceiling`. Both are derived
  state, presentation-only; no rule, datum or tuning number changed.
- **Baseline hygiene from 21/10 is settled.** `hold`, `dock`, `arms`, `boot`, `guns` re-ran on
  `72efa4a` (start of this pass) and again on this pass's final code; both sets are `problems: []`
  (`arms`: 0.0001 m hand step, 4.8 rad/s turn rate, 0 torso hits).
- **Still unbuilt: a consumer for the reward materials (§28).** Materials are granted by all three
  branches and consumed by nothing; the upgrade framework exists with an empty table.

## Verification

- **Typecheck** clean · **Tests** 65 files / **847** (845 at HEAD: +2 for the meter and the
  overpressure read) · **Build** clean: `three` 624.62 kB (gzip 158.35), `app` 316.61 kB (gzip
  90.75) — **+1.48 kB raw / +0.51 kB gzip** for the ceiling-readability pass.
- **`crucible` (dev) — `problems: []`:** player stands on the new floor at (12.2, 24.4), `y =
  0.002`, `grounded: true`; 3 parts / 2 sockets composed; first valve → `pressure 1`, `warnings:
  []`, `running`, `dropped: false`; second valve → `pressure 2`, `warnings: ["overpressure"]`,
  `dropped: false`; **the HUD reads `Pressure 2 / 1.5 — over ceiling` on `Tuyere`**, visible and
  marked; **C2**'s idler turns the vessel **`ccw`** and one feed reads 1, two trip the ceiling;
  **C3**'s cross-run feeds both consumers 2 and stacking route A reads 3 and trips; **CM-3**
  installs its panel, primes 3/3 and the pour lever engages; `branch-c` is `Locked` at the end
  (fresh save) — the gate being honest.
- **`boot --production` — `problems: []`**, imported body `gltf` (49 bones / 11 376 triangles).
- **`branch` (dev, clean profile) — `problems: []`:** all 10 A/B pairs docked on the **first**
  attempt, BM-1 and BM-2 rewards applied (branches A and B Complete), both plates discovered, hub
  stage 2, branch C `Available`; reload restores the autosave, **2/3 clues**, 8 staged actions and
  hub stage 2. It then plays **C's six C1–CM-3 pairs, all on their first attempt**, applies all
  four C rewards, completes Branch C, reaches `stage/crucible-restored`, wakes **and discovers**
  `clue/crucible-plate`, and ends at **A/B/C Complete, hub stage 3, 3/3 clues**. Along the way it
  refuses an **early pour** (`cm3/staged`) and recovers on the second pour after priming.
- **On this pass's final code:** `hold`, `dock`, `arms` and `boot`/`guns` (`--production`) all
  `problems: []` — `arms` walking 0.0001 m hand step, `handTurnRate` 4.81 (gate 12), `insideBody`
  0. These were also the 21/10 hygiene item; they now stand on the shipped three-branch build.

## Next up (start here)

1. **A human eye on the Great Crucible** (`?log=1`): walk in from the hall with Branch C open, read
   the three machines' frames (does the tuyere line read as one machine? does the C3 header read as
   one source to two consumers?), and check the third plate's row on the Regulator's plinth — two
   low plates either side of the column, one on it. The harness proves position and state, not
   composition.
2. **Sign off `DOCS/CONTEXT/SNAP-ASSIST.md`** — the four checklist items (band edges 0.45 m / 20° /
   60°, whether punish is feedback-only, whether the ramp threshold moves to 0.35, whether the
   reward pulse is presentation-only). Then it is a small, testable change.
3. **The reward-material consumer (§28)** — the one thing every branch pays into and nothing reads.
   This needs a decision first (what an upgrade *does*), so it is the next product question, not
   the next commit.
4. **The decoy build, live.** As of 24/10 Branch C completes in `branch`, its machines are proven
   gated (`crucible`), and three refusals are live: C2's **idler** (`ccw`), the two-feed/stacked
   **ceilings** (C1, C2, C3), and CM-3's **early pour** with its recovery. Still logic-suite-only:
   the **shut-off valve** jam (C1/C3/CM-3), the **blanking plate** on a drive (C2/CM-3), and the
   idler on C2's *open* puzzle (its reason code, not just its spin). Those want a wrong-build
   pass on a save where the branch is open.

**Limits:** the harness's route planner takes every door as open, so it is a *room* tool, never a
gate check — gating is proven by the boot log and the access-gate suite. `crucible` stands the
player by direct teleport (route planning is not used for entry) and reads derived machine state,
which exists while the branch is `Locked`; that is deliberate, and it means the scenario does not
prove C1 *completes* on a fresh save (the `branch` run and the logic suite cover the puzzle side).
Carry scenarios (`dock`, `branch`, `crucible`) need the **dev server** (a production build serves no
TypeScript for the harness's route planner). The Crucible's room is roughly 15 × 12 m of floor with
four machine framings; if a future machine needs more floor, the room's east wall is the only wall
with room to move.
