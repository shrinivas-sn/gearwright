# The player's body — where it is, and the optimised route to a real 3D human

**Written 10/10/2026 · Status:** §1 and §2 are *shipped and measured*; §3 onwards are proposals,
each labelled with what it costs and what it buys. Nothing below needs a file outside this repo.

This is a research note, not a contract. The contract is `ARCHITECTURE.md`; where a proposal
touches a boundary there, it says so and does not assume the boundary moved.

---

## 1. What the player is today (shipped 10/10/2026)

The player was an invisible placeholder: `three-renderer.ts` built a `CapsuleGeometry` marker,
set `visible = false` at boot, and never turned it back on — so the shipped build drew **no
player at all**. Measured, not inferred: the harness's `boot` report before this change had no
body in the scene graph, and `syncPlayerMarker` touched a marker nothing ever unhid.

It is now a **procedural skinned humanoid**: 19 bones, one `SkinnedMesh`, one material, no
texture, no glTF, no new dependency.

| Measured in a real Chrome (`npm run check:browser -- boot`) | Value |
|---|---|
| Bones | 19 (`hips → spine → chest → neck/head` + 2 arm chains + 2 leg chains) |
| Triangles | **1440** (budget ceiling: 250 000 — 0.6 %) |
| Materials / draw calls | 1 material → 1 draw call + 1 shadow pass (ceiling: 150) |
| Body position vs. simulation position | exact (`-4.5, 0.002, 12` == spawn) |
| Bundle cost | app JS 202.17 kB → 220.58 kB (gzip 65.73 kB); `three` chunk +4 kB |

The same day added **foot planting** (two ground rays per frame → `gameplay/foot-grounding.ts`, rig plants each leg on its own surface, pelvis drops ≤ 0.12 m to reach, stance foot only while walking) and **head look-at** (focus point, else the camera's aim). Both are presentation-only and both are pinned by tests: the crate-top case asserts the raised ankle at surface + ankle height while the other foot stays on the floor, and the look test asserts the head's own facing vector lands within ~25° of the target and returns to dead ahead when the target goes.

Why procedural rather than an imported model:

- **It is testable headlessly.** Pose, gait and hand placement are pure numbers in
  `src/core/character-pose.ts`; `tests/logic/character-pose.test.ts` verifies the two-bone solve
  *by forward kinematics* (the wrist lands on the target to 1e-6 when in reach), and
  `tests/dom/character-rig.test.ts` verifies the built skeleton (feet on the floor, hands
  converging on a held part, hiding when the spring arm is pulled in, no NaN bones from hostile
  input). No asset means no asset-loading test, no CI download, no licence file.
- **It costs nothing on the wire.** "glTF art pass" sits in `ARCHITECTURE.md` §3 Post-MVP; until
  then a 0 kB body beats a 2 MB one on a GitHub Pages cold load.
- **It cannot desynchronise.** The simulation owns the pose (ARCH §12/ADR-003); the rig only
  reads it. Root motion cannot fight the kinematic capsule because there is no root motion.

The animation is already more than a bob: the gait advances with **distance travelled**
(`GaitDriver`), not wall time, so the feet never slide; the walk/run blend, the airborne tuck,
the carry stance and the breathing idle are all blends of the same pose function, and the hands
are driven by an analytic two-bone aim that follows the held part.

**Honest limits of the current body.** Rigid one-bone-per-vertex skinning (visible mechanical
joints — deliberate, fits the industrial setting but is not a fleshy human); no foot IK (feet
follow the leg, they do not plant); no look-at on the head; the grip is solved in *character*
space, so the torso's own rotation leaves the hand a couple of centimetres off the ideal point;
the body hides entirely when the camera arm is pulled inside it instead of fading.

---

## 2. Optimisation rules this project now follows (verified against the local three r186)

Facts checked in `node_modules/three@0.186.0`, not from memory: the package exports `three/webgpu`
and `three/tsl`; `examples/jsm/libs/` ships `meshopt_decoder`, `draco/` and `ktx-parse`; and
`examples/jsm/utils/` ships `SkeletonUtils`, `SceneOptimizer` and `BufferGeometryUtils`.

1. **One material per body, colours in vertex attributes.** The body's steel/limb/brass
   variation is vertex colours; splitting it into three materials would cost three draw calls for
   zero gain.
2. **Pool and share geometry.** The renderer already pools carryables and markers by id; the rig
   builds its geometry once. Nothing in the character path allocates per frame — every pose call
   writes into a reused buffer (`out`-parameter discipline, `src/core/vec3.ts`).
3. **Cheap bones over more bones.** 19 bones → a 19-texel bone texture. Skinned-mesh cost in
   three scales with bone count and with the number of *distinct* skinned meshes, so a second
   character should reuse the same skeleton via `SkeletonUtils.clone`, never rebuild one.
4. **Never animate on wall-clock time.** Breathing uses the render dt, the gait uses distance.
   Anything that fed a clip time back into logic would break replay/save determinism.
5. **Budget before beauty, with the numbers already in the repo.** `src/core/perf.ts` holds the
   ceilings (150 draw calls, 250 k triangles, 8 lights, 16.67 ms). A hero-quality glTF character
   (15–25 k triangles, 2–4 materials) fits with room to spare; the risk in this project is never
   triangles, it is *shader compile hitches* and *asset download size*.
6. **Warm up shaders.** `renderer.compileAsync(scene, camera)` (available on both renderers;
   WebGL uses `KHR_parallel_shader_compile`) behind the loading/title screen removes the
   first-frame hitch when a new material enters view. Worth doing the day a textured character
   lands — today's single `MeshStandardMaterial` already appears at boot.
7. **Degrade, don't stutter.** The renderer already drops pixel ratio and shadow resolution after
   180 slow frames. The body is the natural next degradation step (`?rig=capsule`, quality tier).

---

## 3. Route A — make the procedural human better (no assets, days not weeks)

| Step | Work | Why it pays |
|---|---|---|
| A1 | ~~**Foot IK**: probe from each ankle, plant and align the foot, drop the pelvis to reach~~ — **shipped 10/10/2026** (vertical planting; sticking the foot through the stride is the remaining half) | Removes the last "puppet" tell; also makes stairs/edges read correctly |
| A2 | ~~**Head look-at**: aim the neck/head at the focus target, clamped, blended~~ — **shipped 10/10/2026** | Player reads intent; cheap (2 joints) |
| A3 | **Socket reach**: while `SnapPreview` is active, drive the hand aim at the socket instead of the held part | Turns an invisible mechanic into a visible one; the IK already exists |
| A4 | **Carry per shape**: grip offset from the part's half-extents, one hand for small parts, two for wide ones | Reads as physical handling rather than a magnet |
| A5 | **Two-bone weight skinning on the elbows/knees** (weights instead of rigid 1.0) | Removes the visible seams without an artist |
| A6 | **Author poses as data** in `src/data/` (like components/sockets already are) | Keeps tuning out of code, in the project's existing content pattern |

Route A keeps every existing test green, downloads nothing, and is the only route that cannot
break determinism. It is the recommended next step regardless of what §5 decides.

## 4. Route B — import a real animated humanoid (glTF + AnimationMixer)

The industry-standard path, and what `ARCHITECTURE.md` §3 already lists as Post-MVP.

**Sources of a rigged human** (checked 10/10/2026):

- **Mixamo** — free auto-rigging + animation library; the default answer for "a human that walks".
- **Quaternius "Universal Animation Library"** — 120+ humanoid animations on a universal rig,
  free for personal/educational/commercial use, and explicitly compatible with Mixamo rigs. The
  cheapest way to get a *complete* clip set (walk/run/turn/carry/idle) without Mixamo's account.
- **Mesh2Motion** — open-source, browser-based auto-rig/animator (humanoid, quadruped, bird).
- **Ready Player Me / VRM** — parameterised humanoids if the game ever wants a character creator.

**Pipeline** (all CLI, no GUI step in the build):

```
# one-off, by hand: export/author → GLB in assets/characters/
npx @gltf-transform/cli optimize in.glb out.glb \
  --compress meshopt --texture-compress ktx2 --texture-size 1024
```

- **meshopt vs Draco**: `EXT_meshopt_compression` compresses geometry *and* animation tracks and
  decodes faster in WASM; Draco compresses geometry only and needs a second decoder. For a
  skinned, animated character meshopt is the better default. Both decoders are already in the
  installed three package, so neither adds a dependency — only a `.wasm`/`.js` asset to serve.
- **KTX2/Basis textures** keep GPU-compressed textures small; a 2 k PBR set becomes ~1 MB instead
  of ~8 MB. Only worth it once a character actually has textures.
- **Then**: `GLTFLoader` → `SkeletonUtils.clone()` for any second instance → `AnimationMixer` with
  crossfades, an additive upper-body layer for the "carrying" stance, and **no root motion** (the
  simulation owns the position; strip or ignore any `Hips` translation track).

**Costs to accept:** 1–3 MB added to a cold load (mitigate by lazy-loading after the title
screen's Start press, behind the existing title/pause overlay); a licence/provenance record that
must be committed with the asset; an artist-shaped failure mode ("the mesh looks wrong") that no
unit test catches; and the loss of the free foot-slide guarantee (distance-driven phase has to be
tuned to the clip's stride length).

**Boundary note:** the GLB and its loader belong in `adapters/`; the *decision* of which
animation state to play is presentation-only and must stay there. `AnimationMixer` time must never
be persisted or fed back into `game-state/` (ARCH §31's "derived flag" rule).

## 5. Recommended shape: the procedural body as the contract, a glTF behind it

Keep `CharacterRig` as the **default and the fallback**, and put an imported humanoid behind the
same seam:

```
RenderPort.syncPlayerMarker(state)          ← unchanged (the port is the contract)
        │
        ├── CharacterRig   (procedural, 1 draw call, 0 kB, testable)   ← shipped
        └── GltfCharacter  (same update(CharacterUpdate) surface, lazy loader)   ← optional
```

Both consume `CharacterUpdate` (position, yaw, speed, grounded, carrying, hold target, dt,
camera distance) and `core/character-pose.ts` remains the truth for the *state* the body is in
(idle/gait/air/carry) — a glTF implementation only has to map that state onto clips. That keeps
the headless tests meaningful whichever body is drawn, keeps the game playable on a machine that
fails to fetch the model, and gives a "quality tier / asset failed → capsule" degradation path
that the perf system already knows how to signal.

**Do not** swap the physics engine for this. Rapier's kinematic character controller is the
obvious alternative to the custom kinematic capsule, but this project's central bet is
deterministic, engine-free rules with a headless test suite; a WASM physics engine would trade
that for controller conveniences (stairs, slopes, moving platforms) the game does not yet use.

---

## 6. Development-process optimisations (the "even more optimised way")

1. **Keep the two-layer discipline for the body.** Pure state/pose maths in `core/` (tested
   headlessly), engine work in `adapters/`, the port unchanged. This is what made today's change
   verifiable without a GPU.
2. **Make the harness the visual gate.** `boot` now asserts bones/triangles/visibility/position
   from the live composition (added 10/10/2026). Extend, in order of value: (a) the body *moves*
   (two samples of the bone world positions differ while walking); (b) ~~the hands land on the held
   part within a tolerance~~ — **shipped 10/10/2026, session 3**, as a *reach-shape* gate, not a
   proximity one: the carry pose floats the part 1.35 m out while the arms reach 0.56 m, so the
   hands clamp at full extension by construction and the gate asserts alignment (dot > 0.9) +
   extension (> 0.4 m); (c) a draw-call/triangle reading from `renderer.info` in a scripted
   stress scenario; (d) a screenshot artefact for human review.
3. ~~**A rig preview surface.** A `?rig=1` debug mode (the debug flags already exist) that plays the~~
   ~~pose function on a loop with sliders for speed/carry/grounded — iterate animation in seconds~~
   ~~instead of walking to a part and picking it up.~~ — **shipped 10/10/2026, session 3** as
   `src/adapters/rig-preview.ts` (L4, lazy-loaded into its own 3.69 kB chunk, own scene + own
   rig + speed/gait-scrub/carry/grounded sliders, jsdom-pinned).
4. **Asset job, when assets arrive.** One `npm run assets:optimize` script wrapping
   `@gltf-transform/cli` so nobody hand-compresses, and the compressed GLB is what gets committed.
5. **Watch the first-load budget as a number, not a feeling.** The `three` chunk is already split
   for caching; add a size check to CI (`dist/assets/*.js` gzip) so a new dependency cannot quietly
   double the cold load.
6. **Keep the shader-compile noise distinguishable.** ANGLE emits a `X4122` precision warning for
   the compiled program on Windows D3D; it is present in the pre-existing reports and is not a
   failure. If more programs appear, `compileAsync` moves the cost off the first gameplay frame.

## 7. Suggested order of work

1. Route A1 + A2 (foot IK, head look) — highest read-quality gain per hour, no assets.
2. Harness check (b): hands on the held part in a live browser — locks in today's IK wiring.
3. Route A3 (reach toward the socket on snap preview) — makes an existing mechanic visible.
4. Only then decide Route B, with §4's costs on the table and a licence record ready.

**Sources** (checked 10/10/2026): three.js r186 package contents (local `node_modules/three`);
glTF Transform CLI (`gltf-transform.dev/cli`, v4.5.1); "100 Three.js Tips That Actually Improve
Performance (2026)" (utsubo.com, r186-era: `compileAsync`, KTX2, meshopt/Draco trade-offs,
draw-call budgets, occlusion queries, WebGPU status); Quaternius Universal Animation Library;
mixamo.com; Mesh2Motion; Rapier JS character controller docs; `gltf.rs`/`three.js` discourse
threads on SkinnedMesh cost.
