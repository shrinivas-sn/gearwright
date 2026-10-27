# WORK — 24/10/2026

**Goal:** make Branch C's ceiling a **readable mechanic** rather than a message that arrives
after the mistake. The branch's whole lesson is "not too much of one", and the shipped build
put its only feedback on the failure line — after the player had already over-fed the machine.
Nothing in `STATUS.md`'s `## Next up` asked for this directly (item 1 is a human eye, 2 and 3
need a decision), but item 4 and the 22/10 room work left the gap visible: the harness could
read the graph's `overpressure` and the player could not read the number before failing.

## 1. A failed machine looked like a working one

The composer derived `powered` from `machine.state === 'running'`. An over-fed machine is
**still `running`** — the overpressure is a warning beside the state, not a state of its own —
so C1 with two valves in drew exactly the healthy green glow and the same spin as C1 with one.
The validator could see the ceiling; the world could not. That is the opposite of §24 rule 6
("hazard state is visible in-world, not only in the HUD").

Fix, at the source and without a new state owner:

- `CarryableRenderState` gained an optional **`overpressured`** flag (`ports/render-port.ts`),
  presentation-only like `powered`.
- `FeedbackComposer` sets it from the **graph's own warning** (`machine.warnings.includes(
  'overpressure')`) — never inferred from a value comparison on the presentation side — and
  only for an attached part. A loose part belongs to no machine and is never marked.
- `ThreeRenderer` draws that part in the hazard tint (`0xe0503c`) with a hotter emissive; the
  motion is untouched, because the machine really is running. The redline says *unsafe*, not
  *stopped*.

## 2. The ceiling became a number the player can watch

The objective surface already names the puzzle, its state and the outstanding requirement.
It now carries one more line: **the machine's highest live output against the ceiling its own
data declares** — `Pressure 1 / 1.5`, then `Pressure 2 / 1.5 — over ceiling` when the ceiling
trips. That is the branch's lesson in the same place the player reads the failure reason.

- `HudObjectiveView` gained `meter: HudMachineMeter | null` (`presentation/hud.ts`): label,
  value, declared ceiling, and the graph's `over` warning. The HUD formats the numbers and
  never calculates a threshold.
- The composition root (`main.ts`) builds it from the active puzzle's `machineRunning`
  activation: the machine definition supplies `maxOutput` and the output kinds, the derived
  state supplies the values and the warning. It is null when no machine stands behind the
  puzzle and when the puzzle is `Complete` — a finished machine has nothing left to watch.
  With nothing powered the outputs list is empty, so the gauge reads **0** against the
  ceiling, which is the truth and still shows where the limit sits.

No gameplay rule, validator, puzzle datum or tuning number changed. The ceiling is the number
the data already had; it is simply no longer invisible until it is broken.

## 3. The rest of the Crucible, played live

`STATUS.md` item 4 has carried "a live scenario for C2 / C3 / CM-3" since the branch shipped.
The `crucible` scenario now plays all four machines in one session, still on a fresh save:

- **C2 "Quench"** — deliberately the **idler** in the drive: the vessel turns `ccw` while the
  machine still runs, so the near-miss is a measured output, not a guess. One quench feed gives
  `pressure 1` and no warnings; a second feed in the other port reads 2 and raises
  `overpressure`. (The correct plain gear and its `cw` sense are proven by the completion run in
  `branch`, so the two scenarios together cover both senses.)
- **C3 "Slag Run"** — the cross-run (route C) alone feeds **both** consumers at 2 and stays
  under the 2.5 ceiling; adding route A stacks on the shared bridge, reads **3** at the casting
  floor and trips the ceiling. That is the open-ended beat's both-kinds-of-answer claim, live.
- **CM-3 "Great Crucible"** — gear + pipe produce `rotation 1 cw` and `pressure 1`, which installs
  the staged panel from the **graph's** structural state (ADR-018, not the puzzle latch). The
  three priming lines open in any order (`3/3`, `primed — engage to activate`) and the pour lever
  focuses and engages afterwards. On a fresh save the puzzle is `Locked`, so this proves the rig
  and the ordered vocabulary, not the reward — the logic suite still owns the refusal cases.

The scenario asserts `branch-c: Locked` at the end through the probe's new `branchC` field, so a
run that somehow opened the branch on a fresh save fails loudly instead of reporting success.

## 4. Branch C completes, in one live session

The gated `crucible` run above proves the machines but not completion, because a fresh save keeps
Branch C `Locked`. The `branch` scenario already ends in exactly the state that can: its reload
restores **A and B Complete** with C `Available`. It now continues past that reload and plays the
Crucible's own curve against the open branch:

| Pair | Result |
|---|---|
| C1 valve → flow A | completed, `[reward] C1:milestone/c1-tuyere applied` |
| C2 gear → drive | docked |
| C2 valve → feed A | completed, C2 reward applied |
| C3 valve → cross-run C | completed, C3 reward applied |
| CM-3 gear → drive | docked |
| CM-3 valve → feed | docked; `[staged] CM-3 structure complete — priming lines are live` |

Then the panel: blast, quench and slag open in order (the objective line walks from "Prime all
three lines" to "Prime the lines, then pull the pour lever"), the pour lever focuses as
`Engage`, and the burst lands:

- `[reward] CM-3:milestone/cm3-great-crucible applied`
- `[progression] branch branch-c complete (Great Crucible)`
- `[progression] hub stage -> stage/crucible-restored (Crucible Restored)`
- `[clue] plate awake: clue/crucible-plate`, then `Inspect` → `[clue] discovered`
- final probe: **branchA/B/C Complete, `hubStage: 3`, three clues**

All six pairs docked on their **first** attempt with no dropped carry. This is the first time the
whole game — three branches, three capstones, three clue plates — has been completed in one real
browser session. The reloaded session also gives the meter its first unlocked-puzzle reading:
`Tuyere / InProgress` with `Pressure 0 / 1.5`, before any of C is built.

**The ordered stage, refused and recovered, live.** Before following the happy path, the harness
pulls the pour lever early: the puzzle reports `InProgress` with
`reasonCodes ['cm3/primed','cm3/staged']`, which is the same refusal the logic suite asserts
(`sequence/out-of-order`, surfaced through the `cm3/staged` requirement). The three priming lines
then clear `cm3/primed` and leave only `cm3/staged`; the second pour — the earliest-match
recovery ADR-018's rule depends on — completes the machine. To read that, the dev probe gained a
`puzzle(id)` read (`state` + failed requirement ids), which is the SM's own answer rather than a
re-derivation.

## 5. Verification

- `npm run typecheck` — exit 0.
- `npx vitest run` — exit 0, **65 files / 847 tests** (845 at HEAD: two new — the HUD meter's
  under/over/no-ceiling states, and the composer's overpressure flag including the loose part
  and a non-overpressure warning).
- `npm run build` — exit 0. `app` **316.61 kB** (gzip **90.75**) from 315.13 (90.24):
  **+1.48 kB raw / +0.51 kB gzip** for the whole pass (the meter, the in-world read and the
  dev-only `puzzle` probe); `three` unchanged and the CSS chunk builds at 12.05 kB (gzip 2.72)
  including the meter's own rules.
- **`node scripts/browser-check.mjs crucible` (dev) — `problems: []`.** The existing ceiling
  proof is unchanged (`pressure 1` with no warnings, then `pressure 2` with
  `["overpressure"]`), and the scenario now also **reads the player-facing line**: with the
  over-fed tuyere in view, `objectiveTitle` is `Tuyere`, the meter is visible and its text is
  **`Pressure 2 / 1.5 — over ceiling`**, with the over class set. This is the first live proof
  that the ceiling reaches the player, not only the graph — the check that was missing.
- The same run plays **C2, C3 and CM-3** (section 3): every pair docked on its first attempt
  with no dropped carry, C2's **idler turns `ccw`**, one feed reads 1 and two trip the ceiling,
  C3's cross-run/stacked outputs are 2/2 then 3/3, CM-3's panel installs, priming is `3/3`, the
  pour lever engages, and `branch-c: Locked` at the end.
- **`node scripts/browser-check.mjs branch` (dev, clean profile) — `problems: []`:** the A→B
  curve is unchanged (10/10 pairs on the first attempt, reload 2/3 clues / 8 staged actions /
  stage 2), and the new C curve completes it — six pairs, all first attempt, all four C rewards,
  Branch C Complete, `stage/crucible-restored`, the third plate discovered, final probe
  **A/B/C Complete, hub stage 3, 3/3 clues** (section 4). The early pour was refused
  (`['cm3/primed','cm3/staged']`), priming left `['cm3/staged']`, and the second pour completed
  it.
- **`node scripts/browser-check.mjs boot --production` — `problems: []`.**

## Tests touched

- `tests/dom/hud.test.ts` — new case: `Pressure 1 / 1.5` with no over class, then
  `Pressure 2 / 1.5 — over ceiling` with it, then a machine that declares no ceiling
  (`Rotation 1`, no fraction), then back to null (row hidden). The over state is words in the
  text as well as the class, so it never rides on colour alone (§33.2 rule 4).
- `tests/logic/feedback-composer.test.ts` — new case: a `running` machine with
  `overpressure` presents `overpressured: true` **and still spins**; a healthy run and an
  unrelated warning (`no-source`) present `false`; a loose part is never marked.
