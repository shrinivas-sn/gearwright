# GEARWRIGHT — Test Suite Plan

**Version:** 0.1 (Phase 0) · **Companion:** `GAME_ARCHITECTURE.md` (section refs as `ARCH §n`)
Edge cases are catalogued once in `GAME_ARCHITECTURE.md §39` with IDs `EC-<CAT>-nn`; this plan references those IDs instead of repeating scenarios.

## 1. Testing Goals

1. Prove the **system boundaries** are safe: input↔manipulation↔physics↔snap↔LMG↔validation↔rewards↔save (the highest-risk seams, ARCH §9).
2. Guarantee **P0 invariants**: no lost required components, no corrupt saves, no duplicate major rewards, no impossible puzzles, no permanently stuck player.
3. Prove **transform-independence**: machine logic passes tests with perturbed physical transforms (ARCH §24).
4. Make every puzzle provably solvable headlessly (solver-simulation tests).
5. Keep tests fast and runnable on an 8 GB machine (no browser required for layers 1–6 below).

**Priority model:** P0 = blocks play or corrupts progression · P1 = major gameplay degradation · P2 = visual/UX. P0 coverage lands first, in the phase that introduces the system.

## 2. Testing Layers

| # | Layer | Runs in | Tooling | Phase introduced |
|---|---|---|---|---|
| 1 | Unit (pure logic: LMG, validation, progression, inventory, save codec) | Node | Vitest | 6–8 |
| 2 | Integration (2+ systems, e.g. snap→LMG→validation) | Node | Vitest | 6–7 |
| 3 | State-machine tests (manipulation SM, puzzle SM — transition tables driven from data) | Node | Vitest | 4, 7 |
| 4 | System-boundary tests (the 8 seams from §1) | Node | Vitest + test doubles | 7–8 |
| 5 | Save/load & corruption tests | Node | Vitest, fake storage | 8 |
| 6 | Puzzle-validation & solvability tests | Node | Vitest + scenario builder | 7, 9 |
| 7 | Performance tests (frame-time asserts, budgets ARCH §36) | Browser | headless Chromium + perf marks | 13 |
| 8 | Browser lifecycle tests (visibility, blur, context loss) | Browser (semi-automated) + manual checklist | 8, 13 |
| 9 | Manual gameplay tests (scripted playtest sheets) | Browser | checklist | each phase gate |

Layers 1–6 must stay headless: game-rule modules never import `three` or DOM APIs (ARCH §11 rule R3); rendering/physics adapters sit behind interfaces so tests substitute fakes.

## 3. Testability Requirements (architecture must expose)

- **Deterministic clock:** all logic consumes `dt` from the fixed-step simulation (ARCH §14); tests drive the stepper directly.
- **Seedable RNG:** single `Rng` service injected; tests pass fixed seeds.
- **Headless core:** LMG, validation, puzzle, progression, inventory, save codec are pure TS modules (no three.js imports).
- **Scenario builder API:** `buildScenario(def)` constructs world state from puzzle definitions for integration tests without rendering.
- **Ports for side effects:** physics, rendering, audio, storage behind narrow interfaces; tests use fakes/mocks.
- **Event tap:** the typed domain-event emitter (ARCH §11 R4) supports subscribing in tests to assert exact event sequences (e.g. reward fired exactly once).
- **Canonical save round-trip:** `decode(encode(state)) === state` property-style tests + fixture files under version control.

## 4. Core Logic Tests (layer 1 — all P0)

| Area | Representative cases |
|---|---|
| Machine connectivity (LMG) | attach creates edge; detach removes it; propagation reaches output only through valid path; cycle in gear chain detected & flagged, no crash; orphan component not powered; reconnect after detach restores state |
| Component compatibility | tag match/mismatch; port direction in/out enforced; occupied socket rejected; mass-class limits respected |
| Puzzle validation | exact-match config passes; **alternative valid config passes** (P3's 3 solutions); near-miss fails with correct reason code; validation ignores transform noise (±ε positions/rotations); staged machine (BM-1) requires stages in any allowed order; completion latch fires once |
| Progression | unlock rules evaluate from canonical state only; branch completion sets hub stage; re-completing does not double-unlock |
| Inventory | add/remove counts; unique part instance registry cannot duplicate; insufficient materials rejected |
| Rewards | every reward has unique `grantId`; granting same `grantId` twice is a no-op (see §10) |
| Upgrades (framework) | modifier pipeline order (base→add→mult→clamp); unknown upgrade id rejected |
| Save codec | round-trip equality; schema v1 fixtures decode; unknown fields tolerated; wrong version → migration or clean error |
| Migrations | v(n)→v(n+1) chain preserves progression; migration of fixture saves produces expected canonical state |

## 5. Interaction Tests (layers 2–4)

- Targeting selects highest-priority interactable under the reticle; **never through walls** (LOS blocked by static collider) — P0 (EC-INT-01).
- Range boundary: target at `maxRange + ε` is not selectable; prompt hides.
- Priority rules: socket preview outranks loose component; disabled interactable never focused.
- Focus change fires exactly one `FocusChanged` event per change (no per-frame spam).
- Input-context switch (Exploration→Manipulation→UI) routes actions correctly; no leaked movement input while in UI.
- Stuck-key recovery: simulated blur clears all held actions (EC-BRN-05).

## 6. Manipulation Tests (layers 3–4 — state-machine driven)

Transition-table tests enumerate the manipulation SM (ARCH §19): every legal transition succeeds, every illegal transition is rejected, guards verified (`hasTarget`, `inRange`, `socketFree`, `massWithinCapability`).

Scenario tests (fakes for physics/render):

| Case | Expectation | EC ref |
|---|---|---|
| Grab → move → release on floor | object rests at clamped valid position | — |
| Release intersecting geometry | depenetration to nearest valid pose (search ≤ 0.5 m) | EC-MAN-01 |
| Release while overlapping machine | rejected → return-to-hold, never embedded | EC-MAN-11 |
| Walk beyond hold range | soft-detach at last valid pose OR auto-return per config | EC-MAN-07 |
| Leave puzzle area holding required part | boundary volume triggers carry-back or part recall | EC-MAN-08 |
| Grab at 10 FPS (dt spikes) | identical end state as 60 FPS (fixed-step determinism) | EC-MAN-12 |
| Cancel during rotation | restores pre-grab pose, no event leaks | EC-MAN-05 |
| Two rapid grabs | second ignored until first completes (atomic transitions) | EC-MAN-13 |
## 7. Snap System Tests (layers 2–4 — highest-risk boundary)
| Case | Expectation | EC ref |
|---|---|---|
| Compatible component enters socket volume | preview appears (`SnapPreview` state), highlight + audio cue | — |
| Incompatible component enters socket volume | invalid feedback; no preview; confirm rejected with reason code | EC-SNAP-05 |
| Component overlaps **two** snap zones | deterministic winner: nearest socket center, tie → lowest socket id; never both | EC-SNAP-01 |
| Two components compete for **one** socket | first-come ownership; second gets `Occupied` reason; no double-attach | EC-SNAP-02 |
| Socket already occupied → attach attempt | rejected; LMG unchanged; no duplicate edge | EC-SNAP-06 |
| Rotate while inside snap volume | preview re-evaluates per fixed step; final attach pose = socket pose exactly | EC-SNAP-03 |
| Socket becomes invalid during attach sequence | attach aborted atomically → object returned to hold; no half-state | EC-SNAP-04 |
| Rapid attach → detach → attach (same frame burst) | final LMG state matches last confirmed command; exactly one edge | EC-SNAP-07 |
| Attach at 10 FPS | same resulting LMG graph as 60 FPS (fixed-step) | EC-MAN-12 |
| Detach with no free space for object | detach still succeeds logically; object placed at nearest valid pose, never inside geometry | EC-MAN-01 |
| Preview visual disabled/quality=Low | LMG attach result **identical** (proves render independence) | — |

**P0 assertion:** attach/detach outcomes are computed by `SnapRules` + `MachineGraph`, never read from rendering or raw physics values.

## 8. Physics Boundary Tests (layer 2–4)

- **Determinism:** identical command script at dt = 1/30 fixed step yields byte-identical canonical state (positions rounded to canonical precision) across runs and frame-rate patterns.
- **Tunneling:** object swept at max carry speed vs thin wall (0.1 m) → never passes through (EC-PHY-02).
- **Extreme delta time:** dt = 2 s injected once → simulation clamped to max substeps; state remains finite, no NaN (EC-PHY-01).
- **Tab backgrounded:** `visibilitychange` → loop pauses; on return, no unbounded catch-up (substep cap), no teleport (EC-BRN-04).
- **Sleeping:** sleeping body wakes correctly on player interaction or socket proximity; never sleeps mid-hold (EC-PHY-03).
- **Stacking:** 5 stacked carryable boxes at 10 FPS → no explosion (velocity clamp + max penetration resolution per step).
- **Velocity clamp:** object released with accumulated speed above cap → capped, no wall penetration.
- **NaN/infinity guard:** malformed transform injected → sanitizer resets to last valid pose + logs (EC-PHY-06).
- **Out-of-world:** object below floor / outside bounds → recovery volume returns to safe pose (EC-MAN-09, EC-MAN-10).
- **Port substitution:** entire test suite for interaction/manipulation passes with a `FakePhysicsPort` — proves L1/L2 never depend on a solver (ARCH §11 rule R4).

## 9. Puzzle State Tests (layers 3–4)

- State machine (ARCH §25) transition table: `Locked→Available→InProgress→Assembled→Validated→Activated→Complete`, plus `InProgress→Reset`, `Validated→InProgress` (partial break), `any→Reset`.
- Completion latch: `Validated→Activated` fires `PuzzleCompleted` exactly once even if validator keeps returning true for 100 frames (EC-PZ-02).
- Transient validity: valid configuration held for one frame then broken → does **not** complete (hysteresis / stable-frame requirement) (EC-PZ-01).
- Machine invalidated after completion → puzzle stays `Complete` (progress is never reverted) (EC-PZ-03).
- Out-of-order solving: player assembles step 3 before step 1 → puzzle completes when the full required graph is satisfied (no sequence enforcement unless defined) (EC-PZ-06).
- Partially completed before tutorial trigger → tutorial marks as already-done, never re-shows or blocks (EC-PZ-07).
- Unexpected-but-valid configuration (required part used in an alternative legal socket) → completes if predicates hold (EC-PZ-08).
- Reset after reward → puzzle returns to `InProgress`, **reward is NOT re-granted** (EC-PZ-04).
- BM-1 staged validation: priming steps in any allowed order pass; disallowed order fails with reason code.

## 10. Reward Idempotency Tests (layer 5 — P0, corruption-class)

**Mechanism under test:** `RewardLedger` grants against a unique `grantId` derived from `(puzzleId, milestone)`; grants are recorded in the canonical save and checked before application (ARCH §24, §27).

| # | Scenario | Expectation | Priority |
|---|---|---|---|
| R-1 | `grant(grantId)` called once | applied once; ledger holds 1 entry | P0 |
| R-2 | Same `grantId` called 100× | applied once; **0** further inventory/blueprint changes | P0 |
| R-3 | Duplicate `PuzzleCompleted` events (validator true ×100 steps) | exactly one grant; exactly one completion feedback | P0 |
| R-4 | Complete → save → reload → completion re-evaluates true | ledger blocks re-grant (persisted) | P0 |
| R-5 | Complete → reset puzzle → complete again | no second grant (milestone id already spent) | P0 |
| R-6 | Reward applied then crash before save | reload from last checkpoint → replay grants once, no duplication | P0 |
| R-7 | Two puzzles granting the same material | counts add correctly (distinct grantIds) | P1 |
| R-8 | Blueprint unlock applied twice | set semantics — one unlock, no duplicate entry | P0 |
| R-9 | Reward references removed/renamed content id | grant skipped, warning logged, no crash, progression preserved | P1 |
| R-10 | Save has `rewardsGranted` but puzzle state missing | ledger authoritative for grants; puzzle state repaired to `Complete` (EC-SAVE-09) | P0 |

**Invariant (property test):** for any sequence of duplicated events, inventory and blueprints are functions of the *set* of granted ids, not the *count* of events.

## 11. Save/Load Tests (layer 5)

- **Round-trip:** `decode(encode(state))` deep-equals `state` for canonical fixtures (every MVP progression stage, mid-puzzle and complete-branch included).
- **Version handling:** v1 fixture decodes; unknown future version → `SaveVersionUnsupported` (no silent partial load); migration chain v(n)→v(n+1)→… tested per migration with before/after fixtures.
- **Malformed data:** truncated JSON, wrong types, `null` required fields, NaN/Infinity poses → rejected safely with reason code; recovery offered (EC-SAVE-05).
- **Missing referenced object:** save references a removed component/socket id → reported; that machine's puzzle resets to `InProgress`; the rest of progression survives (EC-SAVE-06).
- **Duplicate object ids:** decoder rejects duplicates before graph construction (EC-SAVE-07).
- **Interrupted write:** storage failure mid-write → previous good slot intact; loader reads last-good (EC-SAVE-01).
- **Dual-slot conflict (autosave vs checkpoint):** newest *valid* wins; both corrupt → recovery menu (EC-SAVE-08).
- **Reward recorded, puzzle state missing:** R-10 reconcile path (EC-SAVE-09).
- **Puzzle state recorded, reward missing:** ledger reconciles from the completion milestone → granted once (EC-SAVE-10).
- **Load into changed level data:** definition mismatch detected → affected puzzle reset with warning, progression preserved (EC-SAVE-11).
- **Save while manipulating:** manipulation excluded from canonical snapshot; object persists at `lastValidPose`, never "in hand" (EC-SAVE-02).
- **Save while a machine is animating:** only logical state persists; animation restarts deterministically (EC-SAVE-03).
- **Browser closed mid-save:** last-good slot load path (EC-SAVE-04).
- **Storage quota exceeded:** write rejected, previous save preserved, user notified, session continues (EC-SAVE-12).

## 12. Recovery Tests (layer 4 — P0)

Every test asserts the player can always continue; none may leave a required object unreachable.

| Case | Expectation | EC ref |
|---|---|---|
| Object pushed outside world bounds | recovery volume returns it to `lastValidPose` or designated reset anchor within N fixed steps | EC-MAN-09 |
| Object below floor / inside geometry permanently | detected by containment check → relocated to nearest valid pose | EC-MAN-10 |
| "Reset Machine" requested | all components of that machine return to their canonical default/loose positions; puzzle → `InProgress`; **no reward change** | EC-PZ-04 |
| Required part carried into unrelated puzzle area | allowable (no theft lock), but boundary volume offers/accomplishes carry-back | EC-MAN-08 |
| Required part destroyed/despawned by logic error | `ComponentRegistry` integrity check on load + runtime watchdog re-spawns missing required parts from definition | EC-GEN-01 |
| Soft-lock detection (no legal configuration reachable) | validator offers structural hint escalation + explicit reset affordance; never silent dead-end | EC-PZ-05 |
| Player trapped in geometry | depenetration search + respawn at checkpoint anchor if unresolved after N steps | EC-PC-03 |
| Respawn point occupied by machinery | respawn searches for nearest safe clearance point | EC-PC-04 |
| Component stuck in a hazard's moving volume | hazard cycle ends → part ejected to nearest valid pose (no permanent loss) | EC-HAZ-02 |
| Save/load while recovering | recovery state is canonical: reload reproduces the recovered configuration, not the broken one | EC-SAVE-06 |

**P0 rule:** for every recoverable object there must be at least one automated test proving reachability after the worst-case displacement.

## 13. Camera Tests (layers 2–4, mostly manual + a few automated)

- Automated (pure math, `CameraRig` with fake physics): desired pose → collider-blocked pose resolves to nearest valid position outside geometry (no clipping into wall); smooth recovery when obstruction clears; recentre after N seconds idle; pitch clamped to configured range; horizontal distance clamped by obstruction.
- Automated: camera never enters a collider's interior when the player is adjacent to machinery (asserted over a swept set of test positions).
- Automated: manipulation mode easing (camera shifts toward a side/over-shoulder framing) reaches target within T seconds; exiting restores follow pose without pops (continuity assert on the transition curve).
- Automated: sudden grabbed-object motion does not corrupt camera state (no NaN, no unbounded offset).
- Automated: quality tier change does not alter camera behaviour (gameplay independence).
- Manual: narrow machinery spaces — player can still see the socket being manipulated; no visual oscillation between two occluders (no "camera strobe").
- Manual: transition exploration↔manipulation never fights the player's aim on the same frame.
- Manual: sensitivity extremes + inverted-Y behave sanely; camera recentre key works.

## 14. Input Tests (layer 2 + DOM layer 7)

- Automated (unit): context routing — actions emitted only for the active context; movement actions suppressed in `Paused`/`UIMenu`; UI actions ignored in `Exploration`.
- Automated: state snapshot clearing — injecting `blur`/`visibilitychange` clears all held actions; no action remains logically pressed (EC-BRN-05).
- Automated: no per-frame event spam — holding a key emits continuous state, not repeated one-shot events; one-shot actions fire once per physical press.
- Automated: rebinding map — an action resolves to exactly one binding set; unknown action id rejected.
- Automated: mouse-look delta clamped per step (huge delta e.g. from tab-switch lag cannot spin the camera) (EC-BRN-06).
- Automated: pointer lock loss → input context degrades gracefully to `UIMenu` (pause), not stuck-in-place movement.
- Manual: keyboard/mouse/controller-alternative sanity pass on all MVP actions; verify no action requires a 3-key chord.
## 15. Performance Tests (layer 7 — thresholds are pass/fail, not advisory)

Run in headless Chromium on the target-class machine; budgets cross-referenced with ARCH §36.

| Metric | MVP threshold | Fail action |
|---|---|---|
| Median FPS, quality **High**, hub scene | ≥ 50 | Optimize or downgrade default tier |
| Median FPS, quality **High**, branch scene (worst puzzle) | ≥ 45 | Optimize branch content |
| Median FPS, quality **Low** | ≥ 60 (capped) | Investigate CPU-side cost |
| JS frame time (logic+sim), p95 | ≤ 10 ms | Profile; move work off the hot loop |
| Physics step (custom kinematic), p95 | ≤ 2.5 ms | Reduce active colliders / broadphase |
| Draw calls, worst branch view | ≤ 150 | Merge/instance statics |
| Visible triangles, worst view | ≤ 250 k | LOD / cull |
| Texture memory | ≤ 128 MB | Reduce resolutions, enforce budget |
| Active physics bodies | ≤ 60 (≤ 12 dynamic) | Convert props to static/batched |
| Initial download (cold, cached-excluded) | ≤ 8 MB | Split chunks, defer assets |
| Lazy branch chunk | ≤ 4 MB | Re-audit asset compression |
| Time to interactive (dev machine) | ≤ 5 s | Defer non-critical init |
| Memory (JS heap) after 20 min play | ≤ 250 MB, no monotonic growth trend | Hunt leaks (dispose geometry/materials/textures) |

**Adaptive quality test:** force frame time above budget for N seconds → engine steps tier down exactly once per hysteresis window; gameplay outcome (a scripted puzzle solve) is **identical** before/after the tier change.

## 16. Browser Lifecycle Tests (layer 8 — semi-automated + manual)

| Event | Expected behaviour | Automated? | EC ref |
|---|---|---|---|
| Window resize / orientation | Renderer resizes; aspect + projection corrected; no stretched post effects | ✔ (assert renderer size + camera aspect) | EC-BRN-01 |
| Enter/exit fullscreen | No state loss; camera unchanged in gameplay terms; input still routed | ✔ partial | EC-BRN-02 |
| Tab hidden → visible (`visibilitychange`) | Loop pauses; no unbounded catch-up; no teleport; sim resumes cleanly | ✔ (fake clock) | EC-BRN-03 |
| Long background (10 min) | Max substep clamp; no drift; audio context handled | ✔ logic / manual audio | EC-BRN-04 |
| Window blur mid-hold | Held actions cleared; held object released safely (or hold preserved per config) — documented, consistent | ✔ | EC-BRN-05 |
| Key remains logically pressed after alt-tab | Impossible: input snapshot cleared on blur | ✔ | EC-BRN-05 |
| Pointer lock lost (Esc) | Context → `UIMenu`/pause; no camera spin | ✔ | EC-BRN-06 |
| WebGL context lost | Detect `webglcontextlost`; halt sim updates that require GPU; show non-blocking notice; attempt restore on `webglcontextrestored`; rebuild resources from canonical state; **no progression loss** | manual + unit for state rebuild | EC-BRN-07 |
| Audio context suspended (autoplay policy) | Game playable silently; unlock on first gesture; no error spam | manual | EC-BRN-08 |
| Open in second tab (same save) | Last-writer-wins with detectable divergence; no corrupt save (dual-slot + version check) | manual | EC-BRN-09 |
| Devtools throttling to 10 FPS | Playable; determinism preserved; no stuck states | manual + automated dt injection | EC-MAN-12 |
| No WebGL2 support | Clear unsupported-browser screen; no crash | manual | EC-BRN-10 |

## 17. Edge Case Matrix

Columns: ID · System · Scenario · Precondition · Action · Expected result · Recovery · A/M · Priority.
Narratives + prevention mechanisms live in `GAME_ARCHITECTURE.md §39`; this matrix is the test-facing view using the **same IDs**.

### 17.1 Manipulation

| ID | Scenario | Precondition | Action | Expected result | Recovery | A/M | Pri |
|---|---|---|---|---|---|---|---|
| EC-MAN-01 | Release inside geometry | Holding near wall | Release at penetrating pose | Depenetration to nearest valid pose (≤0.5 m search) | Else return to `lastValidPose` | A | P0 |
| EC-MAN-02 | Grab through a wall | Wall between camera and target | Attempt grab | Refused; no focus acquired | None needed | A | P0 |
| EC-MAN-03 | Two sockets compete for one object | Overlapping socket volumes | Move into both | Deterministic single candidate (nearest; tie→lowest id) | Re-evaluate next step | A | P1 |
| EC-MAN-04 | Object in multiple snap zones at attach | Overlapping volumes | Confirm attach | Exactly one socket receives the edge | Other socket stays free | A | P0 |
| EC-MAN-05 | Snapping while rotating | Rotation active in preview | Confirm | Attach pose = socket canonical pose | Cancel restores rotation | A | P1 |
| EC-MAN-06 | Snap invalidated during attach | Target socket becomes ineligible mid-sequence | Confirm after invalidation | Attach aborted atomically → object returns to hold | No half-state | A | P0 |
| EC-MAN-07 | Player moves too far while holding | Held object | Walk beyond hold range | Soft-detach at last valid pose (documented, consistent) | Object recoverable in place | A | P1 |
| EC-MAN-08 | Leaves puzzle area holding required part | Required part in hand | Cross area boundary | Part remains usable; boundary volume offers carry-back | Carry-back / recall | A+M | P0 |
| EC-MAN-09 | Object pushed outside world | Object at level edge | Large impulse/push | Recovery volume returns it to safe pose | Auto-recovery | A | P0 |
| EC-MAN-10 | Object under floor | Thin floor / high speed | Move through floor | Containment test relocates to nearest valid pose | Auto-recovery | A | P0 |
| EC-MAN-11 | Object clips through another machine | Dense machinery | Release inside machine volume | Release rejected → returns to hold; never embedded | Hold retained | A | P0 |
| EC-MAN-12 | Very low FPS while holding | 10 FPS / dt spike | Hold + move + snap | Identical canonical result as 60 FPS | None needed | A | P0 |
| EC-MAN-13 | Rapid input burst | Two grab presses, same frame | Double grab | Second ignored; one held object max | None needed | A | P1 |

### 17.2 Puzzle State

| ID | Scenario | Precondition | Action | Expected result | Recovery | A/M | Pri |
|---|---|---|---|---|---|---|---|
| EC-PZ-01 | Valid configuration reached temporarily | Correct graph for 1 sim step | Break it immediately | Does **not** complete (stable-frame hysteresis) | None | A | P0 |
| EC-PZ-02 | Completion event fires twice | Validator true for 100 steps | Observe events | Exactly one `PuzzleCompleted`; one reward | None | A | P0 |
| EC-PZ-03 | Machine invalidated after completion | Puzzle `Complete` | Detach a component | Puzzle stays `Complete` | Visual de-power allowed | A | P0 |
| EC-PZ-04 | Reset after reward | Puzzle `Complete`, reward granted | Reset machine | Back to `InProgress`; **no** second reward | Ledger blocks | A | P0 |
| EC-PZ-05 | Soft-lock (no reachable legal config) | All parts present, unreachable setup | Continue playing | Hint escalation + explicit reset affordance | Reset restores defaults | M | P0 |
| EC-PZ-06 | Sequence breaking | Steps solved out of order | Build later step first | Completes when full required graph is satisfied | None | A | P1 |
| EC-PZ-07 | Partially completed before tutorial trigger | Some correct attachments exist | Tutorial triggers | Tutorial marks step done; never blocks/re-shows | None | A | P1 |
| EC-PZ-08 | Required part used in unexpected valid socket | Alternative legal placement | Attach there | Completes if predicates hold (multi-solution) | None | A | P0 |
| EC-PZ-09 | Two puzzles share a component region | Adjacent machines | Attach to A while B needs it | Ownership by attachment; B's requirement shown unmet | Detach and move | A | P1 |

### 17.3 Physics

| ID | Scenario | Precondition | Action | Expected result | Recovery | A/M | Pri |
|---|---|---|---|---|---|---|---|
| EC-PHY-01 | Extreme delta time | Loop running | Inject dt = 2 s | Clamped substeps; state finite (no NaN) | Backlog dropped | A | P0 |
| EC-PHY-02 | Tunneling | Thin wall 0.1 m | Sweep at max carry speed | Never passes through (swept test) | None | A | P0 |
| EC-PHY-03 | Body sleeps incorrectly | Sleeping carryable | Interact / approach socket | Wakes reliably; never sleeps mid-hold | Auto-wake | A | P1 |
| EC-PHY-04 | Collision instability | Dense cluster | Push objects together | No explosion; penetration resolved within caps | Position clamp | A | P0 |
| EC-PHY-05 | Stacked components explode | 5 stacked boxes @10 FPS | Wait 10 s | Stable; no jitter runaway | Sleep + clamp | A | P1 |
| EC-PHY-06 | NaN / Infinity transform | Malformed pose injected | Continue sim | Sanitizer resets to last valid pose + logs | Auto-recovery | A | P0 |

### 17.4 Save / Load

| ID | Scenario | Precondition | Action | Expected result | Recovery | A/M | Pri |
|---|---|---|---|---|---|---|---|
| EC-SAVE-01 | Interrupted write | Storage fails mid-write | Kill write | Previous good slot intact | Load last-good | A | P0 |
| EC-SAVE-02 | Save while holding component | Manipulation active | Autosave milestone | Canonical save excludes held state; object recorded at `lastValidPose` | On load: object loose, never "in hand" | A | P0 |
| EC-SAVE-03 | Save while machine animating | Machine running | Autosave | Only logical state saved; animation restarts deterministically | Load rebuilds from canonical flag | A | P0 |
| EC-SAVE-04 | Browser closed mid-save | Write in progress | Force-close | Last-good slot remains loadable | Recovery menu if both slots bad | A | P0 |
| EC-SAVE-05 | Malformed save | Corrupted JSON/types | Load | Refused with reason; no partial load | Offer fresh start (backup kept) | A | P0 |
| EC-SAVE-06 | Missing referenced object | Save references removed id | Load | That machine resets to `InProgress`; rest preserved | Reported in load log | A | P0 |
| EC-SAVE-07 | Duplicate object ids | Hand-edited save | Load | Rejected before graph build | Reason code shown | A | P1 |
| EC-SAVE-08 | Autosave vs checkpoint conflict | Both slots valid, different times | Load | Newest **valid** wins | User can pick slot in menu | A | P1 |
| EC-SAVE-09 | Reward recorded, puzzle state missing | Mixed corruption | Load | Ledger authoritative → puzzle repaired to `Complete` | No double grant | A | P0 |
| EC-SAVE-10 | Puzzle state recorded, reward missing | Mixed corruption | Load | Reconciled from completion milestone; granted once | No duplicate | A | P0 |
| EC-SAVE-11 | Level data changed since save | Definition edits | Load | Mismatch detected; affected puzzle reset, progression preserved | Warning surfaced | A+M | P1 |
| EC-SAVE-12 | Storage quota exceeded | Storage full | Autosave | Write rejected; previous save preserved; session continues | User notified | A | P1 |

### 17.5 Player / Camera

| ID | Scenario | Precondition | Action | Expected result | Recovery | A/M | Pri |
|---|---|---|---|---|---|---|---|
| EC-PC-01 | Player trapped behind machine | Narrow machinery gap | Walk into dead end | Player can always exit (no sealed pockets by level design) | Depenetration + respawn fallback | M | P0 |
| EC-PC-02 | Camera inside wall | Player against wall | Rotate camera | Camera resolves outside geometry, smooth return | No clipping; recentre | A | P0 |
| EC-PC-03 | Player knocked into invalid space | Hazard push | Enter geometry | Depenetration search | Respawn at anchor after N steps | A | P0 |
| EC-PC-04 | Respawn collides with machinery | Anchor blocked | Die/enter recovery | Nearest safe clearance chosen | Documented fallback anchor | A | P1 |
| EC-PC-05 | Camera blocked by moving component | Carried/moving part passes | Continue | Camera occlusion resolves; manipulation aim unaffected | Recentre when clear | A | P1 |
| EC-PC-06 | Camera strobe between occluders | Two occluders near player | Stand between | Hysteresis prevents rapid in/out oscillation | Stable pose held | M | P2 |

### 17.6 Browser Lifecycle

| ID | Scenario | Precondition | Action | Expected result | Recovery | A/M | Pri |
|---|---|---|---|---|---|---|---|
| EC-BRN-01 | Resize | Gameplay | Resize window | Renderer + projection corrected; no distortion | None | A | P0 |
| EC-BRN-02 | Fullscreen toggle | Gameplay | Enter/exit fullscreen | No state loss; input intact | None | A | P1 |
| EC-BRN-03 | Tab hidden → visible | Gameplay | Switch away, return | Loop paused; no catch-up spiral; no teleport | Resume clean | A | P0 |
| EC-BRN-04 | Long background 10 min | Gameplay | Return | Substep clamp respected; no drift | Resume clean | A | P1 |
| EC-BRN-05 | Input focus loss | Holding key / object | Alt-tab | Held actions cleared; no logical stuck key | Held object released safely | A | P0 |
| EC-BRN-06 | Pointer lock lost | Mouse look | Press Esc | Context → pause; camera cannot spin | Resume on demand | A | P0 |
| EC-BRN-07 | WebGL context loss | Gameplay | Force context loss | Notice shown; sim protected; scene rebuilt from canonical state | No progression loss | M+unit | P0 |
| EC-BRN-08 | Audio context suspended | Autoplay policy | First gesture | Audio unlocks; game playable silently until then | No error spam | M | P1 |
| EC-BRN-09 | Second tab, same save | Two tabs open | Both play | Detectable divergence; no corrupt save (dual-slot + version) | Last-writer-wins documented | M | P2 |
| EC-BRN-10 | No WebGL2 support | Unsupported browser | Launch | Friendly unsupported screen | No crash | M | P1 |

## 18. MVP Acceptance Tests

Written as executable acceptance criteria (each maps to an automated test where marked). These are the Phase 14 gate; **any failing P0 here blocks MVP production readiness**.

**A-1 · Cold start**
GIVEN a fresh browser with no save
WHEN the game loads
THEN the title screen appears with "New Game" enabled and "Continue" disabled, WebGL2 is confirmed, and first-frame time is under the budget (§15). *(automated: smoke)*

**A-2 · Foundation**
GIVEN the game is running
WHEN the window is resized, backgrounded and restored
THEN rendering, input and simulation remain correct, with no unbounded catch-up and no stuck keys. *(automated + manual)*

**A-3 · Movement & camera**
GIVEN the player is in the hub
WHEN walking, running and turning near walls and machinery
THEN movement is grounded and frame-rate independent, and the camera never clips through walls or strobes between occluders. *(automated determinism + manual feel)*

**A-4 · Targeting integrity**
GIVEN a wall between the player and a component
WHEN the player aims at the component
THEN no focus is acquired and no grab is possible; valid targets within range **do** focus within N steps. *(automated, P0)*

**A-5 · Grab / release reliability**
GIVEN a loose component
WHEN the player grabs, moves and releases it repeatedly near geometry
THEN the component never ends embedded, never leaves the level, and always remains reachable. *(automated, P0)*

**A-6 · Snap correctness**
GIVEN a compatible free socket and a held compatible component
WHEN the player enters the socket volume and confirms
THEN exactly one LMG edge is created, the component sits at the socket pose, and the socket reports occupied. *(automated, P0)*

**A-7 · Multi-solution puzzle (P3)**
GIVEN P3 with several valid configurations
WHEN the player builds **any** configuration satisfying the output condition
THEN the puzzle validates and completes. *(automated, P0)*

**A-8 · Transform independence**
GIVEN a solved machine whose components are nudged within tolerance
WHEN validation runs
THEN the result is unchanged (no dependence on exact floating-point transforms). *(automated, P0)*

**A-9 · Transient validity rejection**
GIVEN a configuration that satisfies requirements for a single sim step
WHEN it is broken immediately
THEN the puzzle does **not** complete. *(automated, P0)*

**A-10 · Reward idempotency**
GIVEN a completed puzzle
WHEN completion events are duplicated, the game is saved, reloaded and re-evaluated
THEN exactly one reward exists and inventory/blueprints are unchanged by repeats. *(automated, P0)*

**A-11 · Save/load round trip**
GIVEN any MVP progression state (mid-puzzle, completed puzzle, completed branch)
WHEN the game is saved and reloaded
THEN the canonical state is identical and every machine visual state is reconstructed. *(automated, P0)*

**A-12 · Save corruption resilience**
GIVEN a corrupted or partially-written save
WHEN the game loads
THEN it refuses safely, preserves the previous good slot, and never silently partial-loads. *(automated, P0)*

**A-13 · Recovery guarantees**
GIVEN any required component displaced by gameplay or hazards
WHEN the player continues playing
THEN the component is recoverable without console commands or manual file edits. *(automated, P0)*

**A-14 · Low-performance determinism**
GIVEN the game throttled to ~10 FPS
WHEN the player solves a scripted puzzle
THEN the canonical result matches the 60 FPS run exactly. *(automated, P0)*

**A-15 · Quality independence**
GIVEN quality Low and quality High
WHEN the same scripted solve runs
THEN progression outcomes are identical. *(automated, P0)*

**A-16 · Full branch journey**
GIVEN a new game
WHEN the player completes P1 → P2 → P3 → BM-1, returns to the hub, saves and reloads
THEN the branch reads complete, hub progress is reflected, the clue fires once, and reload restores that state. *(manual + scripted, P0)*

**A-17 · Hazard containment**
GIVEN an active hazard
WHEN the player is caught by it
THEN the outcome is telegraph-first, never permanently destructive, and recovery lands at a valid checkpoint. *(manual, P1)*

**A-18 · Hint independence**
GIVEN a player using hints up to L3
WHEN the puzzle is solved
THEN hint usage never alters puzzle state or rewards, and hint level is stored separately. *(automated, P1)*

## 19. Regression Suite

**Purpose:** a fast, always-run set that protects the invariants most likely to break as later phases add systems. Runs headless; target ≤ 30 s total.

| Group | Contents | Guards | Runtime target |
|---|---|---|---|
| R-A Boundaries | Import-graph scan: L1/L0 contain no `three`/DOM imports; no upward imports; `madge --circular` clean | ARCH §11 R1/R2/R6 | < 5 s |
| R-B LMG core | Attach/detach/propagate/cycle/occupancy + transform-perturbation invariants | §24 model | < 5 s |
| R-C Manipulation SM | Full transition-table enumeration + cancel/restore invariants | §19 SM | < 5 s |
| R-D Snap | Compatibility, competition, occupancy, atomic abort | §21 | < 4 s |
| R-E Rewards | Idempotency set (R-1…R-10) | §10 | < 3 s |
| R-F Save codec | Round-trip fixtures + malformed corpus + migration chain | §11 | < 4 s |
| R-G Progression | Unlock rules, hub stage, no double-unlock | §26 | < 2 s |
| R-H Recovery | Every required component recoverable after worst-case displacement | §12 | < 4 s |

Rules: every bug fixed during any phase adds a permanent case here with the EC-ID in its name. Any new system must add its own invariants to the matching group. **A red R-group blocks the phase gate.**

## 20. Production Readiness Checklist

MVP is declared production-ready only when **all** boxes are checked; any BLOCKER or P0 finding keeps it unready (Phase 14 gate, `MVP_READINESS_REPORT.md`).

**Correctness & progression**
- [ ] All P0 tests green: boundaries, LMG, manipulation, snap, puzzle state, rewards, save/load, recovery
- [ ] No duplicate rewards under any duplicated-event sequence (R-1…R-10)
- [ ] Every puzzle provably solvable headlessly (solver-simulation) and every required part recoverable
- [ ] Transform-independence verified for every puzzle
- [ ] No known soft-lock reachable by normal play

**Persistence**
- [ ] Save round-trip verified for every MVP progression stage
- [ ] Corrupted/malformed/interrupted saves handled with no silent partial load
- [ ] One migration path exercised end-to-end on a real fixture
- [ ] New Game / Continue / overwrite flows verified

**Stability & lifecycle**
- [ ] Resize, fullscreen, backgrounding, focus loss, pointer-lock loss, context loss, audio suspension all pass
- [ ] No stuck keys or stuck manipulation states after any lifecycle event
- [ ] 20-minute soak: no memory growth trend, no leaked GPU resources

**Performance**
- [ ] All §15 thresholds met on the target-class machine at each quality tier
- [ ] Quality tier change leaves gameplay outcomes identical
- [ ] Initial download and lazy chunk budgets met
- [ ] Only measured bottlenecks were optimized (profiling evidence recorded)

**Content & experience**
- [ ] Full branch journey A-16 passes on a new save
- [ ] All interactables readable without color alone (shape/icon/motion/sound present)
- [ ] Hints never auto-solve; help level stored separately from puzzle state
- [ ] Hazards telegraph, are non-destructive, and recover to valid checkpoints
- [ ] No placeholder assets, TODO gameplay hooks, or debug default flags enabled in the build

**Engineering hygiene**
- [ ] Boundary lint + circular-dependency check wired into the build script
- [ ] All EC-IDs from §39 have at least one test or an explicit manual row
- [ ] Architecture docs updated to match implementation (no undocumented ownership change)
- [ ] `PROJECT_STATE.md` accurate and resumable at the final phase
- [ ] Debug tooling (§37) works in dev and is excluded or gated in production builds

