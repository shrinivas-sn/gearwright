# PLAN — Playability, feel, visuals and live deployment overhaul

**Written 23/09/2026.** Temporary file — deleted when this closes (durable facts move to
`PROJECT_STATE.md` in the last task).

**What this changes:** `src/**` (input, manipulation, camera, renderer, HUD, composition root,
levels), `tests/**` (new suites + the few named assertion updates), `scripts/browser-check.mjs`
(the browser harness, committed), `.github/workflows/*`, `vite.config.ts`, `package.json`
scripts, `.gitignore`, `PROJECT_STATE.md` (one closing entry), new `README.md`.

**Done means:** every task below is `[x]` (or `[x]` after its fix-up retry), `npm run typecheck`
is clean, `npx vitest run` is all green, `npm run build` is green, the `boot`, `hold` and
`branch` harness scenarios pass their listed checks against the **live URL**, and the live URL
is written in the last Progress Log entry.

---

## 0. READ THIS FIRST (every session, every model)

You are executing a written plan. You do **not** design anything. Every value (keys, colours,
coordinates, timings, file names) is decided below. If something is not written here, use the
**Fallback rules** (section 2) — never invent a new approach.

### 0.1 How to start a session (context management)
1. Read **section 0, 1 and 2** of this file.
2. Read the **last entry of the Progress Log** (bottom of file). Its `Next:` line is where you
   start.
3. Read **only the task card you are executing** and the files it names. Do **not** read
   `PROJECT_STATE.md` (1,900+ lines) or `GAME_ARCHITECTURE.md` unless a card tells you to read
   a specific section.
4. Large files: `src/main.ts` (1,370 lines), `src/gameplay/manipulation-system.ts` (1,120),
   `src/presentation/hud.ts` (840). Find edit points by **searching for the anchor text** given
   in the card (Grep), then read ~60 lines around it. Do not read them top to bottom.
5. **One phase per session is the target.** At every `CHECKPOINT` the work is committed and
   logged, so a fresh session can resume from the log with zero chat history.

### 0.2 The project in 10 lines (so you don't need other docs)
- Browser 3D puzzle game: TypeScript + three.js r186 + Vite 7 + Vitest 5. No framework.
- Fixed-step simulation at **30 Hz** (`src/core/loop.ts`), render every animation frame.
- Layers (enforced by `tests/boundary/import-boundaries.test.ts`):
  `core/` pure math (no DOM, no three) · `ports/` interfaces only · `game-state/` headless rules
  (no three, no ports) · `gameplay/` systems · `adapters/` DOM/WebGL/audio/storage (may import
  three; must NOT import `game-state/` or `gameplay/`) · `presentation/` DOM HUD pieces ·
  `levels/`, `data/` content · `main.ts` + `app.ts` are the only composition roots.
- A non-root file may not import (value imports, relative) from **3 or more** layers.
- Only `adapters/*`, `main.ts`, `app.ts` may import from `adapters/`.
- TS config is strict: `exactOptionalPropertyTypes` (optional props must be typed
  `?: T | undefined`), `noUncheckedIndexedAccess` (array/map reads may be `undefined` — guard or
  `!`), `verbatimModuleSyntax` (type-only imports use `import type`), imports end in `.ts`.
- Player = capsule, world = axis-aligned boxes, custom kinematic physics (no physics engine).
- Carryable parts are owned by `ManipulationSystem` (state machine: Exploration → Targeting →
  Grab → Manipulation ⇄ Rotation ⇄ SnapPreview, DetachPrompt).
- Dev-only debug handle in the browser: `window.__gearwrightDev` (see `src/main.ts` bottom).

### 0.3 Commands (run from `E:\gearwright`, Git Bash syntax; PowerShell works the same)
| Purpose | Command | Green means |
|---|---|---|
| Typecheck | `npm run typecheck` | no output after the `tsc --noEmit` line, exit 0 |
| All tests | `npx vitest run` | `Test Files  N passed (N)` and `Tests  M passed (M)`, 0 failed |
| One file | `npx vitest run tests/logic/<file>.test.ts` | that file passes |
| Build | `npm run build` | ends with `✓ built in …` |
| Browser harness | `npm run check:browser -- <scenario>` (exists after T0.3) | see each card's checks; report also saved to `.tmp-browser-report-<scenario>.json` |

Baseline at plan time (verified 23/09/2026): **564 tests / 44 files pass**, typecheck clean,
build `706.01 kB` JS / `184.62 kB` gzip.

---

## 1. Global rules (non-negotiable)

1. **Branch:** all work happens on branch `overhaul` (created in T0.1). Never commit to `main`
   directly; each phase CHECKPOINT fast-forwards `main`.
2. **One task = one commit**, message `overhaul(T<id>): <short summary>`. Never commit with a
   red typecheck, red tests or red build.
3. **Tests are read-only** except: (a) new test files/blocks the card tells you to add, and
   (b) the exact assertions a card lists under **"May update"**. Never delete a test. Never
   weaken an assertion to make it pass.
4. **Don't touch** anything a card lists under "Don't touch", and never edit
   `src/game-state/**` (the L1 rules) unless a card names the file.
5. **No new npm dependencies.** Everything needed is already installed (three r186 includes
   `three/addons/...`).
6. **No `innerHTML` with data.** DOM text from data always goes through `textContent`. Static
   markup literals with zero interpolation are allowed (the HUD already does this).
7. **Stylesheet:** `src/style.css` must stay flat — every rule closed with `}` before the next
   one starts; never nest rules (a guard test fails otherwise).
8. **Keep comment style:** short `/** … */` doc comments explaining *why*, like surrounding code.
9. **Log honestly.** A Progress Log `Verified:` line contains the real command and its real
   output (test counts, build size, harness fields). Never write "verified" without output.

---

## 2. Fallback rules (use these instead of stopping)

This plan has **no stop points**. When something goes wrong, follow the matching row, record it
in the Progress Log `Surprises:` field, and keep going.

| Situation | Do this |
|---|---|
| Typecheck: "possibly undefined" | Guard (`if (x === undefined) continue/return`) or `!` when the card's logic guarantees presence. |
| Typecheck: optional prop not assignable (`exactOptionalPropertyTypes`) | Declare it `readonly name?: T \| undefined;` |
| Typecheck: "only refers to a type" / verbatimModuleSyntax | Change to `import type { … }` for that name. |
| Typecheck error in a **test file** because an interface gained a field | Make the new field optional (`?: T \| undefined`) in the source instead of editing the test. |
| A test **listed under "May update"** fails exactly as the card predicts | Apply the card's replacement assertion. |
| Any **other** test fails | Your change broke behaviour. Read the failure, compare with the card, fix your code. Up to **3 attempts**. |
| Still red after 3 attempts | `git stash push -m "T<id> failed attempt"`, mark the task `[!]` in the phase list, write the failing output in `Surprises:`, continue with the next task. The phase's **Fix-up** step retries it once (`git stash pop`). If it is still red there, leave it `[!]`, keep the stash, and continue — the final entry lists it. |
| Boundary test fails (`import-boundaries`) | You imported across a forbidden layer. Move the code to the layer the card named, or pass a function/value in from `main.ts` instead of importing. |
| Harness: `server never came up` | Another process holds the port. Run `netstat -ano \| findstr :5199` (or `:5198` for `--production`), kill **only that PID if it is `node.exe`** (`taskkill /PID <pid> /F`), rerun once. |
| Harness: Chrome not found | Set `CHROME_PATH` env var to the local Chrome/Edge exe (Edge: `C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe`) and rerun. |
| Harness hangs > 5 minutes (known: headless rAF sometimes pauses) | Kill the run (Ctrl+C), rerun once. If it hangs again, log "harness inconclusive: <scenario>" and continue — unit tests stay the gate. Never kill `chrome.exe` globally (the owner's browser). |
| Harness check fails (a field is false/unexpected) | Treat like a failing test: fix code, 3 attempts, then `[!]` + continue. |
| Build warns about chunk size | Ignore (limit is 4 MB by design). |
| A card's anchor text is not found | Search for a shorter distinctive part of it (e.g. the function name). The surrounding code is described in the card; edit the matching place. Log the drift in `Surprises:`. |
| `git push` / `gh` fails (auth/network) | Log it, continue all local work. T7.7 retries once at the end. |

---

## 3. Decisions (do not re-litigate)

- **Rotate keys:** `Q` = rotate left, `F` = rotate right. `E` stays grab/use/confirm. While
  carrying, `E` **or** left click confirms (dock / confirm rotation). `R` = drop. `Esc` = cancel.
- **Detach:** looking at a mounted part, `E` opens the remove prompt; `E` again (or `R`) removes it.
- **Simulation stays 30 Hz**; smoothness comes from render interpolation + render-time look
  preview (safer than retuning everything for 60 Hz).
- **Pausing:** losing mouse capture (Esc) or window focus pauses and shows a pause overlay;
  clicking resumes and re-captures the mouse (a click is a valid user gesture; an Esc keypress
  is not, per the HTML spec — that is why the old Esc-resume re-capture failed).
- **Dropped parts fall** under gravity (14 m/s², cap 12 m/s) onto static geometry or other parts.
- **Soft-detach** (part snagged, player walked away) drops the part where it is instead of
  teleporting it back to where it was picked up.
- **Shoulder camera:** 0.45 m right offset in the game. URL `?shoulder=0` disables it (the
  harness uses this so its aim math stays valid).
- **Level:** the test lab is removed from the shipped game (it stays as a test fixture). A
  partition wall at z = 8.0–8.5 splits the room into the hub (north) and the Pressure Gallery
  (south). Branch A's door moves into that wall at x = −6. Doors B/C stay sealed on the north
  wall. Spawn is in the hub at (−4.5, 0.01, 12).
- **Visuals:** one shadow-casting directional light (PCFShadowMap — `PCFSoftShadowMap` was
  removed in r186), RoomEnvironment reflections, procedural gear and pipe shapes, emissive glow
  on running machines. No post-processing/bloom.
- **Settings** stored in `localStorage["gearwright:settings"]` (separate from save slots).
- **Hosting:** GitHub Pages via GitHub Actions. Repo `gearwright` under the logged-in `gh`
  account, **public** (free Pages needs a public repo). *Owner may change `--public` to
  `--private` in T7.7 before execution; private Pages needs GitHub Pro — CI still runs.*
- **Action versions** (checked with `gh api` on 23/09/2026): `actions/checkout@v7`,
  `actions/setup-node@v7`, `actions/configure-pages@v6`, `actions/upload-pages-artifact@v5`,
  `actions/deploy-pages@v5`. Node 22 in CI (local is v22.15.0).
- **Production logs:** `console.info` game logs only in dev or with `?log=1`.
- **Error reporting:** local only (toast + console), no third-party service.
- **Harness URL flags:** harness always loads `?shoulder=0&skipTitle=1&log=1`.
- The harness (`tmp-browser-check.mjs`) becomes committed tooling at `scripts/browser-check.mjs`.

---

## 4. Phases

Legend: `[ ]` todo · `[x]` done · `[!]` failed after retries (see log) · `[~]` done with a logged caveat.

### Phase 0 — Guardrails
- [x] T0.1 Branch + baseline
- [x] T0.2 Commit the browser harness as tooling
- [x] CHECKPOINT 0

### Phase 1 — P0: controls that work for a real person
- [x] T1.1 Fix the E key conflict, confirm key, rotation→preview, detach discoverability
- [ ] T1.2 Pause overlay, click-to-resume, pointer-lock re-capture fix
- [ ] T1.3 Dropped parts fall (gravity settle)
- [ ] T1.4 Save when the tab is hidden or closed
- [ ] T1.5 Harness: `hold` scenario + pause checks
- [ ] Fix-up: retry any `[!]` task once
- [ ] CHECKPOINT 1

### Phase 2 — Feel: smooth camera and physical parts
- [ ] T2.1 Interpolation helpers (`core/interp.ts`)
- [ ] T2.2 Render interpolation (player, carryables) + render-time look preview
- [ ] T2.3 Raise the mouse flick cap
- [ ] T2.4 Recentre only while moving + shoulder camera
- [ ] T2.5 Held part not solid to the player; parts don't overlap each other; soft-detach drops in place
- [ ] Fix-up
- [ ] CHECKPOINT 2

### Phase 3 — World clean-up and render efficiency
- [ ] T3.1 Remove the Phase-1 placeholder scene (keep the lights)
- [ ] T3.2 Fix the world-mesh GPU leak + merge world meshes by colour
- [ ] T3.3 Per-frame allocation trims + power preference
- [ ] Fix-up
- [ ] CHECKPOINT 3

### Phase 4 — A real level: hub + Pressure Gallery
- [ ] T4.1 `levels/game-room.ts` (floor, outer walls, partition wall, spawn)
- [ ] T4.2 Move Branch A's door into the partition wall
- [ ] T4.3 `levels/shipped-content.ts` + remove the lab from `main.ts`
- [ ] T4.4 Content-integrity tests (reachability, no embedded targets)
- [ ] T4.5 Harness update for the new level
- [ ] Fix-up
- [ ] CHECKPOINT 4

### Phase 5 — Visuals
- [ ] T5.1 Shadows + environment reflections + light rework
- [ ] T5.2 Procedural gear and pipe shapes for carryables + powered glow
- [ ] T5.3 Cylinder shafts in the world
- [ ] T5.4 Adaptive pixel ratio on slow machines
- [ ] Fix-up
- [ ] CHECKPOINT 5 (+ owner visual sign-off checklist)

### Phase 6 — UX shell
- [ ] T6.1 Controls table helper
- [ ] T6.2 Title screen (Start/Continue, New Game, Controls)
- [ ] T6.3 Pause overlay: controls + New Game
- [ ] T6.4 Settings (sensitivity, invert Y, volume)
- [ ] T6.5 Touch-only device notice
- [ ] Fix-up
- [ ] CHECKPOINT 6

### Phase 7 — Production + deployment
- [ ] T7.1 Production-quiet game log
- [ ] T7.2 Global error handler
- [ ] T7.3 Split three.js into its own cached chunk
- [ ] T7.4 CI workflow
- [ ] T7.5 GitHub Pages deploy workflow
- [ ] T7.6 Harness `--url` mode (test the live site)
- [ ] T7.7 Create repo, push, enable Pages, deploy
- [ ] T7.8 Live verification
- [ ] T7.9 README + PROJECT_STATE closing entry + close this plan
- [ ] CHECKPOINT 7 (final)

---

## 5. CHECKPOINT procedure (same at the end of every phase)

1. `npm run typecheck` → clean.
2. `npx vitest run` → all green. Note the counts.
3. `npm run build` → green. Note JS size + gzip.
4. Run the phase's harness scenarios (listed in the phase's CHECKPOINT line below).
5. Tick the phase's boxes in section 4.
6. Append a Progress Log entry (template at the bottom). `Next:` = the first task of the next phase.
7. `git add -A && git commit -m "overhaul(CP<n>): checkpoint — phase <n> complete"` (only if
   there are uncommitted log/plan edits).
8. `git checkout main && git merge --ff-only overhaul && git checkout overhaul`.
   If ff-only fails (someone committed to main), run `git checkout overhaul && git rebase main`,
   rerun steps 1–3, then retry the merge.
9. If a remote exists (`git remote -v` prints `origin`): `git push origin main overhaul`.
10. **End the session here if your context is more than half used.** The next session starts at
    section 0.1.

---

## PHASE 0 — Guardrails

### T0.1 Branch + baseline
**Steps**
1. `git status --short` must be empty except `PLAN.md`. If other files are modified, commit them
   first as `chore: pre-overhaul state` (do not discard anyone's work).
2. `git checkout overhaul 2>/dev/null || git checkout -b overhaul` (the branch may already
   exist — the plan itself was committed on it).
3. Run `npm run typecheck`, `npx vitest run`, `npm run build`. Record counts/sizes in the log.
**Verify:** all three green; expected ≈ 564 tests / 44 files, ≈ 706 kB JS.
**Commit:** `overhaul(T0.1): start overhaul branch` (commit `PLAN.md` if not yet committed).

### T0.2 Commit the browser harness as tooling
**Files:** `tmp-browser-check.mjs` → `scripts/browser-check.mjs`, `.gitignore`, `package.json`.
**Steps**
1. `mkdir -p scripts && mv tmp-browser-check.mjs scripts/browser-check.mjs`
2. In `.gitignore`, delete the line `tmp-browser-check.mjs` and the comment line above it that
   says it is throwaway. Keep `.tmp-*`.
3. In `scripts/browser-check.mjs`:
   - Replace the first header comment line
     `THROWAWAY browser verification harness — NOT part of the repo or the build.` with
     `Local browser verification harness (committed tooling; not part of the build, not run in CI).`
   - Replace `const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';` with
     `const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';`
   - Replace the `BASE` line with:
     ```js
     // Harness URL flags: shoulder camera off (aim math assumes the camera looks through the
     // player), no title screen, game logs on even in production builds.
     const QUERY = '?shoulder=0&skipTitle=1&log=1';
     const BASE = (PRODUCTION ? `http://127.0.0.1:${PREVIEW_PORT}/` : `http://127.0.0.1:${DEV_PORT}/`) + QUERY;
     ```
     (The flags are ignored by the game until later tasks add them — harmless now.)
   - `ROOT` stays `process.cwd()`; always run the harness from the repo root.
4. `package.json` → `"scripts"`: add `"check:browser": "node scripts/browser-check.mjs"`.
**Verify:** `npm run check:browser -- boot` → report JSON printed; `report.problems` is `[]`
(or only the two known AudioContext autoplay warnings); `data.lifecycle.pausedState === "paused"`
and `data.lifecycle.resumedState === "running"`.
**Commit:** `overhaul(T0.2): commit browser harness as scripts/browser-check.mjs`

### CHECKPOINT 0 — harness: `boot`.

---

## PHASE 1 — P0: controls that work for a real person

### T1.1 E key conflict, confirm key, Rotation→SnapPreview, detach discoverability
**Why:** `E` is both "grab" and "rotate right". A human holds a key ~100–200 ms (3–6 sim steps),
so the grab press keeps rotating the part and puts it in `Rotation`, where the snap preview
never starts (`syncSnapPreview` only enters it from `Manipulation`). The HUD also says
`[E] confirm` while carrying, but only a mouse click confirms. And removing a mounted part needs
`R`, which is shown nowhere.

**Files:** `src/gameplay/input-system.ts`, `src/gameplay/manipulation-system.ts`,
`src/presentation/hud.ts`, `src/main.ts`, `src/style.css` (none needed), tests below.
**Don't touch:** `snap-system.ts`, `game-state/**`.

**Edits**
1. `src/gameplay/input-system.ts`, in `DEFAULT_BINDINGS`: change `rotateRight: 'KeyE',` to
   `rotateRight: 'KeyF',`. Update the comment on the `rotateLeft`/`rotateRight` fields in
   `InputBindings` to: `/** Rotate the held object (Manipulation context): Q left, F right — E is grab/confirm. */`
2. Same file, Manipulation branch of `sample()` (anchor: `primary: raw.primaryPressed,`): replace
   with
   ```ts
        // E or the mouse confirms while carrying (dock / confirm rotation), so the HUD's
        // "[E] confirm" is true. The grab press itself was consumed as an edge in the
        // Exploration step, so a held E can never confirm by accident.
        primary: raw.primaryPressed || raw.pressed.has(this.bindings.primary),
   ```
   Also update the block comment above that branch: replace "`Q`/`E` rotate the held object" with
   "`Q`/`F` rotate the held object" and "grab/attach confirm is the mouse button" with
   "confirm is `E` or the mouse button".
3. `src/gameplay/manipulation-system.ts`, method `syncSnapPreview` (anchor:
   `if (this.stateValue === 'Manipulation') {` inside it). Replace that first `if` block with:
   ```ts
    if (this.stateValue === 'Manipulation' || this.stateValue === 'Rotation') {
      if (candidate === null || candidate.componentId !== record.binding.instanceId) return;
      // A candidate while rotating confirms the rotation: the socket pose is canonical
      // anyway (§21.3), so making the player click "confirm rotation" first was a trap.
      if (this.stateValue === 'Rotation') this.emit('RotationConfirmed', record.binding.instanceId);
      this.snapCandidate = candidate;
      this.transition('SnapPreview');
      this.emit('SnapCandidateChanged', record.binding.instanceId);
      return;
    }
   ```
4. Same file, `step()`, the `DetachPrompt` branch (anchor: `} else if (input.actions.secondary) {`
   directly followed by `this.tryDetach();`). Change the condition to
   `} else if (input.actions.secondary || input.actions.primary) {` and add above it the comment
   `// The same key that opened the prompt confirms it (E), and the drop key still works (R).`
5. `src/presentation/hud.ts`:
   - `HudManipulationView`: add after `rotateKey`:
     ```ts
     /** Second rotate key (the other direction). Absent hides its chip. */
     readonly rotateRightKey?: string | undefined;
     /** Drop key. Absent hides the drop chip. */
     readonly dropKey?: string | undefined;
     ```
   - `HUD_MARKUP`: replace the line
     `<span class="gw-hud-binding"><kbd class="gw-hud-key gw-hud-rotate-key"></kbd> rotate</span>` with
     `<span class="gw-hud-binding"><kbd class="gw-hud-key gw-hud-rotate-key"></kbd><kbd class="gw-hud-key gw-hud-rotate-right-key"></kbd> rotate</span>`
     and insert before the cancel binding line:
     `<span class="gw-hud-binding gw-hud-drop-binding"><kbd class="gw-hud-key gw-hud-drop-key"></kbd> drop</span>`
   - Class fields next to `rotateKey`: `private readonly rotateRightKey: HTMLElement;`,
     `private readonly dropBinding: HTMLElement;`, `private readonly dropKey: HTMLElement;`
   - Constructor next to `this.rotateKey = requireChild(...)`:
     ```ts
     this.rotateRightKey = requireChild(this.host, '.gw-hud-rotate-right-key');
     this.dropBinding = requireChild(this.host, '.gw-hud-drop-binding');
     this.dropKey = requireChild(this.host, '.gw-hud-drop-key');
     ```
   - `renderManipulation`, after `setText(this.cancelKey, view.cancelKey);`:
     ```ts
     setText(this.rotateRightKey, view.rotateRightKey ?? '');
     setHidden(this.rotateRightKey, view.rotateRightKey === undefined);
     setText(this.dropKey, view.dropKey ?? '');
     setHidden(this.dropBinding, view.dropKey === undefined);
     ```
   - Update the wireframe comment line `[Q] rotate   [E] confirm   [Esc] cancel` to
     `[Q][F] rotate   [E] confirm   [R] drop   [Esc] cancel`.
6. `src/main.ts`, in `buildHudRenderer` → `render` → the `manipulation:` object of the snapshot
   (anchor: `rotateKey: keyLabel(bindings.rotateLeft),`): add
   ```ts
        rotateRightKey: keyLabel(bindings.rotateRight),
        dropKey: keyLabel(bindings.secondary),
   ```
7. `src/main.ts`, same `render`, the `focus:` object (anchor: `verb: focus === null ? null : focus.verb,`):
   replace with
   ```ts
        // The remove prompt is a real state (§19 DetachPrompt): say what the next press does.
        verb:
          focus === null
            ? null
            : manipulation.state === 'DetachPrompt' && manipulation.focusedId === focus.id
              ? 'Press again to remove'
              : focus.verb,
   ```
8. `src/main.ts`, bottom dev socket object (anchor: `__gearwrightDev = {`): add `manipulation,`
   after `interaction,`.

**New tests** (append at the end of each named file, reusing its helpers):
- `tests/logic/manipulation-system.test.ts`:
  ```ts
  describe('ManipulationSystem — overhaul T1.1', () => {
    it('enters SnapPreview straight from Rotation, confirming the rotation', () => {
      const snap = new FakeSnap();
      const { sm } = build({}, snap);
      grab(sm);
      step(sm, { actions: { rotate: 1 } });
      expect(sm.state).toBe('Rotation');
      snap.candidate = candidateFor();
      const result = step(sm);
      expect(result.state).toBe('SnapPreview');
      expect(eventTypes(result)).toContain('RotationConfirmed');
      expect(eventTypes(result)).toContain('SnapCandidateChanged');
    });

    it('detaches with the primary key too (E again confirms the remove prompt)', () => {
      const snap = new FakeSnap();
      const { sm } = build({}, snap);
      step(sm, { focus: focusOn(CRATE.instanceId, 'attached') });
      step(sm, { focus: focusOn(CRATE.instanceId, 'attached'), actions: { primary: true } });
      expect(sm.state).toBe('DetachPrompt');
      const detached = step(sm, { focus: focusOn(CRATE.instanceId, 'attached'), actions: { primary: true } });
      expect(snap.detaches).toEqual([CRATE.instanceId]);
      expect(detached.state).toBe('Exploration');
    });
  });
  ```
- `tests/logic/input-system.test.ts`:
  ```ts
  describe('InputSystem — overhaul T1.1 key map', () => {
    it('rotates right on F, never on E, while carrying', () => {
      const input = new InputSystem({ context: 'Manipulation' });
      expect(input.sample(neutralSample({ held: new Set(['KeyF']) })).rotate).toBe(1);
      expect(input.sample(neutralSample({ held: new Set(['KeyE']) })).rotate).toBe(0);
    });

    it('confirms with a fresh E press while carrying, but not with a held E', () => {
      const input = new InputSystem({ context: 'Manipulation' });
      expect(input.sample(neutralSample({ pressed: new Set(['KeyE']), held: new Set(['KeyE']) })).primary).toBe(true);
      expect(input.sample(neutralSample({ held: new Set(['KeyE']) })).primary).toBe(false);
    });
  });
  ```
- `tests/dom/hud.test.ts`:
  ```ts
  describe('Hud — overhaul T1.1 bindings', () => {
    it('shows the second rotate key and the drop key when provided, hides them when absent', () => {
      const root = document.createElement('div');
      const hud = new Hud(root);
      hud.render(makeSnapshot({ manipulation: { heldName: 'Gear', rotateKey: 'Q', rotateRightKey: 'F', dropKey: 'R', confirmKey: 'E', cancelKey: 'Esc', socketState: 'none' } }));
      expect(root.querySelector('.gw-hud-rotate-right-key')?.textContent).toBe('F');
      expect(root.querySelector('.gw-hud-drop-key')?.textContent).toBe('R');
      expect(root.querySelector('.gw-hud-drop-binding')?.classList.contains('gw-hud-hidden')).toBe(false);
      hud.render(makeSnapshot({ manipulation: { heldName: 'Gear', rotateKey: 'Q', confirmKey: 'E', cancelKey: 'Esc', socketState: 'none' } }));
      expect(root.querySelector('.gw-hud-drop-binding')?.classList.contains('gw-hud-hidden')).toBe(true);
    });
  });
  ```
  (`makeSnapshot` is the factory at the top of that file; `document` exists — it is a jsdom suite.)

**May update:** `tests/logic/input-system.test.ts` → test
`routes the manipulation action set (M3): slow strafe, rotate, drop, cancel`: in its
`held: new Set(['KeyW', 'KeyE', 'ShiftLeft'])` change `'KeyE'` to `'KeyF'`, and change the
comment `Q/E rotate the held object here` to `Q/F rotate the held object here`. Nothing else.

**Verify:** typecheck; `npx vitest run tests/logic/input-system.test.ts tests/logic/manipulation-system.test.ts tests/dom/hud.test.ts`; full `npx vitest run`.
**Commit:** `overhaul(T1.1): fix E grab/rotate conflict, E confirms while carrying, rotation no longer blocks docking, E confirms remove`

### T1.2 Pause overlay, click-to-resume, pointer-lock re-capture
**Why:** pausing stops rendering with nothing on screen (looks frozen); clicking doesn't resume;
Esc-resume asks for pointer lock from an Esc keypress, which browsers refuse, and one refusal
disabled mouse capture for the whole session.

**Files:** new `src/presentation/pause-overlay.ts`, `src/style.css`, `src/main.ts`,
new `tests/dom/pause-overlay.test.ts`.
**Don't touch:** `src/core/lifecycle.ts`, `src/app.ts`, `src/adapters/dom-input-source.ts`.

**Edits**
1. Create `src/presentation/pause-overlay.ts`:
   ```ts
   /**
    * L4 — pause overlay (DOM). Shown while the lifecycle is paused so a paused game never looks
    * frozen; a click resumes. The overlay only reports the intent — the composition root owns
    * the lifecycle and the pointer capture (a click is a valid user gesture for both).
    */

   export type PauseCause = 'user' | 'focus-loss' | 'pointer';

   const CAUSE_TEXT: Readonly<Record<PauseCause, string>> = {
     user: 'Game paused.',
     'focus-loss': 'Paused because the window lost focus.',
     pointer: 'Paused because the mouse was released.'
   };

   /** Static skeleton: zero interpolation, every dynamic value goes through textContent. */
   const PAUSE_MARKUP = `
   <div class="gw-pause-panel" role="dialog" aria-modal="true" aria-labelledby="gw-pause-title">
     <h2 class="gw-pause-title" id="gw-pause-title">Paused</h2>
     <p class="gw-pause-detail"></p>
     <button type="button" class="gw-pause-resume">Resume</button>
     <p class="gw-pause-keys">Click anywhere to resume · Esc also resumes</p>
     <div class="gw-pause-extra"></div>
   </div>
   `;

   export class PauseOverlay {
     private readonly element: HTMLDivElement;
     private readonly detail: HTMLElement;
     private readonly extra: HTMLElement;
     private resumeHandler: (() => void) | null = null;

     constructor(root: HTMLElement) {
       const doc = root.ownerDocument;
       this.element = doc.createElement('div');
       this.element.className = 'gw-pause gw-pause--hidden';
       this.element.innerHTML = PAUSE_MARKUP;
       root.appendChild(this.element);
       const detail = this.element.querySelector<HTMLElement>('.gw-pause-detail');
       const extra = this.element.querySelector<HTMLElement>('.gw-pause-extra');
       if (detail === null || extra === null) throw new Error('ERR-PAUSE-01: pause skeleton incomplete');
       this.detail = detail;
       this.extra = extra;
       // Any click resumes, except on controls that live inside the panel (settings, buttons
       // marked no-resume) — a slider drag must never unpause the game.
       this.element.addEventListener('click', (event) => {
         const target = event.target as Element | null;
         if (target !== null && target.closest('input, select, label, .gw-pause-noresume') !== null) return;
         this.resumeHandler?.();
       });
     }

     onResume(handler: () => void): void {
       this.resumeHandler = handler;
     }

     show(cause: PauseCause): void {
       this.detail.textContent = CAUSE_TEXT[cause];
       this.element.classList.remove('gw-pause--hidden');
     }

     hide(): void {
       this.element.classList.add('gw-pause--hidden');
     }

     get visible(): boolean {
       return !this.element.classList.contains('gw-pause--hidden');
     }

     /** Extra panel content (controls table, settings) mounted by the composition root. */
     mountExtra(content: HTMLElement): void {
       this.extra.appendChild(content);
     }

     dispose(): void {
       this.element.remove();
     }
   }
   ```
2. Append to `src/style.css` (flat rules):
   ```css
   /* Pause overlay (PLAN T1.2): a paused game must never look frozen. */
   .gw-pause {
     position: fixed;
     inset: 0;
     z-index: 20;
     display: flex;
     align-items: center;
     justify-content: center;
     background: rgb(12 14 16 / 55%);
     pointer-events: auto;
     cursor: pointer;
   }

   .gw-pause--hidden {
     display: none;
   }

   .gw-pause-panel {
     min-width: 280px;
     max-width: min(460px, calc(100vw - 32px));
     max-height: calc(100vh - 32px);
     overflow-y: auto;
     padding: 20px 24px;
     background: rgb(12 14 16 / 86%);
     border: 1px solid var(--gw-concrete);
     border-radius: 6px;
     text-align: center;
     color: var(--gw-interactive);
     cursor: default;
   }

   .gw-pause-title {
     margin: 0 0 8px;
     font-size: 20px;
     letter-spacing: 0.08em;
   }

   .gw-pause-detail {
     margin: 0 0 16px;
     font-size: 13px;
     color: var(--gw-muted);
   }

   .gw-pause-resume {
     font: inherit;
     font-size: 14px;
     padding: 8px 20px;
     border-radius: 4px;
     border: 1px solid var(--gw-powered);
     background: transparent;
     color: var(--gw-interactive);
     cursor: pointer;
   }

   .gw-pause-resume:focus-visible {
     outline: 2px solid var(--gw-powered);
     outline-offset: 2px;
   }

   .gw-pause-keys {
     margin: 12px 0 0;
     font-size: 12px;
     color: var(--gw-muted);
   }

   .gw-pause-extra {
     margin-top: 12px;
     text-align: left;
   }
   ```
3. `src/main.ts`:
   a. Import: `import { PauseOverlay, type PauseCause } from './presentation/pause-overlay.ts';`
   b. Right after `const hud = new Hud(hudRoot);` add:
      ```ts
      // PLAN T1.2: a paused game shows why it is paused and resumes on a click.
      const pauseOverlay = new PauseOverlay(document.body);
      /** Why the *next* pause happens (set just before requesting it); focus loss is read from the lifecycle reason. */
      let pendingPauseCause: PauseCause = 'user';
      /** When the last pause began (ms): an Esc arriving right after a capture-loss pause must not undo it. */
      let lastPauseAt = Number.NEGATIVE_INFINITY;
      ```
   c. Replace the whole `lockState` declaration and the `onPointerLockChange` /
      `onPointerLockError` callbacks inside `new DomInputSource({ … })` with:
      ```ts
      const lockState = {
        captured: false,
        /** True once the browser granted a capture this session. */
        everCaptured: false,
        /** Last refusal reason, cleared by a later grant. */
        lastError: null as string | null,
        /** The refusal toast is shown once per session; requests continue on every click. */
        refusalAnnounced: false
      };
      ```
      and inside the `DomInputSource` options:
      ```ts
        onPointerLockChange: (locked) => {
          if (locked) {
            lockState.captured = true;
            lockState.everCaptured = true;
            lockState.lastError = null;
            return;
          }
          lockState.captured = false;
          inputSource.clearAll();
          // Losing the capture mid-play (Esc, alt-tab) pauses, like every mouse-look game;
          // the overlay's click then resumes *and* re-captures (a click is a user gesture).
          if (app.snapshot().lifecycle === 'running') {
            pendingPauseCause = 'pointer';
            app.requestPause('user');
          }
        },
        onPointerLockError: (reason) => {
          lockState.lastError = reason;
          if (lockState.refusalAnnounced) return;
          lockState.refusalAnnounced = true;
          hud.toast(`Mouse capture unavailable (${reason}) — look still works over the canvas.`, 'warn');
          console.info(`[input] pointer lock refused (${reason}) — raw mouse deltas only`);
        }
      ```
      (`app` is declared later with `const`; it is only read inside callbacks that run after
      boot, which is valid TypeScript/JS. If TypeScript reports "used before declaration", move
      nothing — instead wrap the read as `appRef.current` where `const appRef: { current: App | null } = { current: null };`
      is declared before `inputSource` and set right after `createApp(...)` returns; then guard
      `if (appRef.current?.snapshot().lifecycle === 'running')`.)
   d. `entryPointer:` in the `buildHudRenderer({ … })` call — replace the function body with:
      ```ts
      entryPointer: () => {
        if (lockState.captured) return null;
        // "Unavailable" wording only while the browser has never granted a capture.
        return { pointerLocked: false, pointerLockUnavailable: lockState.lastError !== null && !lockState.everCaptured };
      }
      ```
   e. `onLifecycleTransition:` in the `createApp({ … })` call — replace the whole conditional
      value with:
      ```ts
      onLifecycleTransition: (transition) => {
        if (debugFlagState.logLifecycle) {
          console.info(`[lifecycle] ${transition.from} -> ${transition.to} (${transition.reason})`);
        }
        if (transition.to === 'paused') {
          lastPauseAt = performance.now();
          // 'menu' pauses belong to the title screen (PLAN T6.2), which draws its own panel.
          if (transition.reason !== 'menu') {
            pauseOverlay.show(transition.reason === 'focus-loss' ? 'focus-loss' : pendingPauseCause);
          }
          pendingPauseCause = 'user';
        } else if (transition.to === 'running') {
          pauseOverlay.hide();
        }
      }
      ```
   f. After `if (!app.start()) { … }` block, add:
      ```ts
      pauseOverlay.onResume(() => {
        if (app.snapshot().lifecycle !== 'paused') return;
        inputSource.clearAll();
        app.resume('user');
        canvas.focus({ preventScroll: true });
        void inputSource.requestPointerLock();
      });
      ```
   g. `handlePauseKey`, the `else if (state === 'paused')` branch: delete the line
      `if (!lockState.refused) void inputSource.requestPointerLock();` and the comment block
      above it; put this comment instead:
      `// Esc is not a user activation (HTML spec), so the mouse is NOT re-captured here — the next click on the game view captures it.`
      Also make the branch's first line
      `if (performance.now() - lastPauseAt < 300) return; // the Esc that released the capture already paused — don't undo it`
      (browsers differ on whether the capture-releasing Esc also reaches the page as a keydown).
   h. `handleCanvasPointer`: change the condition to
      `if (!inputSource.isPointerLocked && event.button === 0) {` (remove the `refused` check)
      and update the comment "One refusal ends the asking for the session" to
      "A refusal is announced once; later clicks may still succeed (Chrome refuses re-capture for ~1 s after Esc)."
   i. In `bindBrowserEvents(window, canvas, { … })` replace
      `onVisibilityChange: (hidden) => app.handleVisibilityChange(hidden),` with
      ```ts
      onVisibilityChange: (hidden) => {
        app.handleVisibilityChange(hidden);
        // Back from another tab with the capture gone: pause instead of running with a free cursor.
        if (!hidden && lockState.everCaptured && !lockState.captured && app.snapshot().lifecycle === 'running') {
          pendingPauseCause = 'pointer';
          app.requestPause('user');
        }
      },
      ```
   j. `shutdown`: add `pauseOverlay.dispose();` before `app.dispose();`.
4. Create `tests/dom/pause-overlay.test.ts`:
   ```ts
   import { describe, expect, it, vi } from 'vitest';

   import { PauseOverlay } from '../../src/presentation/pause-overlay.ts';

   describe('PauseOverlay (PLAN T1.2)', () => {
     it('starts hidden, shows the cause, hides again', () => {
       const root = document.createElement('div');
       const overlay = new PauseOverlay(root);
       expect(overlay.visible).toBe(false);
       overlay.show('focus-loss');
       expect(overlay.visible).toBe(true);
       expect(root.querySelector('.gw-pause-detail')?.textContent).toBe('Paused because the window lost focus.');
       overlay.hide();
       expect(overlay.visible).toBe(false);
     });

     it('resumes on a click anywhere, but not on panel controls', () => {
       const root = document.createElement('div');
       const overlay = new PauseOverlay(root);
       const onResume = vi.fn();
       overlay.onResume(onResume);
       overlay.show('user');
       (root.querySelector('.gw-pause-resume') as HTMLButtonElement).click();
       expect(onResume).toHaveBeenCalledTimes(1);
       const slider = document.createElement('input');
       overlay.mountExtra(slider);
       slider.click();
       expect(onResume).toHaveBeenCalledTimes(1);
       (root.querySelector('.gw-pause') as HTMLElement).click();
       expect(onResume).toHaveBeenCalledTimes(2);
     });
   });
   ```
**Verify:** typecheck; `npx vitest run tests/dom/pause-overlay.test.ts tests/boundary`; full suite;
`grep -n "lockState.refused" src/main.ts` → prints nothing.
**Commit:** `overhaul(T1.2): pause overlay, click-to-resume with re-capture, no permanent capture refusal`

### T1.3 Dropped parts fall (gravity settle)
**Why:** released parts stay at chest height in mid-air; nothing makes them fall.

**File:** `src/gameplay/manipulation-system.ts` (+ tests). **Don't touch:** ports, physics adapter.

**Edits**
1. Constants block (near `const DETACH_ASSIST_GRACE_STEPS`), add:
   ```ts
   /** Released parts fall (PLAN T1.3): gravity and terminal speed match the player's. */
   const FALL_GRAVITY = 14;
   const FALL_MAX_SPEED = 12;
   /** How far below a part the support probe looks (the room is far shallower). */
   const SUPPORT_PROBE_DISTANCE = 50;
   /** Bottom-face probe points (centre + four corners), in half-extent units. */
   const SUPPORT_SAMPLES: ReadonlyArray<readonly [number, number]> = [[0, 0], [1, 1], [1, -1], [-1, 1], [-1, -1]];
   ```
2. `interface CarryableRecord`: add fields
   ```ts
   /** True while the part is falling to its rest pose (never while held). */
   falling: boolean;
   /** Current fall speed, m/s (0 when resting). */
   fallSpeed: number;
   ```
   and in `upsertRecord` add `falling: false, fallSpeed: 0,` to the `record` literal.
3. Scratch fields next to `scratchCandidate`:
   ```ts
   private readonly scratchOrigin = vec3();
   private readonly scratchDown = vec3(0, -1, 0);
   private readonly scratchOtherHalf = vec3();
   ```
4. New private methods (place them after `holdRangeExceeded`):
   ```ts
   /**
    * Highest support surface under the part's footprint (static geometry via rays, other
    * parts via their boxes), or null when nothing is below — then the part stays put, which
    * is also what every scripted-physics test expects.
    */
   private supportTopBelow(record: CarryableRecord, pose: Pose): number | null {
     rotatedHalfExtents(record.binding.definition.halfExtents, pose.yaw, this.scratchHalfExtents);
     const hx = this.scratchHalfExtents.x;
     const hy = this.scratchHalfExtents.y;
     const hz = this.scratchHalfExtents.z;
     const bottom = pose.center.y - hy;
     let best: number | null = null;
     for (const [sx, sz] of SUPPORT_SAMPLES) {
       this.scratchOrigin.x = pose.center.x + sx * Math.max(hx - 0.02, 0);
       this.scratchOrigin.y = bottom + 0.001;
       this.scratchOrigin.z = pose.center.z + sz * Math.max(hz - 0.02, 0);
       const hit = this.physics.castRay(this.scratchOrigin, this.scratchDown, SUPPORT_PROBE_DISTANCE);
       if (hit !== null && hit.point.y <= bottom + 0.002 && (best === null || hit.point.y > best)) {
         best = hit.point.y;
       }
     }
     for (const id of this.order) {
       if (id === record.binding.instanceId || id === this.heldObjectId) continue;
       const other = this.records.get(id);
       if (!other) continue;
       rotatedHalfExtents(other.binding.definition.halfExtents, other.pose.yaw, this.scratchOtherHalf);
       const overlapX =
         pose.center.x - hx < other.pose.center.x + this.scratchOtherHalf.x &&
         pose.center.x + hx > other.pose.center.x - this.scratchOtherHalf.x;
       const overlapZ =
         pose.center.z - hz < other.pose.center.z + this.scratchOtherHalf.z &&
         pose.center.z + hz > other.pose.center.z - this.scratchOtherHalf.z;
       if (!overlapX || !overlapZ) continue;
       const top = other.pose.center.y + this.scratchOtherHalf.y;
       if (top <= bottom + 0.002 && (best === null || top > best)) best = top;
     }
     return best;
   }

   /**
    * Start a fall toward the support below. The *rest* pose becomes `lastValidPose` at once,
    * so a save taken mid-fall never records a floating part (EC-SAVE-02's spirit).
    */
   private startFall(record: CarryableRecord): void {
     const support = this.supportTopBelow(record, record.pose);
     if (support === null) return;
     const restY = quantiseCanonical(support + record.binding.definition.halfExtents.y);
     if (record.pose.center.y - restY <= CANONICAL_PRECISION) return;
     const rest: Pose = {
       center: {
         x: quantiseCanonical(record.pose.center.x),
         y: restY,
         z: quantiseCanonical(record.pose.center.z)
       },
       yaw: record.pose.yaw
     };
     if (this.poseBlocked(record, rest)) return; // never fall into geometry
     record.lastValidPose = rest;
     record.falling = true;
     record.fallSpeed = 0;
   }

   /** Advance every falling, un-held part one step; lands exactly on its rest height. */
   private stepFalling(dt: number): void {
     for (const id of this.order) {
       const record = this.records.get(id);
       if (!record || !record.falling || id === this.heldObjectId) continue;
       record.fallSpeed = Math.min(record.fallSpeed + FALL_GRAVITY * dt, FALL_MAX_SPEED);
       const restY = record.lastValidPose.center.y;
       const nextY = record.pose.center.y - record.fallSpeed * dt;
       if (nextY <= restY) {
         record.pose.center.y = restY;
         record.falling = false;
         record.fallSpeed = 0;
       } else {
         record.pose.center.y = nextY;
       }
       this.publishRecord(record, false);
     }
   }
   ```
5. `step()`: right after `if (this.detachGrace > 0) this.detachGrace -= 1;` add
   `this.stepFalling(stepDt);`
6. Call `this.startFall(record);` at these places (each right before the `emit(...)` of that path):
   - `commitRelease` (covers normal and relocated release) — after `this.publishRecord(record, true);`.
   - `tryDetach` — after `this.publishRecord(record, true);`.
   - `step()` → `Grab` branch cancel (after `if (record) this.restore(record, record.preGrabPose);` add
     `if (record) this.startFall(record);`).
   - `stepHolding` → cancel branch `else { this.restore(record, record.preGrabPose); …` — after
     `this.publishRecord(record, true);` add `this.startFall(record);`.
   - `restorePose` — after `this.publishRecord(record, true);` (a save from before this fix may
     hold a mid-air pose).
7. `tryGrab`: before `record.preGrabPose = this.clonePose(record.pose);` add
   ```ts
   // Catching a falling part is allowed; it stops falling in the player's hands.
   record.falling = false;
   record.fallSpeed = 0;
   ```
8. `snapshotOf` is unchanged (the renderer reads the live pose).

**New tests** — append to `tests/logic/manipulation-system.test.ts`:
```ts
describe('ManipulationSystem — overhaul T1.3 falling parts', () => {
  it('drops a released part onto the floor over a few steps, and saves the rest pose immediately', () => {
    const physics = new KinematicPhysics();
    physics.setStaticColliders(LAB_WORLD.colliders);
    const sm = new ManipulationSystem(physics, LAB_CARRYABLE, null);
    step(sm, { focus: focusOn(LAB_CARRYABLE.instanceId) });
    step(sm, { focus: focusOn(LAB_CARRYABLE.instanceId), actions: { primary: true } });
    step(sm, { focus: focusOn(LAB_CARRYABLE.instanceId) });
    for (let i = 0; i < 20; i += 1) step(sm);
    expect(sm.currentPose.center.y).toBeGreaterThan(0.8);

    step(sm, { actions: { secondary: true } });
    const restY = LAB_CARRYABLE.definition.halfExtents.y;
    expect(sm.lastValidPoseOf(LAB_CARRYABLE.instanceId)?.center.y).toBeCloseTo(restY, 4);

    for (let i = 0; i < 30; i += 1) step(sm);
    expect(sm.currentPose.center.y).toBeCloseTo(restY, 4);
  });

  it('stays put when nothing is below (scripted physics reports no support)', () => {
    const { sm } = build();
    grab(sm);
    for (let i = 0; i < 10; i += 1) step(sm);
    const held = sm.currentPose;
    step(sm, { actions: { secondary: true } });
    for (let i = 0; i < 10; i += 1) step(sm);
    expect(sm.currentPose).toEqual(held);
  });
});
```
**May update:** none expected. If `Manipulation → Exploration on release, committing lastValidPose`
fails, your support probe returned a hit from `FakePhysics.castRay` (it always returns `null`) —
re-check your code, don't edit the test.
**Verify:** `npx vitest run tests/logic/manipulation-system.test.ts`, full suite, typecheck.
**Commit:** `overhaul(T1.3): released parts fall onto the floor or other parts`

### T1.4 Save when the tab is hidden or closed
**Why:** saves only happen on puzzle completion / clue discovery, so closing the tab mid-puzzle
loses placed parts and BM-1 priming.
**File:** `src/main.ts`.
**Edits**
1. After `const knownComponentIds = content.registry.all.map(…)` add:
   ```ts
   /** PLAN T1.4: save on leaving (tab hidden / page closed). New Game sets the suppress flag. */
   let suppressLeaveSave = false;
   let lastLeaveSaveAt = Number.NEGATIVE_INFINITY;
   const saveOnLeave = (why: string): void => {
     if (suppressLeaveSave) return;
     const now = performance.now();
     if (now - lastLeaveSaveAt < 2000) return; // hide + pagehide fire together
     lastLeaveSaveAt = now;
     const write = save.save('autosave', Date.now(), saveWorldView, knownComponentIds);
     if (!write.ok) console.warn(`[save] ${why} save failed:`, write.failure);
   };
   ```
2. In the `onVisibilityChange` handler from T1.2 step 3i, add as the **first** line:
   `if (hidden) saveOnLeave('tab-hidden');`
3. In `shutdown`, first line: `saveOnLeave('page-hide');`
**Edge cases handled:** a held part is saved at its `lastValidPose` (existing rule); a falling
part at its rest pose (T1.3); storage unavailable → typed failure, warning only.
**Verify:** typecheck, full suite, `npm run check:browser -- branch` → `data.branchReload.loaded === true`.
**Commit:** `overhaul(T1.4): autosave when the tab is hidden or closed`

### T1.5 Harness: `hold` scenario + pause overlay checks
**File:** `scripts/browser-check.mjs`.
1. In `main()`, next to `if (SCENARIO === 'focus') …` add:
   ```js
   if (SCENARIO === 'hold') {
     // PLAN T1.1 regression: a human-length E press (~160 ms ≈ 5 fixed steps) must grab
     // without rotating the part.
     const level = await evaluate(cdp, 'window.__probe.level()');
     const gear = level.p1Parts.find((entry) => entry.id === 'gear-a');
     const found = await focusTarget(cdp, 'gear-a', boxOf(gear));
     report.data.hold = { focused: found !== null };
     if (found !== null) {
       await keyDown(cdp, 'KeyE');
       await sleep(160);
       await keyUp(cdp, 'KeyE');
       await sleep(400);
       report.data.hold.after = await evaluate(
         cdp,
         '({ state: window.__gearwrightDev.manipulation.state, held: window.__gearwrightDev.manipulation.heldId, yaw: window.__gearwrightDev.manipulation.currentPose.yaw })'
       );
     }
     drainConsole(cdp);
   }
   ```
2. In `scenarioBoot`, replace the "Pause / resume lifecycle" block (from
   `await tapKey(cdp, 'Escape');` through the `report.data.lifecycle = { … };` statement) with:
   ```js
   // Pause / resume lifecycle (Escape with an empty hand pauses) + the PLAN T1.2 overlay.
   await tapKey(cdp, 'Escape');
   await sleep(600);
   const paused = await evaluate(cdp, 'window.__probe.state()');
   const overlayShown = await evaluate(cdp, "(() => { const el = document.querySelector('.gw-pause'); return el !== null && !el.classList.contains('gw-pause--hidden'); })()");
   await clickAt(cdp, 800, 450);
   await sleep(800);
   const resumedByClick = await evaluate(cdp, 'window.__probe.state()');
   await tapKey(cdp, 'Escape');
   await sleep(600);
   await tapKey(cdp, 'Escape');
   await sleep(800);
   const resumed = await evaluate(cdp, 'window.__probe.state()');
   report.data.lifecycle = {
     pausedState: paused.lifecycle,
     overlayShown,
     resumedByClick: resumedByClick.lifecycle,
     resumedState: resumed.lifecycle,
     resumedFrames: resumed.loop?.frames
   };
   ```
**Verify:** `npm run check:browser -- boot` → `data.lifecycle` = `{ pausedState: "paused", overlayShown: true, resumedByClick: "running", resumedState: "running" }`.
`npm run check:browser -- hold` → `data.hold.focused === true`, `data.hold.after.held === "gear-a"`,
`data.hold.after.state` is `"Manipulation"` or `"SnapPreview"` (**not** `"Rotation"`), `data.hold.after.yaw === 0`.
`npm run check:browser -- branch` → every field of `data.branchBurst` and `data.branchReload`
(except `progress`/`hud`) is `true`, `data.branchClue.discovered === true`.
**Commit:** `overhaul(T1.5): harness hold scenario and pause overlay checks`

### Fix-up 1 · CHECKPOINT 1 — harness: `boot`, `hold`, `branch`.

**Owner play check (5 min, optional but recommended, write the result in the log if done):**
`npm run dev`, open the URL, click the game view. Grab the gear with E (hold it normally) —
it must not spin. Walk it to the P1 machine: "Socket compatible — confirm to dock" appears; press
E → it docks. Drop a part with R → it falls to the floor. Press Esc → pause panel appears; click
→ game resumes and the mouse is captured again.

---

## PHASE 2 — Feel: smooth camera and physical parts

### T2.1 Interpolation helpers
**File:** new `src/core/interp.ts`, new `tests/logic/interp.test.ts`.
```ts
/**
 * L0 — presentation interpolation helpers (PLAN T2.1). Pure math: no DOM, no engine.
 * `t` at or beyond the ends returns the end value *exactly*, so an interpolation factor of 1
 * reproduces the simulation state bit-for-bit.
 */

export function clamp01(t: number): number {
  if (!Number.isFinite(t)) return 1;
  return Math.min(Math.max(t, 0), 1);
}

export function lerp(a: number, b: number, t: number): number {
  if (t >= 1) return b;
  if (t <= 0) return a;
  return a + (b - a) * t;
}

/** Shortest-path angle interpolation (radians). */
export function lerpAngle(a: number, b: number, t: number): number {
  if (t >= 1) return b;
  if (t <= 0) return a;
  const full = Math.PI * 2;
  let delta = (b - a) % full;
  if (delta > Math.PI) delta -= full;
  if (delta < -Math.PI) delta += full;
  return a + delta * t;
}
```
Test file:
```ts
import { describe, expect, it } from 'vitest';

import { clamp01, lerp, lerpAngle } from '../../src/core/interp.ts';

describe('interp (PLAN T2.1)', () => {
  it('returns exact endpoints', () => {
    expect(lerp(0.1, 0.3, 1)).toBe(0.3);
    expect(lerp(0.1, 0.3, 0)).toBe(0.1);
    expect(lerp(0, 10, 0.25)).toBe(2.5);
  });
  it('takes the short way round for angles', () => {
    expect(lerpAngle(3, -3, 0.5)).toBeCloseTo(3 + (2 * Math.PI - 6) / 2, 9);
    expect(lerpAngle(0, 1, 1)).toBe(1);
  });
  it('clamps factors and treats NaN as 1', () => {
    expect(clamp01(-2)).toBe(0);
    expect(clamp01(5)).toBe(1);
    expect(clamp01(Number.NaN)).toBe(1);
  });
});
```
**Verify:** `npx vitest run tests/logic/interp.test.ts tests/boundary`. **Commit:** `overhaul(T2.1): interpolation helpers`

### T2.2 Render interpolation + render-time look preview
**Why:** the sim runs at 30 Hz and nothing blends between steps (`render(_alpha)` ignores alpha),
so 60/144 Hz screens show judder; mouse look only lands on sim steps (added latency).

**Files:** `src/app.ts`, `src/adapters/dom-input-source.ts`, `src/gameplay/camera-rig.ts`,
`src/presentation/feedback-composer.ts`, `src/main.ts`, tests.
**Don't touch:** `src/core/loop.ts`, the sim-side of `CameraRig.step` (no behaviour change there).

**Edits**
1. `src/app.ts`: in `WorldHooks` change `readonly present: () => void;` to
   `readonly present: (alpha: number) => void;` and in the loop's `render: (alpha) => {` change
   `deps.world?.present();` to `deps.world?.present(alpha);`.
2. `src/adapters/dom-input-source.ts`: after the `isPointerLocked` getter add
   ```ts
   /** Look deltas received since the last `sample()` — read-only, for render-time preview. */
   get pendingLookX(): number {
     return this.lookDeltaX;
   }

   get pendingLookY(): number {
     return this.lookDeltaY;
   }
   ```
3. `src/gameplay/camera-rig.ts`:
   - Field: `private armLength: number;` — in the constructor after `this.distance = …` add
     `this.armLength = this.tuning.distance;`
   - In `placeAndCollide`, right after `const clamped = …;` add `this.armLength = clamped;`
   - New public method after `get currentYaw()`:
     ```ts
     /**
      * Render-time pose (presentation only, never fed back into the sim): the rig's current
      * yaw/pitch plus look deltas the next fixed step has not consumed yet, orbiting the given
      * (interpolated) anchor at the current arm length. It mutates nothing, so the simulation
      * stays deterministic — but the view answers the mouse every rendered frame.
      */
     previewPose(input: {
       readonly anchor: Vec3;
       readonly pendingLookX: number;
       readonly pendingLookY: number;
       readonly dt: number;
     }): CameraPoseState {
       const dt = Number.isFinite(input.dt) && input.dt > 0 ? input.dt : 1 / 30;
       const lookX = Number.isFinite(input.pendingLookX) ? input.pendingLookX : 0;
       const lookY = Number.isFinite(input.pendingLookY) ? input.pendingLookY : 0;
       const yaw = wrapAngle(this.yaw - lookX * this.tuning.yawSpeed * dt);
       const pitch = Math.min(
         this.tuning.maxPitch,
         Math.max(this.tuning.minPitch, this.pitch - lookY * this.tuning.pitchSpeed * dt)
       );
       const cosPitch = Math.cos(pitch);
       const direction = { x: Math.sin(yaw) * cosPitch, y: Math.sin(pitch), z: Math.cos(yaw) * cosPitch };
       let arm = this.armLength;
       const hit = this.physics.castSphere(input.anchor, this.tuning.collisionRadius, direction, arm + this.tuning.skin);
       if (hit) arm = Math.min(arm, Math.max(this.tuning.minDistance, hit.distance - this.tuning.skin));
       return {
         eye: {
           x: input.anchor.x + direction.x * arm,
           y: input.anchor.y + direction.y * arm,
           z: input.anchor.z + direction.z * arm
         },
         target: { x: input.anchor.x, y: input.anchor.y, z: input.anchor.z },
         fov: this.tuning.fov
       };
     }
     ```
4. `src/presentation/feedback-composer.ts`:
   - Import: `import { clamp01, lerp, lerpAngle } from '../core/interp.ts';`
     (If the boundary test complains about 3 layers, the file now imports core + ports +
     gameplay: check `valueImportSpecifiers` counts only value imports; `interp` is a value
     import. If it fails, copy the three functions into the composer as private module
     functions instead and delete the import.)
   - `MutableCarryableState`: add
     ```ts
     prevX: number;
     prevY: number;
     prevZ: number;
     prevYaw: number;
     prevSpin: number;
     /** False until the first step wrote this state (then prev = current). */
     initialised: boolean;
     ```
     and add `prevX: 0, prevY: 0, prevZ: 0, prevYaw: 0, prevSpin: 0, initialised: false` to the
     literal in `stateFor`.
   - Fields: `private readonly presented: MutableCarryableState[] = [];` and
     `private readonly presentedById = new Map<string, MutableCarryableState>();`
   - `rebuildStates`: replace the block from `const state = this.stateFor(snapshot.id);` down to
     and including `state.spinAngle = …;` with:
     ```ts
     const state = this.stateFor(snapshot.id);
     const center = attachedPose?.center ?? snapshot.center;
     const yaw = (attachedPose ?? snapshot).yaw;
     // A stopped machine *holds* its phase instead of rewinding: the motion stopping
     // is the read, and a visible snap back would be a lie about what the machine did.
     const spin = machineId === null ? 0 : this.spinAngles.get(machineId) ?? 0;
     // Interpolation memory (PLAN T2.2): the previous step's values, or the new ones on
     // the first step so nothing slides in from the origin.
     state.prevX = state.initialised ? state.center.x : center.x;
     state.prevY = state.initialised ? state.center.y : center.y;
     state.prevZ = state.initialised ? state.center.z : center.z;
     state.prevYaw = state.initialised ? state.yaw : yaw;
     state.prevSpin = state.initialised ? state.spinAngle : spin;
     state.initialised = true;
     state.center.x = center.x;
     state.center.y = center.y;
     state.center.z = center.z;
     state.halfExtents.x = snapshot.halfExtents.x;
     state.halfExtents.y = snapshot.halfExtents.y;
     state.halfExtents.z = snapshot.halfExtents.z;
     state.yaw = yaw;
     state.spinAngle = spin;
     ```
     (keep the following `state.held = …`, `state.blocked = …`, `state.attached = …`, `push` lines).
   - Replace `present(): void {` and its first line `this.render.setCarryables(…);` with:
     ```ts
     present(alpha = 1): void {
       const t = clamp01(alpha);
       this.presented.length = 0;
       for (const state of this.states) {
         const out = this.presentedFor(state.id);
         // A jump of more than a metre in one step is a relocation (attach, detach search),
         // never motion: draw it where it is instead of smearing it across the room.
         const jump =
           Math.hypot(state.center.x - state.prevX, state.center.y - state.prevY, state.center.z - state.prevZ) > 1;
         const k = jump ? 1 : t;
         out.center.x = lerp(state.prevX, state.center.x, k);
         out.center.y = lerp(state.prevY, state.center.y, k);
         out.center.z = lerp(state.prevZ, state.center.z, k);
         out.halfExtents.x = state.halfExtents.x;
         out.halfExtents.y = state.halfExtents.y;
         out.halfExtents.z = state.halfExtents.z;
         out.yaw = lerpAngle(state.prevYaw, state.yaw, k);
         out.spinAngle = lerp(state.prevSpin, state.spinAngle, k);
         out.held = state.held;
         out.blocked = state.blocked;
         out.attached = state.attached;
         this.presented.push(out);
       }
       this.render.setCarryables(this.presented as ReadonlyArray<CarryableRenderState>);
     ```
     (the pulse part of `present` stays as it is).
   - New private method (next to `stateFor`):
     ```ts
     /** Reuse-or-create the presented (interpolated) mirror for a component id. */
     private presentedFor(componentId: string): MutableCarryableState {
       const existing = this.presentedById.get(componentId);
       if (existing) return existing;
       const created: MutableCarryableState = {
         id: componentId,
         center: { x: 0, y: 0, z: 0 },
         halfExtents: { x: 0, y: 0, z: 0 },
         yaw: 0,
         spinAngle: 0,
         held: false,
         blocked: false,
         attached: false,
         prevX: 0,
         prevY: 0,
         prevZ: 0,
         prevYaw: 0,
         prevSpin: 0,
         initialised: true
       };
       this.presentedById.set(componentId, created);
       return created;
     }
     ```
5. `src/main.ts`:
   - Imports: `import { clamp01, lerp, lerpAngle } from './core/interp.ts';` and
     `import { DEFAULT_LOOP_CONFIG } from './core/loop.ts';`
   - Before `const app: App = createApp({` add:
     ```ts
     /**
      * PLAN T2.2 render interpolation memory (presentation only): the player pose and the
      * camera anchor as they were *before* the most recent fixed step.
      */
     const interp = {
       primed: false,
       player: { x: 0, y: 0, z: 0 },
       facingYaw: 0,
       anchor: { x: 0, y: 0, z: 0 }
     };
     const lerpVec = (a: Vec3, b: Vec3, t: number): Vec3 => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t) });
     ```
   - In `world.step: (dt, raw) => {`, **before** `const result = world.step(dt, raw);` add:
     ```ts
     const playerBefore = player.snapshot();
     const cameraBefore = camera.snapshot();
     interp.player.x = playerBefore.position.x;
     interp.player.y = playerBefore.position.y;
     interp.player.z = playerBefore.position.z;
     interp.facingYaw = playerBefore.facingYaw;
     interp.anchor.x = cameraBefore.target.x;
     interp.anchor.y = cameraBefore.target.y;
     interp.anchor.z = cameraBefore.target.z;
     interp.primed = true;
     ```
   - Change `present: () => {` to `present: (alpha) => {` and replace these lines:
     ```ts
     const playerState = player.snapshot();
     const cameraPose = camera.snapshot();
     renderPort.setView(cameraPose);
     ```
     with
     ```ts
     const playerState = player.snapshot();
     const cameraNow = camera.snapshot();
     // PLAN T2.2: blend between the last two fixed steps, unless the player teleported.
     const teleported =
       Math.hypot(
         playerState.position.x - interp.player.x,
         playerState.position.y - interp.player.y,
         playerState.position.z - interp.player.z
       ) > 2;
     const blend = interp.primed && !teleported ? clamp01(alpha) : 1;
     const lookCap = input.bindingSnapshot.maxLookDeltaPerStep;
     const pendingX = Math.min(Math.max(inputSource.pendingLookX, -lookCap), lookCap);
     const pendingY = Math.min(Math.max(inputSource.pendingLookY, -lookCap), lookCap);
     const cameraPose = camera.previewPose({
       anchor: lerpVec(interp.anchor, cameraNow.target, blend),
       pendingLookX: pendingX,
       pendingLookY: pendingY,
       dt: DEFAULT_LOOP_CONFIG.fixedDt
     });
     renderPort.setView(cameraPose);
     ```
     and in the `renderPort.syncPlayerMarker({ … })` call replace
     `position: playerState.position,` with `position: lerpVec(interp.player, playerState.position, blend),`
     and `facingYaw: playerState.facingYaw,` with `facingYaw: lerpAngle(interp.facingYaw, playerState.facingYaw, blend),`.
   - Replace `composer.present();` with `composer.present(blend);`
   - The **first frame** code after `app.start()` (`renderPort.setView(camera.snapshot());`) stays.
6. Tests — append (these use each file's own helpers: `FakePhysics`, `step`, `DT`,
   `eyeDistance` in the camera file; `makeWorld`, `viewOf`, `stateOf`, `DT`,
   `RecordingRenderPort` in the composer file):
   - `tests/logic/camera-rig.test.ts`:
     ```ts
     describe('CameraRig — previewPose (PLAN T2.2)', () => {
       it('is pure and answers pending look at once', () => {
         const rig = new CameraRig(new FakePhysics());
         const base = step(rig);
         const yawBefore = rig.currentYaw;
         const still = rig.previewPose({ anchor: base.target, pendingLookX: 0, pendingLookY: 0, dt: DT });
         expect(still.target).toEqual(base.target);
         expect(eyeDistance(still)).toBeCloseTo(DEFAULT_CAMERA_TUNING.distance, 6);
         const turned = rig.previewPose({ anchor: base.target, pendingLookX: 60, pendingLookY: 0, dt: DT });
         expect(Math.abs(turned.eye.x - still.eye.x)).toBeGreaterThan(0.1);
         expect(rig.currentYaw).toBe(yawBefore);
       });
     });
     ```
   - `tests/logic/feedback-composer.test.ts`:
     ```ts
     describe('FeedbackComposer — interpolation (PLAN T2.2)', () => {
       it('blends between the last two steps and never smears a jump', () => {
         const render = new RecordingRenderPort();
         const composer = new FeedbackComposer(render);
         const world = makeWorld({ attached: false });
         const view = viewOf(world);
         const start = world.snapshots[0]!;
         composer.update(DT, [], view);
         world.snapshots[0] = { ...start, center: { x: start.center.x + 0.2, y: start.center.y, z: start.center.z } };
         composer.update(DT, [], view);
         composer.present(0.5);
         expect(stateOf(render, 'gear-a').center.x).toBeCloseTo(start.center.x + 0.1, 9);
         composer.present(1);
         expect(stateOf(render, 'gear-a').center.x).toBe(start.center.x + 0.2);
         world.snapshots[0] = { ...start, center: { x: start.center.x + 5, y: start.center.y, z: start.center.z } };
         composer.update(DT, [], view);
         composer.present(0.5);
         expect(stateOf(render, 'gear-a').center.x).toBe(start.center.x + 5);
       });
     });
     ```
**May update:** none.
**Verify:** typecheck, `npx vitest run tests/logic/camera-rig.test.ts tests/logic/feedback-composer.test.ts tests/logic/app.test.ts tests/boundary`, full suite, `npm run check:browser -- boot` and `-- branch` (same checks as T1.5).
**Commit:** `overhaul(T2.2): render interpolation and per-frame look preview`

### T2.3 Raise the mouse flick cap
**File:** `src/gameplay/input-system.ts`: `maxLookDeltaPerStep: 120` → `maxLookDeltaPerStep: 1000`,
and add the comment on that line: `// Guards pointer-lock spike events only; real flicks reach ~600 px per step.`
**Verify:** `npx vitest run tests/logic/input-system.test.ts` (the clamp test reads the constant — no edit), full suite.
**Commit:** `overhaul(T2.3): stop clipping fast mouse flicks`

### T2.4 Recentre only while moving + shoulder camera
**Files:** `src/gameplay/camera-rig.ts`, `src/gameplay/phase-world.ts`, `src/main.ts`, tests.
**Edits**
1. `camera-rig.ts`:
   - `CameraTuning`: add
     `/** Metres the look target sits to the camera's right (over-the-shoulder). 0 = centred. */`
     `readonly shoulderOffset?: number | undefined;`
   - `CameraStepInput`: add
     `/** False while the player stands still: the auto-recentre never fights a player at a machine. Absent = legacy (recentre by idle time only). */`
     `readonly playerMoving?: boolean | undefined;`
   - `recentreBehindPlayer`: first line `if (input.playerMoving === false) return;`
   - Field `private readonly scratchRight: Vec3;` initialised in the constructor `this.scratchRight = vec3();`
   - In `step()`, right after the three `this.desiredTarget.* = …` assignments, add `this.applyShoulderOffset();`
   - New private method:
     ```ts
     /** Over-the-shoulder framing, pulled in if a wall sits on the camera's right. */
     private applyShoulderOffset(): void {
       const shoulder = this.tuning.shoulderOffset ?? 0;
       if (!(shoulder > 0)) return;
       // Camera-right on the ground plane: yaw 0 looks toward -Z, so right is +X.
       this.scratchRight.x = Math.cos(this.yaw);
       this.scratchRight.y = 0;
       this.scratchRight.z = -Math.sin(this.yaw);
       const hit = this.physics.castSphere(
         this.desiredTarget,
         this.tuning.collisionRadius * 0.5,
         this.scratchRight,
         shoulder + this.tuning.skin
       );
       const offset = hit ? Math.max(0, hit.distance - this.tuning.skin) : shoulder;
       this.desiredTarget.x += this.scratchRight.x * offset;
       this.desiredTarget.z += this.scratchRight.z * offset;
     }
     ```
2. `phase-world.ts`, in the `this.systems.camera.step(dt, { … })` call, add
   `playerMoving: Math.hypot(player.velocity.x, player.velocity.z) > 0.4,`
   (horizontal only — `player.speed` includes the downward grounded stick speed and is never 0).
3. `main.ts`: replace `const camera = new CameraRig(physics);` with
   ```ts
   // PLAN T2.4: over-the-shoulder by default; `?shoulder=0` centres it (the browser harness
   // aims through the player and uses this).
   const SHOULDER_OFFSET = new URLSearchParams(window.location.search).get('shoulder') === '0' ? 0 : 0.45;
   const camera = new CameraRig(physics, { shoulderOffset: SHOULDER_OFFSET });
   ```
4. Tests — append to `tests/logic/camera-rig.test.ts`:
   ```ts
   describe('CameraRig — PLAN T2.4', () => {
     it('does not recentre while the player stands still', () => {
       const rig = new CameraRig(new FakePhysics());
       step(rig, { lookDeltaX: 20 });
       const before = rig.currentYaw;
       rig.step(DT, {
         lookDeltaX: 0,
         lookDeltaY: 0,
         player: { position: vec3(0, 0, 0), facingYaw: 0 },
         mode: 'follow',
         idleTime: DEFAULT_CAMERA_TUNING.recenterDelay + 0.5,
         playerMoving: false
       });
       expect(rig.currentYaw).toBeCloseTo(before, 9);
     });

     it("offsets the look target to the camera's right", () => {
       const rig = new CameraRig(new FakePhysics(), { shoulderOffset: 0.45 });
       const pose = step(rig);
       expect(pose.target.x).toBeCloseTo(0.45, 6);
       expect(pose.target.z).toBeCloseTo(0, 6);
     });
   });
   ```
**May update:** none (new fields are optional, defaults preserve old behaviour).
**Verify:** typecheck, camera-rig + phase-world tests, full suite, harness `branch` (checks as T1.5).
**Commit:** `overhaul(T2.4): recentre only while moving, over-the-shoulder camera`

### T2.5 Held part not solid to the player; no part overlap; soft-detach drops in place
**File:** `src/gameplay/manipulation-system.ts` (+ tests).
**Edits**
1. `publishColliders`: inside the loop, after `if (!record || record.publishedCenter === null) continue;` add
   ```ts
   // The part in the player's hands is not an obstacle for the player's own body.
   if (id === this.heldObjectId) continue;
   ```
   and replace `const half = record.binding.definition.halfExtents;` with
   ```ts
   // Yawed footprint, the same box every other query uses.
   const half = rotatedHalfExtents(record.binding.definition.halfExtents, record.publishedYaw, vec3());
   ```
2. New private method after `poseBlocked`:
   ```ts
   /** Would this pose overlap another (non-held) part? Parts may touch, never interpenetrate. */
   private overlapsOtherCarryable(record: CarryableRecord, pose: Pose): boolean {
     this.boxFor(record, pose.yaw, this.scratchBox, pose.center);
     for (const id of this.order) {
       if (id === record.binding.instanceId || id === this.heldObjectId) continue;
       const other = this.records.get(id);
       if (!other) continue;
       rotatedHalfExtents(other.binding.definition.halfExtents, other.pose.yaw, this.scratchOtherHalf);
       if (
         this.scratchBox.min.x < other.pose.center.x + this.scratchOtherHalf.x &&
         this.scratchBox.max.x > other.pose.center.x - this.scratchOtherHalf.x &&
         this.scratchBox.min.y < other.pose.center.y + this.scratchOtherHalf.y &&
         this.scratchBox.max.y > other.pose.center.y - this.scratchOtherHalf.y &&
         this.scratchBox.min.z < other.pose.center.z + this.scratchOtherHalf.z &&
         this.scratchBox.max.z > other.pose.center.z - this.scratchOtherHalf.z
       ) {
         return true;
       }
     }
     return false;
   }
   ```
   and change `poseBlocked` to:
   ```ts
   private poseBlocked(record: CarryableRecord, pose: Pose): boolean {
     this.boxFor(record, pose.yaw, this.scratchBox, pose.center);
     if (this.physics.isBoxBlocked(this.scratchBox.min, this.scratchBox.max)) return true;
     return this.overlapsOtherCarryable(record, pose);
   }
   ```
   (`poseBlocked` is only used by release, the relocation search and `startFall`; carrying and
   rotating still check only static geometry — intentional.)
3. Soft-detach in `stepHolding` (anchor: `// \`Manipulation | hold range exceeded | config: softDetach\``):
   replace the body of that `if` with:
   ```ts
      // Drop it where it is (a carried pose never embeds in walls), nudged clear of other
      // parts if needed — never teleported back to where it was picked up.
      let dropPose: Pose | null = this.quantisePose(record.pose);
      if (this.poseBlocked(record, dropPose)) {
        dropPose = this.findNearestValidPose(record, this.tuning.releaseSearchRadius);
      }
      this.restore(record, dropPose ?? record.lastValidPose);
      record.lastValidPose = this.quantisePose(record.pose);
      this.heldObjectId = null;
      this.transition('Exploration');
      this.publishRecord(record, true);
      this.startFall(record);
      this.emit('SoftDetached', record.binding.instanceId);
   ```
4. Tests — append to `tests/logic/manipulation-system.test.ts`:
   ```ts
   describe('ManipulationSystem — overhaul T2.5', () => {
     it('does not publish the held part as a player collider', () => {
       const { sm, physics } = build();
       grab(sm);
       step(sm);
       const last = physics.carryablePushes[physics.carryablePushes.length - 1]!;
       expect(last.length).toBe(0);
     });
   });
   ```
**May update:** `tests/logic/manipulation-system.test.ts` → test
`Manipulation → Exploration on \`hold range exceeded\` (EC-MAN-07 soft detach)`: replace its last
line `expect(detached.pose).toEqual({ center: CRATE.spawn.center, yaw: CRATE.spawn.yaw });` with
```ts
    // PLAN T2.5: dropped where it was, not teleported back to the spawn.
    expect(detached.pose).toEqual(sm.canonicalLastValidPose);
    expect(detached.pose).not.toEqual({ center: CRATE.spawn.center, yaw: CRATE.spawn.yaw });
```
If that `not.toEqual` fails because the part did not move in that step, delete only the
`not.toEqual` line and log it.
**Verify:** manipulation tests, full suite, harness `branch` (checks as T1.5; the soft-detach
retry path in the harness still works because the part now drops nearby).
**Commit:** `overhaul(T2.5): carried part no longer shoves the player, parts don't overlap, soft-detach drops in place`

### Fix-up 2 · CHECKPOINT 2 — harness: `boot`, `hold`, `branch`.
**Owner play check:** on a 60 Hz+ screen, walk and turn: no stutter; flick the mouse fast: the
view keeps up; stand still at a machine for 5 s: the camera does not swing; the character is
left of the crosshair.

---

## PHASE 3 — World clean-up and render efficiency

### T3.1 Remove the placeholder scene, keep the lights
**Why:** the Phase-1 grey cubes (walk-through, one floating), the debug grid and a second floor
plane coplanar with the real floor (z-fighting) still ship. The only lights live inside it.
**File:** `src/adapters/three-renderer.ts`.
1. Constructor options: `placeholderScene: options.placeholderScene ?? true` → `?? false`.
2. Split `buildPlaceholderScene()`: move the `hemisphere` and `key` light creation (and their
   `scene.add` + `this.lights.push`) into a new `private buildLights(): void` (guard
   `if (!this.scene) return;`). `buildPlaceholderScene` keeps only ground, grid and boxes, still
   guarded by `this.options.placeholderScene`.
3. In `init()`, call `this.buildLights();` immediately before `this.buildPlaceholderScene();`.
**Verify:** typecheck, full suite, harness `boot`: `report.problems` empty; in
`data.soak.overlay` the draw count is lower than before (note both numbers in the log).
**Commit:** `overhaul(T3.1): stop shipping the placeholder scene`

### T3.2 World-mesh leak fix + merge by colour
**Why:** `setLabWorld` creates geometry/material per box on every rebuild (each BM-1 press, each
hub stage) and never frees the old ones; one draw call per box.
**File:** `src/adapters/three-renderer.ts`.
1. Import: `import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';`
2. Field: `private worldDisposables: Array<{ dispose(): void }> = [];`
3. Replace the body of `setLabWorld` with:
   ```ts
    // Free the previous build first: this runs on every hub stage and staged press.
    for (const item of this.worldDisposables) item.dispose();
    this.worldDisposables = [];
    this.labGroup.clear();

    // One merged mesh per colour: same look, a fraction of the draw calls.
    const byColor = new Map<number, THREE.BufferGeometry[]>();
    for (const mesh of meshes) {
      if (mesh.kind !== 'box') continue;
      const sizeX = Math.max(0.001, mesh.max.x - mesh.min.x);
      const sizeY = Math.max(0.001, mesh.max.y - mesh.min.y);
      const sizeZ = Math.max(0.001, mesh.max.z - mesh.min.z);
      const geometry = new THREE.BoxGeometry(sizeX, sizeY, sizeZ);
      geometry.translate(mesh.min.x + sizeX / 2, mesh.min.y + sizeY / 2, mesh.min.z + sizeZ / 2);
      const list = byColor.get(mesh.color) ?? [];
      list.push(geometry);
      byColor.set(mesh.color, list);
    }
    for (const [color, geometries] of byColor) {
      const material = new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.15 });
      this.worldDisposables.push(material);
      const merged = geometries.length === 1 ? geometries[0] ?? null : mergeGeometries(geometries, false);
      if (merged === null) {
        // Merge refused (never expected for boxes): fall back to one mesh per box.
        for (const geometry of geometries) {
          this.worldDisposables.push(geometry);
          this.labGroup.add(new THREE.Mesh(geometry, material));
        }
        continue;
      }
      if (geometries.length > 1) for (const geometry of geometries) geometry.dispose();
      this.worldDisposables.push(merged);
      this.labGroup.add(new THREE.Mesh(merged, material));
    }
    this.labGroup.visible = this.labGroup.children.length > 0;
   ```
   Update the method's comment to "Rebuilds the static world: frees the previous build, then one merged mesh per colour."
4. `dispose()`: first line add `for (const item of this.worldDisposables) item.dispose(); this.worldDisposables = [];`
**Verify:** typecheck, build, harness `branch` (checks as T1.5) and `boot` (draw count lower
again — log it).
**Commit:** `overhaul(T3.2): free world meshes on rebuild and merge them by colour`

### T3.3 Allocation trims + power preference
**Files:** `src/adapters/three-renderer.ts`, `src/main.ts`, `src/adapters/kinematic-physics.ts`.
1. `three-renderer.ts` `init()`: `powerPreference: 'high-performance'` → `powerPreference: 'default'`
   (comment: `// a low-poly scene should not force a laptop's discrete GPU on`).
2. `three-renderer.ts` `stats()`: replace `lights: this.lights.filter((light) => light.visible).length,`
   with a counted loop computed before the `return` (`let visibleLights = 0; for (const light of this.lights) if (light.visible) visibleLights += 1;`).
3. `main.ts` `present`: the `renderPort.setSnapMarkers(resolvedSockets.map(…))` allocates every
   frame. Before `createApp`, add a pooled array:
   ```ts
   /** Pooled socket-marker states (PLAN T3.3): rewritten in place every frame. */
   const snapMarkerStates = resolvedSockets.map((socket) => ({
     socketId: socket.instance.id,
     center: socket.instance.pose.center,
     halfExtents: socket.instance.halfExtents,
     state: 'available' as 'available' | 'preview' | 'occupied'
   }));
   ```
   and replace the `setSnapMarkers(...)` call with:
   ```ts
   for (const marker of snapMarkerStates) {
     marker.state = snap.isSocketOccupied(marker.socketId)
       ? 'occupied'
       : snap.candidate?.socketId === marker.socketId
         ? 'preview'
         : 'available';
   }
   renderPort.setSnapMarkers(snapMarkerStates);
   ```
4. `kinematic-physics.ts` `rayVsAabb`: remove the four per-call tuple arrays (`ox`, `dx`, `bMin`,
   `bMax`). Add a module helper `function axisOf(v: Vec3, axis: number): number { return axis === 0 ? v.x : axis === 1 ? v.y : v.z; }`
   and read `o = axisOf(origin, axis)`, `d = axisOf(direction, axis)`, `axisOf(box.min, axis)`,
   `axisOf(box.max, axis)` inside the loop. Logic otherwise identical.
**Verify:** `npx vitest run tests/logic/kinematic-physics.test.ts`, full suite, typecheck, harness `boot`.
**Commit:** `overhaul(T3.3): per-frame allocation trims, default GPU power preference`

### Fix-up 3 · CHECKPOINT 3 — harness: `boot`, `branch`. Log draw calls / triangles from `data.soak.overlay`.

---

## PHASE 4 — A real level: hub + Pressure Gallery

Geometry facts you can rely on: the room is x −20…20, z −20…20, floor top y = 0, walls 4 m.
All Branch A machinery lies in z −20…3. The hub (Regulator plinth z 14–17, column z 15–16) is
north. Branch A door posts are 0.2 m wide at x = door ± 1.0…1.2.

### T4.1 `src/levels/game-room.ts`
```ts
/**
 * LEVEL — the shipped room shell (PLAN T4.1): floor, outer walls, and the partition wall that
 * splits the Crucible Hall (north, z > 8.5) from the Pressure Gallery (south, z < 8). The
 * gallery is entered through Branch A's door, which `hub.ts` places *in* the partition gap.
 * The test lab (`lab-world.ts`) stays a test fixture and is no longer shipped.
 */

import type { LabWorldDefinition } from './lab-world.ts';

interface RoomBox {
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
  readonly color: number;
}

const ROOM_FLOOR = 0x3a3f45;
const ROOM_WALL = 0x2a2e33;
const ROOM_PARTITION = 0x33383e;

/** The partition wall's z span; Branch A's door (hub.ts) sits in the same span. */
export const PARTITION_Z_MIN = 8.0;
export const PARTITION_Z_MAX = 8.5;

const BOXES: ReadonlyArray<RoomBox> = [
  { min: [-20, -1, -20], max: [20, 0, 20], color: ROOM_FLOOR },
  { min: [-21, 0, -21], max: [21, 4, -20], color: ROOM_WALL },
  { min: [-21, 0, 20], max: [21, 4, 21], color: ROOM_WALL },
  { min: [-21, 0, -20], max: [-20, 4, 20], color: ROOM_WALL },
  { min: [20, 0, -20], max: [21, 4, 20], color: ROOM_WALL },
  // Partition, west of the doorway (door posts fill x -7.2…-7.0 and -5.0…-4.8).
  { min: [-20, 0, PARTITION_Z_MIN], max: [-7.2, 4, PARTITION_Z_MAX], color: ROOM_PARTITION },
  // Partition, east of the doorway.
  { min: [-4.8, 0, PARTITION_Z_MIN], max: [20, 4, PARTITION_Z_MAX], color: ROOM_PARTITION },
  // Lintel over the doorway, above the 3.2 m door height.
  { min: [-7.2, 3.2, PARTITION_Z_MIN], max: [-4.8, 4, PARTITION_Z_MAX], color: ROOM_PARTITION }
];

export const GAME_ROOM: LabWorldDefinition = {
  colliders: BOXES.map((box) => ({
    min: { x: box.min[0], y: box.min[1], z: box.min[2] },
    max: { x: box.max[0], y: box.max[1], z: box.max[2] }
  })),
  meshes: BOXES.map((box) => ({
    kind: 'box' as const,
    min: { x: box.min[0], y: box.min[1], z: box.min[2] },
    max: { x: box.max[0], y: box.max[1], z: box.max[2] },
    color: box.color
  })),
  // In the hall, facing south (yaw 0 faces -Z) toward the gallery door at x = -6.
  spawn: { x: -4.5, y: 0.01, z: 12 }
};
```
**Verify:** typecheck, boundary tests. **Commit:** `overhaul(T4.1): shipped room shell with hub/gallery partition`

### T4.2 Move Branch A's door into the partition
**File:** `src/levels/hub.ts` (+ one test assertion).
1. `HubDoor`: add `/** Z of the door frame's south face. */ readonly z: number;`
2. `HUB_DOORS`: add `z: 8.0` to branch A's entry and `z: DOOR_Z` to B and C. Move the
   `const DOOR_Z = 19.3;` declaration **above** `HUB_DOORS` (it is used there now) and change its
   comment to "Sealed doors B/C stand just in front of the north wall (z = 20)."
3. `doorBoxes`: replace every `DOOR_Z` inside it with `door.z`.
4. `hubMeshes`, the trunk line push: replace the `min`/`max` z values with a rule:
   ```ts
      // A door south of the Regulator (Branch A, in the partition) runs its trunk north past the
      // plinth to the bus; a north-wall door runs south to the bus, as before.
      const southOfRegulator = door.z < 14;
      meshes.push(
        boxMesh({
          min: [door.x - 0.15, 2.6, southOfRegulator ? door.z + 0.5 : 17],
          max: [door.x + 0.15, 2.9, southOfRegulator ? 16.7 : door.z],
          color: branchState(door.branchId) === 'Complete' ? HUB_TRUNK_ON : HUB_TRUNK_OFF
        })
      );
   ```
5. Update the file-header comment "three branch doors line the north wall" to "Branch A's door
   opens from the hall into the Pressure Gallery through the partition wall; B and C are sealed
   on the north wall".
**May update:** `tests/logic/hub-visual-facts.test.ts`, the trunk predicate line
`mesh.min.z >= 17` → `mesh.min.z >= 8`. Nothing else.
**Verify:** `npx vitest run tests/logic/hub-visual-facts.test.ts tests/logic/hub-access-gate.test.ts tests/logic/clue-plate.test.ts`, full suite.
**Commit:** `overhaul(T4.2): Branch A door opens into the gallery`

### T4.3 Shipped content aggregate + remove the lab from the game
1. Create `src/levels/shipped-content.ts`:
   ```ts
   /**
    * LEVEL — everything the shipped game places (PLAN T4.3). `main.ts` and the content-integrity
    * suite both read this module, so the tests always check exactly what ships.
    */

   import {
     BRANCH_A_CARRYABLES,
     BRANCH_A_COMPONENTS,
     BRANCH_A_INITIAL_ATTACHMENTS,
     BRANCH_A_INTERACTABLES,
     BRANCH_A_SOCKETS,
     BRANCH_A_WORLD
   } from './branch-a.ts';
   import { GAME_ROOM } from './game-room.ts';
   import type { LabWorldDefinition } from './lab-world.ts';

   
   export const SHIPPED_WORLD: LabWorldDefinition = {
     colliders: [...GAME_ROOM.colliders, ...BRANCH_A_WORLD.colliders],
     meshes: [...GAME_ROOM.meshes, ...BRANCH_A_WORLD.meshes],
     spawn: GAME_ROOM.spawn
   };
   export const SHIPPED_COMPONENTS = [...BRANCH_A_COMPONENTS];
   export const SHIPPED_SOCKETS = [...BRANCH_A_SOCKETS];
   export const SHIPPED_CARRYABLES = [...BRANCH_A_CARRYABLES];
   export const SHIPPED_INTERACTABLES = [...BRANCH_A_INTERACTABLES];
   export const SHIPPED_INITIAL_ATTACHMENTS = [...BRANCH_A_INITIAL_ATTACHMENTS];
   ```
2. `src/main.ts` — replace every lab/branch aggregate (after the edit,
   `grep -n "LAB_" src/main.ts` must print nothing):
   | Old | New |
   |---|---|
   | the `import { LAB_CARRYABLE, … } from './levels/lab-world.ts';` block | delete |
   | `BRANCH_A_CARRYABLES, BRANCH_A_COMPONENTS, BRANCH_A_INITIAL_ATTACHMENTS, BRANCH_A_INTERACTABLES, BRANCH_A_SOCKETS, BRANCH_A_WORLD,` in the branch-a import | delete those names (keep `bm1PropInteractables`, `bm1PropMeshes`) |
   | — | add `import { SHIPPED_CARRYABLES, SHIPPED_COMPONENTS, SHIPPED_INITIAL_ATTACHMENTS, SHIPPED_INTERACTABLES, SHIPPED_SOCKETS, SHIPPED_WORLD } from './levels/shipped-content.ts';` |
   | `[...LAB_COMPONENTS, ...BRANCH_A_COMPONENTS]` | `[...SHIPPED_COMPONENTS]` |
   | `sockets: [...LAB_SOCKETS, ...BRANCH_A_SOCKETS],` | `sockets: [...SHIPPED_SOCKETS],` |
   | `physics.setStaticColliders([...LAB_WORLD.colliders, ...BRANCH_A_WORLD.colliders]);` | `physics.setStaticColliders([...SHIPPED_WORLD.colliders]);` |
   | `{ ...LAB_WORLD.spawn }` | `{ ...SHIPPED_WORLD.spawn }` |
   | `[...LAB_INTERACTABLES, ...BRANCH_A_INTERACTABLES]` (3 places, sometimes followed by more spreads) | `[...SHIPPED_INTERACTABLES]` (keep the following `...hubInteractables(…)`, `...bm1PropInteractables(true)` spreads) |
   | `graph.reset([...BRANCH_A_INITIAL_ATTACHMENTS]);` | `graph.reset([...SHIPPED_INITIAL_ATTACHMENTS]);` |
   | `const carryables = [LAB_CARRYABLE, ...BRANCH_A_CARRYABLES];` | `const carryables = [...SHIPPED_CARRYABLES];` |
   | `resolveSockets([...LAB_SOCKETS, ...BRANCH_A_SOCKETS])` | `resolveSockets([...SHIPPED_SOCKETS])` |
   | `...LAB_WORLD.colliders, ...BRANCH_A_WORLD.colliders,` (hub colliders call) | `...SHIPPED_WORLD.colliders,` |
   | `...LAB_WORLD.meshes, ...BRANCH_A_WORLD.meshes,` (`worldMeshes`) | `...SHIPPED_WORLD.meshes,` |
3. Old saves that mention `crate-a` / `socket-a` load with a `component-ref-missing` repair
   note (existing EC-SAVE-06 behaviour) — no code needed.
**Verify:** typecheck, full suite, `grep -n "LAB_" src/main.ts` → empty.
**Commit:** `overhaul(T4.3): ship the hall and gallery, not the test lab`

### T4.4 Content-integrity tests
**File:** `tests/logic/shipped-content-integrity.test.ts`.
1. **May update:** its imports of `LAB_CARRYABLE, LAB_COMPONENTS, LAB_INTERACTABLES, LAB_SOCKETS`
   and `BRANCH_A_*` aggregates → import the `SHIPPED_*` equivalents from
   `../../src/levels/shipped-content.ts`, and replace every `[...LAB_X, ...BRANCH_A_X]` /
   `[LAB_CARRYABLE, ...BRANCH_A_CARRYABLES]` with `[...SHIPPED_X]`. Assertions unchanged.
2. Append:
   ```ts
   describe('shipped level — PLAN T4.4', () => {
     const branchState = (id: string): BranchState => (id === 'branch-a' ? 'Available' : 'Locked');

     it('spawns the player in free space and lets them walk through the gallery door', () => {
       const physics = new KinematicPhysics();
       physics.setStaticColliders([...SHIPPED_WORLD.colliders, ...hubColliders(branchState)]);
       const capsule = DEFAULT_PLAYER_TUNING.capsule;
       const spawn = SHIPPED_WORLD.spawn;
       expect(physics.isPoseValid(vec3(spawn.x, spawn.y, spawn.z), capsule)).toBe(true);
       let feet = vec3(spawn.x, spawn.y, spawn.z);
       const out = vec3();
       for (const waypoint of [{ x: -6, z: 10 }, { x: -6, z: 6 }, { x: -6, z: 2 }]) {
         for (let i = 0; i < 400; i += 1) {
           const dx = waypoint.x - feet.x;
           const dz = waypoint.z - feet.z;
           const distance = Math.hypot(dx, dz);
           if (distance < 0.05) break;
           const stepLength = Math.min(0.1, distance);
           const result = physics.moveAndSlide(feet, vec3((dx / distance) * stepLength, -0.01, (dz / distance) * stepLength), capsule, out);
           feet = vec3(result.position.x, result.position.y, result.position.z);
         }
         expect(Math.hypot(waypoint.x - feet.x, waypoint.z - feet.z)).toBeLessThan(0.1);
       }
     });

     it('blocks the partition away from the doorway', () => {
       const physics = new KinematicPhysics();
       physics.setStaticColliders([...SHIPPED_WORLD.colliders, ...hubColliders(branchState)]);
       expect(physics.isPoseValid(vec3(0, 0.01, 8.25), DEFAULT_PLAYER_TUNING.capsule)).toBe(false);
     });

     it('never places an enabled interaction target inside static geometry', () => {
       const physics = new KinematicPhysics();
       physics.setStaticColliders([...SHIPPED_WORLD.colliders, ...hubColliders(branchState)]);
       const embedded = SHIPPED_INTERACTABLES.filter(
         (item) => item.enabled && physics.isBoxBlocked(item.min, item.max)
       ).map((item) => item.id);
       expect(embedded).toEqual([]);
     });
   });
   ```
   Add the needed imports at the top: `KinematicPhysics` (`../../src/adapters/kinematic-physics.ts`),
   `vec3` (`../../src/core/vec3.ts`), `DEFAULT_PLAYER_TUNING` (`../../src/gameplay/player-controller.ts`),
   `hubColliders` (`../../src/levels/hub.ts`), `type BranchState` (`../../src/game-state/progression-system.ts`).
3. If the "never places … inside static geometry" test fails for a target: fix the **content**
   (move that target's box in its level file by the smallest amount — ≤ 0.02 m — so it only
   touches the collider), never the test. Log which id moved.
**Verify:** that file, full suite. **Commit:** `overhaul(T4.4): content tests for spawn, doorway, and embedded targets`

### T4.5 Harness update for the new level
**File:** `scripts/browser-check.mjs`.
1. `oracle`: replace the two imports and the colliders/`all` lines:
   ```js
   const shipped = await import('/src/levels/shipped-content.ts');
   const branch = await import('/src/levels/branch-a.ts');
   const hub = await import('/src/levels/hub.ts');
   const physics = new KinematicPhysics();
   physics.setStaticColliders([
     ...shipped.SHIPPED_WORLD.colliders,
     ...hub.hubColliders((id) => (id === 'branch-a' ? 'Available' : 'Locked'))
   ]);
   const all = [...shipped.SHIPPED_INTERACTABLES, ...branch.bm1PropInteractables(true), ...hub.hubInteractables(() => 'Complete')];
   ```
2. `level`: delete the `const lab = await import('/src/levels/lab-world.ts');` line and the
   `lab: …` property.
3. `scenarioFocus`: delete the `...level.lab.map(…)` line.
4. Delete the `probe` and `liveaim` scenario blocks in `main()` (they target lab objects that no
   longer ship).
**Verify:** `npm run check:browser -- focus` → every `data.focus` entry starts with `focused from`;
`hold` and `branch` → checks as T1.5.
**Commit:** `overhaul(T4.5): harness follows the shipped level`

### Fix-up 4 · CHECKPOINT 4 — harness: `boot`, `hold`, `focus`, `branch`.
**Owner play check:** you spawn in the hall facing the teal door; walk through it into the
gallery; no stray test crates, no red block, no floating cubes.

---

## PHASE 5 — Visuals

### T5.1 Shadows, reflections, light rework
**File:** `src/adapters/three-renderer.ts`.
1. Import: `import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';`
2. Field: `private environment: THREE.Texture | null = null;`
3. `init()`, after `renderer.toneMappingExposure = 1.0;`:
   ```ts
    // PLAN T5.1: one shadow map. PCFSoftShadowMap was removed in r186 (it warns and falls back),
    // so PCFShadowMap is the correct soft-ish filter here.
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
   ```
4. Replace `buildLights()` (from T3.1) body with:
   ```ts
    if (!this.scene || !this.renderer) return;
    const scene = this.scene;
    const hemisphere = new THREE.HemisphereLight(0xbfc6cf, 0x2a2e33, 0.7);
    scene.add(hemisphere);
    this.lights.push(hemisphere);

    const key = new THREE.DirectionalLight(0xfff4e6, 2.0);
    key.position.set(10, 18, 8);
    key.target.position.set(0, 0, 0);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    const shadowCamera = key.shadow.camera;
    shadowCamera.left = -24;
    shadowCamera.right = 24;
    shadowCamera.top = 24;
    shadowCamera.bottom = -24;
    shadowCamera.near = 1;
    shadowCamera.far = 70;
    shadowCamera.updateProjectionMatrix();
    key.shadow.bias = -0.0005;
    key.shadow.normalBias = 0.02;
    scene.add(key);
    scene.add(key.target);
    this.lights.push(key);

    // Soft studio reflections so metal reads as metal (no texture download).
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const room = new RoomEnvironment();
    this.environment = pmrem.fromScene(room, 0.04).texture;
    scene.environment = this.environment;
    scene.environmentIntensity = 0.35;
    room.dispose();
    pmrem.dispose();
   ```
5. Shadow flags: in `setLabWorld` (T3.2) set `castShadow = true; receiveShadow = true;` on every
   mesh added to `labGroup` (assign the `new THREE.Mesh(...)` to a const first). In
   `carryableVisual` set `mesh.castShadow = true; mesh.receiveShadow = true;`. In the constructor,
   set `body.castShadow = true;` for the player marker body. Wireframe markers/pulse/scanner: no shadows.
6. `dispose()`: `this.environment?.dispose(); this.environment = null;` before `this.scene?.clear();`.
**Verify:** typecheck, build, harness `boot` → `report.problems` has no `WebGLShadowMap` warning;
draw calls in `data.soak.overlay` ≤ 100.
**Commit:** `overhaul(T5.1): shadows, environment reflections, light rework`

### T5.2 Procedural gear and pipe shapes + powered glow
**Files:** `src/ports/render-port.ts`, `src/presentation/feedback-composer.ts`,
`src/adapters/three-renderer.ts`, `src/main.ts`, tests.
1. `render-port.ts` `CarryableRenderState`: add
   ```ts
   /** Visual shape (PLAN T5.2). Absent = box. */
   readonly visual?: 'box' | 'gear' | 'pipe' | undefined;
   /** Part of a machine that is running right now (glow). Absent = false. */
   readonly powered?: boolean | undefined;
   ```
2. `feedback-composer.ts`:
   - `FeedbackView` interface (find it in the file): add
     `/** Visual shape per component (PLAN T5.2); absent = every part is a box. */`
     `readonly visualOf?: ((componentId: string) => 'box' | 'gear' | 'pipe') | undefined;`
   - `MutableCarryableState`: add `visual: 'box' | 'gear' | 'pipe'; powered: boolean;` and
     `visual: 'box', powered: false` in both factories (`stateFor`, `presentedFor`).
   - `rebuildStates`: before `this.states.push(state);` add
     ```ts
     state.visual = view.visualOf?.(snapshot.id) ?? 'box';
     state.powered = machine !== null && machine.state === 'running';
     ```
   - `present`: copy them: `out.visual = state.visual; out.powered = state.powered;`
3. `main.ts` `buildFeedbackView`: add to the returned object
   ```ts
    // PLAN T5.2: the part's shape comes from its capability tags (data), never from its id.
    visualOf: (componentId) => {
      const tags = content.registry.definitionFor(componentId)?.tags ?? [];
      if (tags.includes('gear')) return 'gear';
      if (tags.includes('valve') || tags.includes('pipe')) return 'pipe';
      return 'box';
    },
   ```
4. `three-renderer.ts`:
   - Imports already have `mergeGeometries` (T3.2).
   - Module functions (top of file, after the constants):
     ```ts
     /** Unit gear (fits a 1×1×1 box, centred, axis = Y) — scaled per part like the box. */
     function buildGearGeometry(teeth: number): THREE.BufferGeometry {
       const outer = 0.5;
       const root = 0.4;
       const shape = new THREE.Shape();
       const step = (Math.PI * 2) / teeth;
       for (let i = 0; i < teeth; i += 1) {
         const a0 = i * step;
         const points: ReadonlyArray<readonly [number, number]> = [
           [root, a0],
           [outer, a0 + step * 0.25],
           [outer, a0 + step * 0.5],
           [root, a0 + step * 0.75]
         ];
         for (const [radius, angle] of points) {
           const x = Math.cos(angle) * radius;
           const y = Math.sin(angle) * radius;
           if (i === 0 && radius === root && angle === a0) shape.moveTo(x, y);
           else shape.lineTo(x, y);
         }
       }
       shape.closePath();
       const hole = new THREE.Path();
       hole.absarc(0, 0, 0.12, 0, Math.PI * 2, true);
       shape.holes.push(hole);
       const geometry = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false, curveSegments: 12 });
       geometry.rotateX(-Math.PI / 2); // extrusion (+Z) becomes +Y
       geometry.translate(0, -0.5, 0); // centre the thickness
       return geometry;
     }

     /** Unit pipe segment with flanges (fits a 1×1×1 box, axis = X). */
     function buildPipeGeometry(): THREE.BufferGeometry {
       const body = new THREE.CylinderGeometry(0.42, 0.42, 1, 20);
       body.rotateZ(Math.PI / 2);
       const flangeA = new THREE.CylinderGeometry(0.5, 0.5, 0.12, 20);
       flangeA.rotateZ(Math.PI / 2);
       flangeA.translate(-0.44, 0, 0);
       const flangeB = flangeA.clone();
       flangeB.translate(0.88, 0, 0);
       const merged = mergeGeometries([body, flangeA, flangeB], false);
       body.dispose();
       flangeA.dispose();
       flangeB.dispose();
       return merged ?? new THREE.BoxGeometry(1, 1, 1);
     }
     ```
   - `CarryableVisual.mesh` type → `THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>`.
   - Fields: `private readonly gearGeometry: THREE.BufferGeometry;` and
     `private readonly pipeGeometry: THREE.BufferGeometry;` — create them in the constructor next
     to `this.carryableGeometry = …` (`buildGearGeometry(12)`, `buildPipeGeometry()`) and push
     both into `this.disposables`.
   - In `carryableVisual`, type the mesh as `new THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>(this.carryableGeometry, material)`
     and use material `{ color: 0x5fb8a6, roughness: 0.4, metalness: 0.55, emissive: 0x1f3f39, emissiveIntensity: 0.3 }`.
   - In `setCarryables`, after `const visual = this.carryableVisual(state.id);` add
     ```ts
     const geometry =
       state.visual === 'gear' ? this.gearGeometry : state.visual === 'pipe' ? this.pipeGeometry : this.carryableGeometry;
     if (visual.mesh.geometry !== geometry) visual.mesh.geometry = geometry;
     ```
     and replace the emissive lines with
     ```ts
     const powered = state.powered === true && state.attached;
     visual.material.emissive.setHex(state.held ? 0x6b4d12 : powered ? 0x2f7a2f : state.attached ? 0x1c4a1c : 0x1f3f39);
     visual.material.emissiveIntensity = state.held ? 0.85 : powered ? 0.9 : 0.3;
     ```
5. Tests: append to `tests/logic/feedback-composer.test.ts`:
   ```ts
   describe('FeedbackComposer — visual shapes (PLAN T5.2)', () => {
     it('reports the shape from the view, box by default', () => {
       const world = makeWorld();
       const render = new RecordingRenderPort();
       const composer = new FeedbackComposer(render);
       composer.update(DT, [], { ...viewOf(world), visualOf: () => 'gear' });
       composer.present();
       expect(stateOf(render, 'gear-a').visual).toBe('gear');
       const plainRender = new RecordingRenderPort();
       const plain = new FeedbackComposer(plainRender);
       plain.update(DT, [], viewOf(world));
       plain.present();
       expect(stateOf(plainRender, 'gear-a').visual).toBe('box');
     });
   });
   ```
**Verify:** typecheck, full suite, build, harness `branch` (checks as T1.5) and `boot` (no problems).
**Commit:** `overhaul(T5.2): gear and pipe shapes, glow on running machines`

### T5.3 Cylinder shafts in the world
1. `render-port.ts` `LabWorldMesh.kind`: `'box'` → `'box' | 'cylinder-z'` and add
   `/** 'cylinder-z': a round bar along Z filling the box (shafts). */` above it.
2. `src/levels/branch-a.ts`, function `shaftMesh`: its returned object's `kind: 'box'` →
   `kind: 'cylinder-z'` (only in `shaftMesh`). Leave every other mesh a box.
3. `three-renderer.ts` `setLabWorld`: replace `if (mesh.kind !== 'box') continue;` and the
   `new THREE.BoxGeometry(sizeX, sizeY, sizeZ)` line with:
   ```ts
      let geometry: THREE.BufferGeometry;
      if (mesh.kind === 'cylinder-z') {
        const radius = Math.min(sizeX, sizeY) / 2;
        geometry = new THREE.CylinderGeometry(radius, radius, sizeZ, 16);
        geometry.rotateX(Math.PI / 2);
      } else {
        geometry = new THREE.BoxGeometry(sizeX, sizeY, sizeZ);
      }
   ```
   (keep the `translate` and bucket-push lines after it). `mergeGeometries` merges boxes and
   cylinders fine (same attributes; groups ignored). If it returns `null` for a colour bucket, the
   T3.2 fallback already draws them individually.
**May update:** if a test asserts `kind === 'box'` for every shipped mesh, change it to accept
`'box' | 'cylinder-z'`.
**Verify:** typecheck, full suite, build, harness `boot`.
**Commit:** `overhaul(T5.3): round shafts`

### T5.4 Adaptive pixel ratio on slow machines
**File:** `src/adapters/three-renderer.ts`.
1. Fields: `private frameEmaMs = 16.7; private lastRenderAt = 0; private renderedFrames = 0; private degraded = false;`
2. At the top of `render(_alpha)` after the null guard:
   ```ts
    // PLAN T5.4: if frames stay slow (EMA > 24 ms after 3 s of play), drop to pixel ratio 1 and
    // a 1024 shadow map once. Presentation only; never touches the simulation.
    const now = performance.now();
    if (this.lastRenderAt > 0) {
      const frameMs = now - this.lastRenderAt;
      if (frameMs < 250) this.frameEmaMs = this.frameEmaMs * 0.95 + frameMs * 0.05;
    }
    this.lastRenderAt = now;
    this.renderedFrames += 1;
    if (!this.degraded && this.renderedFrames > 180 && this.frameEmaMs > 24) {
      this.degraded = true;
      this.pixelRatio = 1;
      this.applyViewport();
      for (const light of this.lights) {
        if (light instanceof THREE.DirectionalLight && light.castShadow) {
          light.shadow.mapSize.set(1024, 1024);
          light.shadow.map?.dispose();
          light.shadow.map = null;
        }
      }
      console.info(`[render] sustained ${this.frameEmaMs.toFixed(1)} ms frames — pixel ratio 1, shadow map 1024`);
    }
   ```
   (`this.pixelRatio` is also written by `resize`; after degrading, make `resize` keep it at 1:
   in `resize`, change the pixel ratio line to `this.pixelRatio = this.degraded ? 1 : Math.min(Math.max(0.5, pixelRatio), this.options.maxPixelRatio);`)
**Verify:** typecheck, build, harness `boot` (headless may or may not degrade — both fine; log which).
**Commit:** `overhaul(T5.4): adaptive pixel ratio and shadow size`

### Fix-up 5 · CHECKPOINT 5 — harness: `boot`, `hold`, `branch`.
**Owner visual sign-off (write "approved" or the notes in the log):** parts cast shadows on the
floor; gears look like gears and spin when their machine runs; valves look like pipe segments;
running machines' parts glow green; no flicker on the floor; frame rate feels smooth.

---

## PHASE 6 — UX shell

### T6.1 Controls table helper
Create `src/presentation/controls-table.ts`:
```ts
/** L4 — the controls list shown on the title screen and in the pause panel (PLAN T6.1). */

export type ControlRow = readonly [action: string, keys: string];

/** Build a two-column table; every value goes through textContent. */
export function buildControlsTable(doc: Document, rows: ReadonlyArray<ControlRow>): HTMLTableElement {
  const table = doc.createElement('table');
  table.className = 'gw-controls';
  const body = doc.createElement('tbody');
  for (const [action, keys] of rows) {
    const row = doc.createElement('tr');
    const actionCell = doc.createElement('td');
    actionCell.textContent = action;
    const keyCell = doc.createElement('td');
    keyCell.className = 'gw-controls-keys';
    keyCell.textContent = keys;
    row.append(actionCell, keyCell);
    body.append(row);
  }
  table.append(body);
  return table;
}
```
CSS (append, flat):
```css
.gw-controls {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.gw-controls td {
  padding: 3px 6px;
  border-bottom: 1px solid var(--gw-steel);
}

.gw-controls-keys {
  text-align: right;
  color: var(--gw-powered);
  font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
}
```
`main.ts`: after `const input = new InputSystem();` add
```ts
/** PLAN T6.1: the controls, spelled from the live binding map (never hard-coded keys). */
const controlRows = (): ReadonlyArray<ControlRow> => {
  const b = input.bindingSnapshot;
  const k = (code: string): string => (code.startsWith('Key') ? code.slice(3) : code === 'ShiftLeft' ? 'Shift' : code);
  return [
    ['Move', `${k(b.forward)} ${k(b.left)} ${k(b.back)} ${k(b.right)}`],
    ['Run', k(b.run)],
    ['Look', 'Mouse'],
    ['Grab · use · confirm', `${k(b.primary)} / Left click`],
    ['Rotate held part', `${k(b.rotateLeft)} / ${k(b.rotateRight)}`],
    ['Drop held part', k(b.secondary)],
    ['Remove a mounted part', `${k(b.primary)}, then ${k(b.primary)} again`],
    ['Hint', k(b.hint)],
    ['Pause · release mouse', 'Esc']
  ];
};
```
with `import { buildControlsTable, type ControlRow } from './presentation/controls-table.ts';`
New test `tests/dom/controls-table.test.ts`: builds a table from two rows; expects 2 `tr`, the
text of the cells, and that a row value `'<b>x</b>'` appears as text (`textContent`), not as an element.
**Commit:** `overhaul(T6.1): controls table`

### T6.2 Title screen
Create `src/presentation/title-screen.ts`:
```ts
/**
 * L4 — title screen (PLAN T6.2). Shown at boot over the first rendered frame; the game is
 * paused with reason 'menu' behind it. It reports intents only; main.ts owns the lifecycle.
 */

const TITLE_MARKUP = `
<div class="gw-title-panel">
  <h1 class="gw-title-name">GEARWRIGHT</h1>
  <p class="gw-title-tagline">Restore the Crucible Hall. Enter the Pressure Gallery through the teal door and bring its machines back to life.</p>
  <div class="gw-title-actions">
    <button type="button" class="gw-title-start"></button>
    <button type="button" class="gw-title-new"></button>
    <button type="button" class="gw-title-controls-toggle">Controls</button>
  </div>
  <div class="gw-title-controls gw-title--hidden"></div>
</div>
`;

export class TitleScreen {
  private readonly element: HTMLDivElement;
  private readonly startButton: HTMLButtonElement;
  private readonly newButton: HTMLButtonElement;
  private readonly controls: HTMLElement;
  private startHandler: (() => void) | null = null;
  private newGameHandler: (() => void) | null = null;
  private newArmed = false;
  private disarmTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(root: HTMLElement, options: { readonly hasSave: boolean; readonly controlsTable: HTMLElement }) {
    const doc = root.ownerDocument;
    this.element = doc.createElement('div');
    this.element.className = 'gw-title';
    this.element.innerHTML = TITLE_MARKUP;
    root.appendChild(this.element);
    const start = this.element.querySelector<HTMLButtonElement>('.gw-title-start');
    const fresh = this.element.querySelector<HTMLButtonElement>('.gw-title-new');
    const toggle = this.element.querySelector<HTMLButtonElement>('.gw-title-controls-toggle');
    const controls = this.element.querySelector<HTMLElement>('.gw-title-controls');
    if (start === null || fresh === null || toggle === null || controls === null) {
      throw new Error('ERR-TITLE-01: title skeleton incomplete');
    }
    this.startButton = start;
    this.newButton = fresh;
    this.controls = controls;
    this.startButton.textContent = options.hasSave ? 'Continue' : 'Start';
    this.newButton.textContent = 'New game';
    this.newButton.hidden = !options.hasSave;
    this.controls.appendChild(options.controlsTable);
    this.startButton.addEventListener('click', () => this.startHandler?.());
    toggle.addEventListener('click', () => this.controls.classList.toggle('gw-title--hidden'));
    // Two-step confirm: New Game erases progress, so the first click only arms it for 4 s.
    this.newButton.addEventListener('click', () => {
      if (!this.newArmed) {
        this.newArmed = true;
        this.newButton.textContent = 'Click again to erase progress';
        this.disarmTimer = setTimeout(() => {
          this.newArmed = false;
          this.newButton.textContent = 'New game';
        }, 4000);
        return;
      }
      if (this.disarmTimer !== null) clearTimeout(this.disarmTimer);
      this.newGameHandler?.();
    });
  }

  onStart(handler: () => void): void {
    this.startHandler = handler;
  }

  onNewGame(handler: () => void): void {
    this.newGameHandler = handler;
  }

  get visible(): boolean {
    return !this.element.classList.contains('gw-title--hidden');
  }

  hide(): void {
    this.element.classList.add('gw-title--hidden');
  }

  dispose(): void {
    if (this.disarmTimer !== null) clearTimeout(this.disarmTimer);
    this.element.remove();
  }
}
```
CSS (append, flat): `.gw-title` = same as `.gw-pause` but `z-index: 30; background: rgb(12 14 16 / 70%); cursor: default;`;
`.gw-title--hidden { display: none; }`; `.gw-title-panel` = same as `.gw-pause-panel` but
`max-width: min(520px, calc(100vw - 32px));`; `.gw-title-name { margin: 0 0 8px; font-size: 32px; letter-spacing: 0.18em; color: var(--gw-powered); }`;
`.gw-title-tagline { margin: 0 0 20px; font-size: 14px; color: var(--gw-muted); line-height: 1.5; }`;
`.gw-title-actions { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; }`;
`.gw-title-actions button` = same declarations as `.gw-pause-resume`;
`.gw-title-controls { margin-top: 16px; text-align: left; }`.

`main.ts`:
1. Import `TitleScreen`.
2. After the pause overlay creation (T1.2) add:
   ```ts
   // PLAN T6.2: title screen at boot (`?skipTitle=1` skips it — the browser harness uses this).
   const skipTitle = new URLSearchParams(window.location.search).has('skipTitle');
   const titleScreen = skipTitle
     ? null
     : new TitleScreen(document.body, { hasSave: loaded.ok, controlsTable: buildControlsTable(document, controlRows()) });
   ```
3. After `pauseOverlay.onResume(…)` (T1.2 step 3f) add:
   ```ts
   titleScreen?.onStart(() => {
     titleScreen.hide();
     inputSource.clearAll();
     app.resume('menu');
     canvas.focus({ preventScroll: true });
     void inputSource.requestPointerLock();
   });
   titleScreen?.onNewGame(() => startNewGame());
   ```
   and define (before those lines):
   ```ts
   /** New Game (§31.6): clear canonical state + storage, then a clean reboot of the page. */
   const startNewGame = (): void => {
     suppressLeaveSave = true; // T1.4: the reload's pagehide must not re-save the old game
     save.newGame();
     window.location.reload();
   };
   ```
4. In `tick`, inside `if (!firstFrameSeen && app.snapshot().loop.frames > 0) {` add at the end:
   `if (titleScreen?.visible === true) app.requestPause('menu');`
5. `handlePauseKey`: first line after the `Escape` check: `if (titleScreen?.visible === true) return;`
6. `shutdown`: `titleScreen?.dispose();`
Test `tests/dom/title-screen.test.ts`: Start label `Start` without save / `Continue` with save;
New game hidden without save; first New game click does not call the handler, second does;
Start click calls the start handler.
**Verify:** typecheck, full suite, harness `boot` (still green — it uses `skipTitle`), plus add
a harness scenario:
```js
if (SCENARIO === 'title') {
  await cdp.send('Page.navigate', { url: BASE.replace('skipTitle=1&', '') });
  await sleep(4000);
  const before = await evaluate(cdp, "({ visible: !!document.querySelector('.gw-title') && !document.querySelector('.gw-title').classList.contains('gw-title--hidden') })");
  const rect = await evaluate(cdp, "(() => { const r = document.querySelector('.gw-title-start').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()");
  await clickAt(cdp, rect.x, rect.y);
  await sleep(800);
  const afterVisible = await evaluate(cdp, "document.querySelector('.gw-title').classList.contains('gw-title--hidden')");
  report.data.title = { visibleAtBoot: before.visible, hiddenAfterStart: afterVisible };
}
```
(If `window.__probe` is lost after the navigation, that's fine — this scenario only reads the DOM.)
Check: `data.title.visibleAtBoot === true`, `data.title.hiddenAfterStart === true`.
**Commit:** `overhaul(T6.2): title screen with Start/Continue, New Game, Controls`

### T6.3 Pause panel: controls + New Game
`main.ts`, directly after the `titleScreen?.onNewGame(() => startNewGame());` line from T6.2
(so `startNewGame`, `pauseOverlay` and `controlRows` all exist):
```ts
const pauseExtras = document.createElement('div');
pauseExtras.append(buildControlsTable(document, controlRows()));
const pauseNewGame = document.createElement('button');
pauseNewGame.type = 'button';
pauseNewGame.className = 'gw-pause-resume gw-pause-noresume';
pauseNewGame.textContent = 'New game';
let pauseNewArmed = false;
pauseNewGame.addEventListener('click', () => {
  if (!pauseNewArmed) {
    pauseNewArmed = true;
    pauseNewGame.textContent = 'Click again to erase progress';
    window.setTimeout(() => {
      pauseNewArmed = false;
      pauseNewGame.textContent = 'New game';
    }, 4000);
    return;
  }
  startNewGame();
});
pauseExtras.append(pauseNewGame);
pauseOverlay.mountExtra(pauseExtras);
```
Harness `boot` still passes (clicking the panel centre resumes; the New game button is below).
**Commit:** `overhaul(T6.3): controls and New Game in the pause panel`

### T6.4 Settings
1. `src/gameplay/input-system.ts`: field `private lookScaleX = 1; private lookScaleY = 1;`, method
   ```ts
   /** Player settings (PLAN T6.4): sensitivity multiplier and invert-Y, applied before the cap. */
   setLookScale(sensitivity: number, invertY: boolean): void {
     const scale = Number.isFinite(sensitivity) ? Math.min(Math.max(sensitivity, 0.25), 3) : 1;
     this.lookScaleX = scale;
     this.lookScaleY = invertY ? -scale : scale;
   }

   get lookScale(): { readonly x: number; readonly y: number } {
     return { x: this.lookScaleX, y: this.lookScaleY };
   }
   ```
   In `clampedLook`: `clampDelta(raw.lookDeltaX * this.lookScaleX)` and `clampDelta(raw.lookDeltaY * this.lookScaleY)`
   (the non-finite guard inside `clampDelta` still applies).
2. `main.ts` `present` (T2.2): multiply `inputSource.pendingLookX` by `input.lookScale.x` and
   `pendingLookY` by `input.lookScale.y` **before** clamping, so the preview matches the sim.
3. Create `src/adapters/settings-store.ts`:
   ```ts
   /** L4 — player settings persisted in localStorage (PLAN T6.4), separate from save slots. */

   export interface PlayerSettings {
     readonly sensitivity: number;
     readonly invertY: boolean;
     readonly volume: number;
   }

   export const DEFAULT_SETTINGS: PlayerSettings = { sensitivity: 1, invertY: false, volume: 0.8 };
   const KEY = 'gearwright:settings';

   function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
     return typeof value === 'number' && Number.isFinite(value) ? Math.min(Math.max(value, min), max) : fallback;
   }

   export function loadSettings(): PlayerSettings {
     try {
       const raw = globalThis.localStorage?.getItem(KEY);
       if (!raw) return DEFAULT_SETTINGS;
       const parsed = JSON.parse(raw) as Partial<Record<keyof PlayerSettings, unknown>>;
       return {
         sensitivity: clampNumber(parsed.sensitivity, 0.25, 3, DEFAULT_SETTINGS.sensitivity),
         invertY: parsed.invertY === true,
         volume: clampNumber(parsed.volume, 0, 1, DEFAULT_SETTINGS.volume)
       };
     } catch {
       return DEFAULT_SETTINGS;
     }
   }

   export function saveSettings(settings: PlayerSettings): void {
     try {
       globalThis.localStorage?.setItem(KEY, JSON.stringify(settings));
     } catch {
       /* storage unavailable: settings last for this session only */
     }
   }
   ```
4. Create `src/presentation/settings-panel.ts` exporting
   `buildSettingsPanel(doc: Document, initial: PlayerSettings-like, onChange: (next) => void): HTMLElement`
   — declare a local structural type `{ sensitivity: number; invertY: boolean; volume: number }`
   (do **not** import the adapter; presentation must not import adapters). Content: three
   `<label>` rows built with `createElement` + `textContent`: "Mouse sensitivity" with
   `<input type="range" min="0.25" max="3" step="0.05">`, "Invert vertical look" with a
   checkbox, "Volume" with `<input type="range" min="0" max="1" step="0.05">`. On every `input`
   / `change` event call `onChange` with the full current values (parse with `Number(...)`).
   Class names: `gw-settings`, `gw-settings-row`.
   CSS (append, flat): `.gw-settings { margin-top: 12px; display: grid; gap: 8px; font-size: 13px; }`
   `.gw-settings-row { display: flex; justify-content: space-between; align-items: center; gap: 12px; }`
5. `main.ts`: import `loadSettings`, `saveSettings` (adapters — allowed in main) and
   `buildSettingsPanel`. After `const audio = new WebAudioBus(); …init…` add:
   ```ts
   let settings = loadSettings();
   const applySettings = (): void => {
     input.setLookScale(settings.sensitivity, settings.invertY);
     audio.setBusVolume('master', settings.volume);
   };
   applySettings();
   ```
   and in the T6.3 block before `pauseOverlay.mountExtra(pauseExtras);` add
   ```ts
   pauseExtras.prepend(
     buildSettingsPanel(document, settings, (next) => {
       settings = next;
       applySettings();
       saveSettings(settings);
     })
   );
   ```
6. Tests: `tests/dom/settings-panel.test.ts` (changing the range input's value then dispatching
   `new Event('input', { bubbles: true })` calls `onChange` with the new sensitivity; the checkbox
   toggles `invertY`); `tests/logic/input-system.test.ts` append: `setLookScale(2, true)` doubles
   X and negates+doubles Y before the cap; `setLookScale(NaN, false)` behaves as 1.
**Verify:** typecheck, boundary tests, full suite, harness `boot`.
**Commit:** `overhaul(T6.4): sensitivity, invert Y and volume settings`

### T6.5 Touch-only device notice
`main.ts`: replace the final `boot();` with:
```ts
/** PLAN T6.5: keyboard + mouse game — say so on touch-only devices instead of booting a dead game. */
function touchOnly(win: Window): boolean {
  try {
    return win.matchMedia('(pointer: coarse)').matches && !win.matchMedia('(any-pointer: fine)').matches;
  } catch {
    return false;
  }
}

if (touchOnly(window) && !new URLSearchParams(window.location.search).has('forceDesktop')) {
  const notice = document.createElement('div');
  notice.className = 'gw-title';
  const panel = document.createElement('div');
  panel.className = 'gw-title-panel';
  const heading = document.createElement('h1');
  heading.className = 'gw-title-name';
  heading.textContent = 'GEARWRIGHT';
  const text = document.createElement('p');
  text.className = 'gw-title-tagline';
  text.textContent = 'This game needs a keyboard and mouse. Open it on a desktop or laptop.';
  const tryAnyway = document.createElement('button');
  tryAnyway.type = 'button';
  tryAnyway.className = 'gw-pause-resume';
  tryAnyway.textContent = 'Try anyway';
  tryAnyway.addEventListener('click', () => {
    notice.remove();
    boot();
  });
  panel.append(heading, text, tryAnyway);
  notice.append(panel);
  document.body.append(notice);
  document.getElementById('boot-status')?.remove();
} else {
  boot();
}
```
**Verify:** typecheck, build, harness `boot` (desktop headless: boots normally).
**Commit:** `overhaul(T6.5): touch-only notice`

### Fix-up 6 · CHECKPOINT 6 — harness: `boot`, `title`, `hold`, `branch`.
**Owner play check:** title shows at load; Start captures the mouse; Esc shows the pause panel
with settings + controls; changing sensitivity is felt immediately; New game (two clicks)
restarts from zero.

---

## PHASE 7 — Production + deployment

### T7.1 Production-quiet game log
1. Create `src/debug/log.ts`:
   ```ts
   /** Game log (PLAN T7.1): on in dev builds, or in any build with `?log=1` (the harness uses it). */
   import { isDevBuild } from './flags.ts';

   const enabled: boolean =
     isDevBuild || (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('log'));

   export function gameLog(...parts: unknown[]): void {
     if (enabled) console.info(...parts);
   }
   ```
2. `main.ts`: `import { gameLog } from './debug/log.ts';` and replace **every** `console.info(`
   with `gameLog(` (keep `console.warn`/`console.error`). `grep -n "console.info" src/main.ts` → empty.
**Verify:** full suite, `npm run check:browser -- branch --production` → same T1.5 checks (proves
`?log=1` works in a production build).
**Commit:** `overhaul(T7.1): quiet production console`

### T7.2 Global error handler
`main.ts`, inside `boot()` right after the `hud` is created:
```ts
// PLAN T7.2: an unexpected error is told to the player once (progress lives in the last save).
let errorAnnounced = false;
const announceError = (detail: unknown): void => {
  console.error('[error]', detail);
  if (errorAnnounced) return;
  errorAnnounced = true;
  hud.toast('Something went wrong. Your progress up to the last autosave is safe — reload the page if the game misbehaves.', 'error');
};
window.addEventListener('error', (event) => announceError(event.error ?? event.message));
window.addEventListener('unhandledrejection', (event) => announceError(event.reason));
```
**Verify:** typecheck, full suite, harness `boot` (`report.problems` still empty — the handler
adds nothing on a clean run). **Commit:** `overhaul(T7.2): global error toast`

### T7.3 Split three.js into its own chunk
`vite.config.ts` → inside `build: { … }` add:
```ts
    rollupOptions: {
      output: {
        // three.js changes far less often than game code: its own file stays browser-cached across game releases.
        manualChunks: { three: ['three'] }
      }
    },
```
**Verify:** `npm run build` lists two JS files (one `three-*.js`); harness `boot --production`
→ no problems. If the build errors on `manualChunks` (Vite switched bundler), delete the block
and log it — this task is optional.
**Commit:** `overhaul(T7.3): separate three.js chunk`

### T7.4 CI workflow
Create `.github/workflows/ci.yml`:
```yaml
name: CI
on:
  push:
    branches: [main, overhaul]
  pull_request:
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run typecheck
      - run: npx vitest run
      - run: npm run build
```
**Verify:** YAML indentation is spaces only. (It runs after T7.7 pushes.) **Commit:** `overhaul(T7.4): CI workflow`

### T7.5 GitHub Pages deploy workflow
Create `.github/workflows/deploy.yml`:
```yaml
name: Deploy
on:
  push:
    branches: [main]
  workflow_dispatch:
permissions:
  contents: read
  pages: write
  id-token: write
concurrency:
  group: pages
  cancel-in-progress: true
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npx vitest run
      - run: npm run build
      - uses: actions/configure-pages@v6
      - uses: actions/upload-pages-artifact@v5
        with:
          path: dist
  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v5
```
`vite.config.ts` already has `base: './'`, which works under `https://<user>.github.io/gearwright/`.
**Commit:** `overhaul(T7.5): GitHub Pages deploy workflow`

### T7.6 Harness `--url` mode
`scripts/browser-check.mjs`:
1. After `const PRODUCTION = …` add
   `const URL_ARG = process.argv.find((arg) => arg.startsWith('--url='))?.slice('--url='.length) ?? null;`
2. BASE becomes:
   `const BASE = URL_ARG !== null ? URL_ARG.replace(/\/?$/, '/') + QUERY : (PRODUCTION ? … : …) + QUERY;`
   (keep the existing two-way expression inside the parentheses).
3. In `main()`: wrap the whole `if (PRODUCTION) { … } else { … }` server-start block in
   `if (URL_ARG === null) { … }`.
**Verify:** `npm run check:browser -- boot` still works locally. **Commit:** `overhaul(T7.6): harness can test a live URL`

### T7.7 Create repo, push, enable Pages, deploy
1. `gh auth status` → logged in (checked at plan time: account `shrinivas-sn`). If not logged
   in, log it, skip to T7.9, and put "owner: run `gh auth login`, then T7.7" in `Next:`.
2. Finish CHECKPOINT steps 1–8 for Phase 7 so far (main contains everything).
3. If `git remote -v` shows no `origin`:
   `gh repo create gearwright --public --source . --remote origin --push`
   (if the name is taken on the account, use `gearwright-game`). Then `git push origin overhaul`.
4. Enable Pages from workflows:
   `gh api -X POST "repos/{owner}/{repo}/pages" -f build_type=workflow`
   (`gh` fills `{owner}/{repo}` from the current repo). If it answers 409 (already exists), run
   `gh api -X PUT "repos/{owner}/{repo}/pages" -f build_type=workflow`.
5. Trigger: `gh workflow run deploy.yml --ref main`, then `gh run watch` (or
   `gh run list --workflow deploy.yml --limit 1` until `completed`). CI must be green too:
   `gh run list --workflow ci.yml --limit 2`.
6. Live URL: `gh api "repos/{owner}/{repo}/pages" --jq .html_url` → write it in the log.
If a step fails: read `gh run view --log-failed`, fix (usually a Node/lockfile issue: run
`npm ci` locally to reproduce), commit, push, rerun — 3 attempts, then log and continue.
**Commit:** none (pushing only).

### T7.8 Live verification
Run against the live URL (replace `<URL>`):
`npm run check:browser -- boot --url=<URL>` · `-- hold --url=<URL>` · `-- branch --url=<URL>`
Checks: exactly as T1.5. Also open `<URL>` once in the harness `title` scenario:
`npm run check:browser -- title --url=<URL>` → checks as T6.2.
Log every field checked.

### T7.9 README + PROJECT_STATE + close the plan
1. Create `README.md` (≤ 60 lines): what the game is (2 lines), live URL, controls table (same
   rows as `controlRows`), `npm install` / `npm run dev` / `npm test` / `npm run build`,
   `npm run check:browser -- <scenario>` (scenarios: boot, hold, focus, branch, title, bm1, press),
   deploy = push to `main`.
2. `PROJECT_STATE.md`: insert at the top of the "## Last Completed Checkpoint" section a new
   entry `CHK-13 — playability/visual/deploy overhaul (PLAN.md, 23/09/2026 → <date>)` of ≤ 25
   lines: what each phase changed, final test count, bundle sizes, live URL, any `[!]` tasks
   still open. Do not rewrite other entries.
3. Close the plan: if every task is `[x]`/`[~]`, delete `PLAN.md` (its durable content now lives
   in PROJECT_STATE's CHK-13 + git history). If any `[!]` remains, keep `PLAN.md` and put the
   open items in the last log entry's `Next:`.
4. Final CHECKPOINT (steps 1–9).
**Commit:** `overhaul(T7.9): README, project state, close plan`

### CHECKPOINT 7 (final) — harness against the live URL: `boot`, `hold`, `branch`, `title`.

---

## Progress Log

*(Append only. Newest at the bottom. Never rewrite an entry.)*

### Planning — 23/09/2026
Done:       Plan written from a full code review (inputs, manipulation SM, camera, physics,
            renderer, HUD, save, level data, harness) — no code changed.
Verified:   `npx vitest run` → `Test Files 44 passed (44)`, `Tests 564 passed (564)`;
            `npm run build` → `dist/assets/index-CHGu19p0.js 706.01 kB │ gzip: 184.62 kB`, `✓ built in 2.42s`;
            three r186 APIs checked in node_modules: `RoomEnvironment()` takes no args and has
            `dispose()`; `mergeGeometries` exported from `three/addons/utils/BufferGeometryUtils.js`;
            `PCFSoftShadowMap` logs "has been removed. Using PCFShadowMap instead."; `Scene.environmentIntensity` exists.
            Action majors via `gh api …/releases/latest`: checkout v7.0.1, setup-node v7.0.0,
            configure-pages v6.0.0, upload-pages-artifact v5.0.0, deploy-pages v5.0.1.
Surprises:  The harness's "second click" docking (CHK-12.5) is likely the E-rotate bug (T1.1),
            not timing — synthetic key taps never hold E long enough to trigger it.
Next:       T0.1 — `git checkout overhaul`, record baseline.
Commit:     committed on branch `overhaul` by the planning session's save-check (see `git log`)

### Phase 0 — 23/09/2026
Done:       T0.1 (branch + baseline), T0.2 (commit browser harness as scripts/browser-check.mjs), CHECKPOINT 0
Verified:   `npm run typecheck` → clean (exit 0);
            `npx vitest run` → Test Files 44 passed (44), Tests 564 passed (564);
            `npm run build` → dist/assets/index-CHGu19p0.js 706.01 kB │ gzip: 184.62 kB, built in 2.09s;
            `npm run check:browser -- boot` → problems: [], bootStatus: true, pausedState: "paused", resumedState: "running"
Surprises:  none
Next:       T1.1 — edit src/gameplay/input-system.ts DEFAULT_BINDINGS (rotateRight: 'KeyF')
Commit:     overhaul(CP0): checkpoint — phase 0 complete

<!-- Entry template (copy for each session):
### <Phase/Task> — <DD/MM/YYYY>
Done:       <tasks finished, ids>
Verified:   <commands + real output: test counts, build size, harness fields>
Surprises:  <anything unexpected, [!] tasks with their failure output>
Next:       <exact next task id + first action>
Commit:     <hash + message>
-->
