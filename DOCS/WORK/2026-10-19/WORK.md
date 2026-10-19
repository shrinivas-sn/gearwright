# WORK — 19/10/2026

**Goal (owner, verbatim):** continue the game at a production level — improve mechanics and
physics, make motion smooth, fix **the boxes and the slots that do not fit their actual sizes**,
make the character **move smoothly and fast**, and stop the **hands rotating and clashing inside
the body**. Plan it, execute, commit, push.

A five-part pass, all fixed at the source rather than tuned around:

1. **The hands were still spinning (`src/adapters/gltf-character.ts`, `src/core/arm-ik.ts`).**
   The imported body aimed its *forearm* at a grip point and never touched the hand bone. The
   hand's wrist is already *at* the grip after that solve, so its own orientation was left entirely
   to the clip — fingers could point backwards through the gun or the chest while the hand position
   measured correct. That is the reported "hands rotate and clash inside the body". Every arm chain
   now resolves a finger bone (`LeftHandMiddle1`/`Index1`, per side) and `orientWrist` turns the
   hand back onto the **forearm's line** with `clampTurnDirection`, at most 24 rad/s, so the hand
   cannot stay folded while a camera flick sweeps a wrist instead of teleporting a hand. The fix is
   convention-free: it reads the wrist and finger bones' own world positions, never an assumed
   local axis. (`CharacterFacts` now reports the resulting `handLForward`/`handRForward`.)

2. **A reach could pass through the torso (`clampOutsideTorso`).** When the aim swings behind the
   character the mount is aim-relative, so a supporting hand can end up inside the chest box. The
   grip target is now pushed out of an **oriented torso volume** (0.20 m half-width, 0.14 m
   half-depth, 0.8–1.62 m above the feet) through its nearest face **before** the reach clamp, so
   the solve never trades one constraint for the other. Ordinary grips sit in front of the box and
   are copied through untouched (pinned by tests), so nothing on the gun moves.

3. **Locomotion was still soft (`player-controller.ts`, `camera-rig.ts`).** Walk 3.6 → **4.0 m/s**,
   run 7.4 → **8.0 m/s** (the top of ARCH §16's workshop range), acceleration 70 → **55 ms**,
   deceleration 60 → **45 ms**, turn rate 14 → **18 rad/s**. The camera's follow rates went
   14/18 → **20/26**, which cuts the positional trail from ~70 ms to ~50 ms — at 8 m/s the body used
   to slide forward under the camera before the eye caught up, which read as "not smooth". Both
   values are still visibly damped: the manipulation framing must ease, never snap.

4. **The weapon HUD had no CSS at all (`src/style.css`).** The weapons pass shipped the markup and
   the read-model but never a single rule, so the top-right block rendered as an unstyled list: no
   panel, no slot boxes, no sizes to fit. It now has a real surface (grid, tabular ammo, class and
   fire mode aligned, a written READY/RELOADING/refusal line), and the **slot chips are sized to
   their own labels** and wrap inside the panel — five weapon names used to overflow as bare text.
   The ADS reticle gained its missing `.gw-hud-reticle--ads` rule (it closes from 16 px to 10 px,
   a shape change rather than a colour-only cue).

5. **Socket markers were all 0.8 m cubes (`src/data/components.ts`, `src/main.ts`).** The level's
   socket *trigger volume* is deliberately generous (0.4 m half extents) and was being drawn as
   the slot itself, so a thin pipe port looked exactly like a crate dock. `acceptedFootprint()`
   takes the largest footprint among the parts a socket definition accepts (tags → definitions),
   adds a 0.04 m clearance, and the renderer draws **that**. The physics volume is untouched: the
   snap query still uses `socket.instance.halfExtents`, so docking behaviour is identical.

## Verification (all re-run on the final code)

- `npm run typecheck` — exit 0.
- `npx vitest run` — exit 0, **63 files / 805 tests** (792 at HEAD). New: 8 arm-geometry tests
  (torso clearance + wrist turn) and 4 socket-footprint tests; one hop test's step count was
  re-based because the faster walk reaches the floor sooner (the assertion and its intent are
  unchanged).
- `npm run build` — exit 0. `app` 291.36 kB (gzip 85.62) from 289.79 (84.97): **+1.57 kB raw /
  +0.65 kB gzip**; `gltf-character` chunk 11.28 kB (gzip 4.06) from 11.08 (4.00); CSS 11.85 kB
  (gzip 2.69).
- **`boot --production`** — exit 0, **`problems: []`**, body `gltf` (49 bones / 11 376 triangles,
  clips idle/walk/run), `walkSpeed: 4` live. The new layout gate reads the weapon panel at
  **300 × 119 px** with **five slot chips, 72–83 px wide each, all inside the panel** — they wrap
  onto three rows instead of overflowing as bare text.
- **`arms` (dev)** — exit 0, both phases green: standing **0.0000 m** muzzle drift, **0.0000 m**
  hand step, **0.0000 m** grip error; walking **0.0001 m** hand step, **0.0000 m** grip error,
  ≤0.0001 m body-relative spread, **0 hand-inside-torso samples**. The new wrist solve did not move
  a grip.
- **The harness now measures the complaint directly.** `CharacterFacts` reports
  `handLForward`/`handRForward` (wrist → fingers, unit; absent on a body with no finger bones), and
  the `arms` scenario reports the worst angular **rate** of either hand while walking plus a
  body-relative torso-box test. Measured on this code: **`handTurnRate` 4.07 rad/s** (the gate is
  12; a hand left to the clip runs at the wrist's own 24 rad/s limit) and **`insideBody` 0**. The
  thresholds are rate-based because the sampling interval includes a CDP round-trip, so a fixed
  per-sample angle would have been flaky on a busy host.

## Owed / carried forward (unchanged)

1. The **carry distance** is still 1.35 m from a 0.46 m arm (`DOCS/STATUS.md` `## Next up` #1).
   The body now aims at it properly; touching it needs a docking-geometry pass, not a number move.
2. The **`branch` curve** remains the one unproven gate on the 17/10 physics code.
