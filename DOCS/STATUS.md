# Project Status — Gearwright

**Branch:** `main` | **Date:** 2026-10-18 | **Phase:** Post-Overhaul · hand & arm motion pass
**Worktree:** `E:\gearwright` · **Status:** `DOCS/STATUS.md` (index `DOCS/README.md`; log + numbers `DOCS/WORK/2026-10-18/WORK.md`; previous pass `DOCS/WORK/2026-10-17/WORK.md`; text moved out `DOCS/WORK/archive.md`)
**Live:** https://shrinivas-sn.github.io/gearwright/ · **Repository:** https://github.com/shrinivas-sn/gearwright

## Shipped state

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

- **Typecheck** clean · **Tests** 62 files / **792** (769 at HEAD) · **Build** clean: `three` 624.62 kB (gzip 158.35), `app` 289.79 kB (gzip 84.97) — **+3.44 kB raw / +1.48 kB gzip** for this pass.
- **Live (real Chrome):** `boot --production`, `guns --production` (pools flat — `poolPeak 8`, `poolDrops 0`, 79 idle → 82 firing), `hold` (dev; reach shape 0.939/0.925 at 0.576/0.484 m — lower than the old 0.968/0.958 only because the hands now bracket the part) and the new **`arms`** (dev, **both bodies**: standing 0.0000 m muzzle drift / 0.0000 m hand step / 0.0000 m grip error; walking 0.0001 m step / 0.0000 m grip error) all green, with only the documented ANGLE `X4122` / AudioContext autoplay output.
- **`branch` (dev, whole curve in one session): unconfirmed.** Its first run on this code stalled at P2 because the hop teleported to a flat `y = 0.01` over unsupported spots — survivable only while the physics bug above held the player up. `hopTo` now stands the player on the height the level has under the target (`__probe.standingHeightAt`), and the confirming run was **stopped after ~30 min without finishing** (a clean-profile run at HEAD took ~12 min: branch A and B `Complete`, hub stage 2, both clue plates restored after the reload). So the curve is proven at HEAD but **not yet on this pass's code** — and the hop change itself is now a suspect for the extra time (it adds one async collider query per 0.4 m hop step).

## Next up (start here)

1. **Decide the carry distance — a part is still held 1.35 m from a 0.46 m arm.** The body now aims
   at it with a bent elbow and a spread grip instead of a locked-straight reach, but the hands cannot
   physically touch a part floated that far out. It is a design decision (hold distance vs. part size
   vs. the part clipping the torso / breaking `dock` and `branch` aiming), not a rig change — so it
   needs stating before any code. `holdDistance` was deliberately left at 1.35 m by this pass.
2. **Watch the arms in motion on the live link** (`?log=1`): fire a burst (the hands should stay on
   the gun through the recoil kick), walk with a part, and turn the camera hard — the elbows should
   sweep, never flip.
3. **Confirm the `branch` curve end-to-end** (`node scripts/browser-check.mjs branch`, dev) — the
   one unproven gate, unchanged from the 17/10 pass. Time-box it (a clean-profile run took ~12 min)
   and if it overruns, instrument the hop before assuming a game defect; read a failing pair's
   `hopTrace` first.
4. **A decision for the snap-assist/SlotJudge reward-punish pass** — the name has no spec in the
   repo, so the thresholds and what "reward" versus "punish" mean need stating before any code —
   then **Branch C** and the **reward-material consumer**.
5. `PLAN.md` now carries the hand & arm motion pass at the top; its Phase list is landed, and the
   carry-distance decision above is what closes it.

**Limits:** `arms` measures the *presented* mount, because that is what the hands follow — the
simulation's own muzzle leads it by up to one fixed step (≤0.06 m at a run) by design, and reading
the wrong one is what made the first measurement of this pass report a phantom 0.14 m error. Carry
scenarios (`dock`, `branch`) need the **dev server** (a production build serves no TypeScript for the harness's route planner, so they correctly report `inconclusive`). The harness's hop needs a floor under its target; over a genuine hole it falls back to `y = 0.01` (straight line + rollback, as before).
