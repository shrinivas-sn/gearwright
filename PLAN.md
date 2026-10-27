# PLAN — the refusals live, and a consumer for the reward materials

**Written 27/10/2026.** Temporary file — deleted when this closes.

**Goal:** prove the Great Crucible's three wrong-build refusals in the real browser (with the
player-readable reason), and give the reward materials the consumer ARCH §28 has always
specified — an upgrade pipeline fed by the materials every branch already pays.
**Why:** `DOCS/STATUS.md` items 3 and 4. Item 3 ("a consumer for the reward materials") is the
one thing every branch pays into and nothing reads; item 4 ("the decoy build, live") records
that the shut-off valve jam, the blanking plate and the idler's *reason* are logic-suite-only.
**What this changes:** `scripts/browser-check.mjs`; `src/game-state/` (new `upgrade-system.ts`);
`src/gameplay/` (player/phase-world wiring); `src/data/` (new `upgrades.ts`); `src/levels/hub.ts`;
`src/main.ts`; `src/presentation/hud.ts`; `src/game-state/save-codec.ts`; `tests/`; `DOCS/`.
**Done means:** a fresh browser run proves each wrong part's refusal with the reason the player
sees, and materials are spent at the hub's Great Regulator to raise a measurable capability that
survives a save/load — with `typecheck`, the full suite and `build` green.
**Out of scope:** the snap-assist sign-off (a decision awaiting the owner); new branches or
puzzles; a menu/inventory UI; anything that changes validation semantics (ARCH §28.3 rule 2).

---

## Read this first

1. `git status --short` must be clean; HEAD should be the commit named in the last Progress Log
   entry. `npm install` only if `node_modules` is absent.
2. Read only: `DOCS/STATUS.md`, this file's rules, your current task, the last Progress Log
   entry. Do not read `DOCS/CONTEXT/ARCHITECTURE.md` whole — §28 is the only section this plan
   needs (around the search text `## 28. Upgrade Architecture`).
3. Detect the environment — commands, never remembered values:

| Check | Command | Pass looks like |
|---|---|---|
| Types | `npm run typecheck` | exit 0 |
| Suite | `npx vitest run` | exit 0, all tests pass |
| Build | `npm run build` | exit 0, `dist/` written |
| Browser | `node scripts/browser-check.mjs <scenario>` | `problems: []` |

Browser scenarios that carry parts need the **dev server** (`npm run dev` on 5173);
`--production` scenarios need `npm run build` first. Both are run by the harness itself —
do not start servers by hand.

4. A task's **Where:** uses search text, not line numbers. If the text is missing, the code
   moved: find the equivalent, apply the same intent, and log it under Plan issues.

## Facts verified while planning

| Fact | Source | Checked on |
|---|---|---|
| HEAD is `f8ce652` with a clean tree (the 24/10 ceiling pass landed) | `git status --short`, `git log -1` | 27/10/2026 |
| 65 files / 847 tests pass; typecheck clean | `npx vitest run`, `npm run typecheck` | 27/10/2026 |
| C1/C2/C3/CM-3 wrong-build refusals are asserted in the logic suite only | `tests/logic/branch-c-crucible.test.ts` (search text `refuses a shut-off valve`) | 27/10/2026 |
| The Crucible scenario plays C1–CM-3 on a fresh (Locked) save and reads the HUD meter | `scripts/browser-check.mjs` (search text `async function scenarioCrucible`) | 27/10/2026 |
| Detach is "primary twice": first press → `DetachPrompt`, second → `tryDetach()` | `src/gameplay/manipulation-system.ts` (search text `private tryDetach`) | 27/10/2026 |
| The HUD probe exposes `objectiveTitle` / `objectiveState` / `objectiveFailure` | `scripts/browser-check.mjs` (search text `objectiveFailure`) | 27/10/2026 |
| The dev probe exposes `puzzle(id)` → `{ state, reasonCodes }` | `src/main.ts` (search text `puzzle: (puzzleId: string)`) | 27/10/2026 |
| No `upgrade-system.ts` exists; §28 specifies the modifier pipeline and §28.3 its rules | `glob src/**/*upgrade*` → 0 files; ARCH §28 | 27/10/2026 |
| `inventory.spendMaterial` exists and is documented as the §28 seam | `src/game-state/inventory-system.ts` (search text `Spend is exposed`) | 27/10/2026 |
| The save codec has **no** `upgrades` slot yet (ARCH §28.3 says levels are canonical save state, so the codec gains the field in Task 2.2) | `code_search upgrades` in `src/game-state` → 0 matches | 27/10/2026 |
| Loose parts are per-machine in Branch C: `shutoff-c1` / `plate-c2` / `idler-c2` are separate instances, each with its own anchor | `src/levels/branch-c.ts` (search text `shutoff-c1`) | 27/10/2026 |
| `PlayerController` and `InteractionSystem` take partial tuning at construction; their `tuning` is private readonly — runtime change needs a setter or a rebuild seam | `src/gameplay/{player-controller,interaction-system}.ts` | 27/10/2026 |
| A carried player's speed is scaled in the composition, not by the controller | `src/gameplay/manipulation-system.ts` (search text `speedScale`) | 27/10/2026 |

## Rules for every task

- L1 (`src/game-state/`, new `upgrade-system.ts`) never imports `three` or touches the DOM.
- Modifiers may never change validation semantics (ARCH §28.3 rule 2): nothing here touches
  a socket's `accepts`, a requirement, or a puzzle state.
- Presentation reads derived state; it never computes a rule. The HUD formats; the composition
  and L1 decide.
- Every new rule ships with a logic test that fails against the old code.
- Commits are one intent each, lowercase prefix (`upgrades:`, `harness:`, `docs:`), body
  explaining *why*.
- `DOCS/STATUS.md` is updated at each checkpoint; the work log is `DOCS/WORK/2026-10-27/WORK.md`.
- Never mutate `src/data/puzzles/**` or a machine's declared numbers to make a test pass.

## Failure handling

| Situation | Do this |
|---|---|
| A scenario needs a browser the harness cannot launch | Report the limitation; do not mark the check as passed. |
| `dockInto` loses a part (soft-detach) | Re-run the pair once (the harness already retries); if it repeats, log the `hopTrace` and continue. |
| A test fails for a reason the plan did not predict | Fix the cause; never loosen an assertion. |
| A modifier changes a puzzle outcome | Stop: that is §28.3 rule 2. Revert the modifier and log a Plan issue. |
| Anything else fails | Fix and retry at most three times. Then set the work aside, record the real output in the Progress Log, and continue with the next independent task. |
| The plan itself looks wrong | Follow **Plan issues** below — decide by impact, never freeze the whole plan. |
| Owner-only actions | None in this plan. |

---

## Phase 1 — the refusals, live and readable

**Purpose:** close `STATUS.md` item 4's first half: the shut-off valve jam, the blanking plate
and the idler's sense refusal are proven in the real browser, including the line the player
reads on the objective surface.
**Starts when:** now.
**Re-check first:** none.

### Task 1.1 — a `decoy` scenario that plays each wrong part and reads its refusal

**Goal:** one harness scenario in which each wrong-build class refuses the machine *and* the
HUD says why.
**Why:** item 4 exists because these refusals were logic-suite-only; position and state were
proven live, the refusal was not.
**Where:** `scripts/browser-check.mjs` (search text: `async function scenarioCrucible`)
**Do:**
- [ ] Factor the room-entry block out of `scenarioCrucible` into a shared helper
      `enterCrucibleRoom(cdp)` returning the same `entered` record it builds today; call it from
      both scenarios. `crucible` behaviour must not change.
- [ ] Add `async function scenarioDecoy(cdp)`: enter the room, then for each case —
      `shutoff-c1 → socket-c1-flow-a`, `plate-c2 → socket-c2-drive`, `idler-c2 → socket-c2-drive`
      — grab, dock, wait `900 ms`, and read `machine(machineId)` and
      `puzzle(puzzleId)`.
- [ ] Assert, per case: `state === 'jammed'` (shut-off), `outputs` empty (plate), and
      `spin === 'ccw'` (idler); plus the exact reason codes from the logic suite —
      `['c1/blast-line', 'c1/no-jam']` (contains), `['c2/drive-coupled']` (contains),
      `['c2/drive-sense']` (equals).
- [ ] After the shut-off case, focus the seated part and record
      `hud.objectiveFailure.text`; assert it is the c1/no-jam objective line
      (`/shut-off valve/i`). This is the player-readable proof.
- [ ] Between the plate and idler cases, detach the plate with the harness's own rule
      (grab → primary twice), assert the machine returns to `idle`, then seat the idler in the
      same socket. If the second press does not detach, record the state and continue to the
      idler on C2's free feed socket instead (`socket-c2-feed-b`) — log a Plan issue either way.
- [ ] Assert `progress().branchC === 'Locked'` at the end: the run is a fresh save, and the
      scenario must not pretend the branch is open.
- [ ] Register `decoy` in the usage banner and the scenario dispatch table.
**Test first:** n/a — the harness *is* the test; the logic suite already pins the three reason
sets, and this task proves them live.
**Verify:** `node scripts/browser-check.mjs decoy` → `problems: []` with each refusal recorded
in `report.data.decoy`.
**Don't touch:** `scenarioCrucible`'s own assertions; any `src/` file.
**If it fails:** if a docks fails for a geometry reason (not a refusal), move the case to the
socket the logic suite uses and log the plan issue.
**Commit:** `harness: play the wrong builds and read each refusal`

### Checkpoint — Phase 1

- [ ] `npm run typecheck`, `npx vitest run`, `node scripts/browser-check.mjs decoy` all green.
- [ ] `node scripts/browser-check.mjs crucible` still green (the refactor is behaviour-neutral).
- [ ] Commit made.
- [ ] Status file updated: item 4 lists what is now live versus still logic-only.
- [ ] Progress Log entry added.

A new session may start here.

---

## Phase 2 — the materials consumer (ARCH §28)

**Purpose:** make the materials real: an `UpgradeSystem` with the §28 modifier pipeline, two
shipped upgrades, a Great Regulator that consumes materials, HUD feedback, and persistence.
**Starts when:** Phase 1's checkpoint is green.
**Re-check first:** the codec has no `upgrades` field (Plan issue 2), so Task 2.2 adds it to
the DTO, its validator, its restore path and its v1 migration — confirm nothing else already
claims that key before adding it.

### Task 2.1 — `UpgradeSystem` and its content table

**Goal:** an L1 modifier pipeline with two authored upgrades and deterministic maths.
**Why:** ARCH §28.3 rule 1 wants one indirection point; consumers must never read levels.
**Where:** `src/game-state/upgrade-system.ts` (new),      `src/data/upgrades.ts` (new)
**Do:**
- [ ] `UpgradeSystem` holds `Map<string, number>` levels; `levelOf(id)`, `snapshot()`,
      `restore(levels)`, `resetAll()` (New Game), and `canAfford(id)`, `costsFor(id)`,
      `nextLevelCost(id)`.
- [ ] `purchase(id)` → `'Ok' | 'Unknown' | 'Maxed' | 'CannotAfford'`; on `Ok` it spends through
      `InventorySystem.spendMaterial` (the §28 seam) and raises the level by one.
- [ ] `valueOf(category, base)` implements the §28.1 formula exactly:
      `clamp((base + Σ additive) * Π multiplicative, min, max)`, additive before multiplicative.
- [ ] Data: `UPGRADE_DEFINITIONS` with two upgrades — `upgrade/reach` (2 levels, category
      `interactRange`, +0.5 m per level, costs `scrap 2` then `brass 2` + `scrap 2`) and
      `upgrade/load` (2 levels, category `carrySpeedScale`, +0.08 per level, costs `sealant 2`
      then `alloy 1` + `sealant 2`). Levels cap at 2; nothing may exceed the declared max.
- [ ] Unknown ids and negative/non-integer levels are rejected, never clamped.
**Test first:** `tests/logic/upgrade-system.test.ts` — a purchase spends exactly the cost; an
unaffordable purchase changes nothing; the fourth purchase returns `Maxed`; `valueOf` applies
additive-then-multiplicative with several levels and clamps at the max.
**Verify:** `npx vitest run tests/logic/upgrade-system.test.ts` → green.
**Don't touch:** `ValidationSemantics` — no socket, requirement or machine rule.
**If it fails:** re-read ARCH §28.1 for the exact formula before changing a number.
**Commit:** `upgrades: a modifier pipeline the materials can feed`

### Task 2.2 — the Great Regulator consumes them

**Goal:** a forge that is a real interaction at the hub machine, and capability changes the
player can feel.
**Why:** materials are granted 11 times and read nowhere; the Regulator is the one machine
every branch feeds.
**Where:** `src/main.ts` (search text: `const STAGED_RIGS`), `src/levels/hub.ts`
**Do:**
- [ ] Add a `forge` interactable at the Regulator's plinth, enabled only while at least one
      upgrade is below max. Its verb carries the state: `Forge <title> — <cost>` when
      affordable, `Forge <title> — needs <cost>` when it is not. The title/cost text comes from
      the definitions, never from hand-written strings.
- [ ] On `primary` with the forge focused (same dispatch shape as the staged props): call
      `purchase`; on `Ok` log `[upgrade] <id> → level N` and toast
      `<title> improved — <level>/<max>`; on `CannotAfford` toast the missing materials; on
      another refusal toast the reason. Autosave after an `Ok`, like a completion.
- [ ] Wire the two consumers: `InteractionSystem` gets a `setRange(metres)` seam, and the
      composition sets it from `valueOf('interactRange', 3)`; the composition's carry-speed
      scale reads `valueOf('carrySpeedScale', base)` where the manipulation scaling happens.
      Changing range must not re-focus mid-hold (the setter only writes a number).
- [ ] Add the `upgrades` record to the save codec's DTO, its schema validator (non-negative
      integers, unknown ids tolerated like unknown material keys) and its restore path; restore
      levels on load *before* anything reads `valueOf`, and reset them on New Game.
- [ ] HUD: the resource block shows each upgrade's level (`2/2`) so the spend is visible
      after the toast has faded. Materials stay a flat list.
**Test first:** `tests/logic/upgrade-wiring.test.ts` — `valueOf('interactRange', 3)` after one
forge is 3.5; the carried speed scale rises by exactly the declared step; a save round-trip
restores both levels and the derived values.
**Verify:** `npm run typecheck` → exit 0; `npx vitest run` → green.
**Don't touch:** `snap-system.ts` weights, puzzle data, machine numbers.
**If it fails:** if interaction range cannot be changed without a rebuild, keep the upgrade and
defer only the wiring, and record it as a Plan issue — never fake the number.
**Commit:** `upgrades: the Great Regulator forges what the branches pay`

### Task 2.3 — prove the forge live

**Goal:** materials leave the inventory, the capability changes, and it survives a reload.
**Why:** the project's rule is that a feature is not shipped until it is exercised the way a
player will use it.
**Where:** `scripts/browser-check.mjs` (search text: `async function scenarioBoot`)
**Do:**
- [ ] A new `forge` scenario: boot a fresh save, use the **dev-only** probe to grant the
      materials the forge needs (a dev seam, like `machineState` / `puzzle` — stated as such),
      walk to the forge, focus it, read its verb, press it, and assert: the material count fell
      by exactly the cost, the level rose, the reach read from the live system rose, a toast
      appeared, and an autosave was written.
- [ ] Reload, then assert the level and the derived reach survived.
- [ ] Refuse honestly: with materials spent, the second press for an unaffordable upgrade
      toasts the missing cost and changes nothing.
**Test first:** n/a — the harness is the test.
**Verify:** `node scripts/browser-check.mjs forge` → `problems: []`.
**Don't touch:** the existing scenarios.
**If it fails:** if the Regulator's plinth has no standable spot, place the forge at the hub's
spawn-adjacent bench and log the Plan issue.
**Commit:** `harness: forge an upgrade and reload to prove it stuck`

### Checkpoint — Phase 2

- [ ] Full verification: `npm run typecheck`, `npx vitest run`, `npm run build`,
      `node scripts/browser-check.mjs forge`, plus `boot --production` → all green.
- [ ] `node scripts/browser-check.mjs crucible` green (nothing regressed).
- [ ] Commit made for every task in this phase.
- [ ] Status file updated: item 3 moves from "needs a decision" to shipped, with what the
      upgrades actually do.
- [ ] Progress Log entry added.

A new session may start here.

---

## Phase 3 — verify, document, close

**Purpose:** hold the whole pass to the project's own gates and leave the docs pointing at what
is true.
**Starts when:** Phase 2's checkpoint is green.

### Task 3.1 — full verification and the work log

**Goal:** the pass is proven and recorded; nothing from earlier passes regressed.
**Why:** the project's closing rule is that a claim without a measurement is not a claim.
**Where:** `DOCS/WORK/2026-10-27/WORK.md` (new), `DOCS/STATUS.md`, `DOCS/README.md`
**Do:**
- [ ] Run and record: `npm run typecheck`, `npx vitest run` (file/test counts, with the delta
      from HEAD), `npm run build` (with the size delta), and live — `decoy`, `forge`,
      `crucible`, `branch` (dev) and `boot --production`.
- [ ] Write the work log with the sections the previous ones use (goal, each change, the
      verification table, tests touched).
- [ ] Update `DOCS/STATUS.md`'s `## Next up`: the materials consumer moves out of the list; the
      new limits (if the prize is a UI, say so) go in.
- [ ] Add the `DOCS/README.md` row for 27/10.
- [ ] Delete this plan; the record lives in the work log.
**Test first:** n/a — documentation and verification only.
**Verify:** `npx vitest run` → exit 0 and `node scripts/browser-check.mjs decoy` →
`problems: []`; every command above exits 0 and the documents name the numbers they ran with.
**Don't touch:** anything under `src/` except the docs' own numbers.
**If it fails:** record the failure in the work log's verification table — never omit it.
**Commit:** `docs: log the refusal + materials pass`

### Checkpoint — Phase 3 (plan close)

- [ ] Every gate above is green or its failure is recorded.
- [ ] Commit made for Task 3.1.
- [ ] `PLAN.md` deleted; `DOCS/` carries the record.
- [ ] Status file updated; Progress Log entry added.

---

## Plan issues

*(Append only. The executor records every place where reality differs from this plan — before
starting, or during a task. Decide by impact: a local difference with the same intent is fixed,
logged, and work continues; a difference that touches design, other tasks, data, security, or
anything public pauses only that step and flags the owner with what to re-verify, while
independent work continues; a plan that is wrong at its core stops the phase with a proposed
correction. Never rewrite a planned step silently — amend it here and mark the task text
"amended, see issue N". Surface every entry in the status file and in the session's final
message.)*

| # | When | Task | Plan said | Reality (evidence) | Impact | Action taken | Owner decision |
|---|---|---|---|---|---|---|---|
| 2 | 27/10 planning | 2.2 | The save codec already carries an `upgrades` slot | It carries none — `code_search upgrades` in `src/game-state` finds nothing, and `src/gameplay/save-system.ts` does not pass it | Medium — the upgrade levels have nowhere canonical to live | Task 2.2 amended to add the DTO field, validator, restore path and New Game reset | none needed |
| 1 | 27/10 planning | 1.1 | Prove the refusals **on an open branch** | The `branch` scenario's C curve runs with Branch C *open* but its sockets are already occupied by the completion pass, and detaching a mounted part to make room is a new, unproven harness path; the room scenario is fresh-board and cheap | Low — the logic suite already pins the open-puzzle reason codes; the live run proves reachability + the player-readable line | Scoped Phase 1 to the fresh-board live proof; the open-puzzle insert is recorded in the work log as the remaining half | none needed |

---

## Owner inputs

None — this plan waits on nothing. (The snap-assist sign-off in `STATUS.md` item 2 stays open
and is deliberately untouched.)

## Decisions

- The materials consumer is an **upgrade pipeline** (ARCH §28's already-specified shape), not a
  new system. Materials were always described as "only used for upgrades/repairs" (§27.1).
- Two upgrades only, two levels each, spending the four existing material kinds — no new
  resource, no new part, no menu. The forge is one focus target whose verb carries the cost.
- *(assumed)* The forge lives at the Great Regulator because every branch pays into that
  machine; if its plinth has no standable spot the forge moves to the hub bench.
- *(assumed)* Upgrade levels persist through the existing `upgrades` save slot; if the schema
  lacks it, the codec gains it in the same task.
- Numeric modifiers only (`interactRange`, carry speed scale). Capability unlocks stay
  blueprints (§28.2's split), so no puzzle rule is touched.

## Progress Log

*(Append only. Newest at the bottom. Never rewrite an entry — if it turned out wrong, add a new
one saying so.)*

### Phase 1 — 27/10/2026
Done:       Task 1.1: the `decoy` scenario. The room entry was factored into a shared
            `enterCrucibleRoom`, and a new dev-only `puzzleOpen` probe walks a puzzle through
            `unlock()`/`begin()` so a fresh save can show the refusal *reasons* §25 gating
            suppresses. All three wrong-build classes refuse live with their real reason codes,
            and the detach path is exercised for the first time.
Verified:   `node scripts/browser-check.mjs decoy` → `problems: []` with `c1/blast-line`,
            `c1/pressure-up`, `c1/no-jam`, `c2/drive-coupled` and `c2/drive-sense` recorded;
            `node scripts/browser-check.mjs crucible` → `problems: []` (refactor is neutral);
            `npm run typecheck` exit 0; `npx vitest run` → 65 files / 847 tests.
Surprises:  (1) A gated puzzle publishes **no** reason codes — the first run's failures were
            all this, so the scenario had to open the puzzle through the SM itself.
            (2) The objective pane shows the **first** failed requirement in authored order, so
            a dead blast line reads "Run pipework from the furnace to the tuyere" and the jam
            reason is second — the assertion had to match the UI's real contract.
            (3) The detach path works: focus the *attached* part (not the socket marker the
            dock left the reticle on), then `primary` twice.
Next:       Task 2.1 — `UpgradeSystem` + the upgrade content table.
Commit:     (this entry's commit)

### planning — 27/10/2026
Done:       Recap; the 24/10 ceiling pass verified and committed as the baseline `f8ce652`;
            scope chosen from `STATUS.md` items 3 and 4; this plan written.
Verified:   `npm run typecheck` exit 0; `npx vitest run` → 65 files / 847 tests; `git status`
            clean after the commit.
Surprises:  The upgrade framework ARCH §28 specifies has no `src/game-state/upgrade-system.ts`
            at all — the "framework present" note in §12.2 is aspirational, so Phase 2 writes
            it from the spec rather than wiring into an existing stub.
Next:       Task 1.1 — the `decoy` scenario in `scripts/browser-check.mjs`.
Commit:     `f8ce652` (baseline, the 24/10 pass).
