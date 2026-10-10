# 11/10/2026 — physics that holds up: a settle pass, docked parts that stay docked, and a foot plant in the right phase

Session opened as a `/recap` plus a directive: *"continue — build the game with proper physics and
mechanics, check if anything is missing or broken, first commit and push, then do the work."*

The worktree was already clean; the branch was one commit ahead of `origin/main` (the 10/10
character commit, `fe1a44f`), so step one was that push, and step two a baseline.

## Plan

- Push the outstanding commit, then establish a baseline (typecheck / tests / build).
- Run the whole browser harness — the project's only end-to-end proof — including the five
  scenarios `STATUS.md` admitted had not been re-run since the camera fix.
- Read the physics and mechanics for defects rather than guessing at features; fix what is
  provably wrong, with a test that fails on the old behaviour.
- Verify live, in a real browser, and log honestly what is still missing.

## Execution

### Baseline

`npm run typecheck` clean · **628 tests / 53 files** green · build `app` 222.76 kB (gzip 66.66) +
`three` 567.57 kB + lazy `rig-preview` 3.69 kB. (Before any change below.)

### The harness audit (and one self-inflicted scare)

All seven scenarios were run against the dev server in real Chrome. `boot`, `hold`, `title`,
`focus` and `press` passed with only the pre-existing ANGLE `X4122` shader-precision warning.
`branch` and `bm1` failed with `TypeError: Cannot read properties of undefined (reading 'level')` —
`window.__probe` did not exist — but **this was self-inflicted**: the harness was still running
while these edits began, Vite HMR reloaded the page mid-scenario, and the probe went with it. Both
were re-run afterwards on a quiet tree, and both pass (see Verification). Worth writing down so the
next session does not read that error as a game bug.

### Defects found and fixed

**1. Docked parts fell out of their machines (`gameplay/manipulation-system.ts`,
`gameplay/snap-system.ts`).** `restorePose` — the save-load path — ends with `startFall`, and
`main.ts` hands it the *socket* pose for a mounted part ("a mounted part's pose is its socket's").
Gravity does not know about sockets: a gear docked in a machine with open floor below it (P3's
valve ports, for one) came to rest on the floor the moment a save was loaded. Fix: the snap seam
gained an **optional** `isAttached?()` (additive, so every port double still compiles), and
`startFall` refuses to drop a mounted part. This is what makes `restorePose` safe for *any* socket,
not just the ones that happen to sit over geometry.

**2. Parts hung in the air when their support was carried away.** Stack a crate on another, pick
the lower one up and walk off: the upper one stayed exactly where it was. Gravity was only ever
evaluated at the *release* edge and during a fall. Fix: a dirty-driven settle pass. When a part's
published box moves, every part whose footprint covers the box it left or entered is marked
`supportDirty`, and the next step re-checks its support — so a stack drops the moment the part
under it leaves, wherever in the room it leaves from. Parts nobody touched cost one loop and no
queries.

**3. A falling part froze on a stale rest height.** The rest height was computed once when the fall
started. Release a part over a part that is itself still falling and it landed on the *old* height
of the support and stopped — in mid-air, once the lower part carried on down. Fix: the rest height
is re-read from the live world every step (`restYFor`), so a part riding a descending support comes
down with it and a part that lands records the height it really reached. A save taken mid-fall
still records the rest pose, not the floating one.

**4. Two BM-1 loose parts were authored floating (`levels/branch-a.ts`).** `anchor/bm1-gear` sat at
y = 0.12 and `anchor/bm1-plate` at y = 0.07, while the gear's own half-extent is 0.07 and the
plate's is 0.04 — 5 cm and 3 cm above the gallery floor, where P1/P2/P3's equivalents rest exactly.
The settle pass would have fixed them physically, but the authored pose should be the resting pose;
it is now.

**5. The foot plant was in phase with the *swing* (`adapters/character-rig.ts`).** This is the one
that mattered for how the game reads, and it was found by measuring rather than looking:

- `stepFootPlant` weighted each leg with `0.5 + 0.5·cos(phase)`, which peaks at phase 0.
- `sampleCharacterPose` drives `thighL` with `+sin(phase)`: the left leg is at its **frontmost
  (contact) at +π/2** and its rearmost (toe-off) at 3π/2. Phase 0 is the middle of the **swing**.

So for every frame of every walk the rig planted the *swinging* foot: pinned it to the surface
height and dragged it along the ground with the body, while doing nothing at all for the foot that
was actually carrying the body. Measured in the rig tests, old vs new:

| Over one walk (2.2 m/s, flat ground) | before | after |
|---|---|---|
| The carrying foot's world speed, as a multiple of the body's | **1.93×** (skating) | **0.33×** |
| The free foot's world speed (the swing) | 0.37× (held down) | 2.06× |
| Highest the swinging foot ever got above the sole | **0.144 m** | **0.237 m** |

The weight is now `0.5 − 0.5·cos(phase)`, with a comment recording the convention so it is not
"fixed" back.

**6. The planted foot was pinned at its rest fore/aft offset.** With the phase correct, the ankle
was still solved to its rest offset under the body, so a planted foot slid with the body instead of
holding its placement. The division of labour is now explicit: the plant owns the **contact** (the
ankle's height above its own surface, the sole's level, the pelvis drop), and the
distance-driven stride owns the **fore/aft** — the ankle is re-solved onto the surface *where the
stride put it*, read back off the posed bones (`captureStrideFoot`) before the plant touches them.

## Verification (real commands, real output)

| Check | Command | Result |
|---|---|---|
| Typecheck | `npm run typecheck` | clean (exit 0) |
| Tests | `npx vitest run` | **634 passed / 53 files** (was 628; +6: 5 physics, 1 rig) |
| Build | `npm run build` | green — `app` 224.69 kB (gzip 67.14 kB), `three` 567.57 kB, lazy `rig-preview` 3.69 kB |
| Live harness — all 7 scenarios | `npm run check:browser -- boot hold title focus branch bm1 press` | **all pass**; `problems` empty except the pre-existing ANGLE `X4122` shader warning (every scenario) and, in `branch` only, the known `AudioContext … not allowed to start` autoplay notices |
| `boot` | same | `character {bones: 19, triangles: 1440, visible: true, x: -4.5, z: 12}` + live `handL/handR`; pause overlay shown, click-resume `running`, 533 frames |
| `hold` | same | `{focused: true, state: "Manipulation", held: "gear-a", yaw: 0}`, `holding: true` with both hands live |
| `focus` | same | 8 targets probed; 6 focusable with the right verb and reach; the 2 that report "not in the interaction set" are BM-1's **sockets**, which are not empty-handed targets — `bm1`/`press` both dock into them |
| `branch` | same | full Branch A runtime: P1/P2/P3 milestones, `bm1` priming, clue plate read (`clue/regulator-plate`, `Inspect @ 2.96 m`), then reload: `{loaded: true, cluesRestored: true, stagedRestored: true, hubStage: true}` |
| `bm1` | same | assembled live (`BM-1 structure complete`), primed 3/3, engaged, `[reward] BM-1:milestone/bm1-pressure-dynamo applied`, autosave written |
| `press` | same | `{grabGear: true, dockGear: true, grabValve: true, dockValve: true}`; E-press 58/58 samples focused on `bm1/prime-feed`, 0 null |

**Proof the new tests bite** (each edit reverted one at a time, then restored): disabling
`stepSettle` fails both settle tests; removing the anchored guard fails the docked-part test;
restoring the old `cos` sign fails the rig's walk test (`carrying 1.93×`, `free 0.37×`, and the
lift assertion).

## Known loose ends (recorded, not fixed)

- **A world-locked foot plant is a rest-pose change, not a code change.** The rig's rest pose is
  exactly extended — thigh 0.46 + shin 0.44 = 0.90 m, and the hip sits 0.90 m above the ankle — so
  any horizontal foot excursion needs a knee bend plus a pelvis drop (≤ 0.12 m). Holding a foot
  for a whole 0.775 m stance half would need ~0.14 m. Bending the rest pose's knees (or lowering
  the hips) is what buys the slack; it changes the character's silhouette, so it wants a play-test
  opinion first. Recorded in `CONTEXT/CHARACTER-3D.md` Route A1.
- **A carried part's own motion is only checked against world geometry**, by the port's own design
  (`setCarryableColliders` is player-only; `followHold` uses `isBoxBlocked`), so it can be carried
  through a resting part even though the *release* is refused/relocated. Read from the code, not
  reproduced in play; leaving it alone is a design decision, not an oversight to fix silently.
- Branch B/C still ship as sealed doors with no content behind them (unchanged, and the biggest
  thing actually *missing* from the game); the shooting feature is still assessed-but-unbuilt and
  still wants one explicit call (`CONTEXT/SHOOTING-MECHANIC.md` §5).
- The grip still solves in character space (torso rotation leaves the hands ~2 cm off), the
  skinning is still rigid one-bone-per-vertex, and the body still hides rather than fading when the
  camera arm closes — all as recorded on 10/10.
