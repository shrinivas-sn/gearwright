# Can we add a shooting feature? — feasibility, physics and loading cost

**Written 10/10/2026 · Verdict: yes, and cheaply — but it is an architecture decision first, so it
needs an explicit go-ahead.** Nothing here is implemented; this is the assessment that has to come
before the code (see §5 for the exact options to choose between).

---

## 1. The one blocker is a documented decision, not a technical one

`ARCHITECTURE.md` §3 lists **"Combat" as Out of Scope** for the MVP. Shooting is not forbidden by
layering or by any test — but it contradicts a written scope decision, so shipping it means an
explicit ADR entry and a scope update. Everything else below is engineering, and the engineering
is favourable.

## 2. What the engine actually gives us for projectiles

| Need | Available today | Gap |
|---|---|---|
| Segment collision with the world | `PhysicsPort.castRay` (static AABBs, returns point + normal) | none |
| Radii / fat bullets | `PhysicsPort.castSphere` (already used by the camera) | none |
| Deterministic stepping | fixed 30 Hz sim loop, all systems headless-testable | none |
| Gravity + landing on support | already built for dropped parts (`ManipulationSystem.stepFalling`, T1.3) | none |
| Pooled visuals, zero per-frame alloc | renderer pools by id and shares geometry | a bolt pool (small) |
| Sound without asset downloads | `WebAudioBus` is fully procedural | a shot/impact cue |
| Budget headroom | 150 draw calls / 250 k triangles ceiling; the player body uses 1 call / 1.4 k tris | none |

**No physics engine needed.** A bolt is a small box with a velocity, integrated per fixed step and
moved by a *swept* ray (a 25 m/s bolt travels 0.83 m per step — a point test would tunnel straight
through a 0.4 m crate, a sweep cannot). Collisions resolve as reflect-about-normal with a
restitution and friction term, then it either rests (reusing the existing support probe) or
despawns. That is ~200 lines of pure, testable gameplay code, deterministic by construction.

**Honest limits, stated up front:** no stacking solver, so a heap of shot boxes can jitter; no
rotation dynamics (spin is visual); no concave shapes; no damage or health, so nothing shoots back.
Those are the same limits the game already accepts — the kinematic physics is deliberately not a
rigid-body engine (ADR-004).

## 3. Loading cost: effectively zero

- Projectiles, the launcher and targets are **procedural geometry** (the game already builds gears,
  pipes and now a whole human from code). No glTF, no texture, no KTX2, no decoder wasm.
- One shared geometry + one material per prop class, pooled with a fixed capacity (a ring buffer,
  e.g. 32 live bolts) → the draw-call and GC cost is flat regardless of how much you shoot.
- Audio is synthesised by the existing bus, so there is no audio download either.
- The only honest cost is **app JS bytes** (the current app chunk is 220.58 kB / 65.73 kB gzip) plus
  a few hundred bytes of HUD markup; the `three` chunk does not change.

If a "real weapon model and textures" pass is ever wanted, that is the glTF + meshopt + KTX2 route
already costed in `CHARACTER-3D.md` §4 — 1–3 MB, lazy-loadable after the title screen.

## 4. Game-design cost: the interesting part

Three shapes, in increasing order of how much they touch progression:

**A. Sandbox range (fun, zero progression risk).** A sealed test-range room with target crates;
knock them over, stack them, score the hits. Touches no puzzle, no socket, no save. Cheapest to
build, easiest to delete, and the natural *first* slice because it proves the feel before anything
depends on it.

**B. Diegetic "pneumatic parts launcher" (recommended).** Shoot **carryable parts** instead of
bullets: aim, charge, fire, the part arcs, bounces, and can be captured by a socket it lands in.
This turns shooting into a *second input modality for a mechanic the game already has* — parts,
sockets, and the LMG's validation are all built, and the "am I aiming right?" question now has a
physics answer. It is on-theme (GEARWRIGHT is a machinery game), gives the ballistic drop and
restitution real meaning, and does not need enemies to be fun.

**C. Combat (not recommended).** Enemies, damage, health. That needs an AI, a damage model, death
and respawn rules, and a save/hazard story — a project-sized addition to a game whose pillars are
determinism and recovery, and the one that contradicts §3 most directly.

## 5. Non-negotiables if this gets built

1. **Progression safety.** A bolt may move *loose* props; it must never attach, detach, validate or
   complete a puzzle except by handing the part to the system that already owns that job (the snap
   pipeline). No writing into `game-state/` from anything a projectile touches, or the LMG's
   authority (the core architectural bet) is gone.
2. **Determinism.** Fixed-step, distance-based sweeps, no `Math.random()`; the harness and the
   headless suite must be able to replay a shot exactly.
3. **Flagged while it is unproven.** A URL flag (like `?shoulder=0` and the planned `?rig=1`) keeps
   the shipped puzzle experience untouched until the feature earns its place.
4. **Budget discipline.** Pool, cap, and assert the count in the harness (`renderer.info`) so
   "just for fun" cannot quietly cost frames.

## 6. Recommendation

Build **A first, on top of the B mechanics**: a flagged range that fires *parts* (so the projectile
system, the sweep, the restitution and the socket capture are all exercised), then decide whether
the launcher becomes a real ability once it feels right. Estimated shape of the work: one pure
`ProjectileSystem` + tests, a port addition for prop impulses, a pooled renderer path, a HUD
charge/aim readout, and one harness scenario. No new dependency, no assets, no loading cost — the
only real price is an ADR entry updating §3's "Combat out of scope" line to say exactly what is in
scope (a sandbox launcher) and what is not (enemies, damage, death).

## 7. What is being built (16/10/2026, owner-requested)

The owner asked for shooting with weapon switching, BGMI-style handling. §4 option **A** is what is
being built, on top of §4 option **B**'s mechanics: a **sandbox weapon range** over the level's own
carryables and targets — one `WeaponSystem` (L2 runtime), a `src/data/weapons.ts` table (six
weapons, one per class), deterministic spread/recoil *patterns*, magazines, two reload durations,
fire modes, ADS, and pooled **simulated** bullets (travel time + drop, swept per step). This narrows
§3's "Combat out of scope" to *no enemies, damage, health or death*; it does not admit them.

**A bullet reports a hit on a loose part but does not move it.** Pushing parts is a
`ManipulationSystem` capability (§20.1), and adding force to a pose already owned by another system
is exactly the change this pass refuses to make blind — the impact event (`WeaponImpact`: point,
normal, volume id) is the seam a later impulse pass plugs into. Non-negotiable §5.1 holds as
written: nothing a bullet touches may attach, detach, validate or complete anything.
