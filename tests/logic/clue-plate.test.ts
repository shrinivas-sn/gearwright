import { describe, expect, it } from 'vitest';

import { BRANCH_A_ID, branchDefinitionOf } from '../../src/data/branches.ts';
import { CLUE_DEFINITIONS, CLUE_REGULATOR_PLATE, clueDefinitionOf } from '../../src/data/clues.ts';
import { HUB_STAGE_DEFINITIONS } from '../../src/data/hub-stages.ts';
import { ProgressionSystem } from '../../src/game-state/progression-system.ts';
import {
  HUB_DOORS,
  cluePlateActive,
  hubColliders,
  hubInteractables,
  hubMeshes
} from '../../src/levels/hub.ts';
import { KinematicPhysics } from '../../src/adapters/kinematic-physics.ts';
import { DEFAULT_INTERACTION_TUNING, InteractionSystem } from '../../src/gameplay/interaction-system.ts';
import type { LabWorldMesh } from '../../src/ports/render-port.ts';

/**
 * THE CENTRAL-MACHINE CLUE (ARCH §6 beats 5/8, §12.2, §26).
 *
 * §6's beat 5 is "a clue plate on the Great Regulator activates (story beat, no
 * dialogue)" and beat 8 is the branch's "central-machine clue". Both are true *because
 * of progression*, not because of geometry: the plate's activation is the same derived
 * branch state the doors read, and the discovery is the same seen-id set §12.2 makes
 * canonical. This file pins the three things that could silently drift apart — the
 * content, the plate's activation and the plate's readability — plus the placement
 * arithmetic that makes the plate actually reachable, which no other test can see.
 */

function progression(): ProgressionSystem {
  return new ProgressionSystem(
    [{ id: BRANCH_A_ID, title: 'Pressure Gallery', puzzleIds: ['P1', 'P2', 'P3'], requiresBranches: [], sealed: false }],
    HUB_STAGE_DEFINITIONS
  );
}

function stateReader(system: ProgressionSystem) {
  return (branchId: string) => system.branchState(branchId);
}

/** The clue plate: the only box sitting inside the Regulator column's front face. */
function plate(meshes: ReadonlyArray<LabWorldMesh>): LabWorldMesh | undefined {
  return meshes.find((mesh) => mesh.min.z > 14 && mesh.max.z < 15.1 && mesh.max.y < 3.5);
}

function plateOf(system: ProgressionSystem, discovered: ReadonlyArray<string> = []): LabWorldMesh | undefined {
  return plate(
    hubMeshes(stateReader(system), system.hubStageIndex, (clueId) => discovered.includes(clueId))
  );
}

describe('clue content — a clue knows the branch that reveals it (§6 beats 5/8)', () => {
  it('names a real branch, and the hub ships exactly one plate per clue', () => {
    for (const clue of CLUE_DEFINITIONS) {
      // Content that names a branch nothing defines could never activate.
      expect(branchDefinitionOf(clue.branchId)).not.toBeNull();
      expect(clue.text.length).toBeGreaterThan(0);
    }

    const plates = hubInteractables(() => 'Available');
    expect(plates.map((target) => target.id).sort()).toEqual(CLUE_DEFINITIONS.map((clue) => clue.id).sort());
    // §694 "clue plates — mostly read-only interactables": a plate is a prop, so it can
    // never outrank a part in a ray (§18 priority) and never offers a grab.
    for (const target of plates) {
      expect(target.kind).toBe('prop');
      expect(target.verb).toBe('Inspect');
      expect(target.min.x).toBeLessThan(target.max.x);
      expect(target.min.y).toBeLessThan(target.max.y);
      expect(target.min.z).toBeLessThan(target.max.z);
    }
  });

  it('resolves a clue by id, and never invents one', () => {
    expect(clueDefinitionOf(CLUE_REGULATOR_PLATE)?.branchId).toBe(BRANCH_A_ID);
    expect(clueDefinitionOf('clue/not-authored')).toBeNull();
    // An unknown id is never active, whatever the branch state says.
    expect(cluePlateActive(() => 'Complete', 'clue/not-authored')).toBe(false);
  });
});

describe('the plate wakes with its branch, and reports being read (§6 beats 5/8)', () => {
  it('is dormant — inert and unreadable — until Branch A completes', () => {
    const system = progression();
    const read = stateReader(system);

    expect(cluePlateActive(read, CLUE_REGULATOR_PLATE)).toBe(false);
    expect(hubInteractables(read).every((target) => !target.enabled)).toBe(true);

    const dormant = plateOf(system);
    expect(dormant).toBeDefined();

    // Partial progress is not completion: P2 alone must not light the plate.
    system.update(['P1', 'P2']);
    expect(cluePlateActive(read, CLUE_REGULATOR_PLATE)).toBe(false);

    system.update(['P1', 'P2', 'P3']);
    expect(cluePlateActive(read, CLUE_REGULATOR_PLATE)).toBe(true);
    expect(hubInteractables(read).every((target) => target.enabled)).toBe(true);

    // The plate changed appearance with the branch completing — no level edit anywhere.
    expect(plateOf(system)?.color).not.toBe(dormant?.color);
  });

  it('changes again once its clue has been read, without moving', () => {
    const system = progression();
    system.update(['P1', 'P2', 'P3']);

    const awake = plateOf(system);
    const read = plateOf(system, [CLUE_REGULATOR_PLATE]);
    expect(read?.color).not.toBe(awake?.color);
    // Reading a clue is a fact about progression, not about geometry: the plate stays
    // exactly where it is, so nothing the player learned moves under them.
    expect(read?.min).toEqual(awake?.min);
    expect(read?.max).toEqual(awake?.max);

    // An unrelated clue id must not make this plate look read.
    expect(plateOf(system, ['clue/somewhere-else'])?.color).toBe(awake?.color);
  });

  it('leaves the plate reachable: presentation only, no collider, inside interaction reach', () => {
    const system = progression();
    const box = plateOf(system);
    expect(box).toBeDefined();
    if (!box) return;

    // Nothing blocks the ray to the plate's front face…
    const frontCentre = {
      x: (box.min.x + box.max.x) / 2,
      y: (box.min.y + box.max.y) / 2,
      z: box.min.z
    };
    const colliders = hubColliders(stateReader(system));
    for (const collider of colliders) {
      const contains =
        frontCentre.x > collider.min.x &&
        frontCentre.x < collider.max.x &&
        frontCentre.y > collider.min.y &&
        frontCentre.y < collider.max.y &&
        frontCentre.z > collider.min.z &&
        frontCentre.z < collider.max.z;
      expect(contains).toBe(false);
    }

    // …and the interaction reach (§18 `interactRange` = 3 m, measured from the player,
    // who the plinth holds at z ≈ 13.7) covers it with room to spare. This is the
    // arithmetic the placement was chosen with; if either number moves, this fails
    // rather than the plate becoming silently unreadable in the browser.
    const playerZ = 14 - 0.32; // plinth front face minus the player capsule radius
    const reach = Math.hypot(frontCentre.y, frontCentre.z - playerZ);
    expect(reach).toBeLessThan(DEFAULT_INTERACTION_TUNING.range);
  });

  it('is actually readable through the shipped colliders (§18 box-blocked rule)', () => {
    const system = progression();
    system.update(['P1', 'P2', 'P3']);
    const read = stateReader(system);

    // The placement test above is a *point* test; §18's real gate is that an
    // interactable whose whole box overlaps a static collider is never focusable.
    // The plate is flush on the Regulator column, so an interaction volume that grew
    // "proud in every direction" would cross into that collider and hide the clue —
    // silently, with nothing else about the plate looking wrong. This is the check
    // the point test cannot make, run against the real physics and the real system.
    const physics = new KinematicPhysics();
    physics.setStaticColliders(hubColliders(read));
    const target = hubInteractables(read).find((item) => item.id === CLUE_REGULATOR_PLATE);
    expect(target).toBeDefined();
    if (!target) return;
    expect(physics.isBoxBlocked(target.min, target.max)).toBe(false);

    // And the vantage the placement arithmetic assumes really does focus it: the
    // plinth holds the player at z ≈ 13.7, and the follow rig sits behind and slightly
    // below the head (yaw π, default pitch, 4.2 m arm), so the ray rises to the plate.
    // `stableSteps` frames of the same target acquire it (§18 stability gate).
    const interaction = new InteractionSystem(physics, hubInteractables(read));
    const camera = {
      anchor: { x: 0, y: 0.01, z: 13.5 },
      eye: { x: 0, y: 0.09, z: 9.51 },
      target: { x: 0, y: 1.41, z: 13.5 }
    };
    for (let index = 0; index < DEFAULT_INTERACTION_TUNING.stableSteps; index += 1) {
      interaction.update(camera);
    }
    expect(interaction.focus?.id).toBe(CLUE_REGULATOR_PLATE);
  });

  it('is content about progress, never a condition on it (§26)', () => {
    const system = progression();
    system.update(['P1', 'P2', 'P3']);
    const read = stateReader(system);
    const collidersBefore = hubColliders(read).length;
    const targetsBefore = hubInteractables(read).map((target) => target.id);

    expect(system.discoverClue(CLUE_REGULATOR_PLATE)).toBe(true);

    // Both builders take branch state and nothing else, so having read the clue cannot
    // change what the hall blocks or what can be focused: a one-off read is never a
    // trap that closes the target or opens a door. The plate stays an `Inspect` target
    // (the clue is *recorded* there — nothing reads it back out again).
    expect(hubColliders(read).length).toBe(collidersBefore);
    expect(hubInteractables(read).map((target) => target.id)).toEqual(targetsBefore);
    expect(HUB_DOORS.every((door) => typeof door.branchId === 'string')).toBe(true);
    expect(system.canEnter(BRANCH_A_ID)).toBe(true);
  });

  it('records the clue through the SM that owns it, and it persists (§12.2)', () => {
    const system = progression();
    expect(system.discoverClue(CLUE_REGULATOR_PLATE)).toBe(true);
    // Idempotent: re-reading a plate cannot grant the same clue twice.
    expect(system.discoverClue(CLUE_REGULATOR_PLATE)).toBe(false);
    expect(system.discoveredClueIds).toEqual([CLUE_REGULATOR_PLATE]);
    // The seen-id set is progression's only canonical field (the codec round-trip and
    // its validation are covered in `progression-system.test.ts`).
    system.restoreClues([]);
    expect(system.hasClue(CLUE_REGULATOR_PLATE)).toBe(false);
  });
});
