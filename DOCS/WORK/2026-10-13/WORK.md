# 13/10/2026 — Branch B "Thermal Line": the second branch, built from content alone

Session opened as a `/recap` plus a directive: *"keep improving the game, set a proper goal toward a
production/commercial game, use the reverse-engineering skill for reference, don't over-engineer or
break anything, and commit at stages."*

`STATUS.md`'s `## Next up (start here)` named Branch B as **the biggest thing actually missing**:
Branch A's door opens into the Pressure Gallery, but B and C are sealed visuals with nothing behind
them. ARCH §6 makes the goal explicit — the **expansion path** ("a second branch is added by (a) new
`BranchDefinition` + puzzle/reward data, (b) a door anchor in the hub with an `AccessGate`, (c) one
`HubStageDefinition` entry. **No core system changes** — this is the scalability claim the
verification gate tests"). So the goal was to build Branch B **as content**, and to treat "did any
core system change?" as the pass/fail line.

## Plan

- Build Branch B "Thermal Line" behind the hub's north door: a room, an entry machine, a staged
  capstone, a reward, and a clue — all through the existing data contracts.
- Keep the diff content-shaped: `data/` and `levels/` only, plus the composition-root wiring a new
  branch legitimately needs. No L1 system, port, adapter or schema change.
- Verify with the shipped-content suites, a solvability suite, the build, and the browser harness —
  and commit each stage.

## Execution

### Stage A — the room, the branch, and B1 "Feedwater" (`0f3956f`)

- **The room.** `levels/game-room.ts`'s north wall gained a doorway gap (the Branch B door at x = 0
  is a real opening now), and `levels/branch-b.ts` authors the "Steam Works" beyond it — floor,
  walls, and B1's placement. The hall's north wall *is* the room's south wall, so the two level
  files agree by construction.
- **The branch is data.** `data/branches.ts`: Branch B stops being `sealed: true` and gets
  `puzzleIds: ['B1']`. Nothing else about it is special — `hubColliders` and `hubMeshes` already
  read `branchState`, so the door opens, the slab disappears and the trunk line exists with no
  geometry change and no AccessGate class. The hub stage that needs A **and** B
  (`stage/regulator-awake`) already existed.
- **B1 "Feedwater"** is the first shipped puzzle built on the `componentAt` requirement kind: two
  parallel feedwater ports must both hold an open valve (`componentAt` count 2), the outlet must
  receive the two runs' combined pressure (`output` min 2), and a `safety unjammed` names the failure
  a shut-off valve causes. Content only — two socket definitions, one machine, one puzzle, one level
  placement; the geometry reuses Branch A's component definitions.
- **The clue-plate row.** `hub.ts` placed every clue's plate at one hard-coded box, so a second clue
  would have silently shared the first plate's focus ray (and become unreadable). Plates are now
  placed per clue id — Branch A's keeps its original Regulator-column geometry, the Thermal Line's
  is bolted lower-left on the plinth face. This is a latent single-plate bug that only the second
  clue exposed.

### Stage B — BM-2 "Steam Engine", the staged capstone (this session)

- **BM-2** is ADR-018's second instance: assembly (a gear bridges crank → flywheel, a pipe bridges
  boiler → condenser) → order-flexible priming (inlet/outlet/drain) → an ordered throttle pull. It
  uses the same requirement vocabulary as BM-1 (`connected`, `output`, `safety`, `state: primed`,
  ordered `sequence`) and the same two decoys (blanking plate, shut-off valve), so no code knows what
  "BM-2" is.
- **The composition generalised.** The one BM-1-specific piece of `main.ts` was the prop wiring
  (`bm1StructureComplete` / `syncBm1Props` / the `bm1PropMeshes` call). It is now a small
  `STAGED_RIGS` table — a machine id, its prop targets and its prop meshes — so a staged machine is
  one entry, never a code path. `stagedNote` was already generic (it walks `MACHINE_DEFINITIONS`).
- `data/actions.ts` gained BM-2's staged ids; `data/sockets.ts` its two mounts; `data/machines.ts`
  its machine; `data/rewards.ts` its milestone; `data/branches.ts` added `BM-2` to Branch B, so the
  branch completes only once its capstone has run — the same order §6 gives Branch A.

## Verification

| Check | Command | Result |
|---|---|---|
| Typecheck | `npx tsc --noEmit` | clean (exit 0) |
| Tests | `npx vitest run` | **648 passed / 55 files** (was 634 / 53) |
| Build | `npm run build` | green — `app` 235.85 kB (gzip 69.36 kB), `three` 567.57 kB, lazy `rig-preview` 3.69 kB |
| `boot` (real Chrome) | `node scripts/browser-check.mjs boot` | clean apart from the pre-existing ANGLE `X4122` warning; logs `branch-a=Available (open), branch-b=Available (open), branch-c=Locked (sealed)` and `0/2 clue(s) discovered` |
| `focus` (real Chrome) | `node scripts/browser-check.mjs focus` | `no problems`; B1's three parts focus (`Grab`, ~2.09 m) from inside the Steam Works, and BM-2's parts focus likewise |

New/updated suites: `branch-b-solvability` (B1 completes with two open valves; a half-filled header
fails; a shut-off valve jams the run), `bm2-staged` (BM-2 assembly, priming coverage, the
out-of-order engage, and the one-shot `PuzzleComplete` with its milestone), the shipped-content
integrity suite extended to Branch B (every clause re-checked against the new branch, plus a walk
through the new doorway), and the clue-plate suite now covers the whole plate row.

## Known loose ends (recorded, not fixed)

- **Branch B is un-gated.** `progression-system.ts` supports gating (`requiresBranches`) and the
  door reads it, but **nothing in the composition calls `PuzzleSystem.unlock()`**, so a gated branch
  would start its puzzles `Locked` forever. The shipped-content integrity suite encodes exactly that
  ("every shipped puzzle … not born Locked"), which is why Branch B ships available from boot. Making
  B require A is the natural next step and needs one composition-side edge (unlock on branch
  availability) plus a collider refresh when a door opens mid-session — a real, small change, but a
  change, so it was left out of a content-only commit.
- **Branch B is two machines, not four.** It has the §6 template's entry machine (B1) and final
  staged machine (BM-2); the combining and open-ended beats (Branch A's P2/P3 analogues) are the
  next content.
- Branch C (Great Crucible) is still a sealed visual, and the shooting feature is still
  assessed-but-unbuilt (`CONTEXT/SHOOTING-MECHANIC.md` §5).
