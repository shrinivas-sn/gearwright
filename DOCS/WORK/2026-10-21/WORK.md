# WORK — 21/10/2026

**Goal:** the one gate `DOCS/STATUS.md` has carried since 17/10 — the **`branch` curve, end to end**
(`Next up` #2). It is now **confirmed green**, and getting there turned up one real carry defect and
three harness lies.

## The run that lied first

The first attempt today failed P1 and P2 outright, and the reason was **stale state, not the game**:
a killed run never reaches the harness's cleanup, so it leaves its Chrome profile — and the game's
autosave lives in it. The next run boots into the **previous run's world**: `gear-a` was lying at
(-8.42, -1.30) where an earlier session dropped it, not at its spawn (-6.20, 1.50), so the first
grab reported `NOT FOCUSABLE` and every P1 vantage inherited the mess.

The harness now **deletes its profile at the start of every run** (`main()`), so "a fresh boot" is
one. That matters beyond this session: any red verdict from a restarted harness was potentially
about the last run's world.

## A real carry defect behind it

With a clean profile the parts followed correctly except at the machines, where the trace showed the
carried gear **stuck at `blocked: true`** while the player walked on — then soft-detached at 2.6 m.

The cause is geometric and specific: P1's **bearing blocks** occupy y 1.02–1.38 m — exactly the
hands' carry height (1.20 m). Carrying the gear from the far side of the mesh mount, the straight
line to the hold target clipped a bearing's **corner** on every chunk: it could not go forward, and
it had no way to go around, even though **sliding along x alone was free the whole way**.

Fixed in `ManipulationSystem.followHold`: when the straight path is blocked (and the lift-over
retry has not helped), the follow now moves on **x and z separately**, each still chunk-checked by
`advanceAlong`, so a slide cannot embed a part either. It is what a person does — drag the part
along the machine instead of catching it on a corner — and it keeps the part in hand while the
player keeps walking.

`tests/logic/manipulation-system.test.ts` reproduces it against the **real P1 colliders** and the
gear's real definition, from the live wedge pose (-7.66, 1.20, -1.05): with the player in the aisle,
the part used to stay at z = -1.05 and now arrives at the hold (-7.34, 0), never overlapping
geometry. Verified to fail without the fix.

## The harness stopped printing only at the end

A 12-minute scenario that prints its verdict once, at the end, cannot be diagnosed when the *first*
pair fails — which is exactly what happened. `playPair` now reports each attempt as it happens
(`[pair] … attempt 1: grab … / completed | docked | NOT completed | socket … | N hop(s) rolled
back`), and dumps the per-vantage attempts only when a pair fails. "Docked" distinguishes the pairs
before a branch's reward (no puzzle of their own, criterion = the part stayed in hand) from a
scored completion.

**And the console filter had a channel-shaped hole.** The documented autoplay refusal arrives on
*both* CDP channels — `Runtime.consoleAPICalled` (filtered since 20/10) and `Log.entryAdded` (not
filtered) — so a clean run reported two "problems" that `STATUS.md` has always listed as expected
noise. The same two patterns now filter both channels and nothing else.

## Verification

- `npm run typecheck` — exit 0.
- `npx vitest run` — exit 0, **64 files / 827 tests** (826 at HEAD; +1, the wedge regression).
- `npm run build` — exit 0. `app` **293.56 kB** (gzip 86.24) from 293.28 (86.15): **+0.28 kB raw /
  +0.09 kB gzip**; `three` and the CSS unchanged.
- **`node scripts/browser-check.mjs branch` (dev, clean profile) — exit 0, `problems: []`,
  the whole curve played in one session:**
  - all **10** part→socket pairs docked, **every one on its first attempt** (`P1`, `P2`, `P3`,
    `B1`, `B2`, `B3`, `BM-2`'s two), `dropped: false` throughout;
  - **BM-1** burst 5/5: `BM-1:milestone/bm1-pressure-dynamo` applied, Branch A **Complete**, hub
    `stage/pressure-online`, `clue/regulator-plate` awake, autosave written;
  - **BM-2** burst 5/5: `BM-2:milestone/bm2-steam-engine` applied, Branch B **Complete**, hub
    `stage/regulator-awake`, `clue/thermal-plate` awake, autosave written;
  - both clue plates **discovered** (`Inspect @ 2.96 m` / `2.17 m`);
  - **reload** restores the autosave, **2/2 clues**, **8 staged actions**, and the hub reads
    `stage 2 (Regulator Awake); branch-a=Complete (open), branch-b=Complete (open)`; end state
    `branchA: Complete, branchB: Complete, hubStage: 2`.

## Not run

`hold`, `dock`, `arms`, `boot`, `guns` were **not** re-run this session. The only gameplay change is
the follow's blocked branch, which those scenarios do not exercise (the branch run exercises the
carry hardest: ten docks, two staged machines, a reload); the harness changes are output and
profile hygiene. Their 20/10 numbers stand.
