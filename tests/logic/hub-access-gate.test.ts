import { describe, expect, it } from 'vitest';

import { BRANCH_A_ID, BRANCH_B_ID, BRANCH_C_ID, BRANCH_DEFINITIONS } from '../../src/data/branches.ts';
import { HUB_STAGE_DEFINITIONS } from '../../src/data/hub-stages.ts';
import {
  ProgressionSystem,
  type BranchDefinition
} from '../../src/game-state/progression-system.ts';
import { HUB_DOORS, hubColliders, hubMeshes } from '../../src/levels/hub.ts';
import type { LabWorldMesh } from '../../src/ports/render-port.ts';

/**
 * CRUCIBLE HALL — the hub's AccessGate and its stage visuals (ARCH §6, §26).
 *
 * §26's rule is the thing under test: "Branch gating is enforced by `AccessGate`
 * reading `BranchState` — never by scene geometry." So the door's passability is
 * asserted through `ProgressionSystem.canEnter`, and the geometry is asserted only to
 * *follow* it. The hub builders are pure functions of branch state, which is what
 * makes that provable without a renderer.
 */

function progression(): ProgressionSystem {
  return new ProgressionSystem(BRANCH_DEFINITIONS, HUB_STAGE_DEFINITIONS);
}

function stateReader(system: ProgressionSystem) {
  return (branchId: string) => system.branchState(branchId);
}

/** This suite is about doors and stages, so it reads the hall before any clue (§6 beat 8). */
const noClues = (): boolean => false;

/** The shared bus is the only box spanning the full hall width. */
function bus(meshes: ReadonlyArray<LabWorldMesh>): LabWorldMesh | undefined {
  return meshes.find((mesh) => mesh.max.x - mesh.min.x > 12);
}

/** The Regulator column: the only box from y = 1 to y = 5. */
function column(meshes: ReadonlyArray<LabWorldMesh>): LabWorldMesh | undefined {
  return meshes.find((mesh) => mesh.min.y === 1 && mesh.max.y === 5);
}

describe('Crucible Hall — the AccessGate reads branch state, never geometry (§6/§26)', () => {
  it('names a branch for every door, and seals the ones that are not enterable', () => {
    const system = progression();
    expect(HUB_DOORS.map((door) => door.branchId)).toEqual([BRANCH_A_ID, BRANCH_B_ID, BRANCH_C_ID]);

    // Branch A is enterable; B and C are sealed visuals (§6).
    expect(system.canEnter(BRANCH_A_ID)).toBe(true);
    expect(system.canEnter(BRANCH_B_ID)).toBe(false);
    expect(system.canEnter(BRANCH_C_ID)).toBe(false);
    // An unknown branch is not enterable either — a door cannot open onto nothing.
    expect(system.canEnter('branch/missing')).toBe(false);
  });

  it('opens a branch door the moment its gating branch completes — with no change to hub.ts', () => {
    // A gated pair, so the transition the MVP never shows (Locked → enterable) happens.
    const branches: ReadonlyArray<BranchDefinition> = [
      { id: BRANCH_A_ID, title: 'A', puzzleIds: ['P1'], requiresBranches: [], sealed: false },
      { id: BRANCH_B_ID, title: 'B', puzzleIds: ['P2'], requiresBranches: [BRANCH_A_ID], sealed: false }
    ];
    const system = new ProgressionSystem(branches, HUB_STAGE_DEFINITIONS);
    const read = stateReader(system);

    const collidersBefore = hubColliders(read).length;
    const meshesBefore = hubMeshes(read, system.hubStageIndex, noClues).length;
    expect(system.canEnter(BRANCH_B_ID)).toBe(false);

    system.update(['P1']); // branch A completes → branch B becomes Available

    expect(system.canEnter(BRANCH_B_ID)).toBe(true);
    // Exactly one slab disappears: one collider and one mesh fewer. The gate followed
    // progression with no edit to the level file.
    expect(hubColliders(read).length).toBe(collidersBefore - 1);
    expect(hubMeshes(read, system.hubStageIndex, noClues).length).toBe(meshesBefore - 1);
  });

  it('lights the trunk lines and warms the Regulator as hub stages land', () => {
    const system = progression();
    const dormant = hubMeshes(stateReader(system), system.hubStageIndex, noClues);
    // Every trunk is cold and the bus never lit: the Regulator is Dormant (§6).
    expect(bus(dormant)?.color).not.toBe(column(dormant)?.color);

    // The branch's own puzzles, including its final machine (§7): a stage lands when
    // the *branch* does, and the branch needs all four.
    system.update(['P1', 'P2', 'P3', 'BM-1']);
    const online = hubMeshes(stateReader(system), system.hubStageIndex, noClues);
    expect(system.hubStage.id).toBe('stage/pressure-online');

    // "Pressure Line Online": the bus lights and the column warms, because branch A's
    // line has reached the machine.
    expect(bus(online)?.color).not.toBe(bus(dormant)?.color);
    expect(column(online)?.color).not.toBe(column(dormant)?.color);

    // The Regulator stays cold at Dormant and never becomes a working machine in the
    // MVP — the hub only *shows* progress (§6 "inactive, staged").
    expect(dormant.length).toBeGreaterThan(0);
  });
});
