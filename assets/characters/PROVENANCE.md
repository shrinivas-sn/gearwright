# `assets/characters/` — imported bodies and where they came from

Per `DOCS/CONTEXT/CHARACTER-3D.md` §4 ("a licence/provenance record that must be committed with
the asset"). One entry per committed file; nothing here is loaded by a build step, so a new body
is a new file plus a row.

## `vanguard.glb` — the player's body (added 15/10/2026)

| | |
|---|---|
| What | A rigged, textured humanoid in gear (helmet, vest, backpack, gloves, boots): 49 bones, 2 meshes, 11 376 triangles, 2 110 kB uncompressed |
| Clips | `Idle` (1.97 s), `Walk` (1.03 s), `Run` (0.70 s), `TPose` (unused) — all **in place**: the hips' translation band is 6 cm lateral / 8 cm vertical with no forward travel, so the simulation stays the only thing that moves the player |
| Facing | −Z in the model's own bind pose (measured from the toe-vs-ankle bones at load, not assumed) |
| Height | 1.83 m at the file's own scale (`Character` node, scale 0.01 over centimetre geometry) |
| Source | `https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/models/gltf/Soldier.glb` — the three.js example asset, fetched 15/10/2026 |
| Author | Character by **Mixamo** ("Vanguard"); three.js ships it as an example model |
| sha256 | `dfb230fc1f942f259dd00281a1186953ad602fc5d69067ce63e24b2aa439736b` |
| Licence | Mixamo content is royalty-free for use under Adobe's terms; this copy is redistributed here as a three.js example asset. **Before a commercial release, confirm those terms or replace the file** — nothing in the code depends on *this* model |

### Swapping the body

`src/adapters/gltf-character.ts` needs only: one skinned mesh (or a few), a skeleton, and clips
whose names contain `idle`, `walk` and `run`. Everything else is measured at load — the model is
scaled so it stands `BODY_HEIGHT` (1.8 m) tall, its feet are dropped onto the player's own position,
and the yaw offset is derived from the toe-vs-ankle bones, so a differently-authored humanoid
(Quaternius/Universal Animation Library, Mesh2Motion, Ready Player Me) drops in as a new file plus
a row in this table. `?body=proc` always falls back to the procedural rig, and a failed fetch does
too.
