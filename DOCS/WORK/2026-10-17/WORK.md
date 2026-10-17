# WORK — 17/10/2026

**Goal of this pass (owner-requested):** improve the physics and the mechanics — the
locomotion, collision and carry behaviour a player actually feels — without breaking the
shipped puzzle experience.

Focus, in the order it happened: a **real gravity defect** found by reading the collision
adapter, and the **carry-feel tune** `PLAN.md`'s Phase A folded in and left owed.

## What this session did

1. **The world reported ground everywhere (real defect, `src/adapters/kinematic-physics.ts`).**
   `moveAndSlide` derived `supported` from `landOnSupport`, which returned the *current* `y`
   when no collider was under the footprint — so a pose with nothing beneath it still read as
   "supported". Two player-facing consequences: walking off a ledge never accelerated under
   gravity (the player stuck to whatever altitude they were at and sank at the grounded-stick
   speed of 1 m/s), and `grounded` stayed true, so **Space hopped from mid-air**. A third came
   out of the same place: `supported` was OR-accumulated across sub-steps, so any single move
   that crossed a ledge claimed ground *after* leaving it (a stalled frame resolves a long
   sweep in one call).
   Fixed at the cause: `supportTopUnder()` returns `null` when there is genuinely nothing
   underfoot, `landOnSupport` carries that through instead of inventing a height, and
   `moveAndSlide` reports the support of the pose it actually reached (one `probeDown` after
   de-penetration), never "touched ground at some point during this move".
   Pinned by **5 new tests** — 3 in `tests/logic/kinematic-physics.test.ts` (supported on a
   platform, **not** supported the step after walking off the edge, never supported in open
   air) and 2 in `tests/logic/player-controller.test.ts` (falls under gravity past the edge
   and cannot hop mid-air; lands on the floor and is grounded again). Both suites were run
   against the old code first and fail there.

2. **Carry feel (the owed tune, `src/gameplay/manipulation-system.ts`).** The hold follows an
   exponential, so a carried part trails its anchor by `v / (1 - e^(-holdBlend·dt))`: at the
   old `holdBlend` of 14 that was **~0.56 m** behind a running player, which reads as dragging
   rather than carrying. `holdBlend` 14 → **30** (~0.33 m), `rotateSpeed` 2.2 → **3.4** rad/s
   (a quarter turn in 0.46 s instead of 0.71 s), `maxLinearSpeed` 8 → **9** m/s so the part can
   actually keep station at a carried run. Pinned by 3 new tests in
   `tests/logic/manipulation-system.test.ts` (lag under 0.4 m while the player runs, the
   per-step clamp still holds, a quarter turn inside half a second).

3. **A carrying player could not run at all (`src/gameplay/input-system.ts`,
   `src/gameplay/phase-world.ts`).** The Manipulation context hard-set `run: false` — ARCH §15
   calls the carry a "slow strafe", and the input map had implemented that by deleting the
   sprint instead of scaling it. The context now reads the run modifier, and the **composition**
   (which owns locomotion) decides what a carry costs: `CARRY_WALK_SCALE 0.6` and
   `CARRY_RUN_SCALE 0.85`, i.e. 3.6 → 2.16 m/s walking and 7.4 → 6.29 m/s running while
   holding a part. One `input-system` test asserted the old behaviour verbatim; its expectation
   is deliberately reversed, with the reason recorded next to it. Pinned by a new
   `phase-world` test that measures all three (carry-walk, carry-run, free run).

4. **A carried part cannot be moved through geometry at any step size
   (`src/gameplay/manipulation-system.ts`).** The follow swept the sphere inscribed in the
   part's box and then checked the destination box once, so with a large `dt` (the SM accepts
   up to 0.25 s, and its own tests use 1/10) the travel per step (0.9 m) exceeded a thin part's
   blocking window and it jumped clean over a beam. The advance is now carved into chunks no
   larger than **half the part's own thickness**: the full move is still the first candidate
   (an unobstructed follow costs exactly one box query, as before), a blocked step commits the
   last free chunk and stands the part against the face, and nothing is ever embedded. Pinned
   by 2 new tests whose first case ends with the part past the beam (x = 7.34) on the old code.

## Verification (all re-run on the final code)

| Check | Result |
|---|---|
| `npm run typecheck` | exit 0 |
| `npx vitest run` | exit 0 — 60 files, **769 tests** (756 at HEAD: +5 physics/controller, +5 carry, +1 phase-world; 1 input test's assertion deliberately reversed) |
| `npm run build` | exit 0 — `three` 624.62 kB (gzip 158.35) / `app` 286.35 kB (gzip 83.49): **+1.31 kB raw / +0.40 kB gzip** for this pass |
| `boot --production` | exit 0 — imported body (49 bones / 11 376 tris), grounded, only the documented ANGLE `X4122` warning |
| `guns --production` | exit 0 — pools flat (`poolPeak 8`, `poolDrops 0`), 79 idle → 82 firing, ADS 60° → 43.45°, crouch-walk 2.06 vs 3.74 m/s, `?guns=0` still the pre-pass game |
| `hold` (dev) | exit 0 — `problems: []`, reach dots 0.968 / 0.958 (unchanged by the carry tune) |
| `dock` (dev) | exit 0 — `problems: []`, first vantage "Socket compatible — confirm to dock", route planning available |
| `branch` (dev) | **unconfirmed** — the confirming run was stopped after ~30 min without finishing; see below |

**The `branch` curve, and what the first run on this code found.** Playing the whole curve in
one session is the long gate (~12 min). Its first run on this code ended with branch A still
`InProgress` (hub stage 0, no clues, BM-1 never reached) even though the harness exited 0.
The trace blamed the harness, not the game: the hop teleports the player to a flat
`y = 0.01`, which only ever survived because the physics reported `supported` for a pose with
nothing under it — the very bug fixed above. With gravity working, a teleport into a pocket
over an unsupported spot *falls*, and once the player is more than `maxHoldRange` (2.6 m)
below the held part, EC-MAN-07 soft-detaches it and the dock attempt is lost (a trace shows
`held: null, dist: 14.57`). This is the same class as **Plan issue #8** (a tooling artefact
that reads like a game defect), so the hop now asks the level for the height it actually has:
a new `__probe.standingHeightAt(x, z, fromY)` returns the highest collider top under the
target that is reachable from the player (within the capsule's step height), and `hopTo`
places the player there; the rollback path uses it too. A clean-profile `branch` run at HEAD
was green for comparison (branch A and B Complete, hub stage 2, both clue plates restored
after the reload, ~12 min).

The confirming run on this code was **stopped after ~30 min without finishing** (the dev
server and the run's Chrome were left clean and the tree committed at `f21a875`), so the
whole-curve gate is proven at HEAD but **not yet on this pass's code**, and the hop change
is itself a suspect for the extra time: it adds one async collider query per 0.4 m hop
step, and a hop that keeps landing badly retries through vantages. That is the first thing
the next session should settle, with the run time-boxed and the hop instrumented rather
than assumed.

## Owed / deliberately not done

- **snap-assist/SlotJudge reward-punish pass.** Grepped `DOCS/`, `PLAN.md`: the name has no
  spec anywhere in the repo (no thresholds, no "reward" vs "punish" definition). Changing the
  assist weights on a guess is exactly the kind of blind change this project refuses, so it
  stays owed and item 4 of `STATUS.md`'s `## Next up` asks for the decision first.
- `PLAN.md` (the 16/10 weapons pass) is still at the root. Its owed carry tune is now landed;
  the file can go with the next docs commit.
