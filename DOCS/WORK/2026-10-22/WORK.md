# WORK — 22/10/2026

**Goal:** the three items `DOCS/STATUS.md`'s `## Next up` actually names, in order — settle the
carried-over verification hygiene, state the snap-assist/SlotJudge decision the repo has owed since
17/10, and then **Branch C**.

## 1. Baseline first (the hygiene item)

`STATUS.md` #3 said `hold`, `dock`, `arms`, `boot`, `guns` had not been re-run on 21/10 and their
20/10 numbers should not be treated as fresh. Re-run on HEAD `72efa4a`, clean profile:

| Scenario | Result |
|---|---|
| `npm run typecheck` | exit 0 |
| `npx vitest run` | exit 0 — 64 files / **827 tests** |
| `boot --production` | `problems: []` |
| `arms` (dev) | `problems: []` — walking hand step **0.0001 m**, grip error **0.0000 m**, `handTurnRate` **4.29** (gate 12), `insideBody` **0** |
| `hold` (dev) | `problems: []` |
| `dock` (dev) | `problems: []` |
| `guns --production` | `problems: []` |

A first `vitest` run reported 57/64 files and 7 worker errors while the Chrome harness was starting
on the same machine; the clean re-run was green, so the suite is fine and the noise was resource
contention, not a test.

All five scenarios were re-run **at the end** on this pass's final code as well (the harness itself
changed): `hold`, `dock`, `arms` `problems: []` (`arms` 0.0001 m hand step, `handTurnRate` 4.805,
`insideBody` 0), and `guns --production` `problems: []`.

## 2. The snap-assist / SlotJudge decision, stated

`DOCS/CONTEXT/SNAP-ASSIST.md` is new. It does not change a weight — the point is that the name had
**no spec anywhere in the repo**, so changing the assist on a guess was exactly the blind change the
project refuses. The note pins the shipped numbers (`detectRadius` 1.3 m, `assistThreshold` 0.25 →
assist starts at 0.975 m, `maxAssist` 0.85, part-derived hold 0.55–1.35 m, and **orientation is not
a gate at all** — only `snapYaw` the part cannot realise is refused), defines *reward* and *punish*
as feedback bands over (distance, yaw error), and lists the four things that need sign-off before
code: band edges (0.45 m / 20° / 60°), whether punish is feedback-only, whether the ramp threshold
moves 0.25 → 0.35, and whether a reward pulse is presentation-only. Nothing in `snap-system.ts` or
`manipulation-system.ts` was touched.

## 3. Branch C — the Great Crucible

The third branch, built the way the §6 expansion path says to: **content only**, no core change.

**The new teaching is a ceiling.** Every prior machine wanted a connection; C's want **not too
much of one**. `maxOutput` already existed and `safety: 'overpressure'` already existed as a
validator condition — Branch C is the first content that makes it a *player-visible objective*
rather than a latent warning.

- **C1 "Tuyere"** (entry, beat 2) — one furnace feeding one tuyere through two parallel blast
  ports. One open valve reads 1 and lights it; **two open valves read 2 and trip the 1.5 ceiling**;
  a shut-off valve fits a port, conducts nothing, and jams. Three failure modes, three reasons.
- **C2 "Quench"** (combining, beat 3) — Branch A's direction lesson and C's ceiling on one frame:
  the vessel must turn **clockwise** (plain gear vs idler) *and* be fed from **one** of two quench
  ports. Right-handed drive, single feed.
- **C3 "Slag Run"** (open-ended, beat 4) — one furnace, two consumers, three routes. `A+B` and `C
  alone` both complete; `A+C`/`B+C` stack a run on the cross-run and trip the ceiling. Two different
  kinds of answer, which is what "open-ended" has to mean here.
- **CM-3 "Great Crucible"** (capstone, beats 5–6) — the third staged machine (ADR-018), same shape
  as BM-1/BM-2: assembly → three priming lines in any order → an ordered pour. It carries the
  branch's own lessons too (the drive must turn cw; the blanking plate fits and cannot bridge).

**One arithmetic discovery, caught by the suite.** C3's cross-run declares two links through one
socket, and `MachineGraph` sums the carrier **at the shared bridge** — so `C` alone reads **2** at
each consumer, not 1 (the same thing P3's cross-run does). My first ceiling of 1.5 therefore made
`C` alone over-pressure. The fix is honest and keeps the lesson: `maxOutput: 2.5` sits between the
cross-run's own value (2) and a cross-run stacked on a single run (3). The machine comment and the
objective text now say exactly that.

**Room and door.** The Crucible is a second room behind the same north wall, **east of the Steam
Works** (x 9–24, z 20–34), with its own doorway cut at **x = 12** in `levels/game-room.ts`. Its
west wall *is* the Thermal Line's east wall, so the two branches share a wall and never a room. The
hub's Branch C door moved from x = 6 to x = 12 for the same reason: at x = 6 it opened into the
Steam Works' floor, inside another branch's room.

Also shipped: four reward milestones (materials only, the §27.2 rule), the third clue plate
(`clue/crucible-plate`, placed on the plinth's right, mirroring the thermal plate), C hint nudges,
C's staged action ids, and the branch definition that **unseals C and gates it behind A + B**. The
existing `stage/crucible-restored` hub stage needed no edit.

## 4. Harness: a Crucible scenario, and two harness defects it found

`node scripts/browser-check.mjs crucible` lands the player in the room, docks C1's first valve,
reads the machine, docks the second, and reads it again. It deliberately checks **derived machine
state**, which exists even while the branch is `Locked`, so a fresh save can prove the ceiling
without eight puzzles first.

Two real tooling defects surfaced while making it work:

1. **`hopTo` stopped after 0.4 m when empty-handed.** The step loop broke out on `heldId === null`,
   so any check that moved the player *without* carrying something silently stayed near its start —
   the first version of this scenario reported "entered" while still at the spawn pose. The early
   exit is gone; the held-part wait loop above it is what actually needed the check.
2. **Route planning could not see Branch C at all.** `staticColliders()` imported Branch B's world
   and stopped there, and `findPath`'s grid ended at x = 9 — so every vantage in the new room fell
   back to a straight-line teleport (which ignores collision). The collider list now includes
   `BRANCH_C_WORLD`, and the grid reaches x = 25.

**Harness note:** the entry check stands at (12.2, 24.4) — clear floor between C1's and C2's part
rows. An earlier version of the check stood at (12, 22), on top of the shut-off valve's footprint,
and read back `y = 0.242`; the isolated physics reports `y = 0.002` there, so whatever moved the
player up is live-only and was not chased. The check does not need to stand on a part, so it
doesn't.

## 5. Verification

- `npm run typecheck` — exit 0.
- `npx vitest run` — exit 0, **65 files / 845 tests** (827 at HEAD; +18 across the new Branch C
  suite and the content-coupling updates).
- `npm run build` — exit 0. `app` **315.13 kB** (gzip 90.24) from 293.56 (86.24): **+21.57 kB raw /
  +4.00 kB gzip** for the whole branch (four machines, a room, puzzles, rewards, clues, hints);
  `three` and the CSS unchanged.
- **`node scripts/browser-check.mjs crucible` (dev) — `problems: []`:**
  player stands on the new floor at (12.2, 24.4) `y = 0.002`, `grounded: true`; 3 parts / 2 sockets
  composed; first valve → `outputs: [pressure 1]`, `warnings: []`, `state: running`,
  `dropped: false`; second valve → `outputs: [pressure 2]`, `warnings: ["overpressure"]`, `dropped:
  false`. Hub stage stays 0 (the branch is still Locked on a fresh save), which is the gate being
  honest.
- `boot --production` and the full `branch` curve re-run on this pass's code — see below.

### The A→B curve on this pass's code

`node scripts/browser-check.mjs branch` (dev, clean profile) — **exit 0, `problems: []`, the whole
curve still plays in one session** with the Crucible added to the world:

- all **10** part→socket pairs dock, **every one on its first attempt** (`dropped: false`): P1, P2,
  P3 ×2, B1 ×2, B2 ×2, B3 ×2;
- **BM-1** and **BM-2** each apply their milestone (`bm1-pressure-dynamo`, `bm2-steam-engine`), so
  Branch A and Branch B are **Complete**;
- both clue plates discovered, hub stage 2 (`stage/regulator-awake`), branch C **Available**;
- reload restores the autosave, **2/3 clues**, **8 staged actions**, hub stage 2 and both branches.

The one assertion that changed is the clue count: the run plays two branches, so it correctly
restores **2 of 3** now that a third plate exists. Its first run on this code failed that line for
exactly that reason (the game's log read `2/3`, the harness regex still wanted `2/2`) — a harness
expectation, not a game defect.

## Tests touched (content coupling, all deliberate)

- `bm2-staged` asserted BM-2's props against `STAGED_ACTIONS.slice(4)` — a *global* list that now
  also carries CM-3's actions. It compares against BM-2's own declared machine actions instead.
- `hint-system` requires one nudge per shipped puzzle and that no nudge names a part or socket: C's
  four nudges are in the expected key set, and C's components/sockets join the "never named" list.
- `hub-visual-facts`: three clues now (was two), and a new case pins C's *door* opening on B's
  completion while its *trunk* and *plate* wait for C itself — plus the final stage (all three
  trunks gold, Regulator restored, three plates awake).
- `hub-access-gate` / `progression-system`: C is a gate behind B now, not a build-time seal.
- `shipped-content-integrity`: the "gate is satisfiable" check now completes **A and B** (and
  asserts C is still Locked after A alone), plus a Branch C completion case and a walk through the
  Crucible doorway with the real capsule.
- New `tests/logic/branch-c-crucible.test.ts` (18 cases): C1's ceiling and jam, C2's direction /
  plate / two-feed ceiling, C3's two accepted builds, its stacked-run refusal and its jam, CM-3's
  prime→pour order, its out-of-order recovery, and its idler refusal.
