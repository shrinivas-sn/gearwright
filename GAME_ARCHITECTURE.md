# GEARWRIGHT — Game Architecture

**Version:** 0.1 (Phase 0) · **Status:** Verified — see *Architecture Verification* at bottom
**Project root:** `E:\gearwright\` · **Companion docs:** `TEST_SUITE_PLAN.md`, `PROJECT_STATE.md`

This document is the single source of truth for system boundaries, state ownership, and failure handling. It is intentionally dense: decisions are recorded once (§43 ADRs) and referenced elsewhere. No gameplay code exists yet; this file plus the test plan are the complete Phase 0 deliverables.

---

## 1. Executive Summary

**GEARWRIGHT** is a browser-native, third-person 3D mechanical puzzle game: the player explores a dormant industrial complex, physically manipulates components (grab, carry, rotate, socket), assembles working machines, and reactivates a mysterious central machine branch by branch.

**The core architectural bet:** a strict two-layer model of truth.

| Layer | Role | Properties |
|---|---|---|
| **Logical Machine Graph (LMG)** | Authoritative answer to "is this machine correct?" | Deterministic, headless-testable, transform-independent, serializable |
| **Physical Presentation Layer (PPL)** | What the player sees and holds | Kinematic manipulation, collision, effects — believable but never authoritative |

Puzzle completion, rewards, and saves are computed **only** from the LMG. The PPL can jitter, interpolate, or degrade visually without ever corrupting progression. This single decision drives most of the architecture (ADR-004, ADR-005, ADR-006).

**Delivery strategy:** 14 gated phases of vertical slices (§41), each independently testable, with a resumable `PROJECT_STATE.md` handoff. MVP = 1 hub + 1 branch + 3–4 puzzles + 1 branch machine.

## 2. Design Pillars

1. **Mechanics before cosmetics** — a puzzle that validates reliably at low settings beats a pretty one that doesn't.
2. **Determinism before realism** — gameplay truth lives in the LMG, not in floating-point physics.
3. **Recovery before punishment** — experimentation must be safe; every critical object is recoverable (§31, §39).
4. **Readability** — state communicated by shape + color + motion + sound, never color alone.
5. **Small core, data-driven content** — puzzles are definitions + reusable mechanics, not bespoke code (§24, ADR-013).
6. **Headless-testable logic** — every game-rule system runs without DOM/WebGL (§3 of test plan).

## 3. MVP Definition

| | Contents |
|---|---|
| **MVP** | Hub "Crucible Hall" w/ inactive central machine "Great Regulator" (partial reveal) · Branch A "Pressure Gallery" (steam/pneumatics) · Puzzles P1–P3 (+optional P4) · Branch machine BM-1 "Pressure Dynamo" · Manipulation (grab/carry/rotate/release/socket) · Snap/socket system · LMG validation · Parts/materials/1 blueprint · Save+checkpoint (localStorage) · Hints L0–L3 + scanner · 2 hazard types (steam jet, moving press) · Quality tiers Low/Med/High · Debug overlay |
| **Post-MVP** | Branches B/C · Upgrade trees (tool, components, utility) · Replay scoring/optimization · Secrets/optional challenges · glTF art pass + KTX2 textures · IndexedDB saves (only if size demands) · Photo mode · Accessibility expansion |
| **Out of Scope** | Combat, NPCs/dialogue trees, cutscene pipeline, multiplayer, parkour/climbing, UGC, mobile/touch controls, account/cloud sync |

---

## 4. Core Gameplay Loop

```text
EXPLORE ──► DISCOVER components/clues
   ▲           │
   │           ▼
   │      UNDERSTAND mechanism (affordances, scanner, hints)
   │           │
   │           ▼
   │      MANIPULATE / ASSEMBLE (grab → carry → rotate → socket)
   │           │
   │           ▼
   │      VALIDATE machine function (LMG, event-driven)
   │           │ fail ◄── retry freely (recoveries guaranteed)
   │           ▼ pass
   │      ACTIVATE machine ──► FEEDBACK (motion, sound, light)
   │           │
   │           ▼
   └───── REWARD (parts/materials/blueprint) ──► UNLOCK access/capability
                                                    │
                                                    ▼
                                   More complex mechanical problems
```

Two time scales: the **moment loop** (manipulate → snap → validate → feedback, seconds) must feel tactile and reliable; the **session loop** (puzzle → reward → unlock, 15–40 min) must end with a visible world change (machine running, door open, Great Regulator slightly more alive).

## 5. Player Experience Flow

First-session beat sheet (MVP):

1. **Boot → Title → New Game** (autosave slot created).
2. Wake in **Crucible Hall**; camera sweep reveals the dormant **Great Regulator**; movement tutorialized by level geometry (walk/run only).
3. Only unlocked path: **Branch A door**. First loose component + scanner prompt teach targeting.
4. **P1** teaches socket/attach. **P2** adds directionality. **P3** is open-ended. **BM-1** combines all + activation sequence.
5. Branch completion: power conduit to hub lights up; hub door B visible but sealed; a clue plate on the Great Regulator activates (story beat, no dialogue).
6. Autosave at every milestone; quit/reload resumes at last checkpoint with machines intact.

## 6. World / Hub / Branch Structure

```text
                    CRUCIBLE HALL (hub)
              ┌──────────┬──────────┐
              │  GREAT REGULATOR     │  ← mysterious central machine,
              │  (inactive, staged)  │    partial visibility in MVP
              └──────────┬──────────┘
        ┌────────────────┼────────────────┐
        ▼                ▼                ▼
  BRANCH A door     BRANCH B door     BRANCH C door
  "Pressure Gallery" (sealed, visual) (sealed, visual)
  playable (MVP)    post-MVP          post-MVP
```

- **Hub** is a persistent scene; branches load as additive chunks (§34). Branch doors are world-space anchors with an `AccessGate` component reading progression state.
- **Branch template** (8 beats): entry → teaching machine → combining machine → open-ended problem → final machine → activation → reward/access → central-machine clue. Branch A instantiates beats 1–8; future branches reuse the same template + systems.
- Completed branches feed one **trunk line** to the Great Regulator; hub visually accumulates progress (lights, motion) without new logic per branch — hub stages are data (`HubStageDefinition`).

## 7. Puzzle Progression (Branch A)

| ID | Name | Teaches | Combines | Validation type | Solutions |
|---|---|---|---|---|---|
| P1 | "First Mesh" | grab, carry, socket-attach a gear between two shafts | — | required connection `shaftA→gear→shaftB` | 1 |
| P2 | "Right Turn" | directionality, belt/pulley routing | socket + orientation | connection + rotation-direction predicate | 2 (mirror configs) |
| P3 | "Three Valves" | pressure routing, sequence-free multi-solution | attach + flow propagation | output condition: `pressure(out1)≥x ∧ pressure(out2)≥y` | 3+ accepted configs |
| P4 (optional, cut first) | "Counterweight" | mass classes, lock/unlock | all above | state + safety predicate | 2 |
| BM-1 | "Pressure Dynamo" | activation sequence | P1–P3 mechanics | staged validation: assembly → priming → activation | 1 structure, order-flexible priming |

Progression curve: **guided (P1) → semi-open (P2) → systemic (P3/BM-1)**. Every puzzle validates *function* (LMG predicates), never exact placement (§24). Puzzles are data: `PuzzleDefinition` referencing reusable mechanics (ADR-013).
---

## 8. Technical Stack Decision

### 8.1 Language — TypeScript (ADR-001)

| Criterion | TypeScript | JavaScript | Verdict |
|---|---|---|---|
| State-ownership safety | Named types per boundary; illegal cross-layer writes fail at compile time | runtime-only discovery | **TS** |
| Refactor safety across 14 phases | renames/contract changes caught by compiler | manual grep auditing | **TS** |
| Runtime cost | types erased | none | neutral |
| Build overhead | esbuild strips types | none | neutral |

**Decision:** TypeScript `strict: true`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`. No `any` in `src/` (tests may use `unknown` + narrowing). Type-only imports enforced to keep runtime graphs clean.

### 8.2 Build tooling — Vite (ADR-002)

| Option | Cold start (8 GB machine) | HMR | Config weight | Verdict |
|---|---|---|---|---|
| **Vite** | sub-second dev server, esbuild deps | instant module HMR | tiny | **chosen** |
| webpack 5 | 5–20 s on this hardware | slower rebuilds | heavy | rejected (dev-loop cost) |
| esbuild + hand-rolled server | fast, no HMR/asset graph | manual | bespoke maintenance | rejected |
| Parcel | zero-config, slower transforms | acceptable | hidden behavior | rejected (debuggability) |

Vitest shares the Vite pipeline → one toolchain for build + test. Output: static `dist/` (HTML+JS+assets); no server runtime.

### 8.3 Rendering — Three.js (ADR-003)

| Option | Bundle (min+gz) | Fit | Verdict |
|---|---|---|---|
| **Three.js** | ~150–170 KB | mature core, tree-shakeable, WebGL2 | **chosen** |
| Babylon.js | ~600–900 KB | batteries-included but heavy for 1.5 GB RAM budget | rejected |
| PlayCanvas | ~500 KB+ | engine↔editor coupling, server tooling | rejected |
| Raw WebGL2 | ~0 | must build math/scene/shadow/loader stack | rejected (scope burn) |

Pin an exact version; upgrade only at phase gates. Use core `three` + a minimal set of `examples/jsm` loaders. Avoid post-processing chains unless a quality tier justifies them (§35).

### 8.4 Physics — no engine in the MVP (ADR-004)  key decision

The MVP needs **believable handling**, not rigid-body simulation: carry/rotate an object, keep it out of walls, snap it to sockets, and *know when a machine is correct* — a **logic** question, not a solver question.

| Option | Cost | Determinism / reliability | Verdict |
|---|---|---|---|
| **Custom kinematic layer** (swept AABB/OBB vs static colliders, velocity clamp, depenetration, snap assist) | ~0 KB; ~600–900 LOC | fully ours: fixed-step deterministic, no jitter/explosion class, headless-testable | **chosen for MVP** |
| Rapier (WASM) | ~1–1.6 MB + glue; WASM memory on 8 GB | excellent, but adds solver/timestep coupling + instability surface to tame | **post-MVP**, behind `PhysicsPort` |
| cannon-es | ~100 KB | sporadically maintained; stacking/jitter tuning burden | rejected |
| Ammo.js | ~1.7 MB wasm | heavy, aging toolchain | rejected |
| Matter.js | 2D only | N/A | rejected |

Rationale: §39 failure modes are dominated by *placement reliability*, not realistic dynamics. Any adopted engine creates non-determinism we must defensively wrap anyway. Adopting Rapier later is cheap **because** all physics access sits behind one port (§10 L3) and gameplay truth never lives in the solver.
### 8.5 UI strategy — DOM/CSS overlay (ADR-010)

| Option | Iteration speed | Accessibility | Cost | Verdict |
|---|---|---|---|---|
| **DOM + CSS overlay** over the WebGL canvas | fastest (devtools, hot reload) | native focus/ARIA for menus | 0 KB | **chosen** |
| three.js sprites / CSS3DRenderer | 3D-anchored, hard to lay out | poor | CPU cost | rejected for HUD; used only for world-space markers |
| React/Vue | component model | good | 40–140 KB + build complexity | rejected for MVP (≈8 panels); revisit only if menus explode |

Crosshair, prompts, toasts, hint button, pause/settings menus, and debug overlay are DOM. World-space affordances (socket highlights, scanner overlays) render in-scene.

### 8.6 Audio — Web Audio API, thin wrapper (ADR-011)

| Option | Control | Cost | Verdict |
|---|---|---|---|
| **Web Audio + custom `AudioBus`** | bus routing, ducking, scheduled one-shots, precise mechanical click timing | ~0 KB | **chosen** |
| Howler.js | ergonomic, but hides scheduling precision | ~10 KB | rejected (mechanical timing is core feel) |
| three.js positional audio | minimal helpers | included | used only for emitter plumbing |

Audio context starts suspended and is unlocked on first user gesture (EC-BRN-08).

### 8.7 Test framework — Vitest (ADR-012)

| Option | Speed | Vite integration | Verdict |
|---|---|---|---|
| **Vitest** | fast, watch mode | native: shares config/aliases | **chosen** |
| Jest | slower cold start, ESM friction | separate transform pipeline | rejected |
| node:test | zero-dep, no DOM env | none | rejected (need jsdom for UI stores) |

Two projects: `logic` (node env — the majority of game rules) and `dom` (jsdom — UI/lifecycle stores). Browser performance tests are a separate Playwright job introduced in Phase 13.

### 8.8 Persistence — localStorage, canonical schema (ADR-008)

| Option | Capacity | API | Verdict |
|---|---|---|---|
| **localStorage** | ~5–10 MB/origin | sync string KV — ideal for one small canonical blob | **chosen** |
| IndexedDB | ~hundreds of MB | async, transactional, complex | deferred; adopt only if snapshot > ~2 MB (§44 OQ-2) |
| sessionStorage | volatile | N/A | rejected (no persistence) |
| OPFS / File System Access | user-prompted | uneven support | out of scope |

Persisted payloads are **canonical DTOs only** (never runtime objects): settings, progression, puzzle states, machine graphs, inventory, checkpoint. Sync writes are wrapped in `StoragePort` so tests inject a fake and IndexedDB can replace it without touching callers.
---

## 9. High-Level Architecture

```text
┌──────────────────────────────────────────────────────────────────────┐
│ L0  PLATFORM CORE        (no game knowledge)                         │
│   Loop/Clock · Lifecycle · Config/DataLoader · Rng · EventBus(typed) │
│   PerformanceMonitor · DebugLayer                                    │
└───────────────▲───────────────────────────────┬──────────────────────┘
                │ typed events up               │ direct calls down
┌───────────────┴───────────────────────────────▼──────────────────────┐
│ L1  GAME STATE CORE   (pure logic · headless · no three.js, no DOM)  │
│   MachineGraph(LMG) · ComponentRegistry · SnapRules · Validator      │
│   PuzzleSystem · ProgressionSystem · InventorySystem · RewardLedger  │
│   BlueprintSystem · UpgradeSystem · HintState · SaveCodec            │
└───────────────▲───────────────────────────────┬──────────────────────┘
                │ snapshot reads                │ commands
┌───────────────┴───────────────────────────────▼──────────────────────┐
│ L2  GAMEPLAY SYSTEMS   (simulation, engine-agnostic via Ports)       │
│   InputSystem · PlayerController · CameraRig · InteractionSystem     │
│   ManipulationSystem(SM) · SnapSystem · HazardSystem · FeedbackModel │
└───────────────▲───────────────────────────────┬──────────────────────┘
                │ world reads                   │ Port calls
┌───────────────┴───────────────────────────────▼──────────────────────┐
│ L3  PORTS                (interfaces only, no implementations)       │
│   PhysicsPort · RenderPort · AudioPort · StoragePort · AssetPort     │
└───────────────▲───────────────────────────────┬──────────────────────┘
                │                               │
┌───────────────┴───────────────────────────────▼──────────────────────┐
│ L4  ADAPTERS / PRESENTATION   (all engine + DOM contact)             │
│   ThreeRenderer · KinematicPhysics · WebAudioBus · AssetLoaderImpl   │
│   HUD(dom) · FeedbackComposer(VFX/SFX) · WorldSceneBuilder           │
└──────────────────────────────────────────────────────────────────────┘
```

**Law of the diagram:** arrows flow **down as calls** and **up as typed events**. No L4 adapter mutates L1 state; no L1 module imports `three` or touches the DOM. L1 is the only layer allowed to decide progression implications.

**Canonical runtime flow (the safe path through every boundary):**

```text
Input → InteractionSystem (validates target, range, LOS)
      → ManipulationSystem (takes control; SM transition)
      → PhysicsPort (constraint mode → kinematic follow + collision)
      → SnapSystem (detects compatible socket; preview + assist)
      → ManipulationSystem.confirm() → MachineGraph.attach(component, socket)
      → MachineGraph.recompute() (connectivity + propagation)
      → Validator.evaluate() → PuzzleSystem.apply(result)
      → RewardLedger.grant(completion, once) → ProgressionSystem.unlock
      → SaveSystem.capture(canonical DTO)
      → FeedbackComposer.play(outcome)
```

---

## 10. Layer Responsibilities

| Layer | Responsibility | Owns | Must NOT |
|---|---|---|---|
| **L0 Platform Core** | Time, lifecycle, config/data loading, RNG, typed event channels, perf monitoring, debug flags | Clock, frame stats, loaded data tables, event channels | Know about machines, puzzles, or the player |
| **L1 Game State Core** | All game *rules*: what is attached, what a machine does, whether a puzzle is satisfied, what is unlocked, what is saved | Canonical world/progression state (ARCH §12) | Import `three`, touch DOM/WebGL, read frame time, animate anything |
| **L2 Gameplay Systems** | Turn input + world into commands and continuous behaviour: walking, camera, targeting, holding, snapping, hazards, hint triggers | Player/camera runtime transforms, interaction focus, active manipulation session | Decide rewards/progression; write save state directly; bypass SnapRules for attachment |
| **L3 Ports** | Narrow interfaces defining what L2 needs from the engine | Interface contracts only | Contain logic or imports of concrete libs |
| **L4 Adapters/Presentation** | Real engine + DOM implementations; visuals, audio, particles, menus | GPU/audio resources, scene graph objects, DOM nodes | Mutate L1 state; be the source of gameplay truth |

**Ownership nuance that prevents most bugs:** the *scene graph object* for a component (mesh) is owned by L4, while the *component's logical identity and attachment* are owned by L1. L4 mirrors L1 — it never leads.

## 11. Dependency Rules

**Allowed (downward calls, upward events):**

| Caller → | L0 | L1 | L2 | L3 | L4 |
|---|---|---|---|---|---|
| **L0** | ✔ | ✘ | ✘ | ✘ | ✘ |
| **L1** | ✔ (services) | ✔ | ✘ | ✘ | ✘ |
| **L2** | ✔ | ✔ (commands/queries) | ✔ | ✔ (interfaces) | ✘ |
| **L3** | ✔ (types) | ✘ | ✘ | ✔ | ✘ |
| **L4** | ✔ | ✘ *(read snapshots via L2 only)* | ✔ (implements ports) | ✔ (implements) | ✔ |

- **R1 — No upward imports.** A lower layer never imports a higher layer. Enforced by an ESLint `no-restricted-imports` boundary rule per folder.
- **R2 — No L1 ↔ engine coupling.** `src/core/` and `src/game-state/` must contain zero imports of `three`, DOM globals, or `window`. Verified by a test that statically scans those folders' import graphs.
- **R3 — Events go up, commands go down.** L1 emits facts (`MachineChanged`, `PuzzleCompleted`); L2/L4 subscribe. L2 commands L1 via explicit method calls. **No global mutable event bus for commands.**
- **R4 — Everything engine-touching sits behind a port.** L2 depends on `PhysicsPort`, not `KinematicPhysics`. A `FakePhysicsPort` must be able to replace the real one in tests (§8 of test plan).
- **R5 — Persistence only through DTOs.** `SaveCodec` reads canonical DTOs from L1 owners; nothing serializes live objects, `THREE.Object3D`s, or physics bodies.
- **R6 — No circular dependencies.** Import direction is acyclic: `L4 → L3 → L2 → L1 → L0`. Enforced by `madge --circular` in CI (`npm run check:cycles`).
- **R7 — Puzzle logic never lives in rendering or physics.** Validator consumes LMG only. If a rule needs a transform, it consumes a *canonical pose snapshot* supplied by L2, never a raw physics body.
- **R8 — UI never mutates the world.** HUD emits intent events (`HintRequested`, `PuzzleResetRequested`); owning systems apply them and announce results.
---

## 12. State Ownership Matrix

Format: **State** · *Owner* · Readers · Allowed writers · Persistence · Reset behaviour.
"Canonical" = part of the saved DTO. "Runtime" = reconstructed, never saved.

### 12.1 World / Player / Runtime State

| State | Authoritative owner | Readers | Allowed writers | Persistence | Reset behaviour |
|---|---|---|---|---|---|
| Player position/orientation | `PlayerController` (L2) | CameraRig, InteractionSystem, HazardSystem, debug | `PlayerController` only | **Runtime** (canonical = checkpoint anchor, not raw pose) | Respawn at current checkpoint anchor |
| Player velocity / grounded | `PlayerController` | Camera, debug | `PlayerController` | Runtime | Zeroed on respawn |
| Camera orbit / pose | `CameraRig` (L2) | Renderer adapter, debug | `CameraRig` only | Runtime (sensitivity/invert persisted as settings) | Recentre to follow mode |
| Interaction focus (targeted object) | `InteractionSystem` (L2) | HUD, ManipulationSystem, debug | `InteractionSystem` | Runtime | Cleared on SM exit from `Targeting` |
| Manipulation SM state | `ManipulationSystem` (L2) | HUD, SnapSystem, FeedbackModel, debug | `ManipulationSystem.transition()` only | Runtime — **never saved** | Forced to `Exploration`; held object released to `lastValidPose` |
| Held object id | `ManipulationSystem` | PhysicsPort, SnapSystem, SaveSystem (as exclusion) | `ManipulationSystem` | Runtime (excluded from save) | Released to `lastValidPose` |
| `lastValidPose` per carryable | `ManipulationSystem` | SaveSystem, recovery volumes | `ManipulationSystem` | **Canonical** (quantised pose) | Rebuilt from level spawn defaults |
| Component physical pose (transform) | `KinematicPhysicsAdapter` (L4) converges toward LMG pose | Renderer, SnapSystem (assist only) | Physics adapter; **LMG owns the canonical pose** | Canonical pose in LMG; solver state runtime | LMG pose re-applied on load |
| Socket occupancy visual | `SnapSystem` (derived) | Renderer, HUD | Derived — never written directly | Runtime (derived) | Recomputed from LMG |
| Snap preview candidate | `SnapSystem` | ManipulationSystem, HUD | `SnapSystem` | Runtime | Cleared on detach/cancel |
| Hazard runtime state (phase, timing) | `HazardSystem` (L2) | HUD, feedback, debug | `HazardSystem` | Runtime (canonical phase offset where determinism matters) | Restarts from canonical phase |
| Quality tier / render settings | `SettingsStore` (L1-owned, L4 consumer) | Renderer, particles, audio, shadows | Settings UI intent → `SettingsStore` | **Canonical** (settings section) | Preserved across sessions |
| RNG state | `Rng` service (L0) | HazardSystem, cosmetic variance | Only via `next()` | Runtime (seed canonical if deterministic cosmetics required) | Reseeded per session/checkpoint |
### 12.2 Logical / Progression State (all L1)

| State | Authoritative owner | Readers | Allowed writers | Persistence | Reset behaviour |
|---|---|---|---|---|---|
| Component registry (id, def, mass class, tags) | `ComponentRegistry` | LMG, SnapRules, Progression, HUD, debug | Built at load from data; runtime spawn/despawn via registry API | **Canonical** (instance list + def ids) | Rebuilt from level data + saved instances |
| Component attachment (component→socket) | `MachineGraph` | Validator, SaveSystem, SnapSystem (query), HUD | `MachineGraph.attach/detach` only (via manipulation confirm path) | **Canonical** | Restored from save, else level default |
| Machine graph topology (nodes/edges) | `MachineGraph` | Validator, propagation, debug viewer | `MachineGraph.recompute()` internals | Derived from attachments (rebuilt, not stored verbatim) | Rebuilt on load |
| Machine functional state (`idle/running/jammed/powered`) | `MachineGraph` (L1) | Validator, Progression, Feedback, Hazards | Machine logic only (`recompute()`) | Canonical **derived** flag persisted for animation continuity (§31) | Recomputed from graph; persisted flag only skips re-animation |
| Puzzle state (`Locked…Complete`) | `PuzzleSystem` | Progression, HUD, HintSystem, SaveSystem | `PuzzleSystem.apply(result)` / `reset()` | **Canonical** | Reset → `InProgress`; `Complete` never auto-reverts |
| Puzzle objective progress (sub-requirements met) | `Validator` output, cached by `PuzzleSystem` | HUD, HintSystem | Derived | Derived (recomputed) | Recomputes from LMG |
| Reward ledger (granted ids) | `RewardLedger` | Progression, Inventory, SaveSystem | `RewardLedger.grant(id)` only | **Canonical** | Cleared only on New Game |
| Inventory: parts (instances) | `InventorySystem` | HUD, Upgrades, Validator (availability) | Inventory API via RewardLedger / consumption | **Canonical** | New Game resets |
| Inventory: materials (counts) | `InventorySystem` | HUD, Upgrades | Inventory API (grant/spend) | **Canonical** | New Game resets |
| Blueprints unlocked | `BlueprintSystem` | Progression, HUD, Upgrades | `BlueprintSystem.unlock(id)` (idempotent set) | **Canonical** | New Game resets |
| Upgrade levels | `UpgradeSystem` | PlayerController (modifiers), Manipulation (capability), HUD | `UpgradeSystem.apply()` | **Canonical** (framework present, empty in MVP) | New Game resets |
| Branch unlock state | `ProgressionSystem` | Hub `AccessGate`, HUD, SaveSystem | Progression rules on branch completion | **Canonical** | New Game resets |
| Hub stage (central machine progress) | `ProgressionSystem` | Hub visual builder (L4 reads), HUD | Progression rules only | **Canonical** | Rebuilt from branch completions |
| Hint level per puzzle (L0–L4) | `HintState` (L1) | HintSystem, HUD, audio | HintSystem via explicit request/decay rules | **Canonical** (help level only — **never** puzzle state) | Preserved; independent of completion |
| Current checkpoint id | `CheckpointSystem` (L1) | Progression, respawn logic | Set only on defined checkpoint trigger | **Canonical** | New Game → `CP-00` |
| Save schema version | `SaveCodec` (L1) | Loader/migrations | Written by codec on save | **Canonical** | Migrated forward; never downgraded |
| Discovered clues / log entries | `ProgressionSystem` | Story UI, HUD | Progression on discovery events | **Canonical** (seen-id set) | New Game resets |
| Player action history (`primed` / ordered witnesses, §24.1) | `ActionHistory` (L1) | Validator (as `ValidationContext.actions`), composition (staged props, world key), debug | `ActionHistory.append` via the composition's staged-trigger handler; `restore` on load | **Canonical** (§31.1 v2 `actions.ids`) | New Game clears; FIFO-bounded (oldest record dropped) |

**Rule:** any state not listed here must not exist as a module-level mutable. New state requires a row in this matrix (and an ADR if ownership is contested).
---

## 13. Runtime Lifecycle

```text
BOOT ──► CONFIG/DATA LOAD ──► ADAPTER INIT ──► TITLE ──► [LOAD SAVE] ──► ENTER WORLD
  │                                                                          │
  │                                                     ┌────────────────────┘
  │                                                     ▼
  │                              ┌──────────── GAMEPLAY LOOP ────────────┐
  │                              │ input→sim→graph→validate→render→audio │
  │                              └───────┬───────────────────┬───────────┘
  │                                      │ pause             │ checkpoint/autosave
  │                                      ▼                   ▼
  │                                   PAUSED            CAPTURE CANONICAL
  │                                      │                   │
  │                                      └──► resume ────────┘
  ▼
UNLOAD / NEW GAME / RELOAD
```

| Stage | What happens | Failure behaviour |
|---|---|---|
| **BOOT** | Detect WebGL2; read settings/quality; create canvas + DOM root | No WebGL2 → friendly unsupported screen (EC-BRN-10), no crash |
| **CONFIG/DATA LOAD** | Load JSON/TS definitions (components, sockets, puzzles, rewards, checkpoints, hints, hub stages); validate schemas | Invalid definition → fail fast with file+field in console, dev-only blocking screen; production → skip offender + log (never silent corruption) |
| **ADAPTER INIT** | Build renderer, physics adapter, audio bus, storage port; start perf monitor; construct L1 systems with data | Adapter init failure → recoverable error screen with retry |
| **TITLE** | New Game / Continue (enabled only if a valid save exists) / Settings | Corrupt save → Continue disabled, "Start fresh (backup kept)" offered (EC-SAVE-05) |
| **LOAD SAVE** | Decode → migrate → validate → rebuild L1 state → rebuild scene from canonical | Any failure → recovery path; never partial-load silently |
| **ENTER WORLD** | Spawn player at checkpoint anchor; build hub scene; restore machine visual states from canonical flags | Missing anchor → fallback `CP-00` |
| **GAMEPLAY LOOP** | Fixed-step sim + render (see §14) | See §38 error handling |
| **PAUSE** | Halt sim (no stepping), keep render for UI backdrop; input context → `UIMenu`; audio ducked | Focus loss → auto-pause |
| **CAPTURE CANONICAL** | Gather canonical DTOs; write via dual-slot storage | Write failure → keep previous save, notify (EC-SAVE-12) |
| **UNLOAD / RELOAD** | Dispose GPU resources, remove listeners, close audio context | Best-effort dispose; leaks caught by perf tests (§15) |
| **WEBGL CONTEXT LOSS** | Pause sim steps that need GPU; show notice; on restore rebuild renderer + scene from canonical L1 state | Progression untouched (EC-BRN-07) |

## 14. Game Loop

**Fixed timestep simulation at 30 Hz, decoupled rendering.** Rationale (ADR-007): gameplay truth must be identical at 10 FPS and 120 FPS; this is the cheapest way to guarantee it and it makes tests deterministic.

```text
frame(now):
  dtFrame = clamp(now - last, 0, MAX_FRAME)         // MAX_FRAME = 250 ms (tab-switch guard)
  accumulator += dtFrame
  steps = 0
  while accumulator >= FIXED_DT and steps < MAX_STEPS (=5):
      simulate(FIXED_DT)                            // ordering below
      accumulator -= FIXED_DT
      steps++
  if steps == MAX_STEPS: accumulator = 0            // drop backlog, never spiral
  render(interpolationAlpha = accumulator / FIXED_DT)
```

**`simulate(dt)` — fixed ordering (this order is a contract; changing it requires an ADR):**

1. `InputSystem.sample()` → action snapshot for this step
2. `PlayerController.step(dt)` → intent → kinematic motion + collision
3. `CameraRig.step(dt)` → follow/orbit/occlusion resolve
4. `InteractionSystem.step(dt)` → ray/query, focus change (fires events only on change)
5. `ManipulationSystem.step(dt)` → SM tick, constraints, hold pose, confirm/cancel handling
6. `SnapSystem.step(dt)` → candidate re-evaluation, assist, preview update
7. `MachineGraph.recomputeIfDirty()` → connectivity + propagation (only when structural events occurred)
8. `Validator.evaluateDirty()` → requirement predicates → result events (dirty-driven, plus stable-frame hysteresis)
9. `HazardSystem.step(dt)` → cycles, telegraphs, effects applied to player/objects
10. `ProgressionSystem.step(dt)` → consume validation results; apply stage transitions; emit `PuzzleCompleted` once
11. `HintSystem.step(dt)` → timers/cooldowns; escalate only per rules
12. `FeedbackModel.step(dt)` → translate step outcomes into presentation intents (no direct GPU/audio calls)

**Then, outside `simulate()`:** `SaveSystem` reacts to milestone events (never inside the step loop); `FeedbackComposer` consumes intents and plays them on the render side; `HUD` renders from read models once per frame.

**Interpolation:** only *visual* transforms interpolate (player, carried object, moving parts) between last and current sim state. **Interpolation never feeds logic** — validators and snaps read sim-state only. This is what keeps puzzle results frame-rate independent.

**Validation timing:** `Validator` runs when the machine graph is dirty (structural change) and when a component's canonical pose settles within tolerance; a "stable frames" counter (default 3 sim steps) suppresses one-frame transient validity (EC-PZ-01).
---

## 15. Input Architecture

**Layers:** raw device events (L4) → **InputSnapshot** (L2) → **ActionMap** (`ActionId` → bindings) → **context router** → per-step action state consumed by systems.

```text
keydown/keyup/mousemove/mousedown/blur/pointerlockchange  (DOM, L4)
        ↓ normalized into: pressed / justPressed / justReleased / axis values
InputSnapshot (immutable per sim step)
        ↓ ActionMap + InputContext filter
ActionState { moveX, moveY, lookDelta, primary, secondary, rotate, confirm, cancel, detach, scanner, hint, pause }
        ↓
PlayerController · CameraRig · InteractionSystem · ManipulationSystem · HUD
```

**Action set (MVP — deliberately small; no 3-key chords):**

| Action | Default binding | Context |
|---|---|---|
| Move | WASD | Exploration, Manipulation (slow strafe) |
| Look | Mouse move | Exploration, Manipulation |
| Run | Shift (hold) | Exploration |
| Interact / Grab | LMB or E | Exploration |
| Rotate held | Q/E or mouse wheel (documented choice at Phase 4) | Manipulation |
| Confirm attach | LMB | SnapPreview |
| Cancel / drop | RMB or Esc | Grab, Manipulation, Rotation |
| Detach | R (hold) | Exploration on attached component |
| Scanner | F | Exploration (post-blueprint) |
| Hint | H (or HUD button) | Exploration, PuzzleInspection |
| Pause | Esc | any gameplay context |

**Rules:** one physical press → at most one one-shot action; held keys are continuous state; `Esc` also exits pointer lock and always resolves to `Paused/**UIMenu**` (never a dead state); contexts are explicit and exclusive (§19); on `blur`/`visibilitychange` the snapshot is cleared and one-shot latches reset (**EC-BRN-05**). Look deltas are clamped per step to survive tab-switch spikes (**EC-BRN-06**). All bindings live in `config/input.ts` and are displayed by the HUD from the same data (no duplicated hardcoded labels).

## 16. Player Controller

**Scope:** grounded third-person locomotion only — walk, run, turn, slope handling, simple obstacle avoidance. No jumping as a mechanic, no climbing, no parkour (out of scope per §3).

| Concern | Approach | Test hook |
|---|---|---|
| Movement | Camera-relative intent vector → desired velocity → acceleration/deceleration curves (capsule-vs-static-collision via `PhysicsPort`) | deterministic at fixed dt; identical at 10/60 FPS (EC-MAN-12) |
| Rotation | Character faces movement direction with turn rate; no instant snapping | orientation curve unit-testable |
| Grounding | Ray/overlap probe downward; snap-to-ground within step height; slope limit angle | probe unit tests |
| Obstacle navigation | Slide along walls; blocked-by-machinery detection; no wall-sticking | sweep tests |
| Speed | Walk ~2.2 m/s, run ~4.2 m/s (targets, tunable in one config object) | sanity-range unit test |
| Traversal safety | Cannot enter hazard volumes accidentally at walk pace (telegraphs required first) | hazard tests |
| Recovery | Trapped → depenetration search → checkpoint respawn anchor if unresolvable (EC-PC-03/04) | recovery tests |
| Encumbrance (future) | Hook point: `UpgradeSystem` modifiers scale speed/carry capability; **no MVP logic** | upgrade modifier tests (framework only) |

**Deliberate non-goals:** physics-driven player (ragdoll), climbing ledges, crouch/prone, vehicles, swimming.
---

## 17. Camera Architecture

**Model:** spring-arm orbit rig. Player torso anchor → desired position (yaw, pitch, distance) → **occlusion resolve** → damped convergence → camera + look-at target.

| Concern | Decision | Notes |
|---|---|---|
| Base behaviour | Orbit around player, follow with damping; yaw from mouse, pitch clamped | Deterministic at fixed step |
| Collision | Ray/sphere-cast from anchor to desired position via `PhysicsPort`; clamp to first hit minus skin | Prevents wall clipping; smoothed return when clear |
| Occlusion | Hysteresis (two thresholds) so it doesn't strobe between occluders | EC-PC-06 |
| Narrow machinery spaces | Tighter collision skin + minimum distance floor + can bias upward | Manipulation readability is the priority |
| Manipulation mode | Eases to a side/over-shoulder framing focused on socket→object line; slightly higher, closer | Transition eased over ~0.25 s; never snaps |
| Puzzle inspection | Optional held-free look mode (no movement) for reading a mechanism | Data-driven per puzzle |
| Recentring | Auto-recentre after N s of no look input; manual recentre key | Settings: auto-recentre on/off, speed |
| Sensitivity | Settings-driven (mouse sens, invert Y, FOV); applied without touching gameplay logic | §12 settings ownership |
| Sudden object motion | Camera never chases carried/moving parts; only anchor-based | Prevents nausea + aim drift |
| Head bob / shake | **Restrained**: tiny amplitude on run; short impulse on machine activation only | Can be disabled (accessibility) |
| Quality independence | No quality tier changes camera behaviour (ADR-014) | Asserted in tests (§13) |

**Interface:** `CameraRig.step(dt, playerState, lookDelta, mode) → CameraPose`. Renderer consumes the pose; nothing else writes the camera.

## 18. Interaction Architecture

**Purpose:** turn "where the player looks" into a valid, explicit target — the gate before any manipulation.

```text
CameraPose → InteractionRay (origin, dir)
   → PhysicsPort.raycast(interactable layer only)
   → candidate list (sorted: priority → distance)
   → validity filter (range, LOS, not-embedded, enabled, context rules)
   → FocusTarget = { id, kind, socketId?, reason }
   → FocusChanged event (only on change)
```

| Rule | Value / behaviour | Rationale |
|---|---|---|
| Query origin | Camera pose (not player eye) | Matches what the player sees |
| Range | `interactRange` (default 3.0 m; upgradeable later) | Prevents remote-grab weirdness |
| LOS requirement | Static colliders block selection → never grab through walls (EC-MAN-02) | Physical credibility |
| Priority order | socket preview > attached component > loose component > scanner target > read-only prop | Predictable intent ranking |
| Disabled targets | Never focused; optional muted marker | Avoids dead prompts |
| Embedded/stuck targets | Focusable only if reachable; otherwise recovery affordance | EC-MAN-11 |
| Focus thrash guard | Candidate must be stable for N steps before prompt shows; hysteresis on switch | Prevents flicker |
| Feedback | Prompt (key + verb), outline/highlight, reticle state; shape + icon + color (never color alone) | Accessibility |
| Context sensitivity | Same ray, different filters per context (`Exploration` vs `Manipulation` vs `ScannerMode`) | §19 |
| Debug | Ray + candidate list + rejection reasons drawn by debug overlay | §37 |

**Contract:** `InteractionSystem` never changes world state. It only produces `FocusTarget` + `FocusChanged`. Only `ManipulationSystem` acts on it.
---

## 19. Manipulation State Machine

**Design rule:** the SM covers *only what the player's hands are doing*. Global application states (`Paused`, `UIMenu`) and separate contexts (`ScannerMode`, `PuzzleInspection`) are **not** SM states — they suspend the SM rather than multiply its states. `Attached` is **not** an SM state either: attachment is LMG truth; the SM only sees a `DetachPrompt` when looking at an attached component. This keeps the SM small (7 states) and prevents it from duplicating machine state.

**States:** `Exploration`, `Targeting`, `Grab`, `Manipulation`, `Rotation`, `SnapPreview`, `DetachPrompt`.

**Data held:** `focusedId`, `heldId`, `holdPose`, `preGrabPose`, `lastValidPose`, `snapCandidate`, `rotationAxis`, `elapsedInState`.

```text
                    focus acquired (stable N steps)
   ┌──────────────┐ ─────────────────────────────► ┌───────────┐
   │ Exploration  │                                │ Targeting │
   └──────┬─────── ◄───────────────────────────── └─────┬─────┘
          │              focus lost (or out of range)    │
          │                                              │ Grab (in range, grabbable, mass ok)
          │                                              ▼
          │                                        ┌───────────
          │        look at attached component      │   Grab    │  (acquire: preGrabPose saved)
          │ ◄──────────────────────────────────    └─────┬─────┘
   ┌──────┴────────┐                                     │ hold confirmed (1 step)
   │ DetachPrompt  │                                ┌────┴──────┐
   ──────┬────────┘                                ▼           │
          │ Detach (free space found)          ┌────────────── │
          │                                   │ Manipulation │─┘ release
          │                                   └──┬────────┬──┘
          │                                      │        │ release (valid) → Exploration
          │              rotate input            │        │ release (invalid/embedded) → back to Manipulation
          │                    ▼                 │        │ cancel → restore preGrabPose → Exploration
          │            ┌──────────────          │        │
          │            │   Rotation   │──────────┘        │ compatible socket enters volume
          │            ──────────────┘                   ▼
          │                                        ┌──────────────
          └──────────────────────────────────────── │ SnapPreview  │
                     confirm → attach (LMG edge)    └──────┬───────
                     exit socket volume → Manipulation      │ invalidated → Manipulation
                     cancel → Manipulation
```

**Transition table (exact; this is the test enumeration source — TEST §6):**

| From | Trigger | Guard | To | Side effects |
|---|---|---|---|---|
| Exploration | focus stable | target valid, in range, LOS clear | Targeting | `FocusChanged` |
| Targeting | focus lost/changed | — | Exploration | clear focus, `FocusChanged` |
| Targeting | primary | grabbable ∧ massWithinCapability ∧ not disabled | Grab | save `preGrabPose`, `lastValidPose`; PhysicsPort → kinematic follow |
| Targeting | primary | target attached component | DetachPrompt | show detach affordance |
| DetachPrompt | detach | free space resolvable | Exploration | `MachineGraph.detach` → recompute → validation dirty |
| DetachPrompt | cancel/look away | — | Exploration | — |
| Grab | hold confirmed (≥1 step) | held object exists | Manipulation | begin follow + assist |
| Grab | release before confirm | — | Exploration | restore `preGrabPose` |
| Manipulation | rotate input | rotation allowed for this component | Rotation | record axis; show rotation UI |
| Rotation | cancel/confirm | — | Manipulation | apply/rollback rotation per input |
| Manipulation | compatible socket detected | socket free ∧ compatible ∧ aligned | SnapPreview | preview pose, assist active, `SnapCandidateChanged` |
| SnapPreview | socket left volume / invalidated | — | Manipulation | clear candidate, no state change in LMG |
| SnapPreview | confirm | still valid at confirm step | Exploration | `MachineGraph.attach` → recompute → validation dirty → feedback |
| Manipulation | release | resulting pose valid (non-penetrating) | Exploration | set `lastValidPose`; physics restitution mode |
| Manipulation | release | pose invalid/embedded | Manipulation (stays) | refuse + feedback (EC-MAN-01/11) |
| Manipulation | cancel | — | Exploration | restore `preGrabPose` |
| Manipulation | hold range exceeded | config: softDetach | Exploration | drop at `lastValidPose` (EC-MAN-07) |
| any | pause / blur / context loss | — | (SM suspended) | clear input latches; on resume → Exploration with held object released (EC-BRN-05) |

**Invariants (asserted in tests):**
1. At most one object held; at most one snap candidate; at most one active state.
2. `MachineGraph` changes **only** on `DetachPrompt→detach` and `SnapPreview→confirm` (plus recovery paths) — never in `Manipulation`/`Rotation`.
3. Cancel always restores `preGrabPose` exactly (canonical quantised).
4. Every exit path from `Grab`/`Manipulation`/`Rotation`/`SnapPreview` guarantees the object ends in a recoverable pose.
5. SM never reads rendering or interpolation values — sim state only.
---

## 20. Physics Strategy

**Model: custom kinematic manipulation + static world colliders** (ADR-004). Nothing in gameplay depends on a rigid-body solver.

### 20.1 Components of the model

| Element | Implementation | Notes |
|---|---|---|
| World collision | Static AABB/OBB collider list built from level data; broadphase = uniform grid / BVH-lite | No dynamic world geometry in MVP |
| Player | Capsule vs static colliders; slide response; step offset 0.35 m | See §16 |
| Carryables | **Kinematic while held** (follows `holdPose`), collision-checked each step; **resting** carryables are static until grabbed | Removes the entire jitter/stacking problem class |
| Holds | Target pose from player + camera; clamped to `interactRange`; swept along the path | Clamp + sweep prevents tunnelling |
| Rotation | Constrained per component (allowed axes from `ComponentDefinition`) | Impossible rotations are unrepresentable |
| Depenetration | Push-out along minimum-translation vector, capped per step; search for nearest valid pose on release | EC-MAN-01/11 |
| Velocity | Explicit clamp (`maxLinearSpeed`, `maxAngularSpeed`) — no impulse accumulation | EC-PHY-04 |
| Sleeping | Resting carryables marked inert (no per-step work) | Wake on focus/grab/hazard (EC-PHY-03) |
| Recovery volumes | Invisible level volumes; anything inside → relocate to nearest safe pose | EC-MAN-09/10 |
| Determinism | All of the above run in the fixed 30 Hz step with quantised canonical poses | EC-MAN-12 |

### 20.2 Why the MVP does not need a physics engine

The agent of change in this game is the player, not gravity. Objects are either *held* (kinematic), *attached* (socket pose — no dynamics needed), or *resting* (static). There is no puzzle in the MVP whose solution depends on emergent rigid-body behaviour; all validation is logical (§24). Every engine we evaluated would add download weight, WASM memory pressure on an 8 GB machine, a second timestep to reconcile, and a new instability surface — for behaviour we do not use.

### 20.3 Threat model → protections (mapped to §39)

| Threat | Protection |
|---|---|
| Jitter / vibrating parts | Kinematic holds + resting = static; no solver → no jitter source. Visual smoothing is presentational only |
| Tunnelling | Swept collision along movement path + speed clamp + thin-collider flags (EC-PHY-02) |
| Unstable stacks | Stacks are inert unless grabbed; running/driving objects are deterministic (phase-based), never solver-driven (EC-PHY-05) |
| Exploding physics | No impulses; velocities are direct-controlled and clamped (EC-PHY-04) |
| Objects entering walls | Depenetration + refusal of invalid release + containment check each step |
| Objects falling out of level | Recovery volumes + bounds containment (EC-MAN-09/10) |
| Impossible rotations | Per-component allowed-axis constraint from definition data |
| Accidental machine destruction | `MachineGraph` changes only through explicit detach/attach paths and confirmed recovery rules; hazards never destroy components (they displace at most) |
| Inaccessible objects | Every carryable has a canonical spawn anchor + reset path (EC-PC-01, EC-GEN-01) |
| Low-FPS instability | Fixed-step, clamped substeps, no event-driven forces (EC-MAN-12) |
| NaN propagation | Pose sanitizer at step boundaries (EC-PHY-06) |

### 20.4 Migration path to a real engine (post-MVP)

Because L2 only ever talks to `PhysicsPort` (`raycast`, `sweepShape`, `overlapShape`, `setKinematicTarget`, `isPoseValid`, `clampVelocity`), a Rapier adapter can be added later behind the same interface **without touching L1, validation, or save format**. Trigger for reconsideration: a future puzzle genuinely requires emergent dynamics (e.g., free-rolling balls, fluid-ish material, buoyancy). If that day comes, the ADR must be revisited explicitly — not silently.

---

## 21. Snap / Socket Architecture

**Purpose:** convert a physical-ish intent ("put this here") into an atomic, logical attachment — reliably, with clear feedback, and without ever depending on solver behaviour.

### 21.1 Data model

```text
SocketDefinition   { id, machineId, ownerComponentId, poseAnchor, volumeRadius,
                     accepts: ComponentTag[] | SocketKind,
                     portDirection: 'in'|'out'|'bidir', orientationConstraint?,
                     occupiedBy?: componentId }
ComponentDefinition{ id, tags[], massClass, allowedAxes, socketKind, footprint,
                     visualKey, canonicalPose }
```

### 21.2 Pipeline (per fixed step, inside `ManipulationSystem`/`SnapSystem`)

```text
held component pose
   → snap volume query (PhysicsPort.overlapShape, socket layer only)
   → filter: free ∧ compatible ∧ orientation allowed ∧ not blocked by static geometry
   → rank: distance to socket anchor → orientation error → socketId (stable tie-break)
   → winner = single candidate (or none)
   → assist: lerp component toward socket pose proportional to proximity (never forced)
   → SnapCandidateChanged event (presentation)
   → on confirm: re-validate at the confirm step
        ∧ MachineGraph.attach(componentId, socketId)   [atomic]
        ∧ canonical pose := socket canonical pose
        ∧ recompute → validation dirty
```

### 21.3 Rules and guarantees

| Rule | Guarantee |
|---|---|
| One object → one socket | `attach` rejects if the socket is occupied or the component is already attached; no duplicate edges (EC-MAN-04, EC-SNAP-06) |
| Deterministic competition | Ranking is total and stable; ties resolve by lowest `socketId` (EC-MAN-03) |
| Confirm-step re-validation | Never attach to a socket that became invalid between preview and confirm (EC-MAN-06) |
| No rotational ambiguity | After attach, the component adopts the socket's canonical pose exactly; the player's partial rotation is absorbed, not preserved (EC-MAN-05) |
| Assist, never force | Snap assist eases position; it never teleports the object and never pulls it out of the player's control |
| Attachment ≠ physics | The socket pose is written to the LMG; the physics adapter converges visually toward it. Reload reproduces the same logical state regardless of visuals |
| Occupancy is derived | Socket occupancy is computed from LMG edges, never stored separately (no desync possible) |
| Detach | Symmetric: atomic edge removal; the component is placed at the nearest valid pose; if none is free, detach is deferred with clear feedback (never an embedded object) |
| Reason codes | Every rejection returns a typed reason (`Occupied`, `Incompatible`, `BadOrientation`, `Blocked`, `OutOfRange`, `Disabled`) — used by HUD, hints, and tests |

### 21.4 Validation interaction

Snapping never decides completion. It only mutates the graph; `Validator` (§24) decides meaning. This separation is what makes multi-solution puzzles possible without new snap code: P3's alternative layouts are *different graphs satisfying the same predicates* (EC-PZ-08).

## 22. Mechanical Component Model

**Concept:** components are **data + identity**, not behaviours. Logic lives in shared systems; per-component variation lives in definitions and capability tags.

```text
ComponentInstance {
  id: string                 // stable, canonical, used in save + graph
  defId: string              // -> ComponentDefinition
  kind: 'carryable'|'fixed'|'machine-part'|'tool'
  state: 'loose'|'held'(runtime only)|'attached'
  attachedTo?: SocketId
  canonicalPose: Pose        // quantised; authoritative
  spawnAnchorId: string      // recovery target
  flags: { required?: puzzleId, unique?: true, indestructible?: true }
}
```

| Category | MVP examples | Notes |
|---|---|---|
| Structural | frame segments, brackets, rails | Provide sockets; usually `fixed` |
| Transmission | gears, belts, shafts, pulleys | Tags + allowed axes; directionality matters (P2) |
| Power / flow | pipes, valves, pressure nodes, flywheel | Flow propagation through LMG (P3, BM-1) |
| Actuators | motor, piston, counterweight | Provide machine "output" capability |
| Utility | scanner target markers, clue plates | Mostly read-only interactables |

**Capability tags** are the compatibility language: `socketKind` on the socket side, `tags` on the component side. Tag sets are intentionally small and closed in the MVP (enumerable in `config/components.ts`) so that compatibility is testable exhaustively.

**Mass classes** (`light`, `standard`, `heavy`) gate handling by tool capability — the hook the upgrade system later scales (§28). In the MVP, all MVP-required parts are within default capability; classes are declared so the framework exists without extra MVP work.

**Required parts** (`flags.required`) get extra protections: registry integrity check on load + runtime watchdog that re-spawns a missing required part at its `spawnAnchorId` (EC-GEN-01). Optional/decorative parts have no such guarantee.

---

## 23. Machine Connectivity Model

**Yes, the MVP uses a graph — but a deliberately small one.** Machines are graph-structured because the questions we must answer are graph questions ("is there a path from power to output?", "is this chain complete?"), not geometry questions.

### 23.1 Representation

```text
LTG (Logical Topology Graph)
  nodes: NodeId  = ComponentId | SocketId | PortId
  edges: Edge    = { id, from: NodeId, to: NodeId, kind: 'attachment'|'flow'|'transmission' }
```

- An **attachment edge** is created *only* by `MachineGraph.attach/detach` (§21). It is the canonical record of "this part is in this socket".
- **Flow/transmission edges** are *derived* by propagation from attachment edges + component capability data (a gear transmits rotation between its two shaft ports; a pipe conducts pressure between its ends).
- A **machine** is a named subgraph: `{ machineId, rootNodes, requirements, outputNodes }`, defined in data.

### 23.2 Propagation algorithm

```text
recomputeIfDirty():
  if !dirty: return                      // structural events set dirty
  clear derived edges
  seed = nodes with source capability (power source, crank input, pressure source)
  BFS/DFS in deterministic order (sorted node ids) applying capability transfer rules
  compute per-node state: powered | unpowered | jammed | blocked
  compute machine outputs: outputNodes -> { value, direction?, pressure?, torque? }
  emit MachineChanged { machineId, outputs, nodeStates } if anything changed
  dirty = false
```

**Determinism:** traversal order is sorted; no iteration over unordered collections; derived values are quantised. Two runs on the same graph produce identical outputs — this is directly tested.

**Cost:** recompute runs only on structural change or explicit invalidation (valve toggled, crank turned), never per frame. Typical MVP machine size is well under 100 nodes, so a full recompute is trivially cheap.

### 23.3 Why not a full ECS / generic graph framework

The MVP needs exactly three operations — attach, detach, propagate — plus requirement evaluation. A generic ECS or general-purpose graph library would add indirection without removing any real work, and would make determinism harder to prove. The structure above is ~300–400 LOC and fully testable headlessly (a core MVP requirement).

### 23.4 What the graph deliberately does *not* contain

Render objects, physics bodies, transforms, animation phases, particle emitters, or audio emitters. Those are presentation concerns (§10). The graph stores **only** what validation and saving need.

## 24. Puzzle Validation Model

**Central rule:** puzzle completion is a function of the machine graph, never of component positions.

### 24.1 Requirement specification (data)

```text
PuzzleDefinition {
  id, title, branchId,
  machines: MachineDefinition[],
  requirements: Requirement[],        // all must hold (AND at top level)
  rewardIds: string[],                // -> RewardDefinition
  checkpointId?, hintIds[], tutorialId?
}

Requirement (discriminated union):
  | { kind: 'connected',   from: NodeRef, to: NodeRef, through?: ComponentTag }
  | { kind: 'componentAt', componentTag: Tag, socketKind: SocketKind, count: number }
  | { kind: 'output',      machineId, output: 'rotation'|'pressure'|'torque',
                           min: number, direction?: 'cw'|'ccw', equals?: number }
  | { kind: 'state',       machineId, state: 'running'|'powered'|'primed' }
  | { kind: 'sequence',    steps: Requirement[][], ordered: boolean }
  | { kind: 'safety',      machineId, condition: 'overpressure'|'unjammed' }
  | { kind: 'not',         requirement: Requirement }
  | { kind: 'any',         requirements: Requirement[] }   // enables alternate solutions
```

`any` + `output` thresholds are how multi-solution puzzles are expressed without bespoke code (P3, EC-PZ-08).

### 24.2 Evaluation

```text
evaluate(puzzleId):
  for each requirement:
     evaluate against LTG + machine outputs (never transforms)
  satisfied = AND of results
  reasonCodes = failed requirement ids (for hints + debug)
  with stable-frame hysteresis: satisfied must hold for STABLE_STEPS (default 3) before it counts
  return { satisfied, reasonCodes }
```

### 24.3 Transform independence in practice

A component attached to a socket has its **canonical pose set to the socket's pose** at attach time (§21). Validation reads only graph structure and derived outputs. Consequently:

- Nudging a mesh, interpolation jitter, physics convergence error, or quality-tier differences **cannot** change validation results.
- A puzzle that is solved stays solved even if the visuals continue settling.
- Tests can perturb every pose by ±1 m / ±180° and expect identical validation outcomes (A-8).

For the rare requirement that genuinely needs spatial meaning (e.g., "valve A must be physically reachable from valve B"), the rule consumes a **canonical relation from data** (e.g., same pipe network / declared adjacency), never a raw distance computation on live transforms.

### 24.4 Completion latch and hysteresis

- `Validator` is pure and may return `satisfied: true` repeatedly. It does not act.
- `PuzzleSystem` (owner of puzzle state, §12) applies the latch: first *stable* satisfied result transitions `Assembled → Validated → Activated` and emits `PuzzleCompleted` **once** (EC-PZ-01/02).
- Completion is never reverted by later invalidation (EC-PZ-03); only an explicit reset returns the puzzle to `InProgress`, and the reward ledger prevents re-granting (EC-PZ-04).

### 24.5 Reason codes for hints and feedback

---

## 25. Puzzle State Machine

**Owner:** `PuzzleSystem` (L1). **Persisted:** yes (canonical). One instance per puzzle.

```text
            branch access granted
 Locked ──────────────────────────► Available
                                       │ player enters area / interacts
                                       ▼
                                  InProgress ◄──────────────┐
                                       │                    │ reset()
                                       │ validator stable-true│ or detach below requirement
                                       ▼                    │
                                   Assembled ───────────────┤  (structure complete, not yet activated)
                                       │ activation input    │
                                       ▼                     │
                                   Validated ──────────────
                                       │ activation confirmed (stable)
                                       ▼
                                   Activated ──► [PuzzleCompleted emitted once] ──► Complete
                                       │
                                       └── (visual/motion state running; stays Complete)
```

| State | Meaning | Allowed next | Persisted |
|---|---|---|---|
| `Locked` | Not yet reachable (branch gated) | `Available` | yes |
| `Available` | Discoverable; nothing done | `InProgress` | yes |
| `InProgress` | Player is working; partial structure allowed | `Assembled`, `InProgress` (reset) | yes |
| `Assembled` | All structural requirements satisfied, not yet activated | `Validated`, `InProgress` (break) | yes |
| `Validated` | Requirements satisfied stably (hysteresis passed) | `Activated`, `InProgress` (break) | yes |
| `Activated` | Activation input confirmed | `Complete` | yes |
| `Complete` | Reward granted; terminal | — (reset only via explicit replay, post-MVP) | yes |

**Why `Assembled` and `Validated` are separate:** the player must be able to *see* "the machine is built" before "the machine runs". This is a design requirement (feedback layering, §32) and it also gives hints a well-defined escalation point.

**Why `Complete` is terminal:** progress is never taken away (EC-PZ-03). Re-running a machine is allowed visually; it does not re-open the puzzle.

**Reset semantics:** `reset()` returns the puzzle to `InProgress`, calls the recovery path for that machine's components (§31 `MachineReset` DTO), and **never** touches `RewardLedger` (EC-PZ-04, EC-PZ-05).

**Event contract (emitted by `PuzzleSystem`, consumed upward):**

| Event | Payload | Frequency |
|---|---|---|
| `PuzzleStateChanged` | `{ puzzleId, from, to }` | on transition |
| `PuzzleCompleted` | `{ puzzleId, milestoneId }` | **exactly once** per puzzle (latch) |
| `RequirementFailed` | `{ puzzleId, reasonCode }` | on change only (hint + HUD) |

## 26. Progression Architecture

**Hybrid model** (ADR-015): node-based unlocks (branches, blueprints, capabilities) with only two numeric resources (parts instances, materials). No stat inflation, no XP curve.

```text
ProgressionSystem
  ├── BranchState[]      { branchId: Locked|Available|InProgress|Complete }
  ├── HubStage           derived from completed branches (ordered stages)
  ├── UnlockRules        data: on PuzzleCompleted / BranchCompleted -> unlocks[]
  └── StoryClues         seen-id set (discovery events)
```

**Flow (data-driven, no bespoke per-puzzle code):**

```text
PuzzleCompleted(puzzleId)
  → RewardLedger.grant(milestoneId)        [idempotent — §27]
  → RewardSystem applies parts/materials/blueprint grants
  → UnlockRules.evaluate(milestoneId)      → e.g. door A-4 open, scanner available
  → BranchState update if branch complete  → unlock Branch B (visible but still gated in MVP)
  → HubStage advance                       → hub visual builder reads it (L4)
  → CheckpointSystem.mark(checkpointId)    → save trigger
  → SaveSystem.capture()                   → autosave
```

**Ownership rules:** progression never inspects the world directly; it consumes events. Hub visuals never mutate progression; they only read the hub stage. Branch gating is enforced by `AccessGate` reading `BranchState` — never by scene geometry.

**Expansion path (post-MVP, no rewrite):** a second branch is added by (a) new `BranchDefinition` + puzzle/reward data, (b) a door anchor in the hub with an `AccessGate`, (c) one `HubStageDefinition` entry. **No core system changes** — this is the scalability claim the verification gate tests.

---

## 27. Inventory / Parts / Materials / Blueprints

Three resources, deliberately different in nature — this removes whole classes of bugs (no stacks of unique parts, no cost-crafting in the MVP).

### 27.1 Model

```text
InventorySystem (L1, canonical)
  parts:      PartInstanceId[]          // unique instances, not counts
  materials:  Record<MaterialKind, number>   // small closed set: {scrap, brass, sealant, alloy}
  blueprints: Set<BlueprintId>          // unlock set

RewardLedger (L1, canonical)
  granted: Set<GrantId>                 // GrantId = `${sourceId}:${milestone}`
```

| Resource | Semantics | Why this shape |
|---|---|---|
| **Parts** | Actual mechanical components. Carrying one is a world object; owning one *not yet placed* is an inventory instance with a `spawnAnchorId` | Unique instances prevent duplication bugs and make "recover the lost part" (§31) tractable |
| **Materials** | Only used for upgrades/repairs. Four kinds maximum | Closed set keeps UI and save simple; no inventory bloat |
| **Blueprints** | Unlock new capability sets (interaction abilities, machine categories, puzzle possibilities) | Set semantics = naturally idempotent (R-8) |

### 27.2 Rules

1. **Grant anything only through `RewardLedger`.** Direct `inventory.parts.push(...)` calls are forbidden — this is what guarantees idempotency (R-1…R-10).
2. Parts may move: `inventory → world` (placed) and `world → inventory` (retrieved). Both directions are canonical events; the part instance id never changes.
3. **Required parts are indestructible** (`flags.required`, §22): hazards displace, never destroy.
4. No crafting costs in the MVP. Materials exist as a foundation and a milestone reward so upgrades have a currency when they arrive (§28).
5. `InventorySystem` never decides rewards; `RewardSystem` reads `RewardDefinition` and calls `InventorySystem`. Blueprint unlocks go through `BlueprintSystem.unlock(id)` (idempotent).
6. Missing/duplicate part instances detected on load are repaired via `ComponentRegistry` integrity checks (EC-GEN-01), with the repair reported in the load log — never silently.

### 27.3 MVP specifics

- Parts collected: the loose components required by P1–P3 and BM-1, plus a small number of optional spares.
- Materials: two kinds granted in the MVP (`scrap`, `brass`) purely to establish the pipeline.
- Blueprints in MVP: **one** — the scanner unlock, granted on P2 completion. This proves the pipeline (unlock → new capability → new interaction) with minimal scope.
- The HUD shows parts/materials in a compact panel; no grid inventory, no drag-and-drop, no slots UI in the MVP.

## 28. Upgrade Architecture

**MVP scope: framework only, zero upgrade content.** The requirement is that upgrades *can* be added without touching core systems — implemented as a modifier pipeline that already exists but is fed an empty table.

### 28.1 Modifier pipeline

```text
EffectiveValue = clamp(
    (baseValue + Σ additive[category]) * Π multiplicative[category],
    min, max)

Categories: 'interactRange' | 'carryMassClass' | 'rotationPrecision'
          | 'snapAssistStrength' | 'alignTolerance' | 'scannerRadius'
          | 'moveSpeed' | 'materialYield' | ...
```

- `UpgradeSystem` holds `Record<UpgradeId, level>`; each `UpgradeDefinition` contributes modifiers per level.
- Consumers ask `UpgradeSystem.valueOf(category, baseValue)` — they never read upgrade levels themselves. One indirection point, testable in isolation.
- Determinism: modifier application order is fixed (additive → multiplicative → clamp), and values are quantised before use in gameplay logic.

### 28.2 Three planned families (post-MVP)

| Family | Examples | Affects |
|---|---|---|
| **Interaction tool** | manipulation precision, heavier-object handling, alignment assistance, interaction range, specialised manipulation functions | `ManipulationSystem`, `SnapSystem`, `InteractionSystem` via categories |
| **Components** | stronger actuator, improved motor, stronger joint, increased power capacity | Component definitions + LMG capability data (data-only upgrades) |
| **Utility abilities** | scanner, mechanism analysis, temporary activation, connection visualisation | Unlocked *abilities* (from blueprints), not numeric modifiers |

Note the split: **numeric upgrades** ride the modifier pipeline; **capability unlocks** ride blueprints. Keeping these separate is why the MVP can ship the framework with no content and no dead code paths.

### 28.3 Rules

1. Upgrades are purchased/earned **only** through `RewardSystem`/`UpgradeSystem` APIs — never by mutating modifiers directly.
2. A modifier may never change *validation semantics* (e.g. "this gear now fits any socket" would be a data/capability change, not a modifier) — otherwise puzzle rules stop being testable.
3. Upgrade levels are canonical save state (framework present in v1 schema, empty in MVP).
---

## 29. Hint / Scanner Architecture

**Principle:** assistance escalates in *layers*, never skips to the answer, and is tracked completely independently of puzzle state.

### 29.1 Escalation ladder

| Level | Name | What the player gets | Trigger |
|---|---|---|---|
| **L0** | None | Nothing | default |
| **L1** | Environmental cue | Affordance emphasis: a loose part is subtly lit / a socket breathes / a room light points at the machine | explicit request (hint key/button) or generous idling threshold **within an InProgress puzzle** |
| **L2** | Audiovisual emphasis | The specific failed requirement's object pulses + directional sound cue; reason code shown in plain language ("this shaft isn't connected") | second request / longer stall |
| **L3** | Scanner reveal | Scanner overlay highlights relevant components, sockets, and the flow path for the failed requirement | scanner unlocked (blueprint) + request |
| **L4** | Conceptual hint | Short text/log-style nudge naming the *idea* ("power must reach the output through the free socket, not around it") — still no explicit placement | repeated L2/L3 without progress |

**Never given:** the solution as a placement list; auto-attach; auto-complete; skipping a puzzle.

### 29.2 Trigger rules (anti-annoyance)

- Idling alone does **not** auto-escalate while the player is clearly *exploring* (movement/scan behaviour). The stall timer only runs when the player is inside the puzzle area and interacting with its machine, and it is generous (tens of seconds).
- Escalation is **per puzzle**, monotonic by default, but decays slowly so a returning player isn't spammed at L4.
- Explicit request always advances at most one level and always responds immediately.
- Hint usage count/level is stored per puzzle in a **separate `HintState`** (canonical, §12). It never gates rewards, never marks puzzles, never appears in validation.

### 29.3 Scanner (L3 mechanism)

```text
ScannerMode (context, not an SM state — §19)
  → consumes: LTG, failed reason codes, socket definitions
  → presents: highlight rig (L4), flow-path overlay, labels from data
  → duration-limited + cooldown; visual only; cannot be used to bypass interaction
  → reads reason codes from Validator; it never re-computes rules itself
```

The scanner is the visible payoff of the one MVP blueprint (§27) — it proves the "blueprint → new capability" pipeline end-to-end.

**As shipped (M10):** the derivation is pure L1 (`game-state/scanner-reveal.ts` — collects what the
failed requirement names, never evaluates), duration + cooldown are owned by the L4 presenter
(`presentation/scanner-overlay.ts`, stepped in the fixed step like the feedback pulse clock), and the
render port exposes one additive method (`RenderPort.setScannerOverlay`, the M6-precedent pattern). The
composition resolves ids to world points and refuses with words (no machine in view / nothing failing /
still recharging); the HUD reads ready/scanning/cooling from the presenter, and the revealed line is the
requirement's own plain-language text (§33.2 rule 1).

## 30. Hazard Architecture

**Purpose:** hazards teach mechanisms and create *tempo*, never permanent loss. No combat, no death loops, no progression destruction.

### 30.1 Model

```text
HazardDefinition { id, kind, area (volume), phase/timing, telegraph, effect, recoveryTo }
  kinds (MVP): 'steamJet' | 'movingPress'   |   (post-MVP) 'electric' | 'unstable' | 'heat'
  effect:      'knockback' | 'stagger' | 'dropHeld' | 'respawn'
  telegraph:   pre-fire visual + audio cue, always >= T_telegraph (e.g. 0.6 s)
```

### 30.2 Rules

1. **Telegraph first.** Every hazard announces before it acts. A hazard that can hit with zero warning is an architecture violation.
2. **Deterministic timing.** Hazard cycles are phase-based and advance in the fixed step; they are reproducible and testable (canonical phase offsets per §12).
3. **Never destructive to required parts.** Effects are `knockback`/`stagger`/`dropHeld`/`respawn`; a caught part is displaced, never destroyed. A part inside a moving volume is ejected to the nearest valid pose at cycle end (EC-HAZ-02).
4. **Never traps the player.** Post-hit recovery always resolves to a valid pose or checkpoint anchor (EC-PC-03/04).
5. **Never required for progression.** Hazards can make a route harder, but every MVP puzzle must remain solvable with hazards disabled at verification time (belt-and-braces against unfun soft-locks).
6. **Hazard state is visible in-world**, not only in the HUD (pipes hiss, gauges redline, machinery moves) — readability is the warning.
7. **Disable-on-solve.** A solved puzzle's machinery hazard (e.g. the press guarding BM-1) deactivates once the machine runs, so the reward area feels earned and safe.
8. **Recovery integration.** Any hazard effect that moves the player or a part triggers the same recovery paths as ordinary mishaps (§31) — no special-case code.

### 30.3 MVP content

| Hazard | Where | Teaches | Effect |
|---|---|---|---|
| Steam jet | Pressure Gallery corridor + P3 area | pipe pressure is real; respect the rhythm | knockback + brief stagger |
| Moving press | BM-1 approach | timing through machinery; read the cycle | dropHeld + respawn at local checkpoint |

---

## 31. Save / Checkpoint Architecture

### 31.1 Canonical snapshot (the ONLY thing persisted)

```text
SaveFile (v1) {
  version: 1,
  meta:      { savedAt, gameVersion, playtimeSec, slot: 'autosave'|'checkpoint' },
  settings:  { quality, sens, invertY, fov, autoRecentre, audioBusLevels, reducedShake },
  progression:{ branchStates, hubStage, storyClues: string[] },
  puzzles:   { [puzzleId]: { state, machineVisualState, hintLevel, hintsUsed } },
  machines:  { [machineId]: { edges: [componentId, socketId][], machineStateFlag } },
  components:{ [componentId]: { defId, attachedTo?, canonicalPose, lastValidPose, inInventory } },
  inventory: { parts: string[], materials: {kind:number}, blueprints: string[] },
  rewards:   { granted: string[] },            // GrantId set — idempotency source of truth
  upgrades:  { [upgradeId]: level },
  checkpoint:{ id, anchorId }
}
```

**Never persisted:** held-object state, SM state, physics bodies, render objects, `THREE.*`, animation phases, particle state, audio nodes, camera pose, transient timers, interpolation values.

### 31.2 Persistence levels

| Level | Contents | Example |
|---|---|---|
| **Persistent (canonical)** | Everything in §31.1 | progression, edges, rewards, inventory |
| **Checkpointed** | Snapshot of the canonical set at a checkpoint trigger + player anchor id | hub entry, pre-hazard checkpoint, puzzle-start checkpoint |
| **Runtime-only** | Never saved, rebuilt each load | manipulation SM, physics, VFX, camera, hazards phase |
| **Reconstructable** | Derived from canonical state on load | LTG derived edges, socket occupancy, hub visuals, machine motion phase, validation results |

### 31.3 Write protocol (crash-safe)

```text
capture():  build SaveFile DTO  →  JSON.stringify  →  validate against schema
write():    write slot B 'pending'  →  verify readback  →  promote to slot B
            keep slot A (previous good) untouched until promotion succeeds
failure:    log + notify; slot A remains the loadable save (EC-SAVE-01/04/12)
```

Two slots (`autosave`, `checkpoint`) with newest-valid-wins precedence (EC-SAVE-08). Storage access is behind `StoragePort` so tests inject a fake that can fail mid-write.

### 31.4 Triggers

| Autosave | Checkpoint |
|---|---|
| important part collected | entering a hazard zone (pre-risk) |
| puzzle completed | before a complex manipulation section |
| machine activated | before an irreversible-looking sequence |
| blueprint unlocked | on branch entry |
| branch completed / hub stage change | — |
| settings changed (settings-only write) | — |

**Rule:** saves happen on **events outside the sim loop**, never per frame, never mid-manipulation. If an autosave is requested while the player holds an object, the DTO records the object at `lastValidPose` and excludes the hold (EC-SAVE-02).

### 31.5 Load protocol

```text
read both slots → pick newest valid → parse JSON → schema validate
  → version check: equal? use. older? run migration chain. newer? refuse (SaveVersionUnsupported)
  → integrity checks:
       duplicate ids                  → reject (EC-SAVE-07)
       missing component/socket refs  → reset affected machine, keep progression (EC-SAVE-06)
       level-definition mismatch      → reset affected puzzle, warn (EC-SAVE-11)
       ledger ↔ puzzle-state mismatch → reconcile (EC-SAVE-09/10)
  → rebuild L1 state → rebuild registry (+ respawn missing required parts, EC-GEN-01)
  → rebuild L2 systems + scene from reconstructable data
  → spawn player at checkpoint anchor (nearest safe clearance, EC-PC-04)
```

**All failures are typed** (`SaveMalformed`, `SaveVersionUnsupported`, `SaveIntegrityError`) and surfaced in the UI; there is no code path that silently loads partial data.

### 31.6 Recovery design (failure → behaviour)

| Failure | Behaviour |
|---|---|
| Corrupt autosave, valid checkpoint | Load checkpoint, inform the player, keep the corrupt blob for diagnosis |
| Both corrupt | Title screen offers "Start fresh (corrupt data preserved)" — never auto-wipes |
| Missing required part after load | Re-spawn at `spawnAnchorId`; report in load log |
| Reward/puzzle desync | Ledger wins for grants; puzzle state repaired to match (§11 R-10) |
---

## 32. Audio / Feedback Architecture

**Design goal:** the *feeling of machines working* is the reward. Feedback is layered, short, and mechanically synchronized — never a fireworks show.

### 32.1 Translation pipeline (no system plays sound directly)

```text
L1 events (MachineAttached, PuzzleCompleted, MachineRunning…)
        ↓
FeedbackModel (L2, deterministic)     ← decides WHAT feedback is warranted
        ↓  FeedbackIntent[]
FeedbackComposer (L4)                 ← decides HOW it looks/sounds
        ↓
AudioBus (WebAudio) + VFX (three.js) + camera impulse + HUD pulse
```

`FeedbackModel` is plain logic (testable headlessly): it dedupes (a completion produces **one** celebration intent), orders, and suppresses noise during rapid events.

### 32.2 Audio buses

| Bus | Contents | Behaviour |
|---|---|---|
| `master` | everything | user volume |
| `music` | sparse ambient drone / tension beds (MVP: minimal or none) | ducks during major feedback |
| `sfx` | impacts, clicks, servo whirrs, pressure hiss | core mechanical layer |
| `ui` | prompts, confirmations, menu | never randomized |
| `ambience` | room tone, machine hum | looped, cross-faded by zone |

Positional emitters for machinery near the player; global for UI. Audio node pooling to avoid GC churn. Context unlocked on first gesture (EC-BRN-08); all audio optional (game is fully playable silent).

### 32.3 Feedback recipes (canonical example — a correct attachment)

| # | Layer | Detail |
|---|---|---|
| 1 | Tactile | snap assist settles the object (≤0.15 s, eased) |
| 2 | Sound | mechanical `click` (dry, close-mic'd), 60–120 ms |
| 3 | Light | socket indicator changes state; brief local glow |
| 4 | Motion | connected mechanism reacts *only if* the machine now propagates (no fake motion) |
| 5 | Sound layer | low confirm tone only when the change affects machine state |
| 6 | HUD | prompt updates; reason codes clear |

Puzzle completion uses the same layers with more weight (machine runs, room lights shift, camera impulse ≤2°, one music sting). **Budget:** completion feedback ≤1.5 s, never blocking input.

### 32.4 Rules

1. Feedback never mutates game state (L4 is downstream-only).
2. No feedback may be the *only* signal for something mechanically important (color/audio alone is insufficient — combine shape + motion + sound).
3. Reduced-motion / reduced-shake settings scale camera impulses and particle density to zero without changing gameplay.
4. Every recipe is data (`feedback.ts`) — a new machine does not require new code.

## 33. UI / HUD Architecture

**Approach:** DOM overlay + CSS, no framework (ADR-010). The HUD is a *read-model consumer* — it renders snapshots and emits intents; it never touches the world.

```text
L1/L2 owners ──snapshot (per frame or on change)──► HUD (L4)
HUD ──intent events (HintRequested, PuzzleResetRequested, PauseRequested)──► owning systems
```

### 33.1 Surfaces (MVP)

| Surface | Contents | Source |
|---|---|---|
| **Reticle + focus** | crosshair state, target name, verb hint, key label (from the binding map) | `InteractionSystem`, `config/input.ts` |
| **Manipulation strip** | held object name, rotate/confirm/cancel keys, socket validity (icon + color + text) | `ManipulationSystem`, `SnapSystem` |
| **Objective line** | current puzzle name + top-level failed requirement in plain language | `PuzzleSystem`, `Validator` reasons |
| **Resource panel** | parts (count/needed), materials, blueprints | `InventorySystem` |
| **Hint affordance** | hint button + current level indicator (never shows the answer) | `HintState` |
| **Toasts** | "+part", "blueprint unlocked", recovery notices, save warnings | event stream |
| **Menus** | title, pause, settings (quality, sens, invert, FOV, volumes, reduced shake), save slot info | `SettingsStore`, `SaveSystem` |
| **Debug overlay** | §37 (dev only) | debug layer |

### 33.2 Rules

1. **One source of truth per label.** Key names come from the binding map; requirement text comes from validator reasons; nothing is duplicated in markup.
2. **No world mutation.** Every HUD action is an intent event; owning systems validate and apply (R8).
3. **Never blocking.** HUD never pauses the sim except for menus; toasts are non-modal.
4. **Readability first.** Restrained palette (industrial neutrals + a small functional color set: interactive / powered / unpowered / compatible / invalid / hazardous / complete), always paired with shape/icon/motion/sound — never color alone.
5. **Performance.** DOM updates are batched per frame; text mutated only on change (no per-frame layout thrash). HUD must cost <0.5 ms/frame at p95.
---

## 34. Asset Pipeline

### 34.1 Asset classes and formats

| Class | Format | Loading | Budget notes |
|---|---|---|---|
| Level geometry | glTF/GLB (static), or GLB baked from a DCC tool | lazy per zone/branch | merge/instance statics; no per-prop draw calls |
| Component props (carryables) | GLB, shared materials | lazy per branch | low-poly, one material where possible |
| Materials | standard PBR, **no** expensive shader graphs | bundled | MVP may ship flat/vertex-color-friendly materials |
| Textures | PNG/WebP, ≤1024² typical (512² for props) | lazy + cached | KTX2/Basis deferred to a post-MVP art pass |
| Audio | `.ogg` (fallback `.mp3`), short one-shots + a few loops | lazy by zone | pooled nodes; no long uncompressed files |
| UI | HTML/CSS | bundled | 0 KB JS framework |
| Data (config) | TypeScript modules → JSON at build | bundled | puzzle/machine/socket definitions; type-checked, tree-shaken |

### 34.2 Loading strategy

```text
BOOT:      runtime + UI + hub data + hub assets      (must be small — <8 MB cold budget)
PLAY:      on branch entry, load that branch's chunk (geometry, props) with a progress affordance
STREAMING: optional; MVP uses zone-based discrete loads, not continuous streaming
```

- Asset loading is behind `AssetPort`; `AssetLoaderImpl` (L4) does the real work with a bounded concurrency queue.
- **Determinism rule:** gameplay must not depend on asset load order or on a mesh being present. L1 state exists before/without meshes; the scene builder attaches visuals when ready. A late-loading model never blocks a puzzle or a save.
- Placeholder-first workflow: every component has a procedural primitive fallback (box/cylinder with the right footprint) so Phases 1–9 run with zero art assets. This is what keeps the 8 GB development machine comfortable and keeps token/asset burn near zero while systems are proven.

### 34.3 Authoring rules

1. One mesh per component instance; transforms come from `canonicalPose`, never baked into the mesh.
2. Sockets are data (`SocketDefinition`), optionally visualized by debug meshes — not geometry-dependent.
3. Colliders are authored/derived per component as simple primitives (OBB/capsule), never trimesh.
4. No baked lighting dependency: MVP lighting is dynamic (few lights) so quality tiers can scale (§35).
5. Asset memory is accounted for in the budget (§36); each branch chunk has a ceiling.

## 35. Performance Strategy

### 35.1 Principles

1. **Measure before optimizing.** Phase 13 profiles; optimization targets only demonstrated bottlenecks.
2. **Gameplay is quality-independent.** Tier changes never alter simulation, validation, or saves (ADR-014).
3. **Budget-driven, not vibes-driven.** Every scene has a draw-call/triangle/light ceiling (§36).
4. **Cheap by construction.** Few static meshes, instancing for repeated props, primitive colliders, no dynamic shadows on props, minimal post-processing.

### 35.2 Quality tiers

| Knob | Low | Medium | High |
|---|---|---|---|
| Render scale | 0.75× | 1.0× | 1.0× |
| Device pixel ratio cap | 1.0 | 1.25 | 1.5 |
| Shadow-casting lights | 0 | 1 | 1–2 |
| Shadow map | 512 | 1024 | 2048 |
| Shadow distance | off | 20 m | 35 m |
| Particles | off / minimal | reduced | standard |
| Post-processing | none | none | optional vignette/AA |
| Draw distance | 40 m | 70 m | 120 m |
| LOD levels | 2 | 3 | 3 |
| Animated props | core only | most | all |
| Ambient occlusion | off | off | optional (baked only) |

Auto-detection: one-time probe (frame-time sample + `deviceMemory`/`hardwareConcurrency` hints) sets a default tier; the player can always override. Adaptive fallback: if p95 frame time exceeds budget for a sustained window, step one tier down with hysteresis; never step up automatically mid-puzzle (avoids visual pops during solve moments).

### 35.3 Hot-loop discipline

| Rule | Why |
|---|---|
| No allocations in `simulate()` or `render()` (reuse vectors/objects, preallocated scratch) | avoids GC hitches — the #1 cause of perceived stutter |
| Broadphase + dirty flags; no full-scene scans per frame | keeps CPU cost flat as content grows |
| `MachineGraph.recomputeIfDirty()` only | propagation is event-driven, never per frame |
| Validator is dirty-driven + hysteresis | no per-frame requirement evaluation across all puzzles |
| DOM writes batched, text mutated on change only | prevents layout thrash |
| Node pooling for audio/VFX | avoids spike allocations on bursts |
| `requestAnimationFrame` single loop; no nested timers for gameplay | determinism + predictable cost |

### 35.4 Degradation ladder (in order, when over budget)

1. Reduce shadow quality/count → 2. cap pixel ratio → 3. drop render scale → 4. disable particles/post → 5. shorten draw distance → 6. reduce animated props → 7. (never) change gameplay.

### 35.5 Memory strategy (8 GB machine, ~1.5 GB free worst case)

- No WASM physics, no large libs → the JS heap stays small and predictable.
- Textures are the dominant risk: caps enforced per class, shared materials across props, no duplicate textures per component.
---

## 36. Performance Budget

Targets are for the **target-class machine** (8 GB RAM, integrated/entry GPU, 1920×1080) with reasoning, not aspiration.

### 36.1 Frame budgets

| Metric | Target | Rationale |
|---|---|---|
| Target FPS | 45–60 | Spec. 60 preferred; 45 as acceptable floor in the heaviest branch view |
| Frame time budget | 16.6 ms @60 / 22 ms @45 | 45 FPS = 22.2 ms; leave headroom for browser jank |
| JS (logic + sim) | ≤ 6 ms p95 | Sim is fixed 30 Hz → ~2 steps/frame typical; kinematic physics is cheap |
| Render submission (CPU) | ≤ 6 ms p95 | Dominated by draw calls; capped below |
| GPU | ≤ 10 ms p95 @High | Integrated GPU at 1080p with 1–2 shadow maps |
| HUD + DOM | ≤ 0.5 ms p95 | Batched writes, change-only text |
| Audio | negligible CPU | WebAudio mixing, pooled nodes |

### 36.2 Scene budgets

| Metric | Hub | Branch (worst view) | Rationale |
|---|---|---|---|
| Draw calls | ≤ 100 | ≤ 150 | Statics merged/instanced; props are single-material |
| Visible triangles | ≤ 150 k | ≤ 250 k | Low-poly industrial shapes; no dense foliage/high-detail props |
| Active lights | ≤ 6, of which ≤ 2 shadow-casting | ≤ 8, ≤ 2 shadow-casting | Real-time shadows are the main GPU risk; emissives + baked-free ambience preferred |
| Materials | ≤ 20 unique | ≤ 30 unique | Material count drives state changes and memory |
| Textures | ≤ 25 | ≤ 35 | Shared across props |
| Texture resolution | ≤ 1024² (512² props) | same | 1024² RGBA ≈ 4 MB each uncompressed; kept few |
| Texture memory | ≤ 48 MB hub | ≤ 128 MB total loaded | Hard ceiling on the low-memory machine |
| LODs | — | 2–3 levels for large props | Cheap win; geometry swaps only |

### 36.3 Simulation budgets

| Metric | Budget | Rationale |
|---|---|---|
| Fixed step rate | 30 Hz (max 5 substeps/frame) | Determinism + CPU headroom; 5 substeps caps catch-up at 250 ms lag |
| Active colliders (statics) | ≤ 400 in a zone | Broadphase handles this trivially |
| Dynamic / kinematic bodies | ≤ 12 simultaneous | Only held objects + activated machinery parts |
| Raycast queries | ≤ 20/step | Interaction (1–4) + camera (1–3) + snap overlap (1–3) + hazards (few) |
| Machine graph nodes per machine | ≤ 100 | Full recompute stays sub-millisecond |
| Validation evaluations | dirty-driven only | Hysteresis means a few per second, not per frame |

### 36.4 Memory / network budget

| Metric | Budget | Rationale |
|---|---|---|
| Initial download (cold) | ≤ 8 MB | Runtime + data + hub; a 3G-ish connection still boots fast |
| Lazy branch chunk | ≤ 4 MB | Downloaded on entry with progress affordance |
| Total MVP assets | ≤ 20 MB | Includes audio; achievable with placeholder-first + modest textures |
| JS heap after 20 min | ≤ 250 MB, flat trend | No leaks; branch disposal verified |
| GPU memory | ≤ 300 MB | Textures + geometry + render targets (few) |
| Save size | ≤ 512 KB raw, ≤ 150 KB gzipped | localStorage-friendly; DTOs only |

### 36.5 Budget enforcement

- A perf overlay (§37) shows live draw calls/triangles/frame time vs budget, colour-coded.
- Phase 13 adds automated checks that fail when budgets are exceeded in the test scenes.
- **Budgets are ceilings, not targets to hit.** If a scene comes in far under budget, we do not spend it on effects by default — headroom protects the 45 FPS floor on weaker hardware.

## 37. Debug Tooling

Developer-only (stripped/gated in production builds). Purpose: make the *boundaries* observable — most bugs live there.

| Tool | Shows | Toggle |
|---|---|---|
| **FPS / frame-time overlay** | fps, frame ms, JS ms, GPU ms (if available), step count, memory (if available) | F3 |
| **Perf vs budget** | live draw calls/triangles/lights/textures vs §36 ceilings, colour-coded | F3 (extended) |
| **Interaction ray view** | ray origin/direction, hits, candidate list, **rejection reasons** | F4 |
| **Socket visualisation** | socket anchors, volumes, accepted kinds, occupancy, validity colouring | F5 |
| **Manipulation SM inspector** | current state, held id, candidate, guard values, transition log | F6 |
| **Machine graph viewer** | nodes, attachment edges, derived flow edges, per-node state, failed requirements + reason codes | F7 |
| **Puzzle state inspector** | all puzzles: state, stable-frame counter, last validation result, hint level | F8 |
| **Save-state inspector** | canonical DTO tree, size, slot status, last write result, diff vs previous | F9 |
| **Progression inspector** | branch states, hub stage, ledger entries (grant ids), inventory | F10 |
| **Physics debug** | colliders (static/kinematic), swept paths, recovery volumes, depenetration events | F11 |
| **Teleport / spawn tool** | jump to puzzle areas, spawn any component at a socket/anchor | dev console |
| **Determinism harness** | record an input script, replay it at fixed step, compare canonical state hashes | dev console |
| **Event tap** | live stream of typed domain events (filterable) | dev console |

---

## 38. Error Handling Strategy

**Philosophy:** gameplay errors must never be fatal, must never lose progression, and must always be diagnosable. Errors are typed, categorized, and handled by the layer that owns the decision.

### 38.1 Error taxonomy

| Class | Examples | Handling | Player-visible? |
|---|---|---|---|
| **Fatal (boot)** | no WebGL2, bundle failed, data schema invalid in prod | Blocking screen with clear message + retry; log detail | Yes |
| **Recoverable adapter** | audio init failed, storage unavailable, texture load failed | Degrade gracefully (silent audio / memory-only save / placeholder mesh), continue | Subtle notice |
| **Domain rejection** | attach rejected, invalid release, corrupt save refused | Typed reason code returned; caller decides UX; **no exception** for expected outcomes | Contextual |
| **Invariant violation (dev)** | duplicate edge, impossible SM state, NaN pose, unreachable required part | Loud log + assert in dev; in prod auto-repair via recovery path + log | Only if it affects the player |
| **Unexpected exception** | bug inside a system | Caught at the loop boundary; that sim step aborts, loop continues; canonical state untouched | Toast + copyable report |

### 38.2 Rules

1. **Expected failures return values, not exceptions** — `attach()` returns `{ ok: false, reason: 'Occupied' }`.
2. **The sim step is a sandbox** — a throw inside `simulate()` is caught at the boundary, logged with step index + state hash, and the step is skipped. A system bug never kills the loop.
3. **Canonical state is sacred** — repairs may reset a *machine* or a *puzzle*, never unlocks, inventory, or the reward ledger.
4. **Never silent** — every degradation logs a stable code (`ERR-ADAPTER-AUDIO-01`) documented in one place; the debug overlay shows the last N errors.
5. **Fail fast in development, fail soft in production** — schema/invariant violations throw in `import.meta.env.DEV` builds; in production they auto-repair via the recovery path.
6. **Loop-boundary guards** for the four classic browser hazards: WebGL context loss, visibility change, memory pressure, and audio suspension (EC-BRN-03/07/08).

### 38.3 Required error codes (MVP)

---

## 39. Edge Case Registry

Each entry: **scenario → expected behaviour → prevention → recovery → test**. `TEST_SUITE_PLAN.md §17` uses the **same EC-IDs**, so registry and tests cannot drift apart.

### 39.1 Manipulation

**EC-MAN-01 · Object released inside geometry** — *Expected:* pushed to nearest valid pose (search ≤0.5 m) or returned to `lastValidPose`; never left embedded. *Prevention:* release validation against static colliders before commit. *Recovery:* depenetration → `lastValidPose` fallback. *Test:* 6.1, 17.1.

**EC-MAN-02 · Object grabbed through a wall** — *Expected:* grab refused, no focus acquired. *Prevention:* LOS filter in `InteractionSystem` (camera-origin ray vs static colliders). *Recovery:* none needed. *Test:* 5.1.

**EC-MAN-03 · Two sockets compete for one object** — *Expected:* one deterministic winner (nearest anchor; tie → lowest `socketId`). *Prevention:* total ordering in snap ranking. *Recovery:* re-evaluated next step. *Test:* 7.3.

**EC-MAN-04 · Object enters multiple snap zones at attach** — *Expected:* exactly one socket receives the edge; others stay free. *Prevention:* attach is single-target and atomic. *Recovery:* none. *Test:* 7.4.

**EC-MAN-05 · Snapping while rotating** — *Expected:* attach adopts the socket's canonical pose; partial rotation absorbed. *Prevention:* attach writes `canonicalPose := socket.pose`. *Recovery:* cancel restores prior rotation. *Test:* 7.5.

**EC-MAN-06 · Snap becomes invalid during attachment** — *Expected:* attach aborts atomically; object returns to hold; LMG unchanged. *Prevention:* confirm-step re-validation in the same sim step as `attach`. *Recovery:* hold retained. *Test:* 7.6.

**EC-MAN-07 · Player moves too far while holding** — *Expected:* soft-detach at `lastValidPose` (config-driven) and consistent. *Prevention:* hold-range clamp + explicit config flag. *Recovery:* object recoverable in place. *Test:* 6.4.

**EC-MAN-08 · Leaves puzzle area holding a required part** — *Expected:* allowed; boundary volume offers carry-back; part never orphaned. *Prevention:* required parts carry `spawnAnchorId` + boundary volumes. *Recovery:* recall to anchor. *Test:* 6.5, 12.4.

**EC-MAN-09 · Object pushed outside the world** — *Expected:* recovery volume returns it to a safe pose. *Prevention:* bounds containment check each step. *Recovery:* auto-relocation. *Test:* 8.9.

**EC-MAN-10 · Object underneath the floor** — *Expected:* containment test triggers relocation. *Prevention:* thin-collider flags, swept tests, containment probe. *Recovery:* nearest valid pose. *Test:* 8.9.

**EC-MAN-11 · Object clips through another machine** — *Expected:* release rejected → returns to hold; never embedded. *Prevention:* release validation includes machine colliders. *Recovery:* hold retained with clear feedback. *Test:* 6.2.

**EC-MAN-12 · Very low FPS while holding** — *Expected:* identical canonical outcome to high FPS. *Prevention:* fixed 30 Hz step, clamped substeps, sim-only validation. *Recovery:* none needed. *Test:* 6.6, 8.1, 15.

**EC-MAN-13 · Rapid input burst (double grab)** — *Expected:* second input ignored; one held object max; atomic transitions. *Prevention:* SM guard + one-shot latch per sim step. *Recovery:* none. *Test:* 6.8.

### 39.2 Puzzle State

**EC-PZ-01 · Valid configuration reached temporarily** — *Expected:* no completion; requires stability for `STABLE_STEPS` (default 3). *Prevention:* hysteresis counter in `PuzzleSystem`, never in `Validator`. *Recovery:* counter resets, no state change. *Test:* 9.2.

**EC-PZ-02 · Puzzle completion event fires twice** — *Expected:* exactly one `PuzzleCompleted`, one grant, one celebration. *Prevention:* transition latch (`Activated` is entered once) + `RewardLedger` grant-id check + `FeedbackModel` dedupe. *Recovery:* duplicates ignored. *Test:* 9.2, 10.3.

**EC-PZ-03 · Machine becomes invalid immediately after completion** — *Expected:* puzzle stays `Complete`; visuals may de-power. *Prevention:* `Complete` is terminal in the SM; validation results cannot rewind it. *Recovery:* none needed. *Test:* 9.3.

**EC-PZ-04 · Puzzle reset after reward** — *Expected:* back to `InProgress`; **no** second reward. *Prevention:* ledger persists grant ids across resets. *Recovery:* none needed. *Test:* 9.8, 10.5.

**EC-PZ-05 · Soft-lock: no reachable legal configuration** — *Expected:* hint escalation + explicit reset affordance; never a silent dead end. *Prevention:* every puzzle is proven solvable headlessly (solver simulation, TEST §6) and every required part is recoverable; level design forbids sealed pockets (EC-PC-01). *Recovery:* machine reset restores canonical defaults. *Test:* 12.6.

**EC-PZ-06 · Sequence breaking** — *Expected:* completes when the full required graph is satisfied; order enforced only where data declares it (`sequence` requirement with `ordered: true`). *Prevention:* requirements are structural; ordering is opt-in data. *Recovery:* none. *Test:* 9.5.

**EC-PZ-07 · Machine partially completed before tutorial trigger** — *Expected:* tutorial recognizes existing progress, never blocks or re-shows. *Prevention:* tutorials read current graph/state before firing. *Recovery:* none. *Test:* 9.6.

**EC-PZ-08 · Required part used in an unexpected valid configuration** — *Expected:* completes if predicates hold (multi-solution). *Prevention:* `any`/`output` requirement composition; validation independent of exact placement. *Recovery:* none. *Test:* 9.7, A-7.

**EC-PZ-09 · Two puzzles share a component** — *Expected:* ownership follows current attachment; the other puzzle's requirement simply reads unmet. *Prevention:* single attachment edge per component (§23). *Recovery:* detach and move. *Test:* 17.2.

### 39.3 Physics

**EC-PHY-01 · Extreme delta time** — *Expected:* dt clamped, ≤5 substeps, accumulator dropped beyond that; state finite. *Prevention:* frame-time clamp + substep cap. *Recovery:* none needed. *Test:* 8.3.

**EC-PHY-02 · Tunneling through thin geometry** — *Expected:* never passes through. *Prevention:* swept-shape tests along movement + speed clamp + minimum collider thickness rules. *Recovery:* depenetration. *Test:* 8.2.

**EC-PHY-03 · Physics body sleeps incorrectly** — *Expected:* wakes on interaction/proximity/hazard; never sleeps mid-hold. *Prevention:* hold state forces active; wake volumes. *Recovery:* auto-wake on next query. *Test:* 8.5.

**EC-PHY-04 · Collision instability / penetration** — *Expected:* penetration resolved within per-step caps; no oscillation runaway. *Prevention:* MTD push-out with cap; no impulse accumulation. *Recovery:* position clamp. *Test:* 8.6.

**EC-PHY-05 · Stacked components "explode"** — *Expected:* stable. *Prevention:* resting bodies are static (no solver), so stacking is not a dynamic problem at all. *Recovery:* position clamp. *Test:* 8.7.

**EC-PHY-06 · NaN / Infinity in a transform** — *Expected:* sanitized to last valid pose, logged, gameplay continues. *Prevention:* pose sanitizer at step boundaries + finite checks on every write. *Recovery:* `lastValidPose` restore. *Test:* 8.8.

### 39.4 Save / Load

**EC-SAVE-01 · Interrupted write** — *Expected:* previous slot intact and loadable. *Prevention:* dual-slot write + readback verify before promotion. *Recovery:* load last-good. *Test:* 11.6.

**EC-SAVE-02 · Save while holding a component** — *Expected:* hold excluded; object recorded at `lastValidPose`. *Prevention:* canonical DTO has no "held" field (unrepresentable). *Recovery:* object loads loose. *Test:* 11.11.

**EC-SAVE-03 · Save while a machine is moving** — *Expected:* only logical state saved; animation restarts deterministically. *Prevention:* motion phase is reconstructable, not persisted. *Recovery:* rebuild from canonical flag. *Test:* 11.12.

**EC-SAVE-04 · Browser closed mid-save** — *Expected:* last-good slot loadable. *Prevention:* write-then-promote ordering. *Recovery:* newest valid wins. *Test:* 11.13.

**EC-SAVE-05 · Malformed save data** — *Expected:* typed refusal (`SaveMalformed`); no partial load; backup kept. *Prevention:* schema validation before any state mutation. *Recovery:* other slot / fresh-start option. *Test:* 11.3.

**EC-SAVE-06 · Missing object referenced by save** — *Expected:* affected machine reset to `InProgress`; rest of progression preserved; reported. *Prevention:* integrity check on load + required-part respawn. *Recovery:* `ComponentRespawned`. *Test:* 11.4.

**EC-SAVE-07 · Duplicated object ids** — *Expected:* rejected before graph construction. *Prevention:* id-uniqueness check in decode. *Recovery:* typed error + other slot. *Test:* 11.5.

**EC-SAVE-08 · Checkpoint and autosave conflict** — *Expected:* newest valid wins; both corrupt → recovery menu. *Prevention:* slot metadata (timestamp + integrity). *Recovery:* explicit player choice. *Test:* 11.7.

**EC-SAVE-09 · Reward recorded but puzzle state missing** — *Expected:* ledger authoritative → puzzle repaired to `Complete`. *Prevention:* reconciler on load. *Recovery:* no double grant. *Test:* 10.10, 11.8.

**EC-SAVE-10 · Puzzle state recorded but reward missing** — *Expected:* grant replayed exactly once from the completion milestone. *Prevention:* grants keyed by `milestoneId`; ledger check. *Recovery:* single grant. *Test:* 11.9.

**EC-SAVE-11 · Loading into changed level data** — *Expected:* mismatch detected; affected puzzle reset with warning; progression preserved. *Prevention:* definition revisions recorded in the save. *Recovery:* scoped reset, never a full wipe. *Test:* 11.10.

**EC-SAVE-12 · Old save schema version** — *Expected:* migration chain runs; unknown-newer version refused. *Prevention:* versioned DTOs + per-version fixtures. *Recovery:* typed errors surfaced. *Test:* 11.2.

**EC-SAVE-13 · Quota exceeded / storage unavailable** — *Expected:* write rejected cleanly, previous save preserved, session continues (memory-only if needed). *Prevention:* quota pre-check + try/catch on write. *Recovery:* non-blocking notice. *Test:* 11.14.

### 39.5 Player / Camera

**EC-PC-01 · Player trapped behind machinery** — *Expected:* every space the player can enter can be exited. *Prevention:* level-design rule + automated reachability check on hub/branch layouts. *Recovery:* depenetration → checkpoint respawn. *Test:* 17.5.

**EC-PC-02 · Camera inside a wall** — *Expected:* resolved outside geometry with smooth return. *Prevention:* sphere-cast from anchor; skin offset; hysteresis. *Recovery:* recentre. *Test:* 13.1.

**EC-PC-03 · Camera blocked by a moving component** — *Expected:* occlusion resolves; manipulation aim unaffected. *Prevention:* camera ignores carried objects only if configured; otherwise standard cast. *Recovery:* recentre when clear. *Test:* 13.6.

**EC-PC-04 · Player knocked into invalid space** — *Expected:* depenetration; respawn at anchor if unresolvable within N steps. *Prevention:* hazard knockback direction chosen to avoid geometry. *Recovery:* checkpoint anchor. *Test:* 12.7.

**EC-PC-05 · Respawn collides with machinery** — *Expected:* nearest safe clearance chosen. *Prevention:* clearance query around anchors. *Recovery:* documented fallback anchor per zone. *Test:* 12.8.

### 39.6 Browser Lifecycle

**EC-BRN-01 · Resize** — *Expected:* renderer + projection corrected; no distortion. *Prevention:* debounced resize handler; camera aspect update. *Recovery:* none. *Test:* 16.1.

**EC-BRN-02 · Fullscreen change** — *Expected:* no state loss; input intact. *Prevention:* state lives outside presentation. *Recovery:* none. *Test:* 16.2.

**EC-BRN-03 · Visibility change / backgrounding** — *Expected:* loop pauses; no unbounded catch-up; no teleport. *Prevention:* `visibilitychange` handling + accumulator reset + substep cap. *Recovery:* clean resume. *Test:* 16.3.

**EC-BRN-04 · Input focus loss** — *Expected:* held actions cleared; no logically stuck keys; held object released safely. *Prevention:* blur handler clears snapshot + one-shot latches. *Recovery:* SM to `Exploration`. *Test:* 16.5.

**EC-BRN-05 · Keyboard key remains logically pressed** — *Expected:* impossible after blur handling. *Prevention:* full-snapshot clear (not per-key tracking). *Recovery:* none. *Test:* 16.5.

**EC-BRN-06 · Pointer lock loss** — *Expected:* context → pause; no camera spin. *Prevention:* pointer-lock state drives input context. *Recovery:* resume on demand. *Test:* 16.6.

**EC-BRN-07 · WebGL context loss** — *Expected:* sim protected; notice shown; scene rebuilt from canonical state; **no progression loss**. *Prevention:* renderer resources are re-creatable from L1 data; GPU objects never hold gameplay truth. *Recovery:* rebuild + re-upload; reload prompt if restore fails. *Test:* 16.7.

**EC-BRN-08 · Audio context suspension** — *Expected:* playable silently; unlock on gesture; no error spam. *Prevention:* lazy init + gesture unlock + null-object audio fallback. *Recovery:* silent mode. *Test:* 16.8.

**EC-BRN-09 · Two tabs, same save** — *Expected:* detectable divergence; no corrupt save. *Prevention:* dual-slot + version stamp + write-time comparison. *Recovery:* last-writer-wins with warning. *Test:* 16.9.

**EC-BRN-10 · No WebGL2 support** — *Expected:* clear unsupported screen; no crash. *Prevention:* capability check at boot. *Recovery:* explanatory page. *Test:* 16.10.

### 39.7 General / Content Integrity

**EC-GEN-01 · Required part missing at runtime or load** — *Expected:* re-spawned from definition at `spawnAnchorId`; logged; no progression loss. *Prevention:* registry integrity check on load + runtime watchdog + `required` flags (§22). *Recovery:* `ComponentRespawned`. *Test:* 12.5.

**EC-GEN-02 · Invalid or partial content definition** — *Expected:* dev → fail fast with file+field; production → skip offender + log, remaining content playable. *Prevention:* schema validation at data load (§13). *Recovery:* skipped content reported, never silent. *Test:* 4.

---

## 40. File / Folder Architecture

Proposed repository structure — organised by **dependency layer**, not by feature, so the boundary rules (§11) are mechanically enforceable. **No files are created in Phase 0.**

```text
gearwright/
├─ GAME_ARCHITECTURE.md          ← this document
├─ TEST_SUITE_PLAN.md
├─ PROJECT_STATE.md              ← session handoff (authoritative resume file)
├─ MVP_READINESS_REPORT.md       ← Phase 14 output (later)
├─ index.html                    ← DOM root (Phase 1)
├─ package.json / tsconfig.json / vite.config.ts / vitest.config.ts   (Phase 1)
├─ .eslintrc.cjs                 ← boundary rules R1/R2/R6 enforced here
└─ src/
   ├─ core/                      # L0 — platform, zero game knowledge
   │   ├─ loop.ts                # fixed-step driver, accumulator, substep cap
   │   ├─ lifecycle.ts           # boot/pause/unload, visibility, context-loss hooks
   │   ├─ events.ts              # typed event channels (upward only; no command bus)
   │   ├─ rng.ts                 # seedable RNG service
   │   ├─ config.ts              # data loading + schema validation
   │   ├─ perf.ts                # frame stats, budget counters
   │   └─ errors.ts              # error taxonomy, codes, boundary guards
   ├─ game-state/                # L1 — pure logic, HEADLESS (no three/DOM)
   │   ├─ machine-graph.ts       # LTG: edges, recompute, propagation
   │   ├─ component-registry.ts  # instances, defs, integrity/respawn
   │   ├─ snap-rules.ts          # compatibility, ranking, reason codes
   │   ├─ validator.ts           # requirement evaluation (pure)
   │   ├─ puzzle-system.ts       # puzzle SM + completion latch
   │   ├─ scanner-reveal.ts      # §29.3: failed requirement → reveal ids (pure)
   │   ├─ progression-system.ts  # branch/hub stage, unlock rules
   │   ├─ inventory-system.ts
   │   ├─ reward-ledger.ts       # grant ids, idempotency
   │   ├─ blueprint-system.ts
   │   ├─ upgrade-system.ts      # modifier pipeline (empty in MVP)
   │   ├─ hint-state.ts
   │   └─ save-codec.ts          # canonical DTO encode/decode + migrations
   ├─ gameplay/                  # L2 — simulation, engine-agnostic (Ports only)
   │   ├─ input-system.ts        # snapshot + action map + context router
   │   ├─ player-controller.ts
   │   ├─ camera-rig.ts
   │   ├─ interaction-system.ts  # ray, focus, candidates, LOS
   │   ├─ manipulation-system.ts # the SM (§19)
   │   ├─ snap-system.ts         # candidate detection + assist
   │   ├─ hazard-system.ts
   │   └─ feedback-model.ts      # decides WHAT feedback (not how)
   ├─ ports/                     # L3 — interfaces only
   │   ├─ physics-port.ts · render-port.ts · audio-port.ts
   │   ├─ storage-port.ts · asset-port.ts
   ├─ adapters/                  # L4 — real implementations
   │   ├─ three-renderer.ts · kinematic-physics.ts
   │   ├─ web-audio-bus.ts · asset-loader.ts
   │   └─ storage-local.ts       # localStorage dual-slot
   ├─ presentation/              # L4 — scene building + feedback rendering
   │   ├─ world-scene-builder.ts · feedback-composer.ts
   │   ├─ scanner-overlay.ts     # §29.3 reveal timer + port handoff
   │   ├─ hud.ts + hud.css · menus.ts
   ├─ data/                      # content (data-driven, typed)
   │   ├─ components.ts · sockets.ts · machines.ts
   │   ├─ puzzles/ (p1.ts, p2.ts, p3.ts, p4.ts, bm1.ts)
   │   ├─ rewards.ts · checkpoints.ts · hints.ts · hazards.ts · hub-stages.ts
   │   ├─ input.ts               # single source of bindings/labels
   │   └─ feedback.ts
   ├─ levels/                    # level geometry + anchors (data or GLB refs)
   │   ├─ hub.ts · branch-a.ts
   ├─ debug/                     # dev-only tools (§37)
   │   ├─ flags.ts · overlay.ts · inspectors.ts · determinism-harness.ts
   └─ main.ts                    # composition root: wires L0→L4 (only place that knows everything)

tests/
├─ logic/      (mirrors src/game-state + src/core — no DOM/three)
├─ boundary/   (the 8 seams; uses fakes for all Ports)
├─ save/       (fixtures + migrations + corruption corpus)
├─ perf/       (Phase 13; may run in browser)
└─ e2e/        (Phase 14; scripted journeys)
```

---

## 41. Implementation Milestones

Each milestone is a **vertical slice**: something playable and verifiable, with automated + manual acceptance criteria and a rollback story. Mapped to the phased protocol (Phase 0 = this work, already complete except the verification gate).

| M | Phase | Purpose | Systems touched | Acceptance (gate) | Key tests | Rollback |
|---|---|---|---|---|---|---|
| **M0** | 1 | Foundation: Vite+TS+Vitest, fixed-step loop, resize/lifecycle, perf overlay, blank scene | L0, L4 (renderer stub) | App boots; empty scene renders; resize/lifecycle correct; `npm test` runs; baseline perf measured; no console errors | smoke | revert to docs only |
| **M1** | 2 | Third-person movement + camera | L2 (player, camera), Ports | Walk/run/turn near walls; camera never clips; deterministic at 10/60 FPS | determinism, camera math | drop player/camera |
| **M2** | 3 | Targeting only (no grabbing) | L2 (interaction), debug ray view | Never selects through walls or out of range; prompts correct; focus stable | interaction tests | revert interaction |
| **M3** | 4 | Grab/release/rotate one test object | L2 (manipulation SM), L4 physics adapter | SM transitions exact; cancel restores; nothing embeds | SM enumeration, manipulation | revert SM |
| **M4** | 5 | Socket + snap for one compatible pair | L2 (snap), L1 (attach) | Atomic attach; occupancy correct; preview matches result; competing sockets deterministic | snap tests | revert snap |
| **M5** | 6 | Machine graph + propagation + validation (headless-first) | L1 (graph, validator) | Correct machine validates; incorrect doesn't; perturbed transforms change nothing | LMG, validation, transform-independence | revert L1 graph |
| **M6** | 7 | First micro-puzzle (P1) end-to-end with feedback | all layers | Full chain: grab→snap→validate→activate→feedback | boundary tests, P1 acceptance | disable P1 data |
| **M7** | 8 | Rewards + save/checkpoint + recovery | L1 (ledger, inventory, codec), L4 storage | Reward exactly once; reload faithful; corrupt save safe | rewards, save/load, recovery | keep M6 (no persistence) |
| **M8** | 9 | Branch A content: P2, P3 (+P4 if justified), data-driven | `data/` + existing systems | Three puzzles incl. multi-solution; **no new bespoke architecture** | puzzle validation, solvability | drop extra puzzle data |
| **M9** | 10 | Hub integration + BM-1 + clue + branch completion | L1 progression, L4 hub visuals | Branch completion reflected in hub; access gates work; persists | progression, hub stage, e2e journey | revert hub wiring |
| **M10** | 11 | UX/feedback/hints/scanner + readability pass | L2 (hints), L4 (HUD/VFX/SFX) | Hints escalate per rules; scanner useful; no color-only signals | hint rules, HUD | disable hints/scanner |
| **M11** | 12 | Hazards (steam jet, press) + recovery integration | L2 hazards, checkpoints | Telegraph-first; never destructive; recovery lands valid | hazard, recovery | disable hazards |
| **M12** | 13 | Performance pass (measure-driven) + adaptive quality | L4, L0 perf | Budgets met at all tiers; quality changes are gameplay-neutral | perf thresholds | revert optimizations |
| **M13** | 14 | Production validation: full suite + journey + report | — | All P0 green; `MVP_READINESS_REPORT.md` has no BLOCKER/P0 | full suite, A-1…A-18 | ship previous build |

**Milestone discipline:**
1. No milestone begins until the previous one's acceptance criteria pass.
2. Every milestone ends with `PROJECT_STATE.md` updated (the resumable checkpoint).
3. If a milestone reveals an architectural flaw: **stop**, document it, add/amend an ADR, update this document, then continue — never silently change ownership or dependency direction.
4. Every milestone keeps the game playable; no milestone leaves the build in a non-bootable state at its end.
---

## 42. Architecture Risks

Scored: Impact (H/M/L), Likelihood (H/M/L), Detection, Mitigation, Fallback.

### R-1 · Custom kinematic physics feels "floaty" or unsticky *(Impact H · Likelihood M)*
- **Detection:** Phase 4 manual playtest; time-to-snap metric; qualitative "does placing feel good" checklist.
- **Mitigation:** snap assist tuned as a data value; hold-pose smoothing; tactile feedback recipe (§32) does much of the perceptual work; iterate on feel in the manipulation milestone *before* content exists.
- **Fallback:** adopt Rapier behind `PhysicsPort` (§20.4) — the interface already isolates the swap; validation, saves, and puzzle data are untouched.

### R-2 · Transform-independence violated by accident *(Impact H · Likelihood M)*
- **Detection:** transform-perturbation property test in the regression suite (R-B); any validator rule that reads a live transform fails it.
- **Mitigation:** validator accepts only LMG + declared canonical relations; a code-review rule (R7) plus a lint check that `game-state/` cannot import from `gameplay/`.
- **Fallback:** if a puzzle truly needs spatial meaning, express it as a declared adjacency in data and re-review the ADR — never patch the validator with distance math.

### R-3 · Snap ambiguity in dense machinery *(Impact M · Likelihood H)*
- **Detection:** socket-visualisation debug tool + snap tests with overlapping volumes.
- **Mitigation:** total ranking (nearest → orientation → id), single candidate, preview makes the winner visible before commit.
- **Fallback:** shrink socket volumes in data; add explicit "dominant" flags per socket.

### R-4 · Reward duplication via a duplicated event path *(Impact H · Likelihood M)*
- **Detection:** reward idempotency suite (R-1…R-10) + ledger assertions in every boundary test.
- **Mitigation:** single grant path (`RewardLedger.grant(grantId)`), persisted ids, completion latch + stable-frame hysteresis.
- **Fallback:** none needed — this is P0 and must be correct before content work begins (M6/M7 gates).

### R-5 · Save-format churn across milestones *(Impact M · Likelihood H)*
- **Detection:** migration fixtures per version; save round-trip tests in CI.
- **Mitigation:** keep the DTO stable by design (few, flat fields); add fields as optional; never persist runtime shapes; every schema change ships with a migration + fixture.
- **Fallback:** during MVP, "delete save" is acceptable; post-MVP, migrations are mandatory (EC-SAVE-12).

### R-6 · Puzzle authoring costs grow per puzzle *(Impact M · Likelihood M)*
- **Detection:** M8 gate — a new puzzle must be *data only*; if code is needed, the abstraction is wrong.
- **Mitigation:** requirement union + `any` composition cover multi-solution cases; reusable mechanisms; no per-puzzle classes.
- **Fallback:** extract the newly discovered mechanism into another requirement kind (a small, additive change) and document it.

### R-7 · Soft-lock reachable through a combination of mechanics *(Impact H · Likelihood L)*
- **Detection:** headless solver simulation per puzzle; recovery tests; level reachability checks.
- **Mitigation:** required parts indestructible + respawnable; machine reset; boundary carry-back; hazards non-destructive.
- **Fallback:** hint escalation to L4 + explicit reset affordance always available in the puzzle's context menu.

### R-8 · Performance regression from content growth *(Impact M · Likelihood M)*
- **Detection:** perf overlay budgets + Phase 13 automated thresholds; draw-call/triangle counters in the debug overlay.
- **Mitigation:** static merging/instancing from the start; primitive colliders; dirty-driven recompute; textures capped per class.
- **Fallback:** degradation ladder (§35.4) — visual steps only; gameplay never changes.

### R-9 · Camera fights manipulation in tight spaces *(Impact M · Likelihood H)*
- **Detection:** manual playtest in the narrowest machinery areas; camera tests (§13).
- **Mitigation:** manipulation framing mode, occlusion hysteresis, distance floor, configurable bias.
- **Fallback:** allow a temporarily "locked" camera framing during snap confirmation (data-flag per puzzle).

### R-10 · Dense-memory pressure on the 8 GB dev machine *(Impact M · Likelihood M)*
- **Detection:** `performance.memory` in the overlay; soak test; Vite dev-server memory watch.
- **Mitigation:** no heavyweight deps (no WASM physics, no UI framework), placeholder-first assets, branch chunk disposal, no source-map/eval explosions.
- **Fallback:** run dev with `--max-old-space-size` tuned; test in a production build if the dev server is the bottleneck.

### R-11 · Scope creep into post-MVP systems *(Impact M · Likelihood H)*
- **Detection:** milestone acceptance review — any system not required by the current milestone is a violation.
- **Mitigation:** §3 MVP boundary is explicit (`MVP / Post-MVP / Out of Scope`); the phase protocol forbids starting the next phase; upgrades/replay/extra branches have declared placeholders with no implementation.
- **Fallback:** park the work as an ADR + open question, not code.

### R-12 · Browser-lifecycle bugs (context loss, backgrounding) corrupting play *(Impact H · Likelihood L)*
- **Detection:** lifecycle test layer (§16) + manual alt-tab/GPU-reset pass in Phase 14.
- **Mitigation:** no gameplay truth in GPU/adapters; pause on visibility change; accumulator reset; substep caps; canonical rebuild path.
---

## 43. Architecture Decisions (ADRs)

Lightweight format: decision · alternatives · consequence. All are **settled**; changing one requires an explicit new ADR (change-discipline rule).

| ADR | Decision | Alternatives rejected | Consequence |
|---|---|---|---|
| **ADR-001** | TypeScript, `strict: true` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` | JavaScript | Compile-time ownership/contract safety across 14 phases; negligible runtime cost; some upfront typing effort |
| **ADR-002** | Vite for dev/build; Vitest shares the pipeline | webpack, esbuild hand-rolled, Parcel | Fast iteration on an 8 GB machine; one toolchain for build+test |
| **ADR-003** | Three.js only, pinned version; minimal `examples/jsm` usage | Babylon, PlayCanvas, raw WebGL2 | Small bundle; must build any missing helpers ourselves (accepted) |
| **ADR-004** | **No physics engine in MVP**; custom kinematic manipulation + static colliders, behind `PhysicsPort` | Rapier (WASM), cannon-es, Ammo, Matter | Deterministic, lightweight, no jitter/stacking class of bugs; must implement swept collision + depenetration ourselves (~600–900 LOC) |
| **ADR-005** | Logical Machine Graph (LTG) is the authoritative truth; scene graph is a mirror | Trust the scene/physics state as truth | Validation/save/rewards are engine-independent and headlessly testable; requires an explicit mirroring layer (scene builder) |
| **ADR-006** | Transform-independent validation via requirement predicates | `position === expected` comparisons, tolerance comparisons | Multi-solution puzzles for free; puzzles survive visual/physics drift; requires richer requirement modelling |
| **ADR-007** | Fixed 30 Hz simulation, decoupled render, ≤5 substeps, interpolation for visuals only | Variable-timestep physics, per-frame logic | Frame-rate-independent gameplay + deterministic tests; interpolation adds a small visual layer |
| **ADR-008** | localStorage + versioned canonical DTO, dual-slot write-then-promote | IndexedDB, OPFS, raw object serialization | Simple, safe, small; 5–10 MB ceiling accepted; IndexedDB deferred until a snapshot exceeds ~2 MB |
| **ADR-009** | Direct calls **down**, typed events **up**; no global command bus | Uncontrolled event bus, full pub/sub, dependency injection framework | Explicit, debuggable flow; requires discipline to keep channels typed and few |
| **ADR-010** | DOM/CSS overlay UI, no framework | React/Vue, three.js sprites, CSS3DRenderer | Zero UI bundle weight, native accessibility; manual DOM updates (batched) — acceptable for ~8 panels |
| **ADR-011** | Web Audio API with a thin `AudioBus` wrapper | Howler.js, three.js audio for everything | Precise mechanical timing and bus control; must handle unlock/suspension ourselves |
| **ADR-012** | Vitest (two projects: `logic` node-env, `dom` jsdom) | Jest, node:test | Shares Vite config; fast; needs discipline to keep L1 free of DOM imports |
| **ADR-013** | Data-driven puzzle/machine/socket/reward definitions | Bespoke code per puzzle, generic scripting language | New puzzles are data; avoids a mini-language; requires a well-chosen requirement union |
| **ADR-014** | Quality tiers affect presentation only; gameplay identical across tiers | Tier-dependent gameplay tuning | Fair, testable, deterministic; visuals can degrade freely; some tuning freedom given up |
| **ADR-015** | Hybrid progression: node unlocks + 2 numeric resources; no XP/stat curves | Pure currency economy, deep skill tree, XP levels | Meaningful rewards, no inflation, simple save; less "number goes up" satisfaction (accepted by pillar §2) |
| **ADR-016** | Single authoritative owner per state, documented in §12; new state requires a matrix row | Shared mutable state / globals | Prevents silent cross-system writes; requires ownership discipline and a doc update for each new state |
| **ADR-017** | Debug tooling reads public snapshots/events only and doubles as the test harness | Separate bespoke test tooling, direct private-state access | One mechanism for debugging and testing; slightly more public surface than a pure design would need |
| **ADR-018** | Staged puzzles (BM-1) read the player's §12.2 action history as a validator *input* (`context.actions`); the log is a new canonical L1 owner, saved as schema **v2** (v1 migrates by pure widening) | Deriving "primed"/"ordered" from transforms or timers; storing step flags in the puzzle SM | Keeps the validator pure and headless-testable; a reload keeps staged progress; costs one new owner + a schema bump (`SaveCodec.migrate`) |
---

## 44. Open Questions

Only genuine unresolved items. Each has a **default resolution already recorded**, so none of these block Phase 1 — they are finalised in the phase noted.

| # | Question | Default until resolved | Must be finalised by |
|---|---|---|---|
| **OQ-1** | Rotate binding: mouse wheel vs `Q`/`E` — which feels better for precise socket alignment? | Implement **both** in Phase 4, pick one as default after feel testing, keep the other as an alternate binding. Not an architecture change (bindings are data, `config/input.ts`). | Phase 4 |
| **OQ-2** | At what save size do we migrate localStorage → IndexedDB? | Stay on localStorage; adopt IndexedDB only if a real snapshot exceeds **~2 MB** (budget predicts ~150 KB gzipped, so this is unlikely in the MVP). `StoragePort` makes the swap invisible to callers. | Phase 8 (measure), revisit Phase 13 |
| **OQ-3** | Is P4 ("Counterweight") worth MVP scope? | **Cut first.** P1–P3 + BM-1 satisfy the "3–4 puzzles" requirement; P4 only ships if M8 lands ahead of schedule. | Phase 9 |
| **OQ-4** | Do hazards need canonical phase offsets in the save for determinism, or is per-session phase acceptable? | Per-session phase (hazards are not part of validation); if a puzzle ever depends on hazard timing, promote the offset to canonical — a one-field schema addition. | Phase 12 |
| **OQ-5** | Should the scanner be a blueprint reward (as planned) or an early baseline ability? | Blueprint on P2 completion, as designed — it proves the blueprint→capability pipeline with one unlock. Revisit only if playtesting shows the scanner is needed earlier for onboarding. | Phase 11 |
| **OQ-6** | Minimum hardware floor: do we officially support integrated GPUs at 1280×720 only, or 1080p Low? | Target **1080p Low** as the floor; document it in the README when the build exists. | Phase 13 |

**Not open (decided, recorded elsewhere):** physics library choice (ADR-004), validation model (ADR-006), save location (ADR-008), UI approach (ADR-010), progression model (ADR-015), milestone order (§41).
### 39.8 Snap System

These are the **snap-pipeline** cases. `EC-MAN-03/04/05/06` in §39.1 are their manipulation-SM counterparts (same guards seen from the state machine); both are retained because the test plan references each explicitly.

**EC-SNAP-01 · Component overlaps two snap zones** — *Expected:* exactly one deterministic candidate (nearest anchor; tie → lowest `socketId`); never a double preview. *Prevention:* total ranking + single-candidate rule (§21.2). *Recovery:* re-evaluated next step. *Test:* 7.3.

**EC-SNAP-02 · Two components compete for one socket** — *Expected:* first-come owns it; the second receives `Occupied` and is not attached. *Prevention:* occupancy derived from LMG edges; attach is atomic. *Recovery:* second component stays held/loose. *Test:* 7.4.

**EC-SNAP-03 · Rotation while inside a snap volume** — *Expected:* preview re-evaluates every fixed step; committed attach pose equals the socket canonical pose exactly. *Prevention:* allowed-axis constraints + attach absorbs rotation (§21.3). *Recovery:* cancel restores prior rotation. *Test:* 7.6.

**EC-SNAP-04 · Candidate invalidated between preview and confirm** — *Expected:* attach aborts atomically; object returns to hold; LMG unchanged. *Prevention:* confirm-step re-validation inside the same sim step (§21.3). *Recovery:* hold retained, feedback shown. *Test:* 7.7.

**EC-SNAP-05 · Incompatible component enters a socket volume** — *Expected:* no preview; typed rejection (`Incompatible` / `BadOrientation`); confirm refused. *Prevention:* tag + `socketKind` compatibility check before candidate creation. *Recovery:* none needed. *Test:* 7.2.

**EC-SNAP-06 · Socket already occupied** — *Expected:* attach rejected with `Occupied`; no duplicate edge; existing attachment untouched. *Prevention:* single attachment edge per component and per socket (§23.1). *Recovery:* none needed. *Test:* 7.5.

**EC-SNAP-07 · Rapid attach → detach → attach burst** — *Expected:* final LMG state equals the last confirmed command; exactly one edge exists. *Prevention:* one-shot command latch per sim step + atomic transitions. *Recovery:* none needed. *Test:* 7.8.

### 39.9 Interaction Targeting

**EC-INT-01 · Target occluded by geometry** — *Expected:* occluded interactables are never focused or selectable, even at valid range. *Prevention:* LOS filter (camera-origin ray vs static colliders) in `InteractionSystem` (§18). *Recovery:* none needed; the next visible target gains focus. *Test:* 5.1.

**EC-INT-02 · Focus thrash between adjacent targets** — *Expected:* prompt appears only after N stable steps; switching requires hysteresis; no per-frame flicker. *Prevention:* stability counter + switch hysteresis (§18). *Recovery:* none needed. *Test:* 5.4.

---

# Appendix A — System Boundary Coverage Map

Required boundaries (32) mapped to their owning definition, with merge justifications where systems were combined. **Merges are deliberate** — the brief permits them when justified; none of the merged items has a distinct lifecycle, owner, or state.

| # | Required system | Defined in | Owning layer | Notes / merge justification |
|---|---|---|---|---|
| 1 | Application lifecycle | §13 | L0 (`core/lifecycle.ts`) | — |
| 2 | Game loop | §14 | L0 (`core/loop.ts`) | — |
| 3 | Scene / world management | §6, §34.2, §40 (`presentation/world-scene-builder.ts`) | L4 | Branch chunk load/unload; **not** a state owner |
| 4 | Renderer | §10 (L4), §34 | L4 (`adapters/three-renderer.ts`) | Consumes `CameraPose`/scene snapshots; owns GPU resources only |
| 5 | Resource / asset management | §34 | L4 behind `AssetPort` | Determinism rule: gameplay never waits on assets |
| 6 | Player locomotion | §16 | L2 (`player-controller.ts`) | — |
| 7 | Camera | §17 | L2 (`camera-rig.ts`) | — |
| 8 | Input abstraction | §15 | L2 (`input-system.ts`) + L4 DOM | — |
| 9 | Interaction targeting | §18 | L2 (`interaction-system.ts`) | — |
| 10 | Manipulation | §19 | L2 (`manipulation-system.ts`) | — |
| 11 | Physics | §20 | L4 behind `PhysicsPort` | Custom kinematic adapter |
| 12 | Snap / socket system | §21 | L2 (`snap-system.ts`) + L1 (`snap-rules.ts`) | Split: detection is L2, rules are pure L1 |
| 13 | Mechanical component system | §22 | L1 (`component-registry.ts`) | Data + identity, no per-component classes |
| 14 | Machine connectivity | §23 | L1 (`machine-graph.ts`) | — |
| 15 | Machine validation | §24 | L1 (`validator.ts`) | Pure, transform-independent |
| 16 | Puzzle state | §25 | L1 (`puzzle-system.ts`) | — |
| 17 | Puzzle progression | §26 | L1 (`progression-system.ts`) | **Merged with 18** — one progression graph, not two systems |
| 18 | Branch progression | §26 | L1 (`progression-system.ts`) | Same owner; branch state is one field of progression state |
| 19 | Hub progression | §26 | L1 (`progression-system.ts`) | Derived hub stage from branch completion; no separate lifecycle |
| 20 | Inventory | §27 | L1 (`inventory-system.ts`) | — |
| 21 | Rewards | §27 + §24.4 | L1 (`reward-ledger.ts` + `inventory-system.ts`) | **Merged grant path**: ledger is the only writer of rewards |
| 22 | Blueprints | §27.1 | L1 (`blueprint-system.ts`) | Set semantics |
| 23 | Upgrades | §28 | L1 (`upgrade-system.ts`) | Framework only in MVP |
| 24 | Scanner / hints | §29 | L1 (`hint-state.ts`) + L2 (`hint-system`) + L4 overlay | **Merged**: scanner is the L3 hint layer, not a separate system |
| 25 | Environmental hazards | §30 | L2 (`hazard-system.ts`) | Definitions are data |
| 26 | Save / checkpoint system | §31 | L1 (`save-codec.ts`) + L4 (`storage-local.ts`) | — |
| 27 | UI / HUD | §33 | L4 (`presentation/hud.ts`) | Read-model consumer + intent emitter |
| 28 | Audio | §32 | L4 (`web-audio-bus.ts`) | **Merged with 29**: one feedback pipeline, two output adapters |
| 29 | Feedback / VFX | §32 | L2 (`feedback-model.ts`) → L4 (`feedback-composer.ts`) | Model decides *what*; composer decides *how* |
| 30 | Performance manager | §35, §36, §37 (perf overlay) | L0 (`core/perf.ts`) + L4 | **Merged**: strategy, budget, and monitoring in one concern |
| 31 | Debug tooling | §37 | L4 (`debug/`) | Reads public snapshots only; doubles as test harness (ADR-017) |
| 32 | Configuration / data layer | §40 (`data/`), §13 (validation) | L0 loader + typed data modules | Data is typed TS, validated at boot (EC-GEN-02) |

**Boundary count:** 32 required → 37 defined modules / 5 documented merges (17+18+19, 21, 24, 28+29, 30). No required boundary is unowned, and no module exists without a matrix row (§12) or a boundary rule (§11).
---

# Architecture Verification

Internal review performed at the end of Phase 0 against the 13 gate criteria. Both documents cross-checked: `GAME_ARCHITECTURE.md` §1–§44 + Appendix A; `TEST_SUITE_PLAN.md` §1–§20.

## PASS

- **Core loop traceable across systems** — §9 (diagram + canonical flow) and §14 (12-step fixed update ordering) trace Input → Interaction → Manipulation → Physics → Snap → LMG → Validation → Puzzle State → Progression → Rewards → Persistence → Feedback with a named owner at every arrow.
- **Every persistent state has exactly one authoritative owner** — §12.1 (runtime) and §12.2 (logical/canonical) enumerate owner / readers / allowed writers / persistence level / reset behaviour; the rule "no state without a matrix row" makes new ownership explicit.
- **No circular dependencies** — §11 defines a strict downward call order (L4→L3→L2→L1→L0) with upward typed events only; R6 enforces it with `madge --circular`; R1 forbids upward imports; R2 forbids engine imports in L0/L1.
- **Puzzle logic works without raw physics values** — §20 (no solver in the MVP) + §24 (validation consumes the LTG and declared canonical relations only) + ADR-005/ADR-006; interpolation never feeds logic (§14); tested by the transform-perturbation test (TEST §8, A-8).
- **Multiple valid configurations supported** — §24.1 requirement union with `any`/`output` composition; P3 is multi-solution by data, not by code; validated by TEST §9 and A-7.
- **Every critical component recoverable** — §22 (`required` flags + `spawnAnchorId`), §30.2 rule 3 (hazards displace, never destroy), §31.6 (respawn on load), EC-MAN-08/09/10/11, EC-GEN-01; covered by TEST §12 and A-13.
- **Machine states reconstructable safely** — §31.1 keeps only attachment edges + canonical poses + derived flags; §31.2 classifies persistent / checkpointed / runtime-only / reconstructable; §31.5 defines rebuild order and integrity reconciliation.
- **Rewards are idempotent** — single grant path via `RewardLedger` keyed by `GrantId` (§24.4, §27.2 rule 1), persisted in the save; duplicate-event, reload and reset-after-reward cases enumerated (TEST §10 R-1…R-10, EC-PZ-02/04, EC-SAVE-09/10).
- **A second branch can be added without core rewrites** — §26 expansion path (data + door anchor + hub-stage entry) and §41 M8 gate requiring "no new bespoke architecture"; §6 defines the reusable 8-beat branch template.
- **Mechanical rules testable without rendering** — §40 separates `src/game-state/` (pure, headless) from `gameplay`/`adapters`; TEST §2 layers 1–6 run without a browser; TEST §3 specifies the required seams (deterministic clock, injected ports, scenario builder, event tap).
- **Visual quality scales independently of gameplay** — §35.2 quality tiers + ADR-014 (presentation-only), asserted by TEST §15 (adaptive-quality test) and A-15.
- **Low-memory development stays reasonable** — §8.4 (no WASM physics), §34.2 (placeholder-primitive-first, lazy branch chunks), §35.5 memory strategy, §8 stack choices sized for 8 GB; risk R-10 tracked with mitigations.
- **MVP discipline maintained** — §3 splits MVP / Post-MVP / Out of Scope; §28 ships the upgrade *framework* with zero content; §29 defines hint levels without granting solutions; §41 gates prevent starting later work early.
- **Edge-case coverage complete** — §39 defines every case requested (manipulation, puzzle state, physics, save/load, player/camera, browser lifecycle) plus content integrity; the registry's 70 EC-IDs are referenced by TEST §17 with matching IDs and priorities.
- **Boundary coverage complete** — Appendix A maps all 32 required boundaries to owners, with 5 justified merges (17+18+19, 21, 24, 28+29, 30).
- **Test plan covers all 20 required sections** with enforced priorities: P0 first, boundary-focused, including acceptance criteria A-1…A-18 and a production-readiness checklist.

## RISKS

Carried forward with mitigations and fallbacks (§42); none are blockers.

1. **R-1 (Impact H · Likelihood M)** — custom kinematic manipulation may feel less "physical" than a solver; fallback is Rapier behind `PhysicsPort`. Requires implementing swept collision + depenetration (~600–900 LOC): real effort, bounded and headlessly testable.
2. **R-9 (M/H)** — camera versus manipulation in tight machinery spaces; mitigated by the manipulation framing mode + occlusion hysteresis; must be verified during M1/M3 playtests, not at the end.
3. **R-5 (M/H)** — save-schema churn across milestones; mitigated by a deliberately flat DTO and migration fixtures from v1.
4. **R-2 (H/M)** — transform independence is a *discipline* risk (a future rule could reintroduce distance math); guarded by the perturbation test in the regression suite.
5. **R-11 (M/H)** — scope creep into post-MVP systems; guarded by milestone gates and the explicit §3 boundary.
## BLOCKERS

**None.**

Every required Phase 0 artifact exists and every gate criterion above is satisfied. No unresolved architectural contradiction was found during the review. The only defects discovered were **ID drift between the registry and the test plan** (`EC-MAN-13` and `EC-PC-05` had been dropped from the registry; `EC-SNAP-*` and `EC-INT-*` were referenced by tests without registry definitions). All four were **repaired inside Phase 0**, and both documents now agree on all 70 EC-IDs.

## OPEN QUESTIONS

Six recorded deliberately in §44 (`OQ-1…OQ-6`). **Every one carries a documented default resolution, so none blocks Phase 1:**

| # | Question | Default in force until resolved | Resolved by |
|---|---|---|---|
| OQ-1 | Rotate binding: mouse wheel vs `Q`/`E` | Implement both in Phase 4; choose by feel; bindings are data | Phase 4 |
| OQ-2 | localStorage → IndexedDB threshold | Stay on localStorage unless a snapshot exceeds ~2 MB; `StoragePort` hides the swap | Phase 8 / 13 |
| OQ-3 | Is P4 "Counterweight" in MVP scope? | **Cut first** — P1–P3 + BM-1 satisfy the brief | Phase 9 |
| OQ-4 | Hazard phase persisted or per-session? | Per-session (hazards are not part of validation) | Phase 12 |
| OQ-5 | Scanner as blueprint reward or baseline ability? | Blueprint on P2 completion, as designed | Phase 11 |
| OQ-6 | Official hardware floor | 1080p Low | Phase 13 |

## READY_FOR_IMPLEMENTATION

**YES**

Gate result: the architecture is verified, the test plan is complete and ID-aligned with the edge-case registry, and no blockers remain.

Constraint carried forward: Phase 1 (minimal project foundation) may begin **only on an explicit user command**. Nothing in this document authorises starting it automatically, and no gameplay code may be written before that command.

