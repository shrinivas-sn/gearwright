# WORK — 20/10/2026

**Goal:** the item `DOCS/STATUS.md` has carried since 18/10 — *"a carried part is still 1.35 m from
a 0.46 m arm, and the obvious fix was tried and rejected by a gate"* — with the pass that item asked
for: **read the docking geometry (part size, socket clearance, `maxHoldRange`) instead of moving the
number.**

Three things came out of reading it, and two of them were not the thing the item expected:

1. **The 18/10 rejection was a harness artefact, not a docking constraint.** `dockInto` only ever
   stands the player 1.2–2.3 m from a socket. With the rejected 0.72 m hold, the part then sits
   0.48–1.58 m short of the socket at every vantage it tried, so no snap candidate ever appeared —
   and the run reported `hold lost` / soft-detach. The tooling never actually tested whether a short
   carry can dock.
2. **The docking geometry says a short carry is fine.** Measured headlessly against the shipped
   content, the real player capsule and the real colliders (`tests/logic/shipped-content-integrity.test.ts`):
   the *nearest standable stance* to any socket is **0.93 m** (P1/P2's mesh mounts, which sit between
   two shafts); shaft mounts 0.73 m, B2's steam port 0.65 m, every other socket 0.35 m. The dock
   predicate is a **1.3 m** centre radius (`detectRadius`) plus a padded-box overlap with the 0.8 m
   trigger volume, so standing 0.93 m out still leaves the part inside the volume with ~0.2 m to spare.
   `maxHoldRange` (2.6 m) never comes into it.
3. **A real carry defect was hiding behind the long hold.** With the part brought in to the hands, it
   stalled at **y = 0.55 against B2's 0.5 m governor plinth with `blocked: true`**, then the player
   walked on and it soft-detached. The follow only ever moved in a straight line: once the horizontal
   component of the next chunk crossed the plinth, every chunk failed and the part was abandoned. The
   old 1.35 m hold had masked it by keeping the part's arc clear of the machinery.

## What changed

**The hold distance is derived from the part (`src/core/arm-ik.ts`, `carryHoldDistance`).**
`carryReach` (0.42 m — the reach the imported body's measured 0.464 m arm has left once the elbows
bend for a two-handed grip) plus the part's **plan-view circumradius** (`hypot(hx, hz)`). The
circumradius, not the largest half extent: a box turned 45° presents its *corner*, which sticks out
`hypot(hx, hz)`, so it is the only value that bounds the part in every yaw and keeps the hold
**rotation-invariant** — turning a part in your hands never lunges it toward or away from the chest.
Clamped to `[0.55, 1.35]`, so the old constant survives as the ceiling and nothing is ever carried
further out than before.

| part | half extents | hold |
|---|---|---|
| gear / idler | 0.3 × 0.07 × 0.3 | 0.84 m |
| valve / shut-off | 0.3 × 0.12 × 0.12 | 0.74 m |
| boiler | 0.45 × 0.6 × 0.45 | 0.92 m |
| shaft | 0.16 × 0.16 × 0.5 | 0.94 m |
| crate | 0.4 × 0.4 × 0.4 | 0.99 m |
| BM-1 dynamo | 0.7 × 0.65 × 0.5 | 1.28 m |

**The hands grip the part's near face (`carryGripPoint`).** The rig was handed the part's *centre*,
which for anything bigger than a hand is behind its own front face — so the arms stopped wherever
they ran out instead of closing on the part. The composition now computes the surface point nearest
the player (measured **level with the part**, not from the feet: a ray from a standing player's
origin up to a chest-height part points mostly down, and the nearest face of a flat gear is then its
underside — the first version of this handed the hands a gear's bottom edge, 0.07 m below its
middle). It crosses the port as an optional `CarryableRenderState.grip`, computed by the L4
presenter (`feedback-composer.ts`) from the *interpolated* pose the hands must match.

**The carry height moved to the chest (1.05 → 1.20 m).** The hands work level with what they hold;
1.05 was a waist carry and cost 0.18 m of forward reach. Every shipped socket still engages: they sit
at 0.8–1.2 m and their volumes are ±0.4 m, so the vertical offset is at most 0.40 m.

**A carried part is lifted over low geometry, not abandoned against it
(`ManipulationSystem.advanceAlong`).** When the straight-line follow is blocked and the part still
needs to rise, it lifts by the remaining vertical component first and retries the horizontal move
from the lifted pose. A person does exactly this; the box check still refuses a lift into a ceiling.

**The harness stopped manufacturing verdicts it could not support.**
- `dockInto` now includes short standoffs (0.9 m, 0.7 m) in its coverage list — the gap that produced
  the 18/10 rejection.
- Its `hopTrace` now records the part's own pose and its `blocked` flag, so "the part stopped moving"
  is readable instead of inferred from the gap.
- `drainConsole` filters the **two** console lines this repo has always documented as expected noise
  (ANGLE `X4122`, the autoplay refusal) and nothing else. They were being counted as problems, which
  made `boot --production` unable to report `problems: []` on any machine whose driver emits X4122 —
  verified against `HEAD` with the work stashed, so this is attribution, not suppression.

**Tests.** `tests/logic/carry-reach.test.ts` (15): the derived distance per shipped part size, the
capsule clearance for every yaw, the circumradius bound, malformed input; and the near-face point —
broadside vs end-on, yaw, from above, inside the box, degenerate/non-finite. Plus a **shipped-content
guard** (2): every socket × every part it accepts, dockable through the *game's own* predicate from a
stance the real capsule can stand in — with a second test proving the check fails at a 2 m reach, so
it cannot pass vacuously. Plus the lift-over regression (1, verified to fail without the fix) and the
presenter's grip handoff (3).

## Verification (all re-run on the final code)

- `npm run typecheck` — exit 0.
- `npx vitest run` — exit 0, **64 files / 826 tests** (805 at HEAD; 21 new).
- `npm run build` — exit 0. `app` 293.28 kB (gzip 86.15) from 291.36 (85.62): **+1.92 kB raw /
  +0.53 kB gzip**; CSS and the `three` chunk unchanged.
- **`hold` (dev)** — exit 0, **`problems: []`**, body `gltf`. Hands at **dot 0.953 / 0.935**,
  extended **0.573 / 0.486 m** from the chest, and **0.182 / 0.225 m** from the grip face they are
  given — the new proximity gate. Before this pass the part's centre was 1.35 m out and the hands
  could only report their reach: ~0.8 m from any part surface.
- **`dock` (dev)** — exit 0, **`problems: []`**, docked on the **first** attempt (1.5 m standoff),
  `dropped: false`.
- **`arms` (dev)** — exit 0, `problems: []`. Standing 0.0000 m muzzle drift / 0.0000 m hand step;
  walking 0.0001 m hand step, 0.0000 m grip error, `handTurnRate` **5.24 rad/s** (gate 12),
  `insideBody` **0**.
- **`boot --production`** — exit 0, **`problems: []`**, body `gltf` (49 bones / 11 376 triangles),
  `walkSpeed 4`.
- **`guns --production`** — exit 0, `problems: []`, all five slots fire (8 / 11 / 1 / 1 / 1).

## Not run

**`branch`** (the whole Branch A→B curve) was **not** re-run this session: it is the ~12-minute
scenario, and the two scenarios it exercises most heavily (`dock` for the carry, `hold` for the grip)
were both re-run green on this code. The curve remains the one unproven gate on the 17/10 physics
code, unchanged — it is still `DOCS/STATUS.md` `## Next up` #2, now joined by a reason to expect it to
be *faster* (a part held 0.5 m closer is 0.5 m less to catch up after every hop).
