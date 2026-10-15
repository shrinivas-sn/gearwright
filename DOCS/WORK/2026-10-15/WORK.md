# WORK — 2026-10-15 (player body: a real humanoid, and the vertical look reversed)

See `DOCS/STATUS.md` for the standing project status and the `## Next up` resume list.

## Accepted scope for this session (the project owner's own words)

- **"the vertical mouse movement should be reversed … the horizontal left and right is correct, just
  the up and down is feeling wrong"** — flip the vertical look axis.
- **"i want the real tpp person instead of that character, sticky and box type"** — replace the
  generated body with a real rigged human.
- **"continue the work"**, and **"don't touch anything outside this project folder"** — nothing
  outside `E:\gearwright` was read or written.

## 1. The vertical look axis is now inverted (by request)

`CameraRig.integrateLook` and `previewPose` both map `+lookDeltaY` (the DOM's downward travel) onto a
**rising** view: the mouse moving down pushes the pitch up, so the eye drops below the anchor. Pitch
is still the *view* angle, so `minPitch`/`maxPitch` and every framing behaviour are untouched — only
which travel direction reaches them flipped. `invertY` (settings) still flips it one layer down, so
the conventional mapping is one checkbox away.

- `src/gameplay/camera-rig.ts` — the two sign flips plus the comments that explain them.
- `tests/logic/camera-rig.test.ts` — the four look-direction/clamp pins re-stated as the inverted
  contract (mouse-down → look up).
- `tests/logic/phase-world.test.ts` — the two "look down at the floor crate" helpers now drive
  `-120` (mouse *up*), since that is what looks down now.
- `scripts/browser-check.mjs` — `pitchHome`/`pitchTo` keep their public convention (a *view* pitch,
  positive = down) and drive the rig with the negated travel, so every closed-form aim in the harness
  still means what it says. `focus` reached its targets live through that path.

## 2. The player is now a real rigged human (CHARACTER-3D.md §4 Route B / §5)

The procedural rig stays exactly as it was — it is now the **fallback**, and the drawn body is an
imported GLB behind the same `CharacterUpdate` seam.

- **`assets/characters/vanguard.glb`** (2 110 kB, committed) — a rigged, textured humanoid in gear,
  49 bones, 2 meshes, 11 376 triangles, with `Idle`/`Walk`/`Run` clips that are **in place** (hips
  translation band: 6 cm lateral / 8 cm vertical, no forward travel). Provenance, licence note,
  sha256 and the swap recipe are in **`assets/characters/PROVENANCE.md`**.
- **`src/adapters/gltf-character.ts`** (new, L4) — `loadGltfCharacter()` + `GltfCharacterBody`, the
  second implementation of the body seam. It **measures** the model at load instead of trusting it:
  height (1.83 m → fitted to 1.80 m), foot height, facing (toe-vs-ankle bones ⇒ −Z, yaw offset 0°),
  bone names, clip names. It scales, drops the feet onto the player's position, disables culling on
  the skinned meshes, and drives the clips from the **distance-based gait phase** the procedural rig
  already uses, so the feet do not slide.
- **Carry stance on an imported rig**: a convention-free two-bone IK solved in *world* space (no
  knowledge of the model's bone axes) aims each hand at the held part, blended in over ~0.08 s. It
  clamps at full extension because the carry lead (1.35 m) is twice the arm's reach — which is the
  same shape the procedural rig produces.
- **`src/core/character-clips.ts`** (new, pure) + `tests/logic/character-clips.test.ts` — clip
  weights (idle/walk/run, always summing to 1) and the phase → clip-time fraction, headless-tested.
- **`src/ports/render-port.ts`** — `CharacterFacts.body` gains `'procedural' | 'gltf'` (tooling only,
  so the harness knows which bone/triangle numbers are meaningful).
- **`src/adapters/three-renderer.ts`** — `PlayerBody` seam + `upgradePlayerBody(url)`: lazily imports
  the loader chunk and swaps the body in; a refusal leaves the procedural rig in place.
- **`src/main.ts`** — the fetch starts after boot, in the background, and writes
  `canvas.dataset.body` when it settles (`'gltf' | 'proc'`); `?body=proc` keeps the procedural rig.

### Live proof (real Chrome, dev build)

- `boot` — `character {body: "gltf", bones: 49, triangles: 11376, visible: true, x: −4.5, y: 0.002,
  z: 12}` and the load line `imported body: 1.83 m scaled to 1.80 m, facing -Z (yaw offset 0°),
  49 bones, 11376 triangles, clips [idle, walk, run]`. No problems in the report.
- `hold` — the **same reach-shape gate the procedural rig passes**, now measured on the humanoid
  while it carries `gear-a`: left hand dot 0.967 @ 0.548 m, right hand dot 0.960 @ 0.470 m. That is
  the objective check that the two-bone IK really points both hands at the part (the harness waits
  for the body swap before grabbing, so the gate cannot pass on the procedural rig by accident).
- `dock` — the single-pair carry scenario is green with the imported body live (grab at 2.09 m,
  compatible on the first vantage, no lost hold, no problems).
- `focus` — aimed live from real mouse travel through the (now inverted) vertical axis and focused
  its targets; the scenario is long (all parts + sockets) and was cut off by the tool's 10-minute
  ceiling before writing its report, so it is *evidence*, not a completed pass.
- `boot --production` — the same result out of `dist/` (the emitted `vanguard-<hash>.glb` resolves
  from the base-path-relative URL Vite generates), so the deployed artifact is what was measured.
- `HARNESS_BODY=proc boot` (new harness override) — **the fallback path is verified, not assumed**:
  `{body: "procedural", bones: 19, triangles: 3936, visible: true}`, no problems.
- `build` — `three` 624.60 kB (gzip 158.34), `app` 249.76 kB (gzip 72.82), lazy `gltf-character`
  8.23 kB + `GLTFLoader` 44.81 kB (gzip 3.17 + 13.52), `rig-preview` 3.69 kB unchanged, and the
  model emitted as `dist/assets/vanguard-<hash>.glb` (2 160 kB).
- Tests 671/671 across 58 files; typecheck clean.

## What this session did **not** settle (the honest list)

- **Nobody has watched it move.** Everything above is instrumentation: bone/triangle counts, the
  fitted height, the measured facing, the grip alignment. Whether the imported Idle/Walk/Run clips
  read well at this scale in this level, and whether the chosen model suits an industrial workshop,
  is a human judgement and is now the first item of `## Next up`.
- **The cost is real and new**: ~2.1 MB of model on a cold load, plus three's animation modules now
  in the eagerly-cached `three` chunk (+57 kB raw, because `AnimationMixer` was previously
  tree-shaken out). Both are recorded in STATUS.md; if the model's size is judged too high, the swap
  recipe in `PROVENANCE.md` is a file change.
- **Legs have no foot-planting**: the procedural rig plants feet on crate tops and slopes via
  `foot-grounding.ts`; the imported body just plays its clip. Same for the head look-at and the
  crouch-on-jump tuck. Those are the next realism items if the look is kept.
