# Project Status — Gearwright

**Branch:** `main` | **Date:** 2026-10-21 | **Phase:** Post-Overhaul · branch curve confirmed
**Worktree:** `E:\gearwright` · **Status:** `DOCS/STATUS.md` (index `DOCS/README.md`; log + numbers `DOCS/WORK/2026-10-21/WORK.md`; previous pass `DOCS/WORK/2026-10-20/WORK.md`; text moved out `DOCS/WORK/archive.md`)
**Live:** https://shrinivas-sn.github.io/gearwright/ · **Repository:** https://github.com/shrinivas-sn/gearwright

## Shipped state

- **The whole Branch A→B curve is played, green, in one session (21/10).** `branch` (dev, clean
  profile) exits 0 with **`problems: []`**: **10/10** part→socket pairs dock, **every one on its
  first attempt**; BM-1 and BM-2 each fire their 5/5 burst (reward, branch Complete, hub
  `stage/pressure-online` → `stage/regulator-awake`, clue plate awake, autosave); both plates are
  discovered; the reload restores the autosave, **2/2 clues**, **8 staged actions** and hub stage 2.
  This closes the gate carried since 17/10.
- **A carried part slides along geometry instead of wedging on a corner (21/10, found live).** P1's
  bearing blocks occupy **y 1.02–1.38 m — exactly the 1.20 m carry height** — so carrying the gear
  to the mesh mount from the far side made the straight-line follow clip a bearing's **corner** on
  every chunk: it stalled at `blocked: true` a metre short and soft-detached as the player walked
  on, even though **sliding along x alone was free the whole way**. `followHold` now moves on x and
  z separately when the direct path is blocked (after the lift-over retry), each axis still
  chunk-checked so a slide can never embed the part. A regression test runs the **real P1
  colliders** from the live wedge pose (-7.66, 1.20, -1.05) and fails without the fix.
- **The harness no longer lies about a restarted run (21/10).** A killed run never reaches cleanup,
  so its Chrome profile survives — and the game's autosave lives in it: the next run booted the
  *previous* run's world (`gear-a` under the shafts, P1's first grab `NOT FOCUSABLE`). The profile
  is now deleted at the start of every run. The long scenario also reports each pair as it plays
  (and names "docked" for the pairs before a reward, which have no puzzle of their own).
- **A carried part is held in the hands, at the distance its own size needs (20/10).** The fixed
  1.35 m hold is gone: `carryHoldDistance` gives a part `carryReach` (0.42 m — the imported body's
  measured 0.464 m arm, elbows bent) plus its plan-view **circumradius**, clamped to [0.55, 1.35]. A
  gear is held at 0.84 m, a valve 0.74, a crate 0.99, the BM-1 dynamo 1.28. The hands now grip the
  part's **near face** (`carryGripPoint`, computed by the L4 presenter and carried on
  `CarryableRenderState.grip`), measured **live** at 0.18 / 0.23 m from that face — the previous
  centre-based target left them ~0.8 m short of any surface. Carry height moved to the chest
  (1.05 → 1.20 m), which is where the hands are.
- **The 18/10 rejection of a short hold was a harness artefact, and the geometry now says so.**
  Measured against the shipped content with the real capsule and colliders: the *nearest standable
  stance* to any socket is 0.93 m (P1/P2's mesh mounts, between the shafts), 0.73 for shaft mounts,
  0.35 for almost everything else — and the dock predicate is a **1.3 m** centre radius plus a
  padded-box overlap, so a 0.74 m hold still lands inside every socket's volume. `maxHoldRange`
  never came into it. `dockInto` only ever stood 1.2–2.3 m from a socket, so the rejected 0.72 m hold
  could not put a part in range from any vantage it tried.
- **A carried part is lifted over low geometry instead of being abandoned against it (20/10, found
  live).** With the part brought in, B2's valve stalled at **y = 0.55 on the governor's 0.5 m
  plinth** (`blocked: true`) and was dropped once the player walked on: the follow only moved in a
  straight line, so every chunk toward the hold crossed the plinth. It now lifts by the remaining
  vertical component and retries the horizontal move; a ceiling still refuses (box-checked).
- **The hands stay on the gun and out of the body (19/10, the reported "hands rotate and clash inside
  the body").** The imported body used to aim only the forearm, leaving the hand's own direction to
  the clip — so the *position* was right and the fingers still pointed through the gun or the chest.
  Each arm now resolves a finger bone and `orientWrist` turns the hand back onto the forearm's line
  with `clampTurnDirection`, at most 24 rad/s (`core/arm-ik.ts`). A new `clampOutsideTorso` pushes a grip target out of an
  oriented chest box (0.20 × 0.14 m, 0.8–1.62 m) **before** the reach clamp, so an aim swung behind
  the character cannot drag a forearm through the ribcage; ordinary grips are copied through
  untouched, pinned by tests.
- **Locomotion at the top of the range and the camera caught up (19/10, "slow and not smooth").**
  Walk **4.0 m/s**, run **8.0 m/s**, acceleration **55 ms**, deceleration **45 ms**, turn
  **18 rad/s** — the top of ARCH §16's workshop range. The camera follow went 14/18 → **20/26**,
  cutting the positional trail from ~70 ms to ~50 ms (at 8 m/s the body used to slide forward under
  the eye before the camera caught up).
- **The weapon HUD is styled (19/10).** The weapons pass shipped the markup with no CSS: the block
  rendered as an unstyled list. It now has a top-right surface, tabular ammo, a written
  READY/RELOADING/refusal line, a closing ADS reticle, and **slot chips sized to their own labels**
  (they wrap rather than overflow).
- **Slots are drawn at the size of what goes in them (19/10).** Socket markers used the level's
  0.4 m trigger volume, so a pipe port was an 0.8 m cube. `acceptedFootprint()` (tags → component
  definitions) sizes the drawn marker to the accepted part + 0.04 m. The snap query still uses the
  authored trigger volume, so docking is unchanged.
- **The hands are on the gun now (18/10, the reported "broken hand movements").** Five causes, all
  fixed at the source: the weapon mount was **reading the rendered hand** every step (a closed loop
  that walked the arm forward until its reach clamp locked it straight); the body was drawn at the
  **interpolated** position while the gun and its grip came from the **simulated** one a frame later
  (6–12 cm of trail at a run); the grip points were **outside the imported body's arm reach** (its
  shoulder-to-wrist is 0.464 m — the fore-end sat 0.48 m from the left shoulder, so the supporting
  arm was clamped all session); the procedural rig solved from its **rest** shoulder and ignored the
  hips/spine the gait rotates; and the imported body's **elbow plane flipped** because it was read
  off the current clip near full extension. The gun is now a pure function of stance + aim
  (`core/weapon-mount.ts`), the grip targets are clamped into each arm's reach with their direction
  kept (`core/arm-ik.ts`), each arm owns a rate-limited `ElbowPole`, a carried part is held at two
  points ±0.17 m apart, and the torso **squares up to the aim** (BR-style twist on both bodies).
- **Measured, not eyeballed:** a new `arms` browser scenario reports muzzle drift **0.0000 m** and
  hand step **0.0000 m** while standing, and **0.0001 m** with **0.0000 m** grip error while walking.
  The same scenario on the previous code read **0.119 m** of body-relative hand movement at a walk
  and a left hand **0.185 m** off its grip.
- **Gravity works off a ledge (17/10, real defect).** `KinematicPhysics` reported `supported` for a pose with nothing under it, so walking off a platform glued the player to their altitude (a 1 m/s descent that never accelerated) and let them **hop from mid-air**; the flag was OR-accumulated across sub-steps too, so a move crossing a ledge claimed ground after leaving it. The support query now answers "nothing underfoot" honestly, and the flag describes the pose actually reached. 5 new tests, each verified to fail against the old code.
- **Carry feel (17/10, the tune `PLAN.md` left owed).** Hold blend 14 → 30 (trail behind a running player ~0.33 m, was ~0.56), rotate 2.2 → 3.4 rad/s (quarter turn 0.46 s, was 0.71), travel cap 8 → 9 m/s; the carried advance is carved into chunks half the part's own thickness, so it cannot jump a thin beam at any step size. **A carrying player can run now** — the input map read `run` hard-false while carrying — and the composition scales a carried walk 0.6 (3.6 → 2.16 m/s) and a carried run 0.85 (7.4 → 6.29 m/s).
- **Shooting: a sandbox weapon range (16/10, ADR-020)** — six weapons, authored recoil patterns, spread/bloom, magazines + reloads, ADS, crouch, pooled simulated bullets; `?guns=0` = the pre-pass game. The drawn weapon's **two-handed grip** landed in `73d0aa7`.
- Still unbuilt: **Branch C (Great Crucible)** and **a consumer for the reward materials (§28)**. Earlier passes (Branch B, the imported rigged body): `DOCS/README.md`.

## Verification

- **Typecheck** clean · **Tests** 64 files / **827** (826 at the previous commit) · **Build** clean: `three` 624.62 kB (gzip 158.35), `app` 293.56 kB (gzip 86.24) — **+0.28 kB raw / +0.09 kB gzip** for this pass; weapon HUD CSS 11.85 kB (gzip 2.69).
- **21/10 `branch` (dev, clean profile): exit 0, `problems: []`** — 10/10 pairs docked on the **first** attempt (`dropped: false` throughout), BM-1 burst 5/5, BM-2 burst 5/5, both clue plates discovered, reload restores autosave / 2/2 clues / 8 staged actions / hub stage 2, end state `branchA: Complete, branchB: Complete, hubStage: 2`.
- **20/10 live:** `hold` (dev) **`problems: []`** — hands dot 0.953 / 0.935 at 0.573 / 0.486 m, **0.182 / 0.225 m from the grip face**; `dock` (dev) **`problems: []`**, docked on the **first** attempt, `dropped: false`; `arms` (dev) **`problems: []`** — walking 0.0001 m hand step, 0.0000 m grip error, `handTurnRate` **5.24** (gate 12), `insideBody` **0**; `boot --production` **`problems: []`**, body `gltf` 49 bones / 11 376 triangles, `walkSpeed 4`; `guns --production` **`problems: []`**, five slots fire (8 / 11 / 1 / 1 / 1).
- **New this pass:** `tests/logic/carry-reach.test.ts` (15 — the derived distance per shipped part size, capsule clearance in every yaw, the circumradius bound, the near-face point including the top face, inside-the-box and non-finite input) and a **shipped-socket dock guard** (2 — every socket × every accepted part, dockable through the game's own predicate from a stance the real capsule can stand in; the second test proves the guard fails at a 2 m reach, so it cannot pass vacuously). Plus the lift-over regression (verified to fail without the fix) and three presenter grip tests.
- **Live (real Chrome):** `boot --production` (exit 0, **`problems: []`**, body `gltf` 49 bones / 11 376 triangles, `walkSpeed 4`, weapon panel **300 × 119 px** with five **72–83 px** slot chips all inside it) and **`arms`** (dev; standing 0.0000 m muzzle drift / 0.0000 m hand step / 0.0000 m grip error; walking 0.0001 m step / 0.0000 m grip error, ≤0.0001 m body-relative spread, **`handTurnRate` 4.07 rad/s** against a 12 gate, **`insideBody` 0**) green after the wrist/torso changes. The 18/10 pass's `guns --production` and `hold` figures still stand (this pass touched neither the weapon simulation nor the carry target).
- **New this pass:** `CharacterFacts` carries optional `handLForward`/`handRForward` (wrist → fingers, unit), and the `arms` scenario now turns that into two measured gates: worst hand angular rate while walking (12 rad/s; a clip-driven hand runs at the 24 rad/s wrist limit) and a body-relative torso-box count that must stay 0.
- **`branch` (dev, whole curve in one session): unconfirmed.** Its first run on this code stalled at P2 because the hop teleported to a flat `y = 0.01` over unsupported spots — survivable only while the physics bug above held the player up. `hopTo` now stands the player on the height the level has under the target (`__probe.standingHeightAt`), and the confirming run was **stopped after ~30 min without finishing** (a clean-profile run at HEAD took ~12 min: branch A and B `Complete`, hub stage 2, both clue plates restored after the reload). So the curve is proven at HEAD but **not yet on this pass's code** — and the hop change itself is now a suspect for the extra time (it adds one async collider query per 0.4 m hop step).

## Next up (start here)

1. **Watch the arms in motion on the live link** (`?log=1`): fire a burst (the hands should stay on
   the gun through the recoil kick), walk with a part, and turn the camera hard — the elbows should
   sweep, never flip, and the wrists should turn *with* the gun (the 19/10 `orientWrist` solve).
   Also check the new weapon panel at the top-right in a real window: the slot chips must wrap
   inside it, and the ammo/state line must stay readable over a bright lab surface.
2. **A decision for the snap-assist/SlotJudge reward-punish pass** — the name has no spec in the
   repo, so the thresholds and what "reward" versus "punish" mean need stating before any code —
   then **Branch C** and the **reward-material consumer**.
3. **Optional hygiene:** `hold`, `dock`, `arms`, `boot`, `guns` were not re-run on 21/10 (the only
   gameplay change is the follow's blocked branch, exercised hardest by `branch`). They are cheap
   — run them before the next release claim rather than treating their 20/10 numbers as fresh.
4. `PLAN.md` has been **deleted**: both passes it carried (locomotion + weapons, hand & arm motion)
   are closed, the carry-distance decision landed on 20/10, and the `branch` gate it left open was
   closed on 21/10. The record lives in `DOCS/WORK/2026-10-16/`, `2026-10-18/` and `2026-10-21/`.

**Limits:** the carry geometry is measured with the *standing* capsule on the room floor at `y = 0`;
no shipped socket is on a raised platform, but a future one would need `standingHeightAt` in that
check. `hold`'s proximity gate is 0.25 m from the grip face — a hand is 0.17 m from it by
construction (`splitGrip`), so it measures "the arm reached the part", not millimetre contact.
`arms` measures the *presented* mount, because that is what the hands follow — the
simulation's own muzzle leads it by up to one fixed step (≤0.06 m at a run) by design, and reading
the wrong one is what made the first measurement of this pass report a phantom 0.14 m error. Carry
scenarios (`dock`, `branch`) need the **dev server** (a production build serves no TypeScript for the harness's route planner, so they correctly report `inconclusive`). The harness's hop needs a floor under its target; over a genuine hole it falls back to `y = 0.01` (straight line + rollback, as before). A carried part now **slides** along geometry it cannot pass, so the follow keeps pace around corners — but it still has no pathfinding: a part yanked across a machine in one teleport-sized step can slide a long way round, which is what `branch`'s hop-and-wait exercises. A **killed** run leaves its Chrome profile behind unless the harness is allowed to clean up — deleted at the start of every run since 21/10.
