# Project Status — Gearwright

**Branch:** `main` | **Date:** 2026-10-16 | **Phase:** Post-Overhaul · locomotion feel + weapons pass complete
**Worktree:** `E:\gearwright` · **Status file:** `DOCS/STATUS.md` (index: `DOCS/README.md`; today's log and the full numbers: `DOCS/WORK/2026-10-16/WORK.md`)
**Live Game:** https://shrinivas-sn.github.io/gearwright/ · **Repository:** https://github.com/shrinivas-sn/gearwright

## Shipped state (what stands today)

- **Shooting: a sandbox weapon range (16/10/2026, owner-requested; ADR-020).** Six weapons, one per
  class, with BGMI-shaped handling: fire modes gated by rpm, magazines + reserve with two reload
  durations, slot switching, ADS (the camera's own lens 60° → 43.4°, and the walk at 0.53×), a
  **crouch** stance (2.06 m/s vs 3.74 standing), authored recoil **patterns** + spread/bloom, and
  pooled **simulated** bullets (travel time + drop, swept) that stop on static geometry *or* a loose
  part. Synthesised audio (per-class gunshot, magazine, bolt, dry fire, switch, impact) — no assets,
  no new dependency. **`?guns=0` restores the pre-pass game exactly**, and a shot's only output is an
  impact event: it can never attach, detach, validate or complete anything.
- **Presentation budget held:** one merged weapon mesh, one tracer `LineSegments`, one **instanced**
  impact pool — a burst adds ≤3 draw calls (79 idle → 82 firing); across 82 rounds the pools stayed
  flat (`poolPeak 8`, `poolDrops 0`).
- **Faster locomotion + real controls (16/10/2026):** walk 3.6 / run 7.4 m/s, a held **crouch** (`C`),
  and Jump/Crouch/Fire/ADS/Reload/Switch rows in the controls table — jump has existed since ADR-019
  and was simply never listed, which is why it read as missing.
- **Branch B "Thermal Line" complete (13–14/10):** Steam Works with B1 → B2 → B3 → BM-2, gated behind
  Branch A; the whole curve plays end-to-end in one real Chrome session.
- **Player body is an imported rigged human (15/10):** `assets/characters/vanguard.glb` (49 bones,
  11 376 tris) behind the same body seam, with the procedural rig as the `?body=proc` fallback;
  vertical look is inverted by owner request.
- Still unbuilt: Branch C (Great Crucible), a consumer for the reward materials, and a two-handed
  grip pose for the drawn weapon (it is *placed* correctly from `handR`; neither rig poses it).

## Verification State

- **Typecheck:** clean. **Tests:** 60 files, **754 tests** passing. **Build:** clean — `three`
  624.62 kB (gzip 158.35) · `app` 285.04 kB (gzip 83.09) + lazy `gltf-character` 8.23 / `GLTFLoader`
  44.81 / `rig-preview` 3.69 kB and the hashed 2 160 kB model. The weapons pass costs **+35.3 kB raw /
  +10.3 kB gzip** on the app chunk.
- **Live harness (real Chrome):** `boot --production` green (imported body, hands reported);
  `guns --production` green — AR 8 rounds/700 ms at 630 rpm, SMG 11 at 900, shotgun 1 pull = 8
  pellets, every slot refilled from reserve, ADS 60° → 43.45°, crouch-walk 2.06 vs 3.74 m/s, LMB
  leaves you empty-handed while `KeyE` grabs, `?guns=0` → `weapon: null` + HUD block hidden + no
  tracers; `hold` (dev) green — the grip gate passes with weapons on (hands dot 0.967/0.958 @
  0.555/0.464 m); `dock` (dev) green.
- **Only known console output:** the ANGLE `X4122` shader-precision warning (in every scenario since
  24/09) and, in long runs, the plan's recorded AudioContext autoplay notices.

## Next up (start here)

1. **Watch the weapons pass in motion** (`?log=1`, or the live link) and decide whether the drawn
   weapon reads right: it is *placed* from `handR`, but neither rig poses a two-handed grip yet — the
   obvious next polish pass, and presentation-only. `?guns=0` is the fallback if it should go.
2. **Watch the imported body in motion** (unchanged from 15/10): proven by numbers (bones, triangles,
   fitted height, grip alignment), never by eye — whether Idle/Walk/Run read well at this scale, and
   whether a figure in gear suits an industrial workshop.
3. **Walk Branch B as a player, in one sitting** (B1 → B2 → B3 → BM-2): the harness proves it plays,
   not that it *reads*. Are B2's east and B3's west bays distinguishable from the doorway, and is
   B3's multi-solution discoverable from the room alone?
4. **Branch C (Great Crucible):** power-grid coupling, multi-branch dependencies, the endgame trigger
   — the third door is still a sealed visual and is now the largest remaining beat.
5. **Give the reward materials a consumer (§28):** every branch pays into an inventory nothing spends.
6. **Owed from the older plan, unstarted:** the carry-feel tune (hold blend, faster rotate,
   run-while-carrying) and the snap-assist/SlotJudge reward-punish pass — `PLAN.md`'s Phase A
   follow-ups, recorded as Plan issues #9.

**Limits worth knowing before the next session:** carry scenarios (`dock`, `branch`) need the **dev
server** — a production build serves no TypeScript sources for the harness's route planner, so those
runs correctly report `inconclusive` rather than green there. `PLAN.md` stays at the root as this
pass's scaffolding until item 6 closes it.
