# Project Status — Gearwright

**Branch:** `main` | **Date:** 2026-10-17 | **Phase:** Post-Overhaul · physics & mechanics pass
**Worktree:** `E:\gearwright` · **Status:** `DOCS/STATUS.md` (index `DOCS/README.md`; log + numbers `DOCS/WORK/2026-10-17/WORK.md`; text moved out `DOCS/WORK/archive.md`)
**Live:** https://shrinivas-sn.github.io/gearwright/ · **Repository:** https://github.com/shrinivas-sn/gearwright

## Shipped state

- **Gravity works off a ledge (17/10, real defect).** `KinematicPhysics` reported `supported` for a pose with nothing under it, so walking off a platform glued the player to their altitude (a 1 m/s descent that never accelerated) and let them **hop from mid-air**; the flag was OR-accumulated across sub-steps too, so a move crossing a ledge claimed ground after leaving it. The support query now answers "nothing underfoot" honestly, and the flag describes the pose actually reached. 5 new tests, each verified to fail against the old code.
- **Carry feel (17/10, the tune `PLAN.md` left owed).** Hold blend 14 → 30 (trail behind a running player ~0.33 m, was ~0.56), rotate 2.2 → 3.4 rad/s (quarter turn 0.46 s, was 0.71), travel cap 8 → 9 m/s; the carried advance is carved into chunks half the part's own thickness, so it cannot jump a thin beam at any step size. **A carrying player can run now** — the input map read `run` hard-false while carrying — and the composition scales a carried walk 0.6 (3.6 → 2.16 m/s) and a carried run 0.85 (7.4 → 6.29 m/s).
- **Shooting: a sandbox weapon range (16/10, ADR-020)** — six weapons, authored recoil patterns, spread/bloom, magazines + reloads, ADS, crouch, pooled simulated bullets; `?guns=0` = the pre-pass game. The drawn weapon's **two-handed grip** landed in `73d0aa7`.
- Still unbuilt: **Branch C (Great Crucible)** and **a consumer for the reward materials (§28)**. Earlier passes (Branch B, the imported rigged body): `DOCS/README.md`.

## Verification

- **Typecheck** clean · **Tests** 60 files / **769** (756 at HEAD) · **Build** clean: `three` 624.62 kB (gzip 158.35), `app` 286.35 kB (gzip 83.49) — **+1.31 kB raw / +0.40 kB gzip** for this pass.
- **Live (real Chrome):** `boot --production`, `guns --production` (pools flat — `poolPeak 8`, `poolDrops 0`, 79 idle → 82 firing), `hold` (dev; reach dots 0.968/0.958) and `dock` (dev) all green, with only the documented ANGLE `X4122` / AudioContext autoplay output.
- **`branch` (dev, whole curve in one session): unconfirmed.** Its first run on this code stalled at P2 because the hop teleported to a flat `y = 0.01` over unsupported spots — survivable only while the physics bug above held the player up. `hopTo` now stands the player on the height the level has under the target (`__probe.standingHeightAt`), and the confirming run was **stopped after ~30 min without finishing** (a clean-profile run at HEAD took ~12 min: branch A and B `Complete`, hub stage 2, both clue plates restored after the reload). So the curve is proven at HEAD but **not yet on this pass's code** — and the hop change itself is now a suspect for the extra time (it adds one async collider query per 0.4 m hop step).

## Next up (start here)

1. **Confirm the `branch` curve end-to-end on this code** (`node scripts/browser-check.mjs branch`, dev): it is the one unproven gate. Time-box it (the HEAD run took ~12 min) and if it overruns, instrument the hop (`__probe.standingHeightAt` calls per step, retry counts) before assuming a game defect — and read a failing pair's `hopTrace` first.
2. **Watch the physics and carry passes in motion** (`?log=1`, or the live link): step off a machine or the lab step (the fall should accelerate), carry a part at a run, rotate it to face a socket.
3. **A decision for the snap-assist/SlotJudge reward-punish pass** — the name has no spec in the repo, so the thresholds and what "reward" versus "punish" mean need stating before any code — then **Branch C** and the **reward-material consumer**.
4. `PLAN.md` stays at the root; its owed carry tune landed, so it can go with the next docs commit.

**Limits:** carry scenarios (`dock`, `branch`) need the **dev server** (a production build serves no TypeScript for the harness's route planner, so they correctly report `inconclusive`). The harness's hop needs a floor under its target; over a genuine hole it falls back to `y = 0.01` (straight line + rollback, as before).
