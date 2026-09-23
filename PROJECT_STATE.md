# Project State

## Current Phase
PHASE_2 (M1) — movement + camera → **COMPLETE, browser-confirmed**.
PHASE_3 (M2) — targeting only (no grabbing) → **COMPLETE, browser-confirmed**.
PHASE_4 (M3) — grab / carry / rotate / release one test object → **COMPLETE,
browser-confirmed** (its one real defect surfaced during M4 — see "Bugs Fixed 4").
PHASE_5 (M4) — socket / snap / attach → **CODE COMPLETE**, browser check still
outstanding (M5 was authorised before it was reported — the list is below).
PHASE_6 (M5) — machine graph + propagation + validation (headless-first) →
**COMPLETE**. Automated acceptance only (ARCH §41 M5: correct machine validates;
incorrect doesn't; perturbed transforms change nothing), so there is no browser
step for M5 — its gates are the suites, all green.
PHASE_7 (M6) — first micro-puzzle end-to-end, with detach and feedback →
**CODE COMPLETE**, browser check still outstanding. M6's acceptance is the P1
acceptance suite (shipped content, played headlessly: correct completes, the wrong
part does not, detach is reversible) plus the §32 feedback pipeline.
PHASE_8 (M7) — rewards + save/checkpoint + recovery → **CODE COMPLETE, all
automated gates green** (authorised by the user 2026-09-21 — same precedent as
M5-before-M4's-check). ARCH §41 M7's acceptance is automated only (reward
exactly once / reload faithful / corrupt save safe): 376/376 tests (26 files),
`npm run typecheck` clean, `npm run build` green (638.40 KB JS / 165.39 KB
gzip, 49 modules). See CHK-8.1 below. M6's browser check (P1 walkthrough) is
still owed and remains the condition for marking M6 COMPLETE below.
PHASE_9 (M8) — Branch A content: P2 "Right Turn" + P3 "Three Valves", data-driven →
**CODE COMPLETE, all automated gates green** (authorised by the user 2026-09-21).
ARCH §41 M8's gate is "three puzzles incl. multi-solution; **no new bespoke
architecture**": 389/389 tests (27 files), `npm run typecheck` clean, `npm run build`
green (648.53 KB JS / 167.46 KB gzip, 52 modules). P2/P3 are content only — **no L1/L2
system was changed for them**; the only production edits outside `data/`+`levels/`
were making the puzzle SM a *set* in the composition (`phase-world`, `feedback-model`,
`main.ts`), which is wiring, not architecture. M6's browser check (P1 walkthrough) is
still owed and is the condition for marking M6 COMPLETE.
PHASE_10 (M9) — hub integration + BM-1 + clue + branch completion → **all of M9 that
does not need a contract change is now delivered** (slice 1 authorised 2026-09-21;
slice 2 — the clue content and the boot-load pose gap — verified and completed this
session). Delivered: L1 `progression-system.ts`, `Locked`/`Available` puzzle gating,
progression persistence, the Crucible Hall + three branch doors with a state-reading
AccessGate, stage-driven hub visuals, **boot-time save loading** (M7 shipped the load
protocol and its tests but the composition never read a save — "persists" was
unreachable in the running game), the §6 beats 5/8 **clue plate** end to end (content →
activation → discovery → autosave), and the **§31.5 pose handover** that closes the
known loose-part pose gap. 415/415 tests (30 files), typecheck clean, build green
(656.86 KB JS / 170.15 KB gzip, 57 modules). **Not delivered: BM-1 "Pressure Dynamo"
with staged validation — it needs a decision first (it is a new L1 owner plus a
validator contract addition; `state: 'primed'` and `sequence.ordered` are typed
refusals today), and branch B/C content, which §6 makes post-MVP.** M6's browser check
is still owed and is the condition for marking M6 COMPLETE.
PHASE_11 (M9 verification) — **the browser checks, automated**: CHK-11.1 drove the
shipped build in headless Chromium (real Vite dev server, real ports, real
composition) and verified **every non-visual item** of the M4/M6/M9 walkthroughs. It
found and fixed a real defect — **the clue plate on the Great Regulator was
unfocusable**, so §6 beats 5/8's clue could never be discovered in play (Bug 14). The
walkthrough's visual half (colour changes, red slabs, gold trunk lighting) still needs
an eye, so M6/M9 stay short of COMPLETE on that alone.
PHASE_12 (M10) — UX/feedback/hints/scanner + HUD (ARCH §29/§33) → **the first M10
slice is delivered: the HUD and the hint ladder are built, tested and composed into
the running game.** BM-1 "Pressure Dynamo" (ADR-018) was completed in the prior
session — the L1 action history, the staged validator (`state: 'primed'`,
`sequence.ordered`), schema v2 with the v1 widening migration, the §31.4 staged
presses, the BM-1 content and its `bm1-staged` suite. The second slice — **the §29.3
scanner reveal end to end** (L1 `scanner-reveal.ts` derivation, L4 `ScannerOverlay`
timing, one additive `RenderPort.setScannerOverlay` port method in the M6 pattern,
three.js highlight rig + flow-path polyline, HUD states, composed `scannerRequest` with
spoken refusals, 17 new tests incl. a validator→derivation→port integration) — is
delivered and green. The third slice — **the §12.2 clue/log surface** (the HUD's field
log: `HudLogView` + a pooled, change-only log surface in `presentation/hud.ts`, the
left column that stacks it under the objective line, and `main.ts` resolving
progression's canonical seen-id set into words, discovered in the real build headlessly)
— is delivered too. The M10 **HUD visual pass** was then done as far as a browser can
measure it, and it found the defect that made the pass worth doing: the §33 stylesheet
block had never been applied at all (two unclosed rules — Bugs 15/16), so the shipped
HUD was unanchored. It is fixed, measured at four viewports, and now guarded by a suite. The fourth slice —
**audio (ADR-011)**: the L3 `ports/audio-port.ts` and the L4 `adapters/web-audio-bus.ts`
(synthesised §32.3 cues on the §32.2 buses, pooled voices, gesture unlock, silent
null-object fallback), the composer's SFX half, and the composition's gesture binding —
is delivered, verified in a real browser, and green: **542/542 tests (41 files),
typecheck clean, build green (703.29 KB JS / 183.85 KB gzip, 66 modules).** That completes M10's
buildable scope; what remains of it is the aesthetic half of the HUD pass (CHK-12.6 delivered
its *measured* half — contrast — and pinned the M9 colour facts) and an ear on the mix (see
"Human Check Needed").
PHASE_12 (M10) verification — CHK-12.8 closed the last known P0 defect in the running game:
the composition read the step's focus *edge* as live focus (Bug 20), which made every staged
press, hint request and clue read depend on landing on the exact acquisition step. Fixed at
all three sites and **browser-verified end to end** (`priming 1/3 → 3/3` → `primed — engage
to activate` → reward + autosave), with the bug class now guarded by a boundary suite.
CHK-12.9 continued the verification with the full-branch walkthrough (a new `branch` harness
scenario): **P1 → P2 → P3 → BM-1 played end to end in the shipped build, then the clue beat,
then a reload** — every consequence measured (the hint ladder L0 → L4 by steady-focus
request, each puzzle's reward + autosave, the branch-completion burst, the readable plate,
the faithful reload). The run turned up no production defect; see the checkpoint below.

## Current Status
**M10 is implemented — the hint ladder, the scanner reveal, the field log, the HUD's
measurable layout, the audio bus (ADR-011) and now the HUD's measured contrast pass —
and green on every automated gate: 564/564 tests (44 files), typecheck clean, build green
(706.01 KB JS / 184.62 KB gzip).** CHK-12.7 fixed the two defects that had made the branch's
capstone puzzle unplayable (Bugs 17/18) and the HUD strip's empty-handed affordances (Bug 19);
CHK-12.8 then fixed Bug 20 — the composition read the step's focus *edge* as live focus — and
**BM-1's priming/engage presses now register in the shipped build**: the rerun records
`priming 1/3 … 3/3`, `primed — engage to activate`, the reward and the completion autosave.
CHK-12.9 then played the *whole branch* end to end in the shipped build — P1 → P2 → P3 → BM-1,
then the clue beat (`Inspect` from 2.96 m → `Field log — 1 entry`), then a reload — and measured
every consequence: the branch-completion burst (`branch-a complete`, hub stage 1, plate awake),
the discoverable plate, and a faithful restore (save, clue set, staged log, derived state).
CHK-12.10 then fixed the first defect the *player* reported (Bug 21): the game never captured
the mouse and never took keyboard focus, so the look stuck to the window edge and keys could go
silently nowhere. `DomInputSource` now owns a real pointer-lock handshake, the canvas focuses
and captures on the first click, one refusal ends the asking, and the HUD shows a one-shot
entry line that says what to click. **The grant itself still needs one real-browser click** —
headless Chrome refuses the capture by construction (see "Human Check Needed").
M9's state is unchanged from CHK-11.1 (see
its checkpoint below). What is *owed* on M10 is not code: the aesthetic half of the HUD
visual pass and an ear on the mix. The game also remains playable with audio absent by construction (EC-BRN-08) —
the port is optional at every call site, and the silent null object is a shipped class,
not a test fixture.
The hint ladder (`HintSystem`, §29) is now composed: the fixed step reports
`HintEngagement` (focused puzzle + whether the player is manipulating its machine),
explicit requests arrive from the KeyH edge and the HUD button, automatic escalation
stops at L2 while requests reach L4 gated on the scanner blueprint, and every
puzzle's level persists in the save (§31.1's canonical `HintState`, restored
independently of puzzle state). The HUD (§33.1) renders focus, objective + the
top failure reason, resources, the manipulation strip, the hint affordance and
pooled toasts — all through change-only DOM writes with zero data-derived markup. CHK-11.1
additionally verified its acceptance clauses in a real browser — branch completion is
reflected in the hub, the AccessGate blocks exactly the sealed doors, and both the
clue and the part poses persist across a reload — and fixed the one defect that check
found (Bug 14: the plate was box-blocked, so the clue was unreadable).
Progression is a *derived* view: branch state and the hub stage come from the
completed-puzzle set, and its only canonical field is the clue seen-id set — which the
v1 `progression` object already carried, so **no schema bump and no migration were
needed**. The hub's AccessGate reads `ProgressionSystem.canEnter`, and a door's
passability is never geometry (§26). The clue *is* now discovered in play (the plate on
the Great Regulator wakes with Branch A and yields `clue/regulator-plate` on focus),
and a loaded save now restores loose-part poses instead of dropping them back at their
spawn anchors. BM-1 is the only remaining M9 deliverable; see "Next Exact Action".

M6 is implemented end-to-end (the shipped build opens with P1: L1 content, the §25
puzzle SM, and the full §32 feedback chain through the L4 composer) and green on
every automated gate at closeout: 338/338 tests, typecheck clean, build green
(621.48 KB JS / 160.34 KB gzip, 41 modules). The M6 browser check (below) is
still owed and remains the condition for marking M6 COMPLETE.

**M7 (rewards/save/checkpoint/recovery) is implemented and green: 376/376 tests
(26 files) at its closeout.** M7's acceptance is automated only (ARCH §41: reward
exactly once, reload faithful, corrupt save safe) — no browser step is required to
complete it.

**M8 (Branch A content: P2 + P3, data-driven) is now implemented and green on all
automated gates: 389/389 tests (27 files), typecheck clean, build green
(648.53 KB JS / 167.46 KB gzip, 52 modules).** Its gate is "three puzzles incl.
multi-solution, **no new bespoke architecture**" — and that held: P2 and P3 are
`data/puzzles/*` + `data/{components,sockets,machines,rewards}.ts` +
`levels/branch-a.ts` only. P4 is out of scope by decision (ARCH OQ-3: "cut first"),
so the branch ships P1–P3. The P1 walkthrough still covers
M6/M4 where it overlaps, and the new boot log line
`[save] storage available; checkpoint CP-00 @ spawn/lab` is worth an eyeball
when that walkthrough happens.


## What M5 Is (and is not)
ARCH §41 M5 = *"Machine graph + propagation + validation (headless-first)"* — an
L1-only milestone, which is why nothing under `src/gameplay`, `src/ports`,
`src/adapters` or `src/presentation` changed this session. **Detach
(`DetachPrompt`) is not part of M5**; it belongs to M6's full `grab → snap →
validate → activate → feedback` chain, where removing a wrongly placed part is
actually used. The milestone table is the contract here, not the guess in the M4
checkpoint.

## Last Completed Checkpoint
CHK-12.10 — **first-contact control defects, fixed at the source: mouse capture and keyboard
focus** (Bug 21, found by the *user* playing the shipped build — the first defect report that
did not come from a harness). Two symptoms, one root: the game never captured the mouse and
never took focus. (1) **Look stuck to a screen edge** — the camera was fed by raw
`movementX/Y` with a free cursor, so the view "worked but broke", required re-centring the
pointer by hand, and stopped answering at the window edge. (2) **Keys silently dead** — the
page never moved keyboard focus onto the game surface, so a keypress could go to the chrome
around the canvas and *nothing* happened (the user's "I typed H and nothing happened"). The
fix is a real pointer-lock handshake plus focus-on-click, not a workaround:

- **`DomInputSource` now owns the capture handshake** (L4, where all device plumbing lives):
  `lockTarget` + `requestPointerLock()`/`releasePointerLock()`, `pointerlockchange` and
  `pointerlockerror` listeners, `isPointerLocked`, and two callbacks — `onPointerLockChange`
  and `onPointerLockError(reason)`. It stays a *transport*: it reports, it never pauses the
  game (EC-BRN-06 keeps that decision in the composition). No lock target ⇒ no-op, so headless
  wiring and non-DOM tooling are unaffected.
- **The composition owns the policy** (`main.ts`): the canvas is `tabIndex = 0` and a
  `pointerdown` focuses it and asks for the capture — one gesture, two honest jobs, and the
  same press still feeds the sim's primary edge. **One refusal ends the asking for the
  session** (the first browser run of this fix proved why: a browser that cannot capture
  refuses *every* click, so an unguarded retry logged eight refusals and would have stacked
  eight toasts). Esc keeps its documented meaning: the browser releases the capture natively,
  the adapter reports it, the composition clears stuck input, and the Esc-resume re-requests
  capture because the resume keypress is itself a gesture.
- **The HUD says what to do** (`presentation/hud.ts`, §33.1): a new one-shot entry line
  (“Click the game view to focus it and capture the mouse — Esc releases the mouse, Esc again
  pauses.”) that disappears the moment the capture is live, and switches to the honest
  fallback (“… keys and mouse look work without mouse capture.”) when the browser refuses.
  Backed by a new pill rule in `src/style.css` (same audited panel alpha as the save note),
  pinned by the stylesheet-integrity list.

**Verified where it matters.** In the shipped dev build (headless Chrome, real composition):
at boot the entry line is up and nothing claims a capture; a real click focuses the canvas
(`document.activeElement === canvas`), the (headless-only) refusal arrives as
`WrongDocumentError`, is reported **once** (`[input] pointer lock refused … — raw mouse deltas
only`), raises one toast, and swaps in the fallback line — zero console problems, with the
existing look/soak/pause checks still green. The grant path cannot be exercised headlessly
(no valid root document for pointer lock), so **a real-browser click remains the human check**
— it is the one line in "Human Check Needed" this fix adds.

**Gates:** 564/564 tests (44 files; +4 HUD entry-line, +6 new `dom-input-source` pointer-lock
suite — the L4 adapter had no direct suite before), typecheck clean, build green
(706.01 KB JS / 184.62 KB gzip; +2.6 KB JS over CHK-12.9 for the handshake, the line and its
rule). Version control is now initialised (`git init` + first commit), with `.tmp-*` and the
throwaway harness ignored by design.

CHK-12.9 — **the full Branch A, played end to end in the shipped build — then the clue beat,
then a reload** (every consequence measured; no production defect found). A new `branch`
harness scenario drives the real composition in headless Chrome: it focuses P1's loose gear,
reads the HUD hint line at L0, sends four KeyH edges and reads **L1 → L2 → L3 → L4**
(Bug 20's *hint* half, exercised rather than asserted); docks `gear-a → socket-mesh`
(`[reward] P1:…`, autosave), `gear-p2 → socket-p2-mesh` (`[reward] P2:…`, autosave — and the
HUD's scanner line flips to `Scanner ready` after P2), both P3 valves (the A-only seat is
correctly *not* complete — the failure line names the outstanding `p3/route-aux` route —
and seating the C valve completes the puzzle: the cross-run behaviour, seen in play);
assembles BM-1 in one attempt and presses all four props (`Open`/`Open`/`Open`/`Engage`);
then records the whole owed burst: `[reward] BM-1:milestone/bm1-pressure-dynamo applied`,
`[progression] hub stage -> stage/pressure-online (Pressure Line Online)`,
`[progression] branch branch-a complete (Pressure Gallery)`, `[clue] plate awake:
clue/regulator-plate … (inspect the Great Regulator)`, `[save] autosave written`. The plate
is then focused from 2.96 m (`Inspect`) → `[clue] discovered clue/regulator-plate` and a
`Field log — 1 entry` carrying the plate's words; the page is reloaded and the boot logs
`[save] loaded autosave (0 repair note(s))`, `[hub] stage 1 (Pressure Line Online);
branch-a=Complete (open)`, `[clue] 1/1 clue(s) discovered: clue/regulator-plate` and
`[staged] 4 staged action(s) restored: bm1/…`, with the field log back at 1 entry and the
derived branch state still `Complete`. Console: only the two documented AudioContext
autoplay warnings (EC-BRN-08) — no exceptions, no error spam.

**Two harness lessons, both tooling, neither the game.** (1) The middle run dropped P1's
carried gear mid-hop and the dock never happened: the EC-MAN-07 soft-detach rule firing
*exactly as documented* — teleport-hopping outruns a player's carry lead. The scenario now
detects an empty hand and re-grabs with a bounded retry, the way a player would; the game
needed no change. (2) The confirming run's page twice stopped rendering frames for a
stretch (still `visible`, JS answering — rAF simply paused, then resumed); the harness has
no watchdog, so a stuck run must be killed by hand. Both are recorded in "Known Problems".

**Honest scope of the run.** It proves the *measurable* half of the M6/M9 walkthroughs —
every state transition, reward, save and boot line — but not the visual half: the gear
*turning*, the plate's gold→teal in light, the completion pulses, and how the HUD *feels*
stay with an eye. It also leaves two items untouched: the M10 scanner reveal (the blueprint
is now demonstrably `ready` in play, but no scan was requested — the CHK-12.2 check stands)
and loose-part poses after a reload (every part in this run ended up *attached*; the pose
handover stays covered by the `save-load` suite and CHK-11.1, not by this run).

CHK-12.8 — **Bug 20: BM-1's presses were dead because the composition read the step's focus
*edge* as live focus — fixed, browser-verified end to end, and guarded** (all automated gates
green: 554/554 tests / 43 files, typecheck clean, build green 703.37 KB JS / 183.91 KB gzip).
The session before this one had root-caused the defect and ended before the edit; this session
applied it as written: the three consumers in `main.ts`'s step handler — the ADR-018 staged
press, the §29.2 hint engagement and the §6 clue discovery — now read live `interaction.focus`
instead of `result.focus?.current`, the read the HUD render, the hint button and the scanner
request already used.

**The fix, proven by the same rerun that had failed.** `node tmp-browser-check.mjs bm1` builds
the dynamo in the shipped dev build, then presses the four props with real `KeyE` edges. The
run now records `[staged] BM-1 structure complete — priming lines are live`,
`[staged] bm1/prime-feed recorded — BM-1 priming 1/3`, `… prime-return … 2/3`,
`… prime-bleed … 3/3`, `[staged] BM-1 primed — engage to activate`, then the completion burst
`[reward] BM-1:milestone/bm1-pressure-dynamo applied` and `[save] autosave written
(puzzle-completed trigger)`. The press half of BM-1 is no longer owed; it is measured.

**Honest scope of the run**: it plays BM-1 alone, so the *branch*-completion consequences
(`[progression] branch branch-a complete`, the hub stage advance, `[clue] plate awake`) do not
appear in it — they need P1–P3 in the same session and stay on the M6/M9 walkthrough list. The
hint half is fixed by the same edit but not exercised by this harness (a KeyH request on a
steady focus).

**Guarded, because the bug was invisible to every system suite** (same species as Bugs
10/14/17/18 — green units, unreachable in play): `tests/boundary/focus-edge-reads.test.ts`
scans `src/` (comments stripped) and fails if the edge's `current` is read as live state
anywhere — mutation-verified by reintroducing the read, which fails exactly that assertion —
and `tests/logic/phase-world.test.ts` gained the contract test that spells the distinction out:
the acquisition edge fires once (`previous: null`), the steps after it report `focus: null`
while `interaction.focus` keeps answering. No architecture changed: the fix is three reads, the
guards are tests.

CHK-12.7 — **the two defects that made BM-1 "Pressure Dynamo" unplayable, found by driving the
shipped build; plus the HUD strip fix** (all automated gates green: 551/551 tests / 42 files,
typecheck clean, build green 703.43 KB JS / 183.92 KB gzip). This was the first checkpoint of the *production-readiness* kind the plan puts
in M12/M13 (measure-driven, browser-driven), done early because the user asked for real defects
rather than more code: a throwaway harness (`tmp-browser-check.mjs`, outside the build, deleted
at the end of the pass) drives the real composition in headless Chrome over CDP — real Vite dev
server, real ports, real `main.ts` — and reads live state through the dev socket, the HUD DOM and
the console.

**The method, because it is what makes the two findings provable.** Aim is closed-form, not
fiddly: the camera looks *through* its anchor (the player's position + 1.4 m), so the ray's height
`h` metres ahead is `1.4 − h·tan(pitch)`, and yaw follows from the direction to the target. Look
deltas are clamped to `maxLookDeltaPerStep` (120 px), so a large rotation is delivered in chunks
across steps — the first harness attempt "found" that nothing in the world was focusable, and the
cause was the harness, not the game (it was dispatching 250 px deltas that the input system
clipped by half). A second, in-page `InteractionSystem` over a fresh physics world (same shipped
level data) acts as an instant oracle for "is there any vantage that focuses this target?", which
turns an aim/occlusion question into a query instead of a guess.

1. **Bug 17 (P0) — BM-1 was permanently `Locked`, so the MVP's capstone could never complete.**
   `ProgressionSystem.initialPuzzleState` answers `Locked` for a puzzle no branch owns, and §25's
   gated states do not evaluate — so the dynamo's SM never ran a single requirement, and its
   milestone, reward, autosave and branch/hub progression were unreachable no matter how the
   machine was built. Root cause: `BM-1` was never added to Branch A's `puzzleIds` when its
   content landed (ADR-018), even though §7 lists it in the branch's progression table, §6's
   8-beat template calls it the branch's *final machine* (activation is beat 6, reward/access
   beat 7, the clue beat 8), and OQ-3 counts it among "P1–P3 + BM-1". Fix: **`BM-1` is Branch
   A's** (`data/branches.ts`), which is what makes the branch Complete only once its final
   machine has run — the order §6 describes — and is also why the branch's clue plate wakes
   after BM-1 rather than after P3 (see the walkthrough note below).
2. **Bug 18 (P0) — BM-1's four loose parts had no interaction targets at all.**
   `BRANCH_A_INTERACTABLES` aggregated P1–P3 but not BM-1, and there was no `BM1_INTERACTABLES`
   to aggregate: the gear, valve, blanking plate and shut-off valve were registered components,
   carryables the manipulation SM owned and drew — and invisible to §18, so the interaction ray
   could never focus them, and *grab requires a focus target*. The branch's capstone was
   unassemblable even with the gating fixed. Fix: `BM1_INTERACTABLES` (the same
   `interactablesOf` derivation P1–P3 use) and its entry in the aggregate.
   Both bugs are the same species as Bugs 10 and 14 — shipped, unit-green, unreachable in play —
   and neither the suites nor a code read surfaced them; playing the branch did.
3. **Bug 19 — the manipulation strip advertised keys that did nothing.** Seen in the user's own
   screenshot: `Empty-handed — No socket in range  [Q] rotate  [E] confirm  [Esc] cancel` sitting
   under a focus line reading `crate-a GRAB [E]` — the same key described two ways, plus a socket
   verdict for a part that does not exist. `renderManipulation` now hides the socket line and the
   keys unless something is actually carried (the held-name status stays: an empty hand is a real
   state).

**Guard (`tests/logic/shipped-content-integrity.test.ts`, new, 8 tests)** — the suite that would
have caught Bugs 17/18, asserted against the **shipped data the composition root assembles**
rather than a fixture: every shipped puzzle belongs to a branch and is not born `Locked`; Branch A
completes only when its final machine has run; every puzzle's milestone has a reward and its
machine a definition; every placed socket has a definition; every required part is placed and
names a real puzzle; **every carryable has an interaction target**; every target names placed
content in a non-inverted box; every branch and hub stage names real content. Mutation-verified:
removing `BM-1` from the branch fails exactly the two gating cases, and dropping
`BM1_INTERACTABLES` fails exactly the two target cases.

**Verified in the real build, headlessly** (evidence, not opinion):
- boot is clean — `[save] starting fresh (…)`, `[hub] stage 0 (Dormant); branch-a=Available (open),
  branch-b=Locked (sealed), branch-c=Locked (sealed)`, `[clue] 0/1 clue(s) discovered`,
  `[audio] ready (suspended)`, lifecycle `running`, first frame renders (boot status removed),
  **no exceptions and no console errors at all** (the two `favicon.ico` 404s this doc has carried
  since CHK-12.5 are gone — `index.html` now carries an inline data-URI icon, so the request never
  happens);
- HUD read-outs match the fix: `Empty-handed` with `.gw-hud-bindings` **hidden** and the socket
  line hidden, `First Mesh / InProgress / Bridge the two shafts…`, `Parts 0 / 11`, `L0 · None`,
  `Scanner locked — blueprint required`, `Field log — 0 entries` hidden;
- input soak (walk, look sweeps, E/Q/R/H/Escape, canvas and HUD clicks) then a deliberate
  pause/resume: no exceptions, positions finite, frames advancing, lifecycle `paused` → `running`;
- budget read-out from the shipped overlay: **draws 27–40, tris 276–408, lights 2** — far under
  §36's hub ceilings (≤100 draws, ≤150 k tris, ≤6 lights), JS heap ≈12 MB;
- focus probes through the real ray: P1's gear and plate, the lab crate and dock socket all focus
  from computed vantages (`Grab`/`Insert`), and the objective line follows the *focused* puzzle;
- **BM-1 assembled for real**: grabbing `gear-bm1` (`Grab @ 2.39 m`) and `valve-bm1`
  (`@ 2.30 m`) with a real `KeyE`, carrying each into its socket (the strip reads *Socket
  compatible — confirm to dock*), seating both with real clicks → the console logs
  `[staged] BM-1 structure complete — priming lines are live`. That is Bug 18's fix proven in the
  browser, and the first time BM-1 has ever been assembled in the running game.

**Where this checkpoint stops, and what is left of it.** The priming/engage presses and the
completion burst (`[reward]`, autosave, branch complete, hub stage, plate awake) were the next
step: the first attempt reported all four props `NOT FOCUSABLE`, the harness's own aim was at
fault (it aimed from an *intended* vantage, not from where the physics actually left the player —
fixed in the harness), and the rerun had not happened when the session ended. Also unanswered by
this pass: the §29.3 scanner and hint ladder in the real build (they need P2's blueprint), a
production-preview boot (every browser check so far used the dev server), the aesthetic half of
the HUD pass, the audio mix, and the M4/M6 human walkthroughs.

**Deliberately untouched**: every L1 system, every port and adapter, the save schema, the puzzle
SM, the validator, the machine graph. The edits were two content files (`data/branches.ts`,
`levels/branch-a.ts`), one HUD presentation rule (`presentation/hud.ts`), `index.html`, and tests
— no ownership, dependency direction or contract change, so **no ADR**. The one contract nuance
is recorded rather than hidden: Branch A's puzzle list now includes its final machine, which is
what §7/OQ-3 always said it was.

CHK-12.6 — **the objective halves of the two owed visual checks, delivered as suites**
(all automated gates green: 542/542 tests / 41 files, typecheck clean, build 703.29 KB /
183.85 KB gzip / 66 modules — JS byte-identical to CHK-12.5: only CSS and tests moved).
The "Human Check Needed" list named two owed passes — the HUD's aesthetic half and the
M9 walkthrough's colours. Reading them against the code split each into a part a console
can measure and a part only a person can judge, and the measurable parts are now
executable rather than owed:
- **The M9 walkthrough's colour facts are pinned (`tests/logic/hub-visual-facts.test.ts`,
  new, 4 tests).** CHK-11.1 left "the colours" to an eye on the grounds that consoles
  cannot see — but the colours the walkthrough names (red slabs on B/C, the open A
  doorway unslabbed, teal A posts vs stone sealed posts, trunk lines and the shared bus
  gold on completion, the Regulator column warming with stage, the plate dark → gold →
  teal on discovery) are **pure level data**: `hubMeshes` is documented pure and
  `setLabWorld` applies `mesh.color` verbatim (no tint, no lighting recomputation of
  the authored value — tone mapping changes how it *looks*, never what it *is*). The
  suite pins each authored hex against the progression state that must produce it,
  including the plate's full lifecycle being driven by the clue set alone (identical
  geometry, one colour). Mutation-honest: reverting `--gw-invalid`'s audit (below) fails
  exactly the pairs that use it, and the door-post count is asserted so the colour loops
  cannot pass vacuously. What still needs the walkthrough eye: ACES tone mapping,
  lighting and fog — how #8a3b2f reads on screen, not that it is authored.
- **The HUD palette is WCAG-audited (`tests/boundary/hud-contrast.test.ts`, new, 5
  tests) and the four failures it found are fixed in `src/style.css`.** The HUD's text
  sits on translucent panels, so its real backdrop is a *blend* — the panel over
  whatever the canvas draws behind it — and the honest worst case is the lab's
  lightest surface (the step, `LAB_STEP = 0x8b939c`) or a teal carryable. Computing
  every text token against the panel blend over those (browser compositing: sRGB
  alpha blend, then WCAG luminance) found **four failures**: the `.gw-hud-surface`
  panel at its shipped alpha (0.72) left `--gw-muted` at 4.08:1 over the step, and even
  over a fixed panel `--gw-invalid` (3.5:1) and `--gw-unpowered` (3.3:1) failed at their
  12px sizes; worst, `--gw-complete` on the **unbacked** save note measured ≈1.2:1
  against the step or the red test block — unreadable in play. Fixes, all objective:
  the surface panel and the save-note pill composite at **0.86** (toasts keep 0.86,
  matching), `--gw-invalid` → `#e28073` and `--gw-unpowered` → `#8f979f` (the old values
  failed AA at 12px on the audited backdrops; the mutation check fails at 4.45:1), and
  the save note gained a pill backing so its text never floats on bright geometry. The
  suite recomputes every ratio from the shipped stylesheet at every test run and pins
  the audited panel alpha structurally, so a regressive token edit or a quiet alpha
  change fails a test instead of shipping silently unreadable text. The scanner button's
  dimmed state is exempt as a `disabled` (inactive) control; the dev-only `.gw-debug-*`
  panel is tooling, not game UI; `--gw-powered` carries no HUD text (no audit needed);
  `--gw-hazardous` and `--gw-complete` pass over the fixed panel and keep their hues.
- **Deliberately untouched**: every production TypeScript file, the ports, the adapters,
  the levels, the save schema. This checkpoint changed `src/style.css` (two token
  values, two alphas, one pill) and added two suites. No ownership, dependency
  direction or contract change, so **no ADR** — §33.2's "readable without colour alone"
  already demanded the prerequisite this enforces.
- **What this checkpoint does not do**: it does not make the HUD *handsome* — density,
  typefeel and composition at play resolution remain the walkthrough's judgement — and
  it does not touch the audio mix. Those two items, plus the M4/M6 walkthrough itself,
  are the entire remaining "Human Check Needed" list.

CHK-12.5 — **M10 slice 4: audio (ADR-011) — the §32.2 Web Audio bus, wired to the §32.1
intent stream** (all automated gates green: 533/533 tests / 39 files, typecheck clean, build
703.29 KB / 183.85 KB gzip / 66 modules). ADR-011 chose "Web Audio API with a thin `AudioBus`
wrapper" and accepted the cost in the same breath: "must handle unlock/suspension
ourselves". This is that slice, built additively — no canonical state, no schema change, and
no system contract changed:
- **Port (`ports/audio-port.ts`, new, L3)** — interfaces only, no imports at all. The
  §32.2 buses are *vocabulary* (`master`/`music`/`sfx`/`ui`/`ambience`), a cue is a *name*
  rather than a file, `play()` is fire-and-forget (audio is never gameplay truth — §32.4
  rule 1 — and may never be the only signal — rule 2), the emitter is a world *point*
  the composition already has, and the listener is `{eye, target}` — structurally the same
  shape `setListener`/`setView` already receive, so the composition passes the camera pose
  and computes nothing audio-specific.
- **Adapter (`adapters/web-audio-bus.ts`, new, L4)** — three decisions, each a rule:
  **cues are synthesised, not loaded** (a handful of oscillators with authored envelopes,
  so ADR-011's ~0 KB holds and there is no asset pipeline, decode step or load failure on
  the boot path); **voices are pooled** (§32.2's "node pooling to avoid GC churn": one
  oscillator started once at silence plus its own gain and panner, wired
  `osc → gain → panner → bus`, so playback is an envelope on an existing node and a steady
  state allocates nothing — voices are created per bus on first use, capped at 3, and a
  saturated bus steals its longest-idle voice with an 8 ms fade so the steal cannot click);
  and **global is positional-at-the-listener**, so §32.2's "positional emitters for
  machinery, global for UI" is one code path rather than a bypass branch. The engine
  surface is injected as a minimal structural type, so the whole adapter is testable
  headlessly and cannot quietly grow a dependency on a wider Web Audio API.
- **The null object (EC-BRN-08)** — `SilentAudioBus` reports `unavailable` and does
  nothing. `WebAudioBus` behaves identically when there is no `AudioContext`, when the
  factory throws, or when the graph cannot be built: every failure ends in silence and a
  `false`/no-op, **never a throw into boot**, and each warning is latched so a per-frame
  caller cannot turn it into a log flood.
- **The SFX half of the composer (`presentation/feedback-composer.ts`)** — §40's row is
  literally `FeedbackComposer(VFX/SFX)`, so the cue mapping lives there: one §32.3 recipe
  per intent, positioned at the same point as that intent's pulse (the part's pose for an
  attach, the machine's anchor for a machine edge, the puzzle's anchor for a completion),
  with §32.1's noise suppression as a per-cue retrigger window (0.06 s) on the composer's
  own fixed-step clock. An unresolvable anchor degrades to a *global* cue rather than
  going unsounded. The port is an optional constructor argument, so headless compositions
  and every existing call site work unchanged and audio absence is not a branch.
- **Gesture unlock (`adapters/browser-events.ts`)** — `bindFirstGesture(win, onGesture)`
  binds the first real user gesture and releases itself when the callback reports the
  request was delivered; a refusal keeps it watching for the next gesture, because EC-BRN-08's
  retry must be a gesture, never a timer.
- **Composition (`main.ts`)** — the bus is constructed and initialised beside the renderer
  (logging `[audio] ready (…)` or `[audio] unavailable … — running silent`), handed to the
  composer, fed the camera pose as its listener each frame, unlocked by the first gesture,
  disposed on shutdown, and exposed on the dev-only socket so a browser check can read its
  state. `buildFeedbackView` gained `machineAnchorOf` (the machine's first root node, read
  from derived state) and `puzzleAnchorOf` now delegates to it, so a completion's pulse and
  a machine's cue cannot point at different places.
- **Tests** (+22: 511 → 533): `web-audio-bus` (14 — the §32.2 graph built once and
  idempotently, volume clamping including a non-finite request, no voice until a cue plays
  then reuse forever, the cap and the steal fade, exponential glides, listener tracking that
  writes nothing while the camera is still, positional vs global placement, delivered-unlock
  and live state, the latched warning, a hostile context, the no-Web-Audio path, disposal,
  the null object, and every authored recipe's §32.3 budget with the envelope/pool
  invariant), `feedback-composer` (+5 — the cue per intent at the right point, silence for
  state-only changes, audio-optional, the retrigger window and its per-cue independence,
  unresolvable-anchor degradation), `dom-adapters` (+3 — the gesture binding's release,
  delivery retry and custom gesture set), plus a shared `RecordingAudioPort` double and the
  P1 acceptance test asserting that one intent stream reaches **both** presentation ports
  (the attach and the completion cue, positioned where the machine stands).
- **Verified in the real build, headlessly** (evidence, not opinion; the CHK-11.1/12.4
  method, harness outside the repo and cleaned up): boot logs `[audio] ready (suspended)`
  and `state === 'suspended'` — lazy init, no premature resume; a single *trusted* CDP click
  (the page's own probe confirms `pointerdown`/`mousedown`/`mouseup`/`click` all reached
  `#game-canvas` with `isTrusted=true`) flips `state` to `running` and logs the unlock; the
  **live port** schedules a real cue (`play({cue:'attach-click'})` → `lastCue`
  `attach-click`), which is the adapter driving genuine Web Audio rather than a fake; and a
  genuinely played puzzle — teleport, focus the loose gear, `KeyE` to grab it, walk to the
  machine until the HUD reads *Socket compatible — confirm to dock*, then a trusted click —
  seats it, logs `[save] autosave written (puzzle-completed trigger)`, and the bus reports
  the **`completion`** cue, which the composer emits on exactly one intent, with
  `machine-start` observed on the preceding run. The console stayed clean throughout: two
  `favicon.ico` 404s from the page shell (pre-existing, unrelated — there is no favicon
  link) and **no audio error or warning of any kind**.
- **Two real findings, from doing it rather than reading it.** (1) `unlock()` originally
  returned "the context is running", which on Chrome is false for a whole task after the
  resume is accepted — so the first harness run showed the unlock being requested on one
  gesture and only *confirmed* on the next. That is a design error, not a timing quirk of
  the test: the contract is now "the request was delivered" (`state` answers the settled
  question separately), which is what the caller actually needs to stop listening. (2) The
  composition's machine-start cue was **not** observed on the final run even though the
  attach was: the SM enters `SnapPreview` one step after the snap candidate appears (§14's
  order), so a frame-accurate click can land in that gap — the harness now retries like a
  human holding the button, and the run that seated the gear did so on the second click.
  Worth recording: it is not a defect the player can feel at 30 Hz, but it is real.
- **Deliberately untouched**: every L1 owner, every L2 system, the ports besides the new
  one, all adapters besides the new bus, the save schema, the HUD and the scanner. No
  ownership, dependency direction or system contract changed, so **no ADR was needed** —
  ADR-011 already decided the implementation and §32 already specified the buses, the
  recipes and the unlock rule.
- **§32.4 rule 4's deviation, stated plainly**: the rule says recipes are data
  (`feedback.ts`). There is no `data/feedback.ts` in this repo (the M6 slice co-located
  `DEFAULT_FEEDBACK_TUNING` with its composer for the same reason), so the cue table lives
  with its only consumer as an exported constant and is pinned by the suite. Moving it to
  `data/` is a mechanical change if a second consumer ever appears.
- **What this slice does not do**: no music or ambience content (the buses are authored and
  wired, but nothing drives them — §32.2 allows music to be "minimal or none"), no UI-bus
  cues (the hint/scanner/toast affordances still acknowledge silently — the cue path exists
  and is one call away), no machine-hum *loop* (the machine edge plays a one-shot spin-up/
  spin-down), and no ear has been on the mix at all: the recipes are authored to the §32.3
  descriptions, not balanced against each other.

CHK-12.4 — **M10 HUD visual pass, measurable half — and the defect it found** (all
automated gates green: 511/511 tests / 38 files, typecheck clean, build 695.24 KB /
181.41 KB gzip / 65 modules). §33's HUD is DOM/CSS (ADR-010), and this doc has said since
M10 slice 1 that "the dom suite proves behaviour, not layout". So this pass drove the
shipped dev build over CDP in headless Chrome and measured **computed geometry** — and
found the layout had never applied at all.
- **The defect (Bugs 15/16).** Two rules in `src/style.css` were missing their closing
  brace: `.gw-debug-bad` (so lines 93–204 — `.gw-hud`, `.gw-hud-surface`, the key chip, the
  reticle, the whole focus/objective block — were parsed as rules *nested inside* it) and
  `.gw-hud-materials, .gw-hud-blueprints` (so the hint strip, both buttons, the scanner
  rules, the toast stack, the save note **and `.gw-hud .gw-hud-hidden`** were nested inside
  that). Browsers support CSS nesting now, so the parser does not error: it reads each
  swallowed rule as a **descendant selector** that can never match. Nothing throws, the
  build stays green, and every one of those declarations silently did nothing. Measured
  proof: `.gw-hud-toasts` computed `position: static` (authored `absolute`) and the
  surfaces stacked as full-width blocks at the top-left (`resources 0,0 1920x81`,
  `manipulation -960,81 …`) instead of anchoring to their corners. Fixed by closing each
  rule where its declarations end; the displaced tail (`font-size: 12px; }` sitting after
  the hidden rule) turned out to be the materials rule's real final declaration and moved
  back into it. This is **pre-existing**, not introduced this session: the HUD block was
  appended after `.gw-debug-bad` without a closing brace, and the materials rule was split
  by a later append.
- **Amends CHK-12.3 (and why it slipped through).** Both CHK-11.1 and CHK-12.3 verified HUD
  *state* by class (`classList.contains('gw-hud-hidden')`) and by console output. With the
  stylesheet swallowed, `.gw-hud-hidden` hid nothing — the log surface was in fact visible
  on a fresh boot. CHK-12.3's finding (the composition resolves the clue into real words)
  stands, but its "hidden vs visible" claim is only true *now*; CHK-12.4 re-established it
  against **computed `display`**, the only honest test of a CSS state.
- **Verified after the fix, at four viewports** (1920x1080, 1440x900, 1280x720, 1024x640),
  with the HUD populated to worst case — the objective line carrying a real failed
  requirement, one log entry with a full-length clue, and a full four-toast stack:
  - the reticle, the focus line and the manipulation strip are **centred** (±2 px);
  - the left column anchors at 16,16 and the log **stacks below the objective line**
    (`log.y = 112 ≥ objective.bottom = 104` at every viewport, with the objective growing
    to 88 px when its requirement text wraps);
  - resources anchor bottom-left at 16/16, the hint strip bottom-right, the toast stack
    top-right — each within 2 px of its authored inset;
  - **no surface is off-screen and no two surfaces overlap**, at any of the four sizes;
  - fresh boot: `.gw-hud-log` computes `display: none` (the save note too), so
    `.gw-hud-hidden` really hides.
- **Regression guard (`tests/boundary/stylesheet-integrity.test.ts`, new, 3 tests).** CSS
  has no compile step here, so this failure mode is silent by construction. The suite
  asserts the stylesheet is **flat** (brace depth never exceeds 1 — a nested rule here is
  always a missing brace), that braces balance, and that the selectors the HUD is built
  from are present. Verified by mutation: re-breaking one brace fails exactly the two
  structural assertions and nothing else.
- **Deliberately untouched**: every production TypeScript file, the ports, the adapters,
  the systems. This slice changed `src/style.css` (two missing braces) and added a boundary
  test — no ownership, dependency direction or contract change, so no ADR.
- **What is still owed**: the *aesthetic* half. Geometry, anchoring, stacking and hiding
  are now measured; whether the palette, density and typography read well at play
  resolution is a judgement a console cannot make (no screenshots were saved).

CHK-12.3 — **M10 slice 3: the §12.2 clue/log surface (the HUD's field log)** (all
automated gates green: 508/508 tests / 37 files, typecheck clean, build 695.24 KB /
181.41 KB gzip / 65 modules). The M9 clue was discovered, persisted and printed to the
console, but nothing in the game ever read `discoveredClueIds` back out — the story beat
was a console line. §12.2 already names the consumer ("Discovered clues / log entries →
Story UI, HUD"), so this is that surface, built as a pure read-model with no new owner
and no contract change:
- **HUD (`presentation/hud.ts`)** — `HudLogEntryView` (`id`/`title`/`text`) and
  `HudLogView`, a required `log` field on `HudSnapshot`, and a new surface whose rows are
  pooled and reconciled exactly like the material/blueprint rows: a signature gate
  (`ids.join('|')` — the set only grows and content is static at runtime) means a steady
  frame touches no DOM, surplus rows are hidden rather than removed, and the count in the
  heading is derived from the rows themselves, so the label and the list cannot disagree
  (§33.2 rule 1). The surface starts **hidden** and hides again when the set is empty:
  "you have found nothing" is not "the world holds nothing". An entry with no words (an
  id with no shipped definition) keeps its title and hides its text line rather than
  rendering an empty paragraph. It imports nothing new and emits no intent — the HUD stays
  a read-model consumer (§33.2 rule 2).
- **Layout (`style.css`)** — a new `.gw-hud-left` column owns the left anchor and stacks
  the objective line above the log. The objective line's height depends on how far the
  requirement text wraps, so a second absolutely-positioned surface under it could not be
  placed without either measuring it or overlapping it; in the column the two flow.
  `.gw-hud-left > .gw-hud-surface { position: static }` (two-class specificity) is what
  moves the objective line off its own absolute anchor, and every class the dom suite
  queries is unchanged.
- **Composition (`main.ts`)** — `buildHudRenderer` gained the narrow lookup
  `discoveredClueIds: () => progression.discoveredClueIds` (never the owner: the HUD can
  reach nothing back) and resolves each id through `clueDefinitionOf`, because only the
  composition may read progression *and* import content (§26, §12.2). An unresolved id
  degrades to its id with an empty text — the "ghost ids degrade to ids" rule the scanner
  reveal already uses — so a save written against older content reports what it holds
  rather than vanishing. The discovery trigger now also toasts
  (`Clue recorded: <title>`): §33.1's toasts are the event stream, and a surface quietly
  gaining a row is too small a signal for the branch's one story beat.
- **Tests** (+3: 505 → 508): `hud.test.ts` (17, was 14) — the fixture gained the `log`
  field and "renders every surface" now asserts the heading/title/text; new cases cover
  hidden-while-empty then a counted multi-entry render, pooled rows surviving a shrink and
  a New Game (same elements, surface hidden, pool not emptied), and the wordless-entry
  path; the existing hostile-string case now also proves a hostile clue title/text is text,
  never markup.
- **Deliberately untouched**: every L1/L2 owner (progression, the puzzle SMs, the
  validator, the graph, the physics), the ports and every adapter, the save schema (the log
  reads the canonical seen-id set the v1 `progression` object already carried) and the
  scanner. No ownership, dependency direction or system contract changed, so **no ADR was
  needed** — §12.2 named this consumer from the start.
- **Verified in the real build, headlessly** (evidence, not opinion): the dev server was
  driven over CDP in headless Chrome (the CHK-11.1 method; the harness lives outside the
  repo). Fresh boot: the HUD mounts, the log surface is `gw-hud-hidden` with
  `Field log — 0 entries` and 0 rows. Then, calling the *live* owner
  (`__gearwrightDev.progression.discoverClue('clue/regulator-plate')` — the same call the
  step's focus trigger makes) and letting the next frames render: it returns `true`
  (genuinely new), the surface un-hides, the heading reads `Field log — 1 entry`, one row,
  and the row carries the authored content — `Regulator Plate — “Pressure First”` and the
  full plate text with its curly quotes intact. A second `discoverClue` returns `false`
  and the row count stays 1 (set semantics; no duplicate row). A reload clears it back to
  hidden, so the transition is verified both ways.
- **Not covered by that check**: the discovery *toast* fires only on the step's real focus
  trigger, which requires Branch A to be Complete — so seeing it means playing P1–P3,
  i.e. the same M6/M8/M9 walkthrough already owed to an eye. The toast mechanism itself is
  covered by the `hud` suite.

CHK-12.2 — **M10 slice 2: the §29.3 scanner reveal end to end** (all automated
gates green: 505/505 tests / 37 files, typecheck clean, build 693.70 KB / 181.01 KB
gzip / 65 modules). The HUD's scanner button lived as an intent with a
console-only acknowledgement — the dedicated overlay was the missing half. Now a scan
is a real reveal, built additively with no new state owner and no rule evaluation:
- **Derivation (`game-state/scanner-reveal.ts`, new, L1, pure)** — collects what a
  *failed* requirement names (`named`) plus what its declared capabilities point at
  (`candidate`: tag carriers via `registry.byTag`, acceptable sockets via
  `SocketDefinition.accepts`, sockets of the required `socketKind`), descends
  `sequence`/`not`/`any` instead of judging them, and yields the requirement's route as
  the conducting chain read from `graph.derived` when one exists, else the two named
  endpoints (the link to close). `indexRequirements` resolves nested ids; output is
  deterministic (sorted, deduped, BFS over sorted adjacency). It never calls the
  validator — the verdict stays the validator's, by construction.
- **Presenter (`presentation/scanner-overlay.ts`, new, L4)** — owns duration (6 s) +
  cooldown (8 s) in the fixed step, copies the reveal in (no aliasing), refuses while
  scanning or cooling (§29.2's "always responds immediately" — the caller toasts the
  refusal), fades `strength` 1→0, clears the port exactly once, and carries the
  requirement's plain-language `text` while up. No owner, no canonical state: it owns a
  clock, exactly where `FeedbackComposer` owns the pulse clock.
- **Port (`ports/render-port.ts`, additive)** — `ScannerOverlayState`
  (targets + route polyline + strength) + `RenderPort.setScannerOverlay`, the M6
  precedent (`setFeedbackPulse`): specified in §29.3, additive, no architecture change.
- **Renderer (`adapters/three-renderer.ts`)** — pooled per-id wireframe highlights (box
  for named, octahedron for candidate: shape, not colour, per §33.2 rule 4) + one thin
  flow-path polyline from a preallocated 64-point buffer (no per-reveal allocation),
  faded by strength; malformed states draw nothing, never throw.
- **HUD (`presentation/hud.ts` + `style.css`)** — `scannerAvailable` widened to a
  four-state `scannerState` (`locked`/`ready`/`scanning`/`cooling`) from one text table
  (label + aria-label can never disagree), plus the `scannerText` line carrying the
  revealed requirement's words (the same resolution the objective line reads).
- **Composition (`main.ts`)** — module-level `REQUIREMENT_BY_ID` (all shipped
  requirements, once) + `requirementText` (authored `objectiveText`, else
  `REASON_TEXT` — one function, so the objective line and the scanner line can never
  disagree) + `composeHudScannerState`; `scannerRequest` resolves the focus-derived
  puzzle → `reasonCodes[0]` (the same requirement the objective line names) → derive →
  world points, refusing with words (no blueprint: silent — the button is disabled; no
  machine in view / nothing failing / still recharging: toasts). `scanner.step(dt)` in
  the fixed step, `scanner.present()` beside the composer's.
- **Tests** (+17: 488 → 505): `scanner-reveal` (9 — the shipped P1 near-miss, endpoint
  fallback vs the mounted conducting chain, purity/no-dirty, `componentAt`, machine
  expansion, sequence descent + nested index, every shipped requirement resolving
  deterministically with targets, ghost ids degrade to ids), `scanner-overlay` (6 —
  fade lifecycle, text lifetime, refusal during scan + cooldown, NaN/negative deltas
  ignored, defensive copy, documented-tuning floor), `scanner-integration` (1 —
  validator → derivation → presenter → port, headless), `hud` (+1 — the
  ready/scanning/cooling states; `RecordingRenderPort` gained the scanner recording).
- **Deliberately untouched**: the validator, the puzzle SMs, the machine graph, the
  physics, the save schema (nothing canonical is added — the reveal is transient
  presentation). `objectiveText`/`REASON_TEXT` moved, not duplicated (the objective
  line reads the same new helper). No ADR: §29.3 already specified the overlay; this
  is its implementation, recorded in the §29.3 note and the §40 file list.
- **Input (`gameplay/input-system.ts`)** — a `hint` one-shot edge in `InputActions`
  bound to **KeyH** (`DEFAULT_BINDINGS.hint`), routed in the Exploration branch only
  (a carry owns Q/E; §15), and nulled in Manipulation like every other Exploration
  edge. Covered by the input-system suite (edges from `pressed`, never from held).
- **Codec (`game-state/save-codec.ts`)** — schema v2 gains an *additive optional*
  `hints: { levels: Record<puzzleId, level> }` block (§12.2's canonical HintState).
  Decode validates present-or-absent (a pre-M10 v2 file simply has no block), levels
  must be finite numbers, and `apply()` restores the ladder **after** the puzzles so
  the replacement clears whatever the session had climbed. No version bump — v2
  files with and without the block are both valid.
- **Coordinator (`gameplay/save-system.ts`)** — the optional `SaveSystemDeps.hints`
  seam (`snapshot` → capture's `hintLevels`, `restore` → apply, `restore({})` in
  `newGame()`), shaped exactly like the ADR-018 `actions` seam beside it. Headless
  compositions (tests, tools) work unchanged without it.
- **Composition (`main.ts`)** — `HintSystem` and `Hud` constructed with the rest of
  the owners; a module-level `buildHudRenderer` derives the per-frame `HudSnapshot`
  (focus + validity from the snap candidate, held part + socket state, the active
  puzzle's title/state/top failure reason via the authored per-requirement texts of
  `data/hints.ts`, parts/materials/blueprints, the hint ladder row and its key
  label); `hints.update(dt, engagement)` runs in the fixed step with engagement
  derived from the same focus/carry state the world reads (never guessed); the KeyH
  edge requests one ladder rung for the focused puzzle and answers with a toast;
  the HUD's hint/scanner buttons are wired as intents (§33.2 rule 2 — the HUD
  reports, the systems decide); the scanner request is still acknowledged per §29.3 (the
  dedicated overlay landed in the checkpoint right above this one); and the toast clock
  lives in the fixed step, so lifetimes are deterministic.
- **Tests** (+19: 469 → 488): `tests/dom/hud.test.ts` (13 — the full snapshot
  render, null-value hiding, pooled material/blueprint rows grown and hidden rather
  than rebuilt, the 4-toast buffer dropping the oldest, `update(dt)` expiry against
  the shared `HUD_TOAST_LIFETIME_SECONDS` table, NaN/negative deltas ignored,
  intent buttons, the scanner locked without the blueprint, and hostile strings
  rendered as text — never markup), `save-load` (+4 — the codec round-trip of
  `hints.levels`, a pre-M10 v2 file restoring nothing, SaveSystem capture/restore
  through `deps.hints`, and New Game clearing a climbed ladder), and `input-system`
  (+2 − reshaped — the hint edge from `pressed` only, in Exploration).
- **Deliberately untouched**: every L1 owner's logic, the validator, the puzzle SMs,
  the machine graph, the renderer and the physics. The HUD is a read-model consumer
  and the ladder is read-only with respect to puzzle state (§29.2); no ownership,
  dependency direction or system contract changed, so no ADR was needed — §12.2's
  HintState row (canonical, "Preserved; independent of completion") already
  mandated exactly this shape.

CHK-11.1 — **M9's browser check, automated: one real defect found and fixed** (all
automated gates green: 416/416 tests / 30 files, typecheck clean, build 656.87 KB /
170.15 KB gzip / 57 modules). The M4/M6/M9 walkthroughs were owed to a human because
"some of it is visual". This checkpoint verifies everything in them that is *not*
visual, by driving the shipped build in headless Chromium and reading the console plus
the live systems. **The check found a real bug (14), which is what it was for.**
- **The defect.** The clue plate on the Great Regulator was **unfocusable in the
  shipped build**: its interaction volume was authored "slightly proud of the plate in
  every direction", so its back face (z = 15.05) poked 5 cm into the Regulator column's
  static collider (z ≥ 15). ARCH §18 discards any interactable whose whole box overlaps
  a collider (`KinematicPhysics.isBoxBlocked`), so `InteractionSystem` never offered the
  plate — and because nothing else about the plate looked wrong, §6 beats 5/8's clue
  could never be discovered in play. Every headless test passed anyway: `clue-plate.test.ts`
  asserted a *point* (the plate's front centre) was outside the colliders, never the
  box §18 actually tests, and no test ever ran the real `InteractionSystem` against the
  hub's real colliders.
- **The fix (`levels/hub.ts`).** The plate's interaction volume is now proud to the
  front, sides, top and bottom, but stops **short of the column face**
  (`COLUMN_FRONT_Z − 0.01`). The column's front plane is named (`COLUMN_FRONT_Z`) and
  shared by the collider and the plate's constants, so the two numbers can no longer
  drift apart — the coupling that hid the bug.
- **The regression test (`tests/logic/clue-plate.test.ts`, +1 = 8).** It runs the
  *real* `KinematicPhysics` and the *real* `InteractionSystem` against the hub's real
  colliders and asserts both halves: the plate's box is not box-blocked, **and** the
  vantage the placement was chosen for (plinth at z = 14, follow rig at yaw π / default
  pitch / 4.2 m arm) genuinely focuses `clue/regulator-plate`. The old point test stays;
  this is the check it could not make.
- **Verified headlessly in the real browser build** (evidence, not opinion):
  - **Boot (fresh)**: `[save] starting fresh (SaveLoadFailed: no valid save in either
    slot)`, `[hub] stage 0 (Dormant); branch-a=Available (open), branch-b=Locked
    (sealed), branch-c=Locked (sealed)`, `[clue] 0/1 clue(s) discovered`, `[save]
    storage available; checkpoint CP-00 @ spawn/lab`; WebGL2 up, lifecycle `running`,
    frames advancing.
  - **Load (§31.5)**: with a v1 save in `gearwright:autosave`, boot logs `[save] loaded
    autosave (0 repair note(s))` and `[save] placed 2 part pose(s)`; the hub reads
    `stage 1 (Pressure Line Online)` and `branch-a=Complete (open)`; the restored P1
    machine reports `machine-running` (the restored edge set really propagates); the
    clue set restores (`1/1`).
  - **Discovery (§6 beats 5/8)**: from the vantage the plinth holds the player at, the
    plate focuses (verb `Inspect`) and the step logs `[clue] discovered
    clue/regulator-plate` + the plate text, then autosaves. Reloading logs `[clue]
    1/1 clue(s) discovered: clue/regulator-plate` and `[save] placed 8 part pose(s); 10
    in the inventory or not a carryable` — the handover places every carryable from the
    previous session's own save.
  - **AccessGate (§26)**: walking into Branch B's sealed slab stops the player at
    z ≈ 19.11 (slab face 19.45 − capsule 0.32); the identical walk through Branch A's
    open doorway passes through to z ≈ 19.66. One rule, two doors, opposite outcomes.
- **Dev-only inspection socket (`main.ts`, ARCH §37).** Browser tooling cannot reach
  the composition otherwise, so `window.__gearwrightDev` now exposes the player, camera,
  interaction and progression handles **in dev builds only** (production is unchanged;
  `__gearwright` already set the precedent). It made the walkthrough deterministic —
  `teleport` to a chosen vantage instead of guessing a route — and is what let the bug
  be found and reproduced. No ownership, dependency direction or system contract
  changed; nothing here is read by gameplay.
- **Not covered by this (still needs an eye)**: the *colours* the walkthrough names
  (red slabs, gold trunk/bus and Regulator warming, plate dark → gold → teal) and the
  loose-part poses *visually* coming back where they were left. These are the only
  M4/M6/M9 items left, and they are exactly the ones a console cannot report.

CHK-10.2 — **M9 slice 2: the §6 beats 5/8 clue plate, and the §31.5 pose handover**
(all automated gates green: 415/415 tests / 30 files, typecheck clean, build 656.86 KB /
170.15 KB gzip / 57 modules). Neither half needed a contract change, which is why both
landed without an ADR:
- **Clue content (`data/clues.ts`, new)** — `ClueDefinition` (id, title, the `branchId`
  whose completion reveals it, and the plate's text) + `CLUE_REGULATOR_PLATE` +
  `clueDefinitionOf`. §6 beat 8 is wordless by design, so the plate carries the story
  text and discovery is a *progression event*: `ProgressionSystem.discoverClue` stays the
  only writer and the seen-id set stays the only canonical field (§12.2). Content is
  data; placement is level data; the composition joins them, because only it may read
  progression (§26).
- **`levels/hub.ts` — the plate, its activation rule and its interaction target.**
  `cluePlateActive(branchState, clueId) === (branchState(clue.branchId) === 'Complete')`
  is exported and pure, and is read by *all three* consumers: the plate's render colour
  (dormant → awake → read), its `enabled` flag in `hubInteractables`, and the
  composition's discovery trigger. A plate is a `prop` (§694's "read-only
  interactables"), so it can never outrank a part in the ray (§18 priority) and never
  offers a grab; it is `contexts: ['Exploration']` so it cannot be read mid-carry. It is
  **presentation only — never a collider**, and it sits at y ≈ 2.3 on the column's front
  face, where the plinth (which holds the player at z ≈ 13.7) leaves it 2.60 m from the
  player's anchor against the 3 m `interactRange` (asserted as arithmetic in the suite).
  `hubMeshes` gained a required third parameter `hasClue` — the read state is
  progression's, and hub visuals only read it (§26).
- **Composition (`main.ts`)** — the hub's interaction targets are installed *after* the
  load (like the colliders, so a restored save decides what the hall shows **and** what
  can be read in it); `syncCluePlates` walks the plates on branch completion and sets
  `enabled` from the same derived state the door reads, announcing only the edge; and the
  discovery trigger sits in the fixed step where §31.4 puts every event consumption —
  focus on an awake plate → `discoverClue` → log the text → autosave (so "persists"
  covers clues, which nothing could previously record).
- **§31.5 pose handover (the pose gap closed)** — `ManipulationSystem.restorePose`
  adopts a persisted pose with **no** SM transition: quantised to canonical precision
  like any committed pose (EC-MAN-12), it commits `lastValidPose`/`preGrabPose` too, so a
  later grab-and-cancel returns to where the part actually was, and it refuses while
  something is held or for an id that is not an authored carryable. `SaveSystemDeps`
  gained the optional `restorePoses` seam, called **after** `apply()` rebuilt the graph:
  the `attached` flag the world reads is therefore the *restored* edge set. Attached
  parts adopt their **socket's** pose (§21.3 — so the part's physics box agrees with where
  the socket puts its render), loose parts go back exactly where they lay, and inventory
  parts are skipped and counted.
- **Tests** (+12): `clue-plate.test.ts` (7 — one plate per clue / a real branch / prop +
  Inspect shape; dormant until Branch A completes and partial progress is not
  completion; the read state changes the plate without moving it; no collider on the
  plate and the reach arithmetic inside `interactRange`; the builders take branch state
  alone, so reading a clue cannot gate a door; discovery is idempotent and restorable),
  `manipulation-system` (+2 — adopt/quantise/mirror-to-interaction-and-physics with the
  SM left in Exploration, plus the two refusals), `save-load` (+3 — the handover happens
  after the graph restore with `attached`/`inInventory` flags, an unplaced component is
  offered as loose rather than repaired, and a refused save never touches a pose).
  `hub-access-gate` was updated for `hubMeshes`' third argument (behaviour unchanged).

CHK-10.1 — **M9 slice 1: progression + hub gating** (sequenced by the user
2026-09-21; M6's browser check still owed, unchanged):
- **L1 `game-state/progression-system.ts` (new)** — branch state, the derived hub
  stage and the clue seen-id set (§12.2/§26). It is deliberately **not a second copy of
  puzzle state**: `update(completedPuzzleIds)` receives the authoritative set from the
  SMs, and `branchState`/`hubStage`/`initialPuzzleState` are computed from it. Only
  `clueIds` is canonical, which is why only it is saved. `canEnter(branchId)` is the
  AccessGate rule, in L1 where §26 requires gating to live. `resetAll()` for New Game.
- **Data**: `data/branches.ts` (`BRANCH_DEFINITIONS` — Branch A with P1–P3; B and C
  `sealed`, which is §6's "sealed, visual" expressed as a fact rather than as geometry)
  and `data/hub-stages.ts` (`HUB_STAGE_DEFINITIONS`, authored low → high).
- **`game-state/puzzle-system.ts` — §25 gating states made real.** `Locked`/`Available`
  no longer evaluate (a gated puzzle reports *nothing*, not "every requirement
  failed"); `unlock()` and `begin()` walk the two edges idempotently; `reset()` never
  re-opens a gated puzzle; and `restore()` now honours the gating states, so a locked
  branch's puzzle cannot come back enterable. Previously every non-`Complete` state
  reloaded as `InProgress`, which would have handed the player gated content.
- **Persistence**: `SaveTargets.progression` restores the clue set, `decode()` now
  validates the `progression` object (it was previously unvalidated), `SaveSystemDeps`
  gained the progression owner, capture writes `storyClues`, and `newGame()` resets
  progression and returns each puzzle to its **§25 start state** (`Locked` for a gated
  branch) rather than blanket `InProgress`.
- **`levels/hub.ts` (new)** — Crucible Hall: the Great Regulator (plinth/column/cap,
  "inactive, staged") and three branch doors. `hubMeshes(branchState, stageIndex)` and
  `hubColliders(branchState)` are **pure functions of progression**, so hub visuals only
  read it (§26) and the gate's answer can never disagree with the branch state. A sealed
  door carries a slab; an enterable one does not.
- **Composition (`main.ts`)** — progression is built *before* the puzzles (it answers
  where each one starts), `syncProgression()` re-derives on completion only, the hub's
  colliders are evaluated *after* the save load so a restored save decides the hub, and
  `refreshHubVisuals()` re-renders the static world when a stage lands
  (`setLabWorld` is documented idempotent). Boot now logs `[hub] stage … ; branch-a=…
  (open), branch-b=… (sealed), …`.
- **Boot-time save loading** — M7 built the write/load protocols and tested them
  headlessly, but `main.ts` never called `save.load()`, so nothing was ever restored in
  the running game. It now loads the newest valid slot, logs its repair notes, and
  re-syncs progression. **Known gap:** loose-part *poses* are not yet applied on load
  (the graph edges, inventory, ledger, checkpoint and puzzle states all are) — see
  "Known Problems".
- **Tests** (+14): `progression-system.test.ts` (11 — derivation, sealed/unknown
  branches, gating chains, stage advance, `initialPuzzleState`, clues, all four §25
  gating behaviours, and a codec round-trip proving the clues persist while branch/hub
  state re-derives, plus refusal of a malformed `progression` object) and
  `hub-access-gate.test.ts` (3 — doors name branches; a door **opens** when its gating
  branch completes with *no* edit to `hub.ts`; trunk/bus/Regulator visuals follow the
  stage).

CHK-9.1 — **M8 Branch A content (P2 + P3) implemented, data-driven** (authorised by
the user 2026-09-21; M6's browser check still owed, unchanged):
- **P2 "Right Turn" (directionality)** — `data/puzzles/p2.ts`: `connected`
  (crank→output through a `gear`) + `output … direction: 'cw'`. The sense is not
  declared by the wiring: it comes from the crank's `drive` port (`spin: 'cw'`) and is
  flipped by whichever part declares `reverses`, so `GEAR_DEF` leaves the output `cw`
  and `IDLER_GEAR_DEF` turns it `ccw`. Mounting the idler fails *exactly one*
  requirement (`p2/output-clockwise`) with the drive still bridged — the lesson is a
  data consequence, and no code knows what an "idler" is.
- **P3 "Three Valves" (pressure routing, multi-solution)** — `data/puzzles/p3.ts`:
  `connected` to each of two outlets (through `pipe`), an `output` pressure floor and a
  `safety` `unjammed` condition. Multi-solution is **declared adjacency**:
  `P3_THREE_VALVES_MACHINE` declares valve A → main, B → aux, and valve C → *both*
  (two links deliberately sharing one socket id). Accepted pairings are A+B, A+C and
  B+C, and a lone cross-run also solves it — all proven by placing the parts and
  driving the real `PuzzleSystem` (EC-PZ-08), never by re-deriving the predicate.
- **P3's near-miss is new content, not new code** — `SHUT_OFF_VALVE_DEF` fits a pipe
  port and carries the same tags, but its port declares `conducts: false`. The carrier
  is refused at it, the downstream outlet is never reached and the machine reports
  `jammed` — P1's "fits, cannot bridge" restated for pressure as one boolean.
- **New content**: `GEARBOX_FRAME_DEF`, `COUNTER_SHAFT_DEF`, `BOILER_DEF`, `OUTLET_DEF`,
  `VALVE_DEF`, `SHUT_OFF_VALVE_DEF`, `MANIFOLD_DEF` (`data/components.ts`);
  `P2_{CRANK_MOUNT,OUTPUT_MOUNT,MESH}_DEF`, `P3_VALVE_{A,B,C}_DEF` (`data/sockets.ts`);
  `P2_RIGHT_TURN_MACHINE`, `P3_THREE_VALVES_MACHINE` (`data/machines.ts`);
  `data/puzzles/{p2,p3}.ts` + `data/puzzles/index.ts` (the set the composition reads);
  `MILESTONE_P2_RIGHT_TURN` / `MILESTONE_P3_THREE_VALVES` and **`SCANNER_BLUEPRINT`**
  (`data/rewards.ts` — §27.3's single MVP blueprint is now granted on P2 completion);
  P2/P3 anchors, sockets, parts, boxes and aggregates in `levels/branch-a.ts`.
- **Composition (wiring, not architecture)**: the puzzle SM became a **set** —
  `PhaseWorld.puzzles`, `WorldStepResult.puzzles`, `FeedbackModel` per-puzzle (it was
  already keyed by `puzzleId` internally), and `main.ts` builds one SM per
  `PUZZLE_DEFINITIONS` entry, wires every one as a `SaveSystem` target and routes every
  one's events. `BRANCH_A_COMPONENTS/SOCKETS/CARRYABLES/INTERACTABLES/WORLD` are the
  branch's aggregate placements, consumed exactly as P1's three exports were in M6.
- **Registrations confirmed**: every component/socket addition is additive; L1 still
  imports no content; the boundary suite stays green.
- **Tests** (+13): `branch-a-solvability.test.ts` on a new whole-branch fixture
  (`tests/logic/support/branch-a-content.ts`): P2 opening/idler-refusal/transform-
  independence, P3's opening, all four accepted routings, order-freedom, the
  one-outlet refusal, the shut-off refusal, and a **cross-puzzle independence** case
  (P1, P2 and P3 on one shared graph, completing without disturbing each other and
  never reverting). P1's fixture now scopes to P1's machine alone.

CHK-8.1 — **M7 rewards + save/checkpoint + recovery implemented** (authorised by the user 2026-09-21; M6's browser check still owed, unchanged):
- **L1 `game-state/reward-ledger.ts` (new)** — the canonical granted-id set
  (ARCH §27.1): `grant()` returns true exactly once per id, `confirm()` is the
  load-path repair hook, `restore()`/`resetAll()`; cleared only on New Game.
- **L1 `game-state/inventory-system.ts` (new)** — three resources with three
  shapes (§27.1): parts as unique instances, materials as counts over the
  closed four-kind vocabulary, blueprints as a set. Guarded mutations; it
  never decides rewards (§27.2 rule 5).
- **L1 `game-state/checkpoint-system.ts` (new)** — canonical checkpoint state
  as anchor ids (§31.2), `CP-00` fallback, unknown trigger ids rejected.
- **L1 `game-state/save-codec.ts` (new)** — the only serialisation path (R5):
  v1 schema per §31.1, typed decode failures (empty/malformed/schema/
  version-unsupported/duplicate-id), non-finite pose refusal, EC-SAVE-06
  edge repair, and the two P0 reconciles (EC-SAVE-09 ledger-authoritative,
  EC-SAVE-10 milestone-proves-grant) with every repair in `loadLog`.
- **L1 `game-state/puzzle-system.ts` (restore)** — canonical state restore that
  keeps the completion latch consistent with the reconciled ledger (R-4: saved
  Complete never re-fires; R-6: a pre-completion checkpoint replays once).
- **L3 `ports/storage-port.ts` (new)** — sync storage seam with the §31.3
  protocol in the interface: `writePending`/`verifyPending`/`promote`, typed
  failures, quota probe (R4; OQ-2's IndexedDB swap stays invisible).
- **L2 `gameplay/reward-system.ts` (new)** — the one reward writer (§26 flow):
  reads `RewardDefinition` data, calls into the inventory, skips unknown
  content with a report (R-9); grantId = `${puzzleId}:${milestoneId}` matches
  the codec's reconcile exactly.
- **L2 `gameplay/save-system.ts` (new)** — write/load protocols (§31.3/31.5):
  capture from the L1 owners (poses via the L2 SM so a held part saves at its
  `lastValidPose`, EC-SAVE-02), pending→verify→promote, newest-valid-slot load,
  New Game reset; playtime accumulates from stepped time only.
- **L4 `adapters/storage-local.ts` (new)** — localStorage backend: envelope
  holds `current` + staged `pending`, so an interrupted write never touches the
  previous good save; quota/security failures typed, never thrown (EC-SAVE-12).
- **Composition (`main.ts`, `data/rewards.ts`)** — owners constructed at boot;
  §31.4 triggers wired OUTSIDE the sim loop (PuzzleCompleted → grant →
  autosave); boot logs storage availability + checkpoint anchor; P1's milestone
  grants scrap×3 + brass×1 (the scanner blueprint stays reserved for P2, §27.3).

CHK-7.1 — **M6 first micro-puzzle (P1) end-to-end implemented**: the shipped build
opens with P1 assembled end to end (`grab → snap → validate → activate →
feedback`):
- **L1 `game-state/puzzle-system.ts` (new)** — the ARCH §25 SM per puzzle:
  `InProgress → Assembled → Validated → Activated → Complete`, with the two things
  the pure validator deliberately does not own (EC-PZ-01): the **stable-frame
  hysteresis counter** (3 consecutive satisfied evaluations, ARCH §24.2) and the
  **completion latch** (`PuzzleCompleted` fires exactly once; `Complete` is
  terminal, never rewound; `reset()` only re-opens an unfinished puzzle). Activation
  is data (`PuzzleActivation`; M6 ships `machineRunning` — the machine's own derived
  `running` state — through a closed, compiler-checked rule table, so a new variant
  without a rule is a compile error). The **first evaluation always runs**, so the
  §33.1 objective line has its reasons from frame one; after that it stays
  dirty-driven (ARCH §14 step 8).
- **L2 `gameplay/feedback-model.ts` (new)** — §32.1's translation: per-step L1/L2
  edges → `FeedbackIntent[]` (attach/refuse/detach, machine running/idle edges with
  the output spin, puzzle stage/completion, objective changes only on change).
- **L4 `presentation/feedback-composer.ts` (new)** — §32.1's composer (decides HOW):
  one pulse channel (newest wins), per-machine spin phase that advances only while
  the derived machine state says `running` (no fake motion, §32.3 layer 4; stopped
  machines hold their phase), fixed-step so it is deterministic. It reads systems
  through lookups only (no imports with runtime cost — the boundary suite stays
  green), and the HUD surfaces of §33 stay M10 work.
- **Detach path (`DetachPrompt`)** — §19 rows implemented end to end: focusing an
  attached component offers `Remove`; `R` (the detach key) removes the edge through
  `SnapSystem.detach` (the same single-owner graph write as attach), relocating the
  part to a valid free pose or refusing with the prompt open when nothing is free.
  The world composition flips carryables `loose ↔ attached` in the interaction layer
  (instead of disabling them, which was M4's pre-detach stand-in) and stops offering
  occupied sockets as insertion targets, so the detach affordance is reachable.
- **Content + placement**: `data/puzzles/p1.ts` (P1 requirements as data —
  `connected … through: 'gear'` plus a real `output` floor), `levels/branch-a.ts`
  (resolved anchors, world-space sockets, machine boxes/colliders, gear + the
  deliberate blanking-plate near-miss as loose parts, interactables), `main.ts`
  composes the shipped `MachineContent` (registry + sockets + defs + machines),
  applies the initial edges, runs the puzzle + feedback + composer per step.
- **Ports**: `RenderPort` generalised to the level's set (`setCarryables` /
  `setSnapMarkers`, pooled per id in the renderer), plus presentation-only
  `spinAngle` and `setFeedbackPulse`. Old single-object calls are replaced, not
  shadowed (documented port generalisation, additive in behaviour).
- **Tests** (+22): `puzzle-system.test.ts` (6: hysteresis, latch, transient validity,
  Validated parking, terminal Complete, reset), `feedback-model.test.ts` (5: edges
  not levels, celebration exactly once, objective-change dedupe),
  `feedback-composer.test.ts` (4: pulses, canonical poses, motion gated on running),
  `p1-acceptance.test.ts` (3: level opening, full chain with visible spin + one
  completion, plate fits-but-cannot-bridge + detach + retry).

CHK-6.1 — **M5 machine graph + propagation + validation implemented**:
- **L1 types (`game-state/component-model.ts`, extended)** — `PortCarrier`
  (`rotation` | `pressure`), `PortDirection` (`in`/`out`/`bidir`), `PortRole`
  (`source`/`through`/`sink`), `PortDefinition` (`value`, `spin`, `reverses`,
  `conducts`), `NodeRef` (`{kind:'component'|'socket'}`), `MachineLinkDefinition`
  (declared adjacency: `viaSocketId` + `viaTags` + `carrier` + `from`/`to` +
  `transfer`), `MachineOutputDefinition`, `MachineDefinition` (`rootNodes`,
  `links`, `outputs`, `maxOutput`). `SocketDefinition` gained `carrier` and
  `ownerPortId` — the socket is the node *between* a part and the structure that
  mounts it.
- **L1 `game-state/component-registry.ts` (new)** — `ComponentRegistry` owns
  identity and placement (id, defId, kind, `spawnAnchorId`, flags) and **nothing
  about the machine**: there is deliberately no `attachedTo` on an instance,
  because attachment has exactly one owner (§21.3) and a second copy is the
  classic desync. `checkIntegrity()` is the load-time gate (unknown definition,
  missing required part, duplicate id) — it reports, it never repairs (EC-GEN-01).
  Also defines `MachineContent`: the bundle (registry + sockets + socket
  definitions + machines) the composition root assembles, so L1 never imports
  `data/` or `levels/`.
- **L1 `game-state/machine-graph.ts` (extended)** — the LTG (ARCH §23):
  - **Canonical attachment edges** unchanged (atomic attach/detach, derived
    occupancy, M4's tests still pass untouched).
  - **Derived topology**: `attachment` edges (part ↔ socket, direction-filtered
    by *both* sides' declarations), `transmission` edges (socket ↔ owner port),
    `flow` edges (machine links, *directional*, applied through the bridge
    component's matching port).
  - **Per-machine propagation**: seeds are components with a `source` port, then a
    deterministic BFS (sorted frontier, edges sorted by id, magnitudes summed at
    equal hop distance, quantised to 1e-3, `reverses` applied once on the way out
    of the bridge). Per node: `powered` / `unpowered` / `blocked`, with value and
    spin. Per machine: `idle` / `powered` / `running` / `jammed`, `outputs`, and
    `warnings` (`cycle`, `blocked-path`, `overpressure`, `no-source`).
  - **Determinism + hygiene**: cycles are flagged, never fatal; recompute happens
    only on a dirty read; `MachineChanged` now also reports *which machines'
    derived state actually changed* (empty when a structural change has no
    functional consequence — the `invalidate()` case); **reads can never be
    stale**, because `derived` rebuilds itself when the edges have moved.
  - **Scope rule**: a machine's node set is its roots plus everything reachable
    (undirected), stopping at a socket belonging to another machine — otherwise a
    shared frame would merge two machines and let one machine's source power the
    other's output.
- **L1 `game-state/validator.ts` (new)** — §24.1's requirement union, evaluated
  against the graph and machine outputs only: `connected` (directed reachability
  over *conducting* edges, optional `through` tag), `componentAt`,
  `output` (`min`/`equals`/`direction`), `state`, `sequence` (unordered),
  `safety` (`overpressure`/`unjammed`), `not`, `any`. Every refusal returns a
  typed reason and the failed requirement id lands in `reasonCodes` (HintSystem's
  key, §24.5). The stable-frame rule is expressed as **data**
  (`previousStreak` in → `streak`/`confirmed` out) so the validator stays pure;
  the counter belongs to `PuzzleSystem` (EC-PZ-01).
- **Content**: `data/components.ts` (`FRAME_DEF` with *sink* ports, `SHAFT_DEF`
  with the rotation source, `DRIVEN_SHAFT_DEF` with none, `GEAR_DEF`,
  `IDLER_GEAR_DEF` (reversing), `BLANKING_PLATE_DEF` (fits, cannot bridge)),
  `data/sockets.ts` (`SHAFT_MOUNT_A/B_DEF`, `MESH_SOCKET_DEF`), `data/machines.ts`
  (new: `P1_MESH_MACHINE` — "First Mesh"), `levels/branch-a.ts` (new: P1's socket
  and component placement + the two shafts' initial attachment edges).
- **Tests** (+45): `machine-graph.test.ts` 12 new propagation/topology cases,
  `validator.test.ts` (20), `component-registry.test.ts` (12), and a shared
  `tests/logic/support/p1-mesh.ts` fixture that assembles the *shipped* content
  exactly as the composition root does.

CHK-5.1 — M4 socket / snap / attach implemented (LMG + snap layer + reachable
`SnapPreview`; see "Completed (M4)").
CHK-4.2/CHK-4.1 — M3 accepted in the browser / implemented.
CHK-3.2/CHK-3.1 — M2 accepted in the browser / implemented.
CHK-2.2/CHK-2.1 — Phase-2 test suite, camera fixes.

## Design Decisions (M5/M6, all documented where they are enforced)
[M6] 0. Design decisions below that touch M4/M5 behaviour are M6 decisions: the
detach path replaces the M4 "attached = disabled" stand-in (which was explicit
about being temporary), the puzzle owns what the validator was designed not to
own (EC-PZ-01), and the port surface generalises from one object to the level's
set. None of these change a system contract or ownership — see "Architecture
Status".

1. **Ports are named connection points on edges, not graph nodes.** §23.1 allows
   `NodeId = ComponentId | SocketId | PortId`; requirements address components and
   sockets and `through` is a *tag* (§24.1), so port nodes would add indirection
   without answering any question the validator asks. Port *data* still decides
   everything: capability, direction, reversal, blocking.
2. **Connections come from declared relations, never from geometry.** The gear's
   mesh is a `MachineLinkDefinition` (§24.3's "declared adjacency"), which is why
   perturbing every pose by ±1 m / ±180° changes nothing (tested).
3. **Links are directional.** A link transmits `from → bridge → to` and nothing
   else. Emitting the reverse would fabricate a connection the machine never
   declared.
4. **Sharing a structure is not a connection.** A frame's ports are `sink`s: it
   accepts a carrier from each part mounted in it and conducts it nowhere.
   Interconnecting them would make every socket of a frame mutually reachable —
   i.e. P1 would validate with nothing installed.
5. **The output end must not be a source.** `DRIVEN_SHAFT_DEF` has no source port,
   otherwise "the output is powered" would be true in an empty machine.
6. **Derived state cannot be read stale.** `MachineGraph.derived` rebuilds when the
   edges have moved; `recomputeIfDirty()` remains the *event* signal for the fixed
   step (and only reports machines whose state really changed).
7. **`primed` and `ordered: true` sequences are typed refusals**
   (`state/unsupported-primed`, `sequence/unsupported-ordered`): both need the
   player's *action history* (BM-1 staged validation, §25), so the validator
   refuses them explicitly rather than silently returning false — a silent false
   is a puzzle that can never complete.
8. **A socket naming a machine with no definition is inert** (M4's lab dock names
   `BM-1`, whose definition arrives with the branch machine): tested, not a crash.

9. [M6] **An occupied socket stops being an insertion target.** §18 ranks socket
   previews above attached components *so a free socket can win a ray*; leaving an
   occupied one focusable would let its stale "Insert" prompt outrank the part in it
   and hide the §19 detach affordance, so the world composition enables sockets only
   while they are free.
10. [M6] **The first puzzle evaluation always runs.** The §33.1 objective line reads
    `reasonCodes`, and "nothing has happened yet" is exactly when the player needs
    them; after that the puzzle stays dirty-driven, so the steady state costs nothing.
11. [M6] **The blanking plate ships in the level but is not required.** Registered
    and mountable (its point is that fitting is not conducting, §21.4), but P1 is
    solvable without it — `checkIntegrity` only demands the required parts.
12. [M6] **Completed is terminal; `reset()` only re-opens the unfinished.** Progress
    is never taken away (EC-PZ-03/04): a later structural change, and a reset on a
    finished puzzle, leave `Complete` untouched, and a reset re-opens the hysteresis
    window rather than resuming it.
13. [M8] **P2 ships one mesh socket, not two "mirror" sockets.** Two sockets would let
    a plain gear and an idler occupy the same train at once, and the derived sense
    would then depend on edge-visit order instead of declared data — exactly the
    hidden coupling §24.3 forbids. A level-global `componentAt`/`not` guard cannot
    close it either: P1's mesh socket is also `gear-mount`, so P1's gear would be
    counted against P2 and P2 would become unsolvable the moment P1 was solved. The
    single socket keeps the puzzle order-independent; §7's mirror-solution obligation
    is carried by P3, which is multi-solution by declared adjacency.
14. [M8] **P3 addresses its outlets with `connected`, not a per-node `output`.** §7
    phrases P3 as `pressure(out1)≥x ∧ pressure(out2)≥y`; the §24.1 `output`
    requirement selects an output by *kind*, so two same-kind outlets are not
    individually addressable and widening the predicate would be a code change M8's
    gate forbids. `connected boiler→outX through 'pipe'` already answers "pressure
    reached this exact outlet" over the same derived edges, so the two outlet
    requirements use it and one `output` floor covers magnitude. No new predicate kind.
15. [M8] **The P3 sockets' `ownerComponentId` is a registered but portless manifold.**
    Routing is declared by the machine's links, so a socket must not also conduct into
    its owner; omitting `ownerPortId` makes the ownership-conduction step a no-op,
    which is why `MANIFOLD_DEF` declares no ports at all.
16. [M8] **The puzzle SM became a set — in composition only.** `PhaseWorld.puzzles`,
    `WorldStepResult.puzzles` and `FeedbackModel` taking per-puzzle updates are wiring:
    the §14 step-8 order, the §25 SM, the §24 validator and the §12.2 ownership table
    are unchanged, and each SM reads the same single authoritative graph. L1 gained no
    awareness of "how many puzzles there are".
17. [M9] **Progression keeps no copy of puzzle state.** §12.2 makes it canonical for
    branch state, hub stage and clues — but branch state and the hub stage are *derived*
    from the completed-puzzle set ("Rebuilt from branch completions", §12.2), which the
    puzzle SMs already own and persist. Storing them too would create a second source of
    truth that a save round-trip could make disagree with itself. The clue seen-id set is
    the only canonical field, and it is the only thing persisted.
18. [M9] **A branch's seal is data, not geometry.** §6 says Branch B and C are "sealed,
    visual" in the MVP. That is expressed as `BranchDefinition.sealed`, so the door's
    slab and `ProgressionSystem` both follow one fact — §26 requires gating to be read
    from branch state and *never* from scene geometry, and a sealed flag is what lets the
    two agree without either reading the other.
19. [M9] **The §25 gating states do not evaluate.** A `Locked`/`Available` puzzle reports
    `satisfied: null` and an empty reason list rather than failing every requirement: a
    puzzle the player cannot touch has no objective line. `reset()` never re-opens a
    gated puzzle (that would walk it straight through its door), and `restore()` keeps the
    gating states across a load because §25 lists every state as "Persisted: yes".
20. [M9] **Boot loads the newest valid save, and nothing is silent about it.** M7 shipped
    the load protocol and its tests but the composition never read a slot, so "persists"
    was unreachable in the running game. The load now runs on boot, logs its repair notes
    via the existing `loadLog`, and re-derives progression from the restored puzzle states.
    A refused save simply leaves a fresh game running (EC-SAVE-05).
21. [M9] **Reaching a clue plate *is* the discovery — no new SM state.** §19's seven
    states cover "what the player's hands are doing"; a read-only plate (§694) is not a
    hand action, and adding an `Inspect` state or a consume path for `prop` would be a
    §19 contract change. So the trigger is the focus edge in the composition: the plate is
    focusable *only because* its branch completed (its `enabled` flag is derived branch
    state), and focusing it records the clue once. It is `contexts: ['Exploration']` so it
    cannot be read while carrying something, and it is a `prop` in §18's priority order so
    it can never steal a ray from a part.
22. [M9] **The pose handover is L2 → L2, and one-way.** Poses belong to the manipulation
    SM (§12.1) and the codec is L1 (R5: persistence only through DTOs), so neither could
    own the other's business: the coordinator — allowed to touch both — passes them across
    after `apply()`, and the *world* decides what to do with them (socket pose for mounted
    parts, saved pose for loose ones, skip the inventory). The codec learned nothing about
    poses and the SM learned nothing about the save format, which is why this closed the
    gap without a schema change.

## Tuning / Content Changes
- `DEFAULT_STABLE_STEPS = 3` (ARCH §24.2) lives in `validator.ts`.
- Derived magnitudes quantise to `1e-3` (`quantise`); `P1_MESH_MACHINE.maxOutput`
  is 1.5, above which the machine reports `overpressure` (§24.1 safety).
- Scanner reveal timing (ARCH §29.3): `DEFAULT_SCANNER_TUNING = { durationSeconds: 6,
  cooldownSeconds: 8 }` in `presentation/scanner-overlay.ts` — a reveal shorter than a
  glance or a cooldown that never bites would be a defect (the floor is pinned by the
  `scanner-overlay` suite).

## Bugs Fixed
1. **Movement inverted vs. the camera (ARCH §16)** — `CameraRig` built the
   target→eye direction as `(-sin, -cos)`. Fixed to `(sin, cos)` (M2 session).
2. **Camera never recovered from occlusion (ARCH §17)** — `occludedDistance =
   min(...)` could only shrink; it now eases back out past a clearance margin.
3. **`interactRange` measured from the camera eye, not the player (M3)** — with a
   4.2 m arm nothing in front of the player was focusable.
4. **A held object resting on the floor could not move at all (found during M4)**
   — the swept-sphere probe's Minkowski expansion put the object's own support
   surface at distance 0 and the skin clamp froze it. Degenerate starting contacts
   now defer to the full-box destination check.
5. **Manipulation camera framing snapped instead of easing (M3)** — now an eased
   `modeBlend`.
6. **A gear's reversal cancelled itself (M5)** — `reverses` was applied to both
   halves of a link edge pair, so an idler gear changed nothing. Now applied once,
   on the way out of the bridge.
7. [M6] **The follow camera, once fallen behind, never re-acquired floor-level
   parts** — a debug-probe symptom, not a game bug: the scripted test walks kept the
   player sliding inside the lab's low step while falling, so focus flickered. Fixed
   in the tests (stable `teleport` vantages + explicit `aimAt` using the published
   tuning), not in `CameraRig`, which was never touched.
8. [M6] **Stale error text**: the `manipulation-system.test.ts` expectation
   `GrabRefused/DetachUnsupported` (the M4 boundary) was replaced by the §19
   `DetachPrompt` rows, and the `setBinding` test seam was removed when the SM went
   multi-carryable (construction-time bindings instead).
9. [M8] **P1's machine geometry was colliders without visuals** — `main.ts` handed the
   renderer only `LAB_WORLD.meshes`, so `P1_WORLD.meshes` (the frame, the bearing
   blocks, both shafts) was never drawn. Found while wiring P2/P3 and fixed there:
   the renderer now receives `[...LAB_WORLD.meshes, ...BRANCH_A_WORLD.meshes]`. This is
   a real defect, not a tidy-up — it was invisible in the M6 screenshot only because
   P1 stands outside the spawn view.
10. [M9] **The game never loaded a save.** `main.ts` constructed the `SaveSystem`,
   autosaved on puzzle completion and logged storage availability, but never called
   `load()` — so the M7 acceptance claim "reload faithful" held only in the headless
   suites, and a player's progress was written every time and read never. Boot now loads
   the newest valid slot.
11. [M9] **A gated puzzle would have come back enterable on load.** `restore()` mapped
   every non-`Complete` state to `InProgress`, which is correct for a mid-assembly save
   (R-6) but wrong for `Locked`/`Available`: loading a save from a gated branch would
   have opened its content. The gating states are now honoured, and `reset()` no longer
   promotes them either.
12. [M9] **A restored save put every loose part back at its spawn anchor** (found as a
   "Known Problems" note during M9 slice 1, fixed in slice 2). The load rebuilt every L1
   owner and the graph edges, but the part *poses* live in the L2 manipulation SM, which
   had no load path — so a save that was written faithfully could not be drawn back.
   Closed by a one-way handover seam (L2 → L2) rather than by letting the L1 codec reach
   into the SM.
13. [M9] **An attached part would have been handed over as loose.** The handover's
   `attached` flag is computed from the graph *after* `apply()` rebuilt it — but the
   handler had to be told to prefer the socket's canonical pose (§21.3) over the saved
   one, because the SM keeps a record (and therefore a physics box) for a mounted part
   too. Leaving it at the saved loose pose would have put a solid box where the part no
   longer was.
14. [M9, found by the CHK-11.1 browser check] **The clue plate was unfocusable in the
   shipped build, so the clue could never be discovered.** Its interaction volume was
   authored proud of the plate in *every* direction, including back — and the plate is
   flush on the Great Regulator's column, which is a static collider, so the volume
   (z = 15.05) crossed the column face (z = 15). §18 discards any interactable whose box
   overlaps a collider, so `InteractionSystem` never offered it. Nothing else about the
   plate looked wrong, and the whole headless suite was green: `clue-plate.test.ts`
   checked a *point* against the colliders, not the box §18 tests. Fixed by stopping the
   volume short of the column face and naming that plane once (`COLUMN_FRONT_Z`);
   covered by a new test that runs the real physics + interaction system, so a regression
   fails a test instead of silently making the clue unreadable in the browser.
15. [M10, found by the CHK-12.4 layout pass] **The §33 HUD stylesheet never applied.**
   `.gw-debug-bad` in `src/style.css` was missing its closing brace, so every rule from
   `.gw-hud` down to the focus line was parsed as a rule *nested inside* `.gw-debug-bad`.
   The browser accepts that (CSS nesting) rather than erroring, so the swallowed rules
   became descendant selectors that can never match: no throw, no build failure, no
   styling. In the browser the HUD's surfaces were unanchored, stacking as full-width
   blocks at the top-left. Fixed by closing the rule; the header comment's claim that it
   was an "appended block only" was the tell.
16. [M10, same pass] **A second unclosed rule swallowed the rest of the HUD.** The
   `.gw-hud-materials, .gw-hud-blueprints` rule was split by a later append: its opening
   block and declarations sat in the resources section while its final `font-size: 12px;`
   and `}` ended up after `.gw-hud .gw-hud-hidden`. Everything between — the hint strip,
   the hint/scanner buttons and all their states, the toast stack, the save note **and the
   `.gw-hud-hidden` rule itself** — was nested inside it and never applied, which is why
   the HUD's conditional lines could not hide. Fixed by closing the rule at its
   declarations and moving the displaced declaration back into it. Both bugs are now
   caught by `tests/boundary/stylesheet-integrity.test.ts`.
17. [M10, found by the CHK-12.7 browser run, root-caused the session after it, fixed in
   CHK-12.8] **A staged press never registered: the composition read the focus *edge* as live
   focus.** `PhaseWorld.step`'s `focus` is a `FocusChanged` edge — emitted only on the step the
   focused target *changes* — but `main.ts`'s step handler read `result.focus?.current` in three
   places: the ADR-018 staged press, the §29.2 hint engagement and the §6 clue discovery. On
   every steady-focus step that value is `null`, so a KeyE press on a priming prop did nothing
   unless it happened to land on the exact acquisition step; BM-1's whole priming/engage half
   was unreachable in play, and a KeyH request while looking at a puzzle was dropped. All three
   now read live `interaction.focus` — the read the HUD render, the hint button and the scanner
   request already used. Guarded by `focus-edge-reads` (a boundary scan of `src/`,
   mutation-verified by reintroducing the read) and pinned by a `phase-world` contract test
   that spells out the difference between the edge and the live read. Same species as Bugs
   10/14/17/18: every suite was green because every *system* was correct — only the
   composition's read was wrong. Browser-verified end to end by the rerun (priming `1/3` →
   `3/3`, `primed — engage to activate`, reward + completion autosave).
18. [M10, found by the *user* in play, fixed in CHK-12.10] **Mouse look stuck to a screen edge,
   and keys silently dead: the game never captured the mouse or took focus.** The look was raw
   `movementX/Y` off a free cursor — workable only until the pointer reached the window edge,
   which is exactly when a third-person view must keep turning — and the page never focused the
   canvas, so a keypress could land on the browser chrome around the canvas and nothing in the
   game would happen (the report: "I typed H and nothing happened"). Fixed at the source: the
   L4 adapter owns a real pointer-lock handshake (report-only, no lifecycle decisions), the
   composition focuses the canvas and requests the capture on the first click — **one refusal
   ends the asking**, because a browser that cannot capture refuses every click (the first
   build of this fix logged eight refusals; caught and fixed in the same session) — and the
   HUD shows a one-shot entry line that names the contract, disappearing on capture and
   switching to an honest no-capture fallback when the browser refuses. Esc keeps its meaning:
   the browser releases the capture, the composition clears stuck input, and Esc-resume
   re-requests it from the resume gesture.

## Architecture Status
READY_FOR_IMPLEMENTATION: YES. M1–M8 followed ARCH §11/§12/§14–§25/§32/§40/§41; M9
slice 1 implemented the §12.2 progression owner, the §25 gating states, §26's derived
branch/hub state and §6's `AccessGate`; slice 2 implemented §6 beats 5/8's clue plate and
§31.5's pose handover. **No ownership or dependency direction changed, and no ADR was
needed for either slice** — the `restorePoses` seam is an *additive L2 dependency*
(`SaveSystemDeps`, not a port or a codec contract), the plate is level geometry plus a
`prop` interaction target, and the discovery trigger is a §31.4 event consumption in the
composition, which is where the architecture already says events are consumed.
The one contract nuance is recorded rather than hidden:
`PuzzleSystem.restore()` now honours `Locked`/`Available` instead of collapsing them to
`InProgress`, which is §25's "Persisted: yes" column being implemented, not amended.
No ownership or dependency direction changed; every port addition is additive and
documented. No ADR was needed: the M6 items above are implementation decisions
*inside* the §19/§25/§32 contracts (see "Design Decisions"), not changes to
ownership, dependency direction or system contracts.
- L1 is engine-free and headless and may not import `ports/`, `gameplay/`,
  `adapters/`, `presentation/`, `levels/` or `three` (machine-checked).
- L1 never imports content: `data/` and `levels/` are assembled into
  `MachineContent` by the composition root (and by the test fixture, which imports
  the same modules the game ships).
- `MachineGraph` owns attachment edges, the derived topology and machine
  functional state; `ComponentRegistry` owns identity/placement; `Validator` is
  pure and owns nothing (§12.2).

## Completed (M6 — Phase 7)
`game-state/puzzle-system.ts`, `gameplay/feedback-model.ts`,
`presentation/feedback-composer.ts`, `data/puzzles/p1.ts`; the SM's reachable
`DetachPrompt` (enter/detach-with-free-space/cancel, prompt stays open when nothing
is free); `PhysicsPort` unchanged; `RenderPort` plural carryable/marker calls plus
pulse; `levels/branch-a.ts` (P1 anchors/sockets/boxes/parts); `main.ts` composes the
shipped `MachineContent`, runs the puzzle + feedback + composer per step.

## Completed (M4 — Phase 5)
`game-state/{component-model,machine-graph,snap-rules}.ts`, `data/{components,
sockets}.ts`, `gameplay/snap-system.ts`, `core/geometry.ts`; the SM's reachable
`SnapPreview` (enter/invalidate/confirm, canonical handoff, rotation absorbed); the
dock marker and `attached` carryable presentation; `PhysicsPort.setSocketVolumes`/
`overlapSocketVolumes`; `RenderPort` socket/carryable additions; `LAB_SOCKETS` and
definition-derived instance boxes in `levels/lab-world.ts`.

## Completed (M3 — Phase 4)
`gameplay/manipulation-system.ts` (the ARCH §19 SM, all seven states), carryables
as capsule-only colliders, live-pose crate presentation, `interactRange` from the
player, eased manipulation framing, context routing.

## Completed (M2 / M1)
`gameplay/interaction-system.ts` (ray, focus stability, LOS, priority, disabled
filter); `core/vec3.ts`, the three ports, `adapters/{kinematic-physics,
dom-input-source,three-renderer}.ts`, `gameplay/{input-system,player-controller,
camera-rig,phase-world}.ts`, `levels/lab-world.ts`, `app.ts` `WorldHooks`,
`main.ts`.

## Completed (M9 — Phase 10, slices 1 + 2)
`game-state/progression-system.ts`; `data/branches.ts` + `data/hub-stages.ts` +
`data/clues.ts`; `levels/hub.ts` (Crucible Hall, the Great Regulator, three branch doors,
the clue plate and its pure `cluePlateActive`/`hubInteractables`/`hubMeshes`/`hubColliders`);
`PuzzleSystem` gating (`Locked`/`Available`, `unlock()`, `begin()`, `isGated`,
gating-aware `reset()`/`restore()`); the codec's `progression` save target + decode
validation; `SaveSystemDeps.progression` + `restorePoses`, `PuzzleSaveTarget.initialState`,
and a `newGame()` that respects §25 start states; `ManipulationSystem.restorePose`;
`main.ts` boot load, hub colliders/meshes, clue targets + the discovery trigger,
stage-driven re-render and the `[hub]`/`[clue]` read-outs.

## Completed (M10 — Phase 12, slices 1 + 2 + 3)
`presentation/hud.ts` (§33.1 surfaces, §33.2 change-only rendering, pooled rows, a11y);
`game-state/hint-system.ts` (§29.1's ladder, §29.2's anti-annoyance rules);
`data/hints.ts` (§29.1's words: level definitions, `CONCEPTUAL_HINTS`, total
`REASON_TEXT`); the save codec's additive optional `hints.levels` block + the
`SaveSystemDeps.hints` seam; and the scanner reveal (CHK-12.2):
`game-state/scanner-reveal.ts` (pure L1 derivation), `presentation/scanner-overlay.ts`
(L4 reveal timing), `RenderPort.setScannerOverlay` + `ScannerOverlayState` (additive
L3, the M6-precedent pattern), the three.js highlight rig + flow-path polyline, and
the composed `main.ts` wiring (`REQUIREMENT_BY_ID`, `requirementText`,
`composeHudScannerState`, `scannerRequest`, `scanner.step(dt)`/`scanner.present()`); and
the §12.2 clue/log surface (CHK-12.3): the `hud.ts` field log plus `main.ts` resolving
`progression.discoveredClueIds` through `data/clues.ts`, and the left column that stacks
it under the objective line.
plus the HUD visual pass's measurable half (CHK-12.4): two missing braces in
`src/style.css` that had left the whole §33 HUD block unapplied, and
`tests/boundary/stylesheet-integrity.test.ts` to keep it that way.
NOT done in M10: audio (ADR-011 — `AudioPort`/`WebAudioBus` are still unwired) and the
aesthetic half of the HUD pass. BM-1 + staged validation are DONE (ADR-018), and Branch
B/C content is post-MVP (§6).

## Files Changed (M9 session)
- Created (slice 1): `src/game-state/progression-system.ts`, `src/data/branches.ts`,
  `src/data/hub-stages.ts`, `src/levels/hub.ts`,
  `tests/logic/{progression-system,hub-access-gate}.test.ts`
- Created (slice 2): `src/data/clues.ts`, `tests/logic/clue-plate.test.ts`
- Edited (slice 1): `src/game-state/puzzle-system.ts` (gating), `src/game-state/save-codec.ts`
  (`progression` target + validation), `src/gameplay/save-system.ts` (`progression` dep,
  `initialState`, New Game start states), `src/main.ts` (progression, boot load, hub),
  `tests/logic/save-load.test.ts` (new dep)
- Edited (slice 2): `src/levels/hub.ts` (the plate, `cluePlateActive`, `hubInteractables`,
  `hubMeshes`' `hasClue`), `src/main.ts` (clue targets + discovery + `restorePoses`),
  `src/gameplay/manipulation-system.ts` (`restorePose`), `src/gameplay/save-system.ts`
  (`RestoredPose` + the `restorePoses` seam), `tests/logic/{hub-access-gate,save-load,
  manipulation-system}.test.ts`
- Untouched (deliberately): `src/game-state/{machine-graph,validator,component-*,
  puzzle-system}.ts`, `src/gameplay/{phase-world,feedback-model,snap-system}.ts`,
  `src/adapters/**`, `src/ports/**`, `src/presentation/**`. Slice 2 added no L1 owner, no
  port and no schema field.

## Files Changed (M9 verification — CHK-11.1)
- Edited: `src/levels/hub.ts` (the fix — the column's front plane named once
  (`COLUMN_FRONT_Z`) and shared; the plate's interaction volume stops short of it),
  `src/main.ts` (dev-only `__gearwrightDev` inspection socket, ARCH §37),
  `tests/logic/clue-plate.test.ts` (+1 — the real physics + the real interaction system
  run against the plate).
- Untouched (deliberately): every system, port, adapter and L1 owner. No state
  ownership, dependency direction or system contract changed; the socket exposes live
  handles and is read by nothing in the game.
- The temporary browser harness (`tmp-browser-check.mjs` and the screenshots it wrote)
  was used to drive and verify the shipped build and is **not** part of the repo or the
  build.

## Completed (M8 — Phase 9)
`data/puzzles/{p2,p3}.ts` + `data/puzzles/index.ts`; `data/components.ts`
(`GEARBOX_FRAME_DEF`, `COUNTER_SHAFT_DEF`, `BOILER_DEF`, `OUTLET_DEF`, `VALVE_DEF`,
`SHUT_OFF_VALVE_DEF`, `MANIFOLD_DEF`); `data/sockets.ts` (P2 crank/output/mesh, P3
valves A/B/C); `data/machines.ts` (`P2_RIGHT_TURN_MACHINE`, `P3_THREE_VALVES_MACHINE`);
`data/rewards.ts` (P2/P3 milestones + `SCANNER_BLUEPRINT`); `levels/branch-a.ts`
(P2/P3 anchors, sockets, parts, structure boxes and the branch aggregates);
`gameplay/{phase-world,feedback-model}.ts` and `main.ts` (the puzzle *set*);
`tests/logic/support/branch-a-content.ts` + `tests/logic/branch-a-solvability.test.ts`.

## Files Changed (M6 session)
- Created: `src/game-state/puzzle-system.ts`, `src/gameplay/feedback-model.ts`,
  `src/presentation/feedback-composer.ts`, `src/data/puzzles/p1.ts`,
  `tests/logic/{puzzle-system,feedback-model,feedback-composer,p1-acceptance}.test.ts`,
  `tests/logic/support/recording-render-port.ts`
- Edited: `src/ports/render-port.ts` (plural `setCarryables`/`setSnapMarkers`,
  presentation-only `spinAngle`, `setFeedbackPulse`), `src/adapters/three-renderer.ts`
  (per-id pooling), `src/gameplay/{manipulation-system,snap-system,phase-world,interaction-system}.ts`
  (detach path, per-id bindings, puzzle+feedback stages, attached-kind sync),
  `src/game-state/component-model.ts` (touch), `src/data/{components,sockets,machines}.ts`,
  `src/levels/{lab-world,branch-a}.ts`, `src/main.ts` (full M6 composition),
  `tests/logic/{manipulation-system,phase-world,component-registry,app}.test.ts`
- Untouched (deliberately): `src/adapters/{kinematic-physics,dom-input-source,browser-events}.ts`,
  `src/app.ts`, `src/debug/**`, `src/core/**`

## Files Changed (CHK-12.10 — Bug 21: pointer capture + keyboard focus)
- Edited: `src/adapters/dom-input-source.ts` (the capture handshake: `lockTarget`, request/
  release, `pointerlockchange`/`pointerlockerror`, `isPointerLocked`, the two report callbacks,
  `documentOf`; no lifecycle decisions in the transport).
- Edited: `src/main.ts` (the composition's policy: canvas `tabIndex`, focus + request on the
  first click, one-refusal-then-stop, capture state read by the HUD through the `entryPointer`
  dep, Esc-resume re-request, lock-loss clears stuck input), `src/presentation/hud.ts`
  (`HudCaptureView` + the one-shot entry line + its markup), `src/style.css` (the entry rule,
  same audited panel alpha as the save note).
- Created: `tests/dom/dom-input-source.test.ts` (6 — the handshake against a stubbed browser:
  grant, native release, refusal, one-report, dispose, no-target no-op).
- Edited: `tests/dom/hud.test.ts` (+4 — the entry line's four states), `tests/boundary/stylesheet-integrity.test.ts`
  (+ the entry selector in the pinned list).
- Repo hygiene: `.gitignore` gains `.tmp-*` and `tmp-browser-check.mjs` (throwaway harness and
  its reports are not part of the repo, as PROJECT_STATE has always said); `git init` + first
  commit — this is the first commit of the project.
- Untouched (deliberately): `InputSystem` (the L2 action map — no new actions, no rebinding),
  every gameplay system, every L1 owner, the save schema, `core/**`, `app.ts` (the lifecycle
  contract already had `focus-loss`; the capture never touches it).

## Files Changed (CHK-12.9 — full-branch browser walkthrough)
- Edited (temporary tooling only): `tmp-browser-check.mjs` (the `level()` probe now reports
  P1/P2/P3 parts + sockets, the hub targets and a `progress()` read; the shared
  `grabPart`/`dockInto` learned multi-direction docking plus an empty-hand re-grab with a
  bounded retry; the new `branch` scenario plays P1 → P2 → P3 → BM-1, the hint check, the
  clue beat and a reload).
- Not part of the repo or the build: the branch run's log and report
  (`.tmp-branch-run3.log`, `.tmp-browser-report-branch.json`).
- Untouched (deliberately): everything in `src/`, every test, the build. No gate moved:
  554/554 tests, typecheck clean, build green (byte-identical — nothing in the bundle moved).

## Files Changed (CHK-12.8 — Bug 20 fixed and browser-verified)
- Edited: `src/main.ts` (the three consumers in the step handler now read live
  `interaction.focus` — the staged press, the hint engagement, the clue discovery — with the
  Bug 20 reasoning in the comments).
- Created: `tests/boundary/focus-edge-reads.test.ts` (2 — no `src/` file may read the focus
  edge's `current` as live state; the composition still reads live focus).
- Edited: `tests/logic/phase-world.test.ts` (+1 and a type import — the edge-vs-live contract:
  the acquisition edge fires once with `previous: null`, the steps after it report no edge
  while `interaction.focus` keeps answering).
- Not part of the repo or the build: `tmp-browser-check.mjs`, `.tmp-bm1-run.log` and
  `.tmp-browser-report-*.json` (the CDP harness and its reports; delete when the browser pass
  that owns them closes).
- Untouched (deliberately): every L1 owner, every port, adapter and presentation module, the
  save schema, the validator, the machine graph, the puzzle SM. No contract changed — the fix
  makes a consumer read the state the way the rest of the composition already did.

## Files Changed (CHK-12.7 — the production-readiness pass)
- Edited: `src/data/branches.ts` (Branch A's `puzzleIds` gain `BM-1` — its final machine, and the
  reason the branch/clue beats land in §6's order), `src/levels/branch-a.ts` (new
  `BM1_INTERACTABLES`, aggregated into `BRANCH_A_INTERACTABLES`), `src/presentation/hud.ts` (the
  manipulation strip hides its keys and socket line while empty-handed), `index.html` (inline
  data-URI icon: no more `favicon.ico` 404 on every boot),
  `tests/logic/{hub-access-gate,hub-visual-facts,progression-system}.test.ts` (the branch-complete
  fixtures now include `BM-1`), `tests/dom/hud.test.ts` (+1 and the empty-handed assertions).
- Created: `tests/logic/shipped-content-integrity.test.ts`.
- Not part of the repo or the build: `tmp-browser-check.mjs` (the CDP harness; delete when the
  browser pass closes).
- Untouched (deliberately): every L1 system, every port, every adapter, the save schema, the
  validator, the machine graph, the puzzle SM.

## Next Exact Action
**0. (23/09/2026, supersedes the list below while it is open) Execute `PLAN.md`** — the
playability / feel / visuals / deployment overhaul written from a full code review (8 phases,
T0.1 → T7.9, branch `overhaul`). Start at the last Progress Log entry's `Next:` line in
`PLAN.md`. Its Phase 1 fixes P0 defects found in that review: E bound to both grab and
rotate-right, remove/drop keys never shown, invisible pause, pointer-lock re-request from an
Esc keypress, released parts floating mid-air.

1. Get the M6 browser check reported (the list in "Human Check Needed"), then mark
   M6 COMPLETE in this file. (M4's list still stands where it overlaps; P2/P3 and the
   hub are now part of that walkthrough's neighbourhood. CHK-12.9 has since measured the
   *behavioural* half of both walkthroughs — every transition, reward, save and boot line —
   so what this item still owns is the *visual* half: the turning gear, the glowing markers,
   the plate's gold→teal in light, and how the chain feels in hand.)
2. **M10 is code-complete** (hint ladder, scanner reveal, field log, HUD layout/geometry,
   audio) — what is left of the milestone is verification-shaped, not buildable:
   the aesthetic half of the HUD pass and an ear on the mix. The record, in order of
   when each landed:
   - ~~**Scanner reveal (§29.3)**~~ **DONE (CHK-12.2)** — the dedicated overlay shipped; see the checkpoint above.
   - ~~**A visual browser pass over the HUD**~~ **DONE as far as measurable (CHK-12.4)** —
     it found and fixed Bugs 15/16 (the HUD stylesheet had never applied); geometry,
     anchoring, stacking, hiding and overlap are verified at four viewports, and guarded
     by a boundary suite. What it cannot report is the *aesthetic* half: palette, density
     and typography at play resolution still want an eye.
   - ~~**Clue/log panel (§33)**~~ **DONE (CHK-12.3)** — the field log shipped; see the
     checkpoint above.
   - ~~**Audio (ADR-011)**~~ **DONE (CHK-12.5)** — the §32.2 bus, the §32.3 synthesised
     cues, pooled voices, the EC-BRN-08 gesture unlock and the silent null object all
     shipped; the composer owns the cue mapping. What it deliberately left out is listed
     in "Known Problems" (music/ambience content, UI-bus cues, a machine-hum loop, and
     any ear on the mix).
   - ~~**BM-1 is playable**~~ **FIXED (CHK-12.7)** — the capstone puzzle was gated `Locked`
     (Bug 17) and its loose parts had no interaction targets (Bug 18); both are fixed and
     guarded by `shipped-content-integrity`, and the assembly half is browser-verified.
   - ~~**BM-1's priming/engage presses are live**~~ **FIXED + BROWSER-VERIFIED (CHK-12.8)** — the
     previous session root-caused Bug 20 (the composition read the focus *edge*
     `result.focus?.current` as live focus in three places — the staged press, the hint
     engagement, the clue discovery — so a press only registered if it landed on the exact
     acquisition step). The fix is applied at all three sites (live `interaction.focus`), the
     rerun records `[staged] bm1/prime-feed recorded — BM-1 priming 1/3` … `3/3`,
     `[staged] BM-1 primed — engage to activate`, `[reward] BM-1:milestone/bm1-pressure-dynamo
     applied` and `[save] autosave written (puzzle-completed trigger)`, and the bug class is
     guarded by `focus-edge-reads` + a `phase-world` contract test. The run plays BM-1 alone,
     so the *branch*-completion consequences are not in it — they stay on the M6/M4 walkthrough
     list below (P1–P3 must be played in the same session).
   - **Then, and only then**: the aesthetic pass that CHK-12.4 could not measure —
     density and type at play resolution (the *palette* half is done: CHK-12.6 audited
     it for WCAG AA and fixed the four failures) — and the M6/M4 walkthroughs below.
3. ~~**BM-1 "Pressure Dynamo"**~~ **DONE (ADR-018, prior session)** — the L1 action
   history, staged validation, schema v2 and the BM-1 content are landed and green.
   The history below is kept for the record of what the ADR promised:
   - **New L1 owner: the player's action history.** Staged validation is *ordered*
     (assembly → priming → activation), and ARCH §24.1's requirement union is
     deliberately a function of the graph, not of what the player did. Draft shape: an
     L1 `action-history.ts` owning a bounded, ordered, id-tagged log (append on the
     §31.4 triggers, `restore()` for saves, `resetAll()` for New Game), fed by the
     composition, read by the validator through a new `ValidationContext` argument —
     never by the validator holding it.
   - **Validator contract addition (additive, in the §41 M8 sense of "no new bespoke
     architecture").** Design Decision 7's two typed refusals become real: `state:
     'primed'` and `sequence: { ordered: true }`. Both take the history as an *input*
     and stay pure (exactly as `previousStreak` does for the stable-frame rule).
   - **The save surface**: the history is a new canonical owner, so it needs a
     `SaveTargets`/codec field — that is a **schema bump to v2 plus a migration step**,
     the first one this project has needed (the version band and the migration chain in
     `SaveCodec.migrate` were built for it). This is the part that most needs sign-off.
   - **Content afterwards**: `data/puzzles/bm1.ts` + `data/machines.ts`'s
     `BM1_PRESSURE_DYNAMO`, the lab dock that already names `BM-1` (Design Decision 8)
     becoming live, and a `levels/` placement. P4 stays cut (ARCH OQ-3).
3. Branch B/C content is post-MVP (§6): their doors are sealed visuals and
   `ProgressionSystem` agrees they are not enterable. Opening one means clearing
   `BranchDefinition.sealed` and adding a dynamic-collider port (see "Known Problems").

## Tests Passing
- logic 451, boundary 18, dom 85 — **554/554 total (43 files)**.
- New (CHK-12.8): `focus-edge-reads` (2 — no `src/` file reads the step result's focus *edge*
  as live focus, mutation-verified by reintroducing Bug 20's read; the composition still reads
  live `interaction.focus`) and `phase-world` (+1 — the edge-vs-live contract: the acquisition
  edge fires once with `previous: null`, every steady step reports no edge while
  `interaction.focus` keeps answering).
- New (CHK-12.7): `shipped-content-integrity` (8 — every shipped puzzle is branch-owned and not
  born `Locked`, Branch A completes only when its final machine has run, every puzzle's milestone
  and machine exist, every required part and placed socket resolves, **every carryable has an
  interaction target**, every target's box is real, and every branch/hub stage names real content;
  mutation-verified against both P0 fixes) and `hud` (+1 — the manipulation strip's keys and
  socket verdict are hidden while empty-handed and come back on the next grab).
- New (CHK-12.6): `hub-visual-facts` (4 — the M9 walkthrough's colour facts pinned as
  data: sealed red slabs on B/C only, the open A doorway unslabbed, teal vs stone posts,
  trunk/bus gold on completion, the column warming with stage, and the plate's
  dark → gold → teal lifecycle driven by the clue set alone) and `hud-contrast`
  (5 — every HUD text token clearing WCAG AA over the panel's worst-case blended
  backdrops, the audited panel alpha pinned structurally, and the token set guarded
  against silent removal; mutation-verified by reverting `--gw-invalid`).
- New (M10 slice 4 — audio, ADR-011): `web-audio-bus` (14 — the bus graph, pooling and the
  capped steal, placement, unlock/refusal/disposal, the silent null object, and every
  authored §32.3 recipe's budget), `feedback-composer` (+5 — cue per intent and where it
  lands, silence for state-only changes, audio-optional, the retrigger window, unresolvable
  anchors), `dom-adapters` (+3 — the EC-BRN-08 gesture binding), `p1-acceptance` (+0 tests,
  new assertions that one intent stream reaches both presentation ports).
- New (M10 visual pass): `stylesheet-integrity` (3 — the stylesheet is flat (no rule
  nested in another), its braces balance, and the HUD's selectors are present; proved by
  mutation to fail when a brace goes missing).
- New (M10 slice 3): `hud` (+3 — the field log: hidden while empty then counting its own
  entries, pooled rows surviving a shrink and a New Game, and a wordless entry hiding its
  text line; 14 → 17).
- New (M10 slice 2): `scanner-reveal` (9 — the derivation shape, its route rules,
  its descent and its shipped-content determinism), `scanner-overlay` (6 — the
  duration/cooldown lifecycle, the text, refusals, bad-frame discipline, the
  defensive copy, the tuning floor), `scanner-integration` (1 — validator →
  derivation → presenter → port, headless) and `hud` (+1 — the
  ready/scanning/cooling states; 13 → 14).
- New (M10 slice 1): `hud` (13 — §33.1 render, pooled rows, toast buffer + lifetimes,
  intents, injection safety), `save-load` (+4 — HintState round-trip, the pre-M10 v2
  file, capture/restore through `deps.hints`, New Game), `input-system` (+2 − the
  hint edge and its held-state refusal).
- New (BM-1 / ADR-018, prior session): `bm1-staged` (the staged validation suite),
  plus the action-history suite — the 469/469 baseline this slice started from.
- New (M6): puzzle-system (6), feedback-model (5), feedback-composer (4), p1-acceptance (3).
- New (M7): reward-idempotency (12 — R-1…R-10 + set invariant + EC-SAVE-10 dual),
  save-load (13 — round-trip, refusal reasons, write protocol, restore, latch),
  storage-local (10 — two-phase protocol, hostile backends).
- New (M8): `branch-a-solvability` (13 — P2 + P3 solvability/validation through the
  shipped content, and the branch's puzzles staying independent on one graph).
- New (M9): `progression-system` (11 — derivation, gating states, clues, persistence),
  `hub-access-gate` (3 — the AccessGate reading branch state, and hub visuals by stage),
  `clue-plate` (8 — one plate per clue, activation by branch completion, the read state,
  the reach arithmetic, that reading a clue cannot gate a door, and — added by CHK-11.1 —
  that the plate is actually focusable through the *real* physics and interaction system
  rather than merely un-blocked at its centre point).
- Updated for M10 slice 1: `save-load` (25 — the `hints` seam beside `actions`),
  `input-system` (22 — the `hint` action in `InputActions`/`DEFAULT_BINDINGS`),
  `hud` is the suite `presentation/hud.ts` never had.
- Updated for M9 slice 2: `manipulation-system` (+2 — `restorePose` and its refusals),
  `save-load` (+3 — the pose handover, its ordering, and its refusal path),
  `hub-access-gate` (the `hubMeshes` third argument; behaviour unchanged).
- Updated for M8 semantics: `feedback-model` (5 — the step input is the puzzle *set*),
  `p1-acceptance` (3 — composes `puzzles: [puzzle]`, still reading `result.puzzles[0]`).
- Updated for M9 semantics: `save-load` (16 — the new `progression` save target).
- `npm run typecheck` clean (strict + exactOptionalPropertyTypes +
  noUncheckedIndexedAccess + verbatimModuleSyntax).
- `npm run build` green: 703.43 KB JS / 183.92 KB gzip (CHK-12.7: +0.14 KB JS — the HUD strip's
  hide rule and the inline icon are the only production deltas).

## Human Check Needed
**The pointer-lock *grant* needs one real click (CHK-12.10, new).** Headless Chrome has no valid
root document to capture, so the browser check could only prove the *refusal* path
(`WrongDocumentError` reported once, toast, fallback line) — the grant itself is a browser-only
judgement. `npm run dev`, then: the entry line is up at boot; click the game view → the cursor
disappears, the line goes, the mouse turns the camera **through and past the window edge**, and
W/A/S/D + E/Q/R/H answer without any extra click; press Esc → the mouse is released and the game
pauses; press Esc again → play resumes *with* the capture (no second click needed); and if a
browser refuses the capture (sandboxed iframe, hardened settings), exactly **one** toast and one
consoles line appear and the fallback entry line stays — look and keys must still work.

**M10's audio needs an ear (CHK-12.5, new).** The bus, the unlock and the cue path are
browser-verified — but *how it sounds* is a judgement a console cannot make. `npm run dev`,
then: attach the P1 gear (a click, and a low confirm tone as the machine starts); complete
P1 (the weighted completion recipe, ≤1.5 s, which must not delay input); try the near-miss
plate (a refusal, not a success sound); detach (the click heard from the other side); and
check the balance — machine cues from across the lab must sit under the player's own
actions, and nothing may be loud enough to make the scanner or hint affordances feel
silent by comparison. Also worth one deliberate check: **mute the tab or start in a browser
that refuses audio** — the game must be fully playable with no sound and no error spam
(EC-BRN-08), and `[audio] unavailable … — running silent` must be the only trace.

**M9's browser check is now largely automated (CHK-11.1), and its *colour facts* are
pinned as data (CHK-12.6, `hub-visual-facts`), so the eye's job is judging, not
verifying facts.** CHK-11.1 verified items 1, 5 and 6 end-to-end in headless Chromium,
verified item 2's *blocking* by walking the player into the slabs and measuring where he
stopped, and verified the logs item 4 promises (the stage/plate-awake consequences);
CHK-12.6 pinned the authored state→colour mapping itself (sealed red slabs on B/C only,
trunk/bus gold on completion, column warming, plate dark → gold → teal). What remains
for the walkthrough is how those colours *read on screen* — tone mapping, lighting and
fog at play resolution — and loose parts *visibly* back where they were left. For the M10
scanner (CHK-12.2): play P2 in the shipped build, grant the blueprint, and scan P3/BM-1
with a failed requirement — the highlight rig, the flow path and the HUD line should
agree with the objective line, then fade and recharge. For the M10 **field log**
(CHK-12.3, whose wiring is already browser-verified): it must be **absent** before the
plate is read and appear under the objective line the moment it is (`Field log —
1 entry`, carrying the plate's words) together with a `Clue recorded: …` toast, and it
must come back from the save on the next boot. **The HUD's geometry is no longer part of
this list**: CHK-12.4 measured its anchoring, stacking, hiding and overlap at four
viewports and fixed the two missing braces that had left the whole §33 block unapplied
(Bugs 15/16) — and **the HUD's palette is no longer part of this list either**:
CHK-12.6 audited every text token for WCAG AA over the panel's worst-case backdrops and
fixed the four failures it found (panel alpha 0.72 → 0.86, `--gw-invalid` and
`--gw-unpowered` brightened, the save note pill-backed), so what remains for an eye is
how it *feels* (density, type at play resolution), not whether it can be read.
`npm run dev`,
then:
1. Read the console: `[save] starting fresh (…): no valid save in either slot` on a first
   run, `[hub] stage 0 (Dormant); branch-a=Available (open), branch-b=Locked (sealed),
   branch-c=Locked (sealed)`, and `[clue] 0/1 clue(s) discovered`.
2. Walk **+Z** past the lab (the hub is at `z ≈ +15`): the Great Regulator with three
   doors on the north wall — A open, B and C with red slabs. Walking into B/C's slab must
   be blocked.
3. The plate on the Regulator's column is **dark** and must produce **no prompt**: it is
   not focusable until Branch A completes (the enabled state is branch state, not
   geometry).
4. Complete P1, P2, P3 **and BM-1** (CHK-12.7 put the dynamo back into Branch A: it is the
   branch's final machine, so the branch — and therefore the plate — completes on the
   *fourth* completion, not the third). On that completion the console must log
   `[progression] hub stage -> stage/pressure-online`, a branch-complete line, **and
   `[clue] plate awake: clue/regulator-plate …`**, the trunk lines/bus must light gold with
   the Regulator column warming, and the plate must light **gold**.
5. Walk up to that plate: focusing it must log `[clue] discovered …` and the plate text,
   then `[save] autosave written`, and the plate must turn **teal** (read). No key press is
   needed to read it, and it stays readable afterwards. The HUD's **field log** must
   appear beneath the objective line at that same moment — `Field log — 1 entry` with the
   plate's words — plus a `Clue recorded: …` toast; before this step it must be absent.
6. Reload the page: it should log `[save] loaded autosave …` and `[save] placed N part
   pose(s)`, plus `[clue] 1/1 clue(s) discovered: clue/regulator-plate`. P1–P3 must stay
   Complete and the hub must still show Pressure Line Online and the plate teal (M9's
   "persists"). The **field log** must come back with the clue (`Field log — 1 entry`),
   since it reads the same restored set. **Loose parts must come back where you left
   them** — that is the pose handover; anything back at its spawn anchor is a defect now,
   not a known gap.

**M8 needs none** — ARCH §41 M8's acceptance is "three puzzles incl. multi-solution;
no new bespoke architecture", and both halves are automated: `branch-a-solvability`
proves every accepted routing and the refusals headlessly, and the diff proves the
gate (P2/P3 touched no L1/L2 system). The M4/M6 walkthrough below is still the one
that must be reported; P2 now stands at `x = +8` and P3 at `z ≈ -14`, so they are
worth an eyeball while it happens.

**M5 needs none** — its acceptance criteria are the automated ones above.

**M6's browser check is outstanding** (this is what makes M6 COMPLETE: the P1 chain
played for real). `npm run dev`, the build opens at the lab spawn; the P1 machine
stands out at `x = -8` (frame with two shafts out front, gear and plate on the floor
in front of it):
1. Walk to the gear, grab it, carry it to the machine: the mesh-socket marker tints
   **preview** and the gear eases in.
2. Confirm → the gear seats exactly, the marker goes **occupied**, and (after ~3
   frames of holding) the gear visibly starts **turning** and the socket marker glows.
3. Detach: focus the mounted gear (verb **Remove**), hold **R** → it comes out to a
   free pose, the machine stops, the marker goes **available**.
4. The plate: seat *it* instead — it fits, but the machine never runs and there is
   no completion; `R` takes it back out.
5. M4's list still stands where it overlaps (crate grab/carry/dock, M3/M2/M1
   regression: drop/cancel, targeting, movement, camera).

CHK-12.8 has since verified BM-1's assembly *and* press halves automatically in the shipped
build (headless Chrome: assemble → `priming 1/3–3/3` → `primed — engage to activate` → reward +
completion autosave), so what this walkthrough still owns is how that chain **feels and looks**
in P1's machine, plus the M4 items below.

Screenshot review 2026-09-21: the supplied browser image verifies boot/render only —
60 fps, `running`, lab spawn view, crate ahead, one socket marker, dev perf overlay,
and no HUD yet. All of that matches M6 expectations. The P1 machine is outside the
initial camera view, as expected at `x = -8`, so this does **not** replace items 1–5.

**M4's browser check is still outstanding** (reported pending when M5 was
authorised). `npm run dev`, spawn `(0, 0.01, -6)` facing -Z, crate 1 m ahead, dock
at the near-left corner of the low step:
1. Grab the crate — it must **rise into your hands** (until the M4 fix it could
   not leave the floor at all).
2. Carry it to the dock: the dock marker tints **preview** and the crate eases in.
3. LMB while the preview is up → attaches exactly, marker goes **occupied**, normal
   speed returns.
4. E does nothing on the docked crate, and it never moves again (walk away/back).
5. Rotate before confirming → the committed orientation is still the dock's.
6. Carry it into the tall block → it slides, refuses or relocates, never clips.
7. M3/M2/M1 regression: drop/cancel, targeting, movement, camera.

## Known Problems
- ~~**[last session — Bug 20 (P0)] Staged presses could never register: the composition
  read the focus *edge* as live focus.**~~ **CLOSED in CHK-12.8.** `PhaseWorld.step`
  returns `result.focus` as `FocusChanged | null` — an edge that fires only on the fixed
  step the focused target *changes* — and three consumers in `src/main.ts`'s step handler
  read `result.focus?.current` as the player's focus: the ADR-018 staged press, the §29.2
  hint engagement and the §6 clue discovery. A press was therefore dead unless it landed on
  the exact acquisition step, which is why BM-1's priming/engage half was unreachable in
  play while every suite stayed green (same species as Bugs 10/14/17/18). All three now
  read live `interaction.focus`, the rerun registers the whole press sequence and completes
  the dynamo, and `tests/boundary/focus-edge-reads.test.ts` fails the build if any `src/`
  file reads the edge's `current` as live state again (mutation-verified by reintroducing
  the bug). The hint path benefits silently: a KeyH request while *steadily* looking at a
  puzzle now escalates instead of being dropped.
- jsdom@30 EBADENGINE warning on Node 22.15.0 — benign.
- **[new, CHK-12.7] `lookSensitivity` is a binding that does nothing.** `InputBindings` declares
  it (default 300, "screen pixels of mouse travel mapped to one look unit") and the tests assert
  only that the snapshot echoes it; `InputSystem.clampedLook` never divides by it, so the real
  mapping is the camera's `yawSpeed`/`pitchSpeed` × the fixed step. It is a settings-menu
  placeholder (ADR-014/§33.1's settings surface is post-MVP). Either wire it into `clampedLook`
  (a feel change, so it wants a playtest) or drop the field; today it is a knob that lies.
- **[new, CHK-12.7] The browser harness is temporary and currently lives in the repo.**
  `tmp-browser-check.mjs` (plus `.tmp-*-run.log` / `.tmp-browser-report-*.json`) is tooling, not
  shipped code: it is not imported by `src`, not in the build, and must be deleted when the
  browser pass that owns it finishes, exactly as CHK-11.1 did with its harness. CHK-12.9 grew
  it a `branch` scenario (the full playthrough plus the reload) — same status: delete with the
  pass it serves.
- **[new, CHK-12.10] The pointer-lock grant path is not measurable headlessly.** Headless
  Chrome refuses `requestPointerLock()` with `WrongDocumentError`, so the browser check proves
  the refusal/fallback half and the composition wiring, not the grant. The grant (cursor
  hidden, look crossing the window edge, Esc release, Esc-resume recapture) is on the
  Human Check list. If a future headless driver reports a valid root document, promote it to
  the harness.
- **[new, CHK-12.10] `lookSensitivity` still does nothing** (the CHK-12.7 note stands): the
  binding is declared and echoed, `clampedLook` never divides by it. Pointer lock makes the
  omission *less* visible (raw deltas dominate), but the knob still lies; wiring it is a feel
  change that wants the same playtest this fix does.
- **[new, CHK-12.9] The browser harness is occasionally slower than its own patience.**
  Teleport-hopping can outrun a carried part (EC-MAN-07 drops it — the scenario now re-grabs
  with a bounded retry, exactly as a player would), and the headless page sometimes pauses
  rAF for a stretch (JS alive, frames frozen, then it resumes) while the harness waits on a
  frame — a stuck run is killed by hand, never worked around in the game. Both are tooling
  properties, not game defects: the runs either side of the pause agreed with each other.
- ~~**[new, CHK-12.7] BM-1's priming props were never pressed in a real browser.**~~ **CLOSED
  in CHK-12.8**: the rerun records all three priming presses (`1/3` → `3/3`), `[staged] BM-1
  primed — engage to activate`, `[reward] BM-1:milestone/bm1-pressure-dynamo applied` and
  `[save] autosave written (puzzle-completed trigger)`. The branch-completion consequences (hub
  stage advance, `[clue] plate awake`) need P1–P3 played in the same session and remain on the
  M6/M9 walkthrough list.
- **[M10, new] The audio mix is unaudited.** The recipes are authored to §32.3's
descriptions (a dry 60–120 ms click, a low confirm tone, a ≤1.5 s completion), but nobody
has *heard* them together: relative levels, the panner's falloff in a 30 m hall and the
  0.06 s retrigger window are all first-guess numbers. Treat the mix as owed, not done.
- **[M10, new, CHK-12.6] The HUD's colours were failing WCAG AA where it matters.** The
  panel at its shipped alpha left `--gw-muted` at 4.08:1 over the lab's lightest
  surface, `--gw-complete` on the unbacked save note measured ≈1.2:1 against the step or
  the red test block, and `--gw-invalid`/`--gw-unpowered` failed at 12px even over a
  fixed panel. All four are fixed (panel/save-note alpha 0.86, two tokens brightened,
  the note pill-backed) and `tests/boundary/hud-contrast.test.ts` now fails a
  regressive token or alpha edit — the stylesheet-integrity pattern applied to
  readability. If a future aesthetic pass deliberately re-authors the palette, it must
  re-run that audit in the same commit rather than weaken it.
- **[M10, new] Audio is deliberately narrower than §32.2's table.** `music` and `ambience`
  are built and wired but nothing drives them (§32.2 permits "minimal or none" for music);
  machine hum is a one-shot spin-up/spin-down rather than a looped emitter that follows the
  derived running state; and the `ui` bus has no cues, so the hint/scanner/toast affordances
  are still silent. Each of those is an additive call on the port, not a redesign.
- **[M10, new] Cue recipes are synthesis, not assets.** §32.4 rule 4 wants recipes in
  `data/feedback.ts`; the table is exported from the adapter instead (no `data/feedback.ts`
  exists — the same co-location the M6 composer already uses for its tuning). Mechanical to
  move if a second consumer appears.
- **[M10, new] One step of latency in the attach confirm.** The manipulation SM enters
  `SnapPreview` one step *after* `SnapSystem` publishes the candidate (§14's order), so a
  click that lands in that single frame is consumed by the wrong state and does nothing. A
  player holding the button never notices (the harness needed a retry to land a
  frame-accurate synthetic click); if it ever becomes worth removing, it is a one-step
  carry of the candidate, which would change §14's documented order.
- **CSS has no compile step, so a malformed rule fails nothing.** Browsers now accept CSS
  nesting, which turned two missing braces into silently-unapplied rules for the whole of
  M10 (Bugs 15/16). `tests/boundary/stylesheet-integrity.test.ts` now enforces a flat,
  balanced stylesheet so the same mistake fails a test; it is also the reason
  `src/style.css` must stay nesting-free.
- ~~**[M9] A loaded save restores everything L1 but not loose-part *poses*.**~~ **CLOSED
  in CHK-10.2** via `ManipulationSystem.restorePose` + the `SaveSystemDeps.restorePoses`
  seam. The fixed version also handles the half the note had not noticed: an *attached*
  part's SM record still drives its physics box, so the handover hands those over at
  their **socket's** pose rather than leaving a collider at the spawn anchor.
- **[M9] The AccessGate is evaluated once, after the load.** In the MVP that is
  sufficient and provably stable — Branch A is always `Available`/`Complete` (never
  `Locked`) and B/C are sealed forever — so no door ever needs to open mid-session.
  When Branch B's content lands, a door that opens during play will need a
  dynamic-collider addition to `PhysicsPort`; that is a documented, additive port change,
  not an architecture change (the M6 precedent).
- ~~**[M9] Nothing discovers a clue yet.**~~ **CLOSED in CHK-10.2**: `data/clues.ts` + the
  plate on the Great Regulator + the step's discovery trigger; the clue set is no longer
  always empty in play, and its discovery autosaves.
- ~~**[M9] The clue has no UI surface.**~~ **CLOSED in CHK-12.3**: `presentation/hud.ts`
  gained the §12.2 field log (pooled rows, change-only writes, hidden until something is
  discovered) and `main.ts` resolves `ProgressionSystem.discoveredClueIds` through
  `data/clues.ts` into it — the story beat is now readable in the game, not only in the
  console (which stays), and the plate still changes colour.
- `main.ts` present-hook re-snapshots the player every frame; fine at this scale.
- Detached parts relocate to the nearest *valid* pose, which is usually lifted
  above the mount rather than resting on the floor (the EC-MAN-01 search lifts
  first). Correct and reachable, but visually they hang in the air until re-grabbed.
- Only the P1 parts, shafts and frame are physical; the other lab props are render
  boxes (unchanged from M4).
- The rig's max pitch (31°) limits aiming at the floor to ~2.2 m ahead of the
  player (a camera-tuning change, not a logic change).
- `MachineDefinition.maxOutput` is authored per machine; `overpressure` is
  reported as a warning + safety condition, not as damage (hazards are M7+).
(Superseded: the M4/M5-era "Next Exact Action" list that used to sit here is spent — M5,
M6, M7, M8 and M9 slice 1 are all complete. There is one Next Exact Action, above.)

## Do Not Do Yet
- Do NOT implement hazards, upgrades or the quality tiers — M10's buildable scope is
  **complete** (BM-1, the HUD/hint ladder, the scanner overlay, the clue/log surface, the
  HUD's layout and the ADR-011 audio bus). What remains of the milestone is an aesthetic
  HUD pass and an ear on the mix. The hint ladder must never touch puzzle state (§29.2's
  independent-owner rule).
- Do NOT let anything read audio state as gameplay input, and do NOT make a cue the only
  signal for a mechanical event (§32.4 rules 1/2). L1/L2 must never import the adapter:
  the composer talks to `AudioPort`, and the composition passes the instance.
- Do NOT introduce CSS nesting or `@`-rules in `src/style.css` without updating
  `tests/boundary/stylesheet-integrity.test.ts` — the suite deliberately asserts a *flat*
  stylesheet, because that is what makes a missing brace a failing test instead of a
  silently unapplied rule.
- Do NOT re-author an HUD text token or the panel alphas without re-running
  `tests/boundary/hud-contrast.test.ts` in the same change — the audit computes WCAG AA
  against the panel's worst-case *blended* backdrops (the lab step, a teal carryable),
  so a darker hex or a lower alpha that looks fine over the graphite floor still fails
  in play. A deliberate aesthetic re-palette updates the audit's expectations in the
  same commit; it never deletes them.
- ~~Do NOT begin BM-1 / staged validation without an explicit command and an ADR~~ —
  **spent**: ADR-018 is decided, documented in §43, and implemented (schema v2 live).
- Do NOT give Branch B/C content or open their doors without a command — §6 seals them
  for the MVP, and `BRANCH_DEFINITIONS` is where that changes.
- Do NOT add a dynamic-collider port while B/C are sealed: the gate's answer is stable
  within a session today, so it is not yet needed (see `levels/hub.ts`).
- Do NOT silently change architecture, state ownership, dependency direction, or
  system contracts — stop, document it (as done in "Design Decisions"), and
  add/amend an ADR first.
