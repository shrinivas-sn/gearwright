import { describe, expect, it } from 'vitest';

import { BRANCH_A_ID, BRANCH_B_ID, BRANCH_C_ID, BRANCH_DEFINITIONS } from '../../src/data/branches.ts';
import { CLUE_DEFINITIONS, CLUE_REGULATOR_PLATE } from '../../src/data/clues.ts';
import { HUB_STAGE_DEFINITIONS } from '../../src/data/hub-stages.ts';
import { ProgressionSystem } from '../../src/game-state/progression-system.ts';
import { HUB_DOORS, hubMeshes } from '../../src/levels/hub.ts';
import type { LabWorldMesh } from '../../src/ports/render-port.ts';

/**
 * The M9 walkthrough's *colour facts*, pinned (PROJECT_STATE "Human Check Needed").
 *
 * CHK-11.1 verified every non-visual item of the M4/M6/M9 walkthroughs in a real
 * browser and deliberately left "the colours" to a human eye — but the colours the
 * walkthrough names (red slabs, gold trunk/bus, warming column, plate
 * dark → gold → teal) are **pure data**: `hubMeshes` is a documented pure function
 * of progression state, and `ThreeRenderer.setLabWorld` applies `mesh.color` to the
 * material verbatim (no tint, no light-dependent recomputation of the authored
 * value). So the facts an eye would confirm are facts about this data, and a suite
 * can pin them exactly the way `scanner-overlay` pins its timing.
 *
 * What still genuinely needs an eye is everything *downstream* of these values:
 * tone mapping (ACES filmic) and lighting change how #8a3b2f *looks* without
 * changing that it is authored — that judgement stays with the walkthrough. What
 * can no longer silently regress is the state→colour mapping itself.
 *
 * The hex literals here ARE the walkthrough's facts. If a deliberate aesthetic pass
 * re-authors a colour in `levels/hub.ts`, update the matching literal here in the
 * same commit — that is the review conversation, not a false alarm.
 */

const REGULATOR_DORMANT = 0x6f7b86;
const REGULATOR_WARMED = 0x6f9aa6; // stage 1: "Pressure Line Online"
const SEALED_RED = 0x8a3b2f;
const OPEN_TEAL = 0x5fb8a6;
const STONE = 0x4a5057;
const TRUNK_OFF = 0x3a3f45;
const TRUNK_GOLD = 0xd2b04f;
const PLATE_DORMANT = 0x2f3439;
const PLATE_AWAKE_GOLD = 0xb08a4a;
const PLATE_READ_TEAL = 0x5fb8a6;

function progression(): ProgressionSystem {
  return new ProgressionSystem(BRANCH_DEFINITIONS, HUB_STAGE_DEFINITIONS);
}

function stateReader(system: ProgressionSystem) {
  return (branchId: string) => system.branchState(branchId);
}

/** Boxes spanning z 19.45–19.65, 2 m wide, full door height: only slabs match. */
function slabs(meshes: ReadonlyArray<LabWorldMesh>, doorX: number): LabWorldMesh[] {
  return meshes.filter(
    (mesh) =>
      Math.abs(mesh.max.x - mesh.min.x - 2) < 1e-9 &&
      mesh.min.y === 0 &&
      mesh.max.y === 3.2 &&
      mesh.min.z > 19.4 &&
      mesh.min.z < 19.5 &&
      mesh.max.z > 19.6 &&
      mesh.max.z < 19.7 &&
      mesh.min.x > doorX - 1.05 &&
      mesh.max.x < doorX + 1.05
  );
}

/** Door posts at a door's x (0.2 m wide, full height, in front of the north wall). */
function doorPosts(meshes: ReadonlyArray<LabWorldMesh>, doorX: number): LabWorldMesh[] {
  return meshes.filter(
    (mesh) =>
      Math.abs(mesh.max.x - mesh.min.x - 0.2) < 1e-9 &&
      mesh.min.y === 0 &&
      mesh.max.y === 3.2 &&
      Math.abs((mesh.min.x + mesh.max.x) / 2 - (doorX - 1.1)) < 1e-9 ||
      (Math.abs(mesh.max.x - mesh.min.x - 0.2) < 1e-9 &&
        mesh.min.y === 0 &&
        mesh.max.y === 3.2 &&
        Math.abs((mesh.min.x + mesh.max.x) / 2 - (doorX + 1.1)) < 1e-9)
  );
}

/** A branch's trunk line: the 0.3 m-wide box at y 2.6–2.9 reaching its door. */
function trunk(meshes: ReadonlyArray<LabWorldMesh>, doorX: number): LabWorldMesh | undefined {
  return meshes.find(
    (mesh) =>
      Math.abs(mesh.max.x - mesh.min.x - 0.3) < 1e-9 &&
      mesh.min.y === 2.6 &&
      mesh.max.y === 2.9 &&
      Math.abs((mesh.min.x + mesh.max.x) / 2 - doorX) < 1e-9 &&
      mesh.min.z >= 8
  );
}

/** The shared bus: the only trunk-height box spanning the hall. */
function bus(meshes: ReadonlyArray<LabWorldMesh>): LabWorldMesh | undefined {
  return meshes.find((mesh) => mesh.min.y === 2.6 && mesh.max.y === 2.9 && mesh.max.x - mesh.min.x > 12);
}

/** The Regulator column: the only box from y = 1 to y = 5. */
function column(meshes: ReadonlyArray<LabWorldMesh>): LabWorldMesh | undefined {
  return meshes.find((mesh) => mesh.min.y === 1 && mesh.max.y === 5);
}

/** The clue plate: 1.2 m wide, y 2.0–2.55, flush on the column's front plane (z = 15). */
function plate(meshes: ReadonlyArray<LabWorldMesh>): LabWorldMesh | undefined {
  return meshes.find(
    (mesh) =>
      Math.abs(mesh.max.x - mesh.min.x - 1.2) < 1e-9 &&
      mesh.min.y === 2 &&
      Math.abs(mesh.max.y - 2.55) < 1e-9 &&
      Math.abs(mesh.max.z - 15) < 1e-9
  );
}

describe('Crucible Hall — the walkthrough colour facts, as data (§6, §26)', () => {
  it('a fresh game: sealed doors are red, the open doorway has no slab, everything else is cold', () => {
    const system = progression();
    const meshes = hubMeshes(stateReader(system), system.hubStageIndex, () => false);

    // Walkthrough step 2: B and C are red slabs; A is an open doorway (no slab).
    expect(slabs(meshes, HUB_DOORS[1]!.x)).toHaveLength(1);
    expect(slabs(meshes, HUB_DOORS[2]!.x)).toHaveLength(1);
    expect(slabs(meshes, HUB_DOORS[0]!.x)).toHaveLength(0);
    expect(slabs(meshes, HUB_DOORS[1]!.x)[0]!.color).toBe(SEALED_RED);
    expect(slabs(meshes, HUB_DOORS[2]!.x)[0]!.color).toBe(SEALED_RED);

    // The open door's posts are lit teal; the sealed ones stay stone. (Each door
    // has exactly two posts — the count is asserted so this cannot pass vacuously.)
    expect(doorPosts(meshes, HUB_DOORS[0]!.x)).toHaveLength(2);
    expect(doorPosts(meshes, HUB_DOORS[1]!.x)).toHaveLength(2);
    expect(doorPosts(meshes, HUB_DOORS[2]!.x)).toHaveLength(2);
    for (const post of doorPosts(meshes, HUB_DOORS[0]!.x)) expect(post.color).toBe(OPEN_TEAL);
    for (const post of doorPosts(meshes, HUB_DOORS[1]!.x)) expect(post.color).toBe(STONE);
    for (const post of doorPosts(meshes, HUB_DOORS[2]!.x)) expect(post.color).toBe(STONE);

    // Dormant hall: every trunk and the bus cold, the column cold.
    for (const door of HUB_DOORS) expect(trunk(meshes, door.x)?.color).toBe(TRUNK_OFF);
    expect(bus(meshes)?.color).toBe(TRUNK_OFF);
    expect(column(meshes)?.color).toBe(REGULATOR_DORMANT);
  });

  it('the plate on the column is dark while Branch A is incomplete (walkthrough step 3)', () => {
    const system = progression();
    const meshes = hubMeshes(stateReader(system), system.hubStageIndex, () => false);

    expect(CLUE_DEFINITIONS).toHaveLength(1); // the walkthrough names exactly one plate
    expect(plate(meshes)?.color).toBe(PLATE_DORMANT);
    expect(system.hasClue(CLUE_REGULATOR_PLATE)).toBe(false);
  });

  it('completing Branch A: slabs stay for B/C, the A trunk and bus light gold, the column warms, the plate goes gold', () => {
    const system = progression();
    // Branch A is P1–P3 **and its final machine** (§7/OQ-3): the branch, the hub stage
    // and the clue all land when the dynamo runs, which is §6 beats 6–8 in order.
    system.update(['P1', 'P2', 'P3', 'BM-1']);
    expect(system.hubStage.id).toBe('stage/pressure-online');

    const meshes = hubMeshes(stateReader(system), system.hubStageIndex, (id) => system.hasClue(id));

    // The slabs that remain are exactly the sealed branches' — and still red.
    expect(slabs(meshes, HUB_DOORS[0]!.x)).toHaveLength(0);
    expect(slabs(meshes, HUB_DOORS[1]!.x)[0]!.color).toBe(SEALED_RED);
    expect(slabs(meshes, HUB_DOORS[2]!.x)[0]!.color).toBe(SEALED_RED);

    // Walkthrough step 4: trunk lines/bus gold with the Regulator column warming.
    expect(trunk(meshes, HUB_DOORS[0]!.x)?.color).toBe(TRUNK_GOLD);
    expect(trunk(meshes, HUB_DOORS[1]!.x)?.color).toBe(TRUNK_OFF);
    expect(trunk(meshes, HUB_DOORS[2]!.x)?.color).toBe(TRUNK_OFF);
    expect(bus(meshes)?.color).toBe(TRUNK_GOLD);
    expect(column(meshes)?.color).toBe(REGULATOR_WARMED);
    expect(system.branchState(BRANCH_A_ID)).toBe('Complete');
    expect(system.branchState(BRANCH_B_ID)).toBe('Locked');
    expect(system.branchState(BRANCH_C_ID)).toBe('Locked');
  });

  it('the plate lifecycle is dark → gold → teal, driven by discovery alone (walkthrough steps 4–5)', () => {
    const system = progression();
    system.update(['P1', 'P2', 'P3', 'BM-1']);
    const read = stateReader(system);

    // Awake and unread: gold.
    const awake = hubMeshes(read, system.hubStageIndex, (id) => system.hasClue(id));
    expect(plate(awake)?.color).toBe(PLATE_AWAKE_GOLD);

    // Walkthrough step 5: focusing the plate discovers the clue — and the plate
    // turns teal because `hasClue` says so, not because anything moved.
    expect(system.discoverClue(CLUE_REGULATOR_PLATE)).toBe(true);
    const readState = hubMeshes(read, system.hubStageIndex, (id) => system.hasClue(id));
    expect(plate(readState)?.color).toBe(PLATE_READ_TEAL);

    // The read state is the clue set, nothing else: the same geometry, one colour.
    expect(plate(readState)).toEqual({ ...plate(awake)!, color: PLATE_READ_TEAL });
  });
});
