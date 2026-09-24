import { describe, expect, it } from 'vitest';

import { BRANCH_A_ID, BRANCH_DEFINITIONS } from '../../src/data/branches.ts';
import { COMPONENT_DEFINITIONS } from '../../src/data/components.ts';
import { HUB_STAGE_DEFINITIONS } from '../../src/data/hub-stages.ts';
import { MACHINE_DEFINITIONS } from '../../src/data/machines.ts';
import { PUZZLE_DEFINITIONS } from '../../src/data/puzzles/index.ts';
import { REWARD_DEFINITIONS } from '../../src/data/rewards.ts';
import { SOCKET_DEFINITIONS } from '../../src/data/sockets.ts';
import { ComponentRegistry } from '../../src/game-state/component-registry.ts';
import { ProgressionSystem } from '../../src/game-state/progression-system.ts';
import {
  SHIPPED_CARRYABLES,
  SHIPPED_COMPONENTS,
  SHIPPED_INTERACTABLES,
  SHIPPED_SOCKETS,
  SHIPPED_WORLD
} from '../../src/levels/shipped-content.ts';
import { BRANCH_A_INTERACTABLES } from '../../src/levels/branch-a.ts';
import { KinematicPhysics } from '../../src/adapters/kinematic-physics.ts';
import { vec3 } from '../../src/core/vec3.ts';
import { DEFAULT_PLAYER_TUNING } from '../../src/gameplay/player-controller.ts';
import { hubColliders } from '../../src/levels/hub.ts';
import type { BranchState } from '../../src/game-state/progression-system.ts';

/**
 * SHIPPED CONTENT INTEGRITY — "assembled" is not the same as "reachable".
 *
 * Every system suite is green while a *link* between them is missing, because each
 * suite hands its system the content it needs. The composition root is where the links
 * actually happen, and the failure mode is silent: content that is placed, machined,
 * rewarded and rendered, but that belongs to no branch. `ProgressionSystem`
 * `initialPuzzleState` answers `Locked` for a puzzle no branch owns, and a gated SM
 * never evaluates (§25) — so the machine runs, the props light, and the puzzle can
 * never complete. BM-1 "Pressure Dynamo" shipped that way: the MVP's capstone was
 * uncompletable, with a green suite and a running machine.
 *
 * These assertions run against the **shipped data the composition root assembles** (the
 * same modules `main.ts` imports), never a fixture, so adding a puzzle without wiring it
 * into a branch — or a branch without its content, a puzzle without its reward, a
 * required part that is not placed — fails here instead of shipping.
 */

/** The same bundle `main.ts` builds: placed components from both level files. */
function shippedRegistry(): ComponentRegistry {
  return new ComponentRegistry(COMPONENT_DEFINITIONS, [...SHIPPED_COMPONENTS]);
}

function shippedProgression(): ProgressionSystem {
  return new ProgressionSystem(BRANCH_DEFINITIONS, HUB_STAGE_DEFINITIONS);
}

describe('shipped content — every puzzle is reachable (§6, §7, §25, §26)', () => {
  it('gives every shipped puzzle a branch, so none is born Locked', () => {
    const progression = shippedProgression();
    expect(PUZZLE_DEFINITIONS.length).toBeGreaterThan(0);

    for (const definition of PUZZLE_DEFINITIONS) {
      // A puzzle with no branch is one the player can stand in and never finish: the
      // §25 gating states do not evaluate, so `Locked` is permanent (nothing in the
      // composition calls `unlock()` — there is no door to walk through).
      expect(progression.branchOf(definition.id), `${definition.id} belongs to no branch`).not.toBeNull();
      expect(progression.initialPuzzleState(definition.id), `${definition.id} starts gated`).not.toBe(
        'Locked'
      );
    }
  });

  it('completes Branch A only when its final machine has run (§6 beats 5–8)', () => {
    const progression = shippedProgression();

    // P1, P2 and P3 are the branch's teaching and open-ended machines; BM-1 is the
    // branch's *final* machine. Its activation is beat 6, so the reward/access beat and
    // the central-machine clue (beat 8) come after it — not before.
    progression.update(['P1', 'P2', 'P3']);
    expect(progression.branchState(BRANCH_A_ID)).toBe('InProgress');
    expect(progression.hubStage.id).toBe('stage/dormant');

    progression.update(['P1', 'P2', 'P3', 'BM-1']);
    expect(progression.branchState(BRANCH_A_ID)).toBe('Complete');
    expect(progression.hubStage.id).toBe('stage/pressure-online');
  });

  it('defines a reward for every shipped puzzle milestone, and every milestone only once', () => {
    const milestoneIds = REWARD_DEFINITIONS.map((definition) => definition.id);

    for (const definition of PUZZLE_DEFINITIONS) {
      expect(milestoneIds, `${definition.id} has no reward`).toContain(definition.milestoneId);
    }
    expect(new Set(milestoneIds).size).toBe(milestoneIds.length);
  });

  it('defines the machine every shipped puzzle activates on', () => {
    const machineIds = MACHINE_DEFINITIONS.map((machine) => machine.id);

    for (const definition of PUZZLE_DEFINITIONS) {
      // The activation table is closed (`machineRunning` is the only rule), so a puzzle
      // whose machine id is not defined can never leave `Validated`.
      expect(machineIds, `${definition.id} names an undefined machine`).toContain(
        definition.activation.machineId
      );
    }
  });

  it('places every part the puzzles require, and defines every placed socket', () => {
    const socketDefinitionIds = SOCKET_DEFINITIONS.map((definition) => definition.id);
    for (const socket of [...SHIPPED_SOCKETS]) {
      expect(
        socketDefinitionIds,
        `${socket.id} references unknown socket definition ${socket.defId}`
      ).toContain(socket.defId);
    }

    const registry = shippedRegistry();
    const requiredIds = registry.all
      .filter((instance) => instance.flags.required !== undefined)
      .map((instance) => instance.id);
    expect(requiredIds.length).toBeGreaterThan(0);

    // EC-GEN-01 as the composition root runs it: unknown definitions and unplaced
    // required parts are reported, never repaired — so they must be empty here.
    expect(registry.checkIntegrity(requiredIds)).toEqual([]);

    // The same `required` flag is what the HUD's "parts needed" counter reads, and it
    // must name a puzzle that exists (§27.3).
    const puzzleIds = PUZZLE_DEFINITIONS.map((definition) => definition.id);
    for (const instance of registry.all) {
      const requiredBy = instance.flags.required;
      if (requiredBy === undefined) continue;
      expect(puzzleIds, `${instance.id} is required by unknown puzzle ${requiredBy}`).toContain(
        requiredBy
      );
    }
  });

  it('gives every carryable an interaction target, so no part is scenery', () => {
    // Grab is a focus action (§19's Exploration → Grab), so a carryable the interaction
    // layer does not know is a part the player can see, walk into, and never pick up.
    // BM-1's four loose parts shipped exactly that way: registered, posed, drawn and
    // carried by the SM, but absent from `BRANCH_A_INTERACTABLES` — which made the
    // branch's capstone machine unassemblable no matter how it was gated.
    const targets = new Set(
      [...SHIPPED_INTERACTABLES].map((item) => item.id)
    );

    for (const binding of [...SHIPPED_CARRYABLES]) {
      expect(targets, `${binding.instanceId} is carryable but has no interaction target`).toContain(
        binding.instanceId
      );
    }
  });

  it('names real placed content behind every interaction target, in a real box', () => {
    const componentIds = shippedRegistry().all.map((instance) => instance.id);
    const socketIds = [...SHIPPED_SOCKETS].map((socket) => socket.id);

    // Branch targets are all part-derived, so each one must name a placed component.
    // (The lab's `crate-far` / `crate-locked` are the M2 *demonstration* targets for the
    // range filter and the disabled filter — deliberately not components, which is why
    // only the socket and box rules below apply to the lab set.)
    for (const item of BRANCH_A_INTERACTABLES) {
      if (item.kind === 'prop' || item.kind === 'scanner') continue;
      expect(componentIds, `no component for branch target ${item.id}`).toContain(item.id);
    }

    for (const item of [...SHIPPED_INTERACTABLES]) {
      if (item.kind === 'socket') {
        expect(socketIds, `no placed socket for target ${item.id}`).toContain(item.socketId ?? item.id);
      }
      // The §18 volume must be a real box: an inverted or flat one can never be hit.
      expect(item.max.x, `${item.id} width`).toBeGreaterThan(item.min.x);
      expect(item.max.y, `${item.id} height`).toBeGreaterThan(item.min.y);
      expect(item.max.z, `${item.id} depth`).toBeGreaterThan(item.min.z);
    }
  });

  it('names real content from every branch and every hub stage', () => {
    const puzzleIds = PUZZLE_DEFINITIONS.map((definition) => definition.id);
    for (const branch of BRANCH_DEFINITIONS) {
      for (const puzzleId of branch.puzzleIds) {
        expect(puzzleIds, `${branch.id} names unknown puzzle ${puzzleId}`).toContain(puzzleId);
      }
      for (const required of branch.requiresBranches) {
        expect(
          BRANCH_DEFINITIONS.map((entry) => entry.id),
          `${branch.id} requires unknown branch ${required}`
        ).toContain(required);
      }
    }

    for (const stage of HUB_STAGE_DEFINITIONS) {
      for (const required of stage.requiresBranches) {
        expect(
          BRANCH_DEFINITIONS.map((entry) => entry.id),
          `${stage.id} requires unknown branch ${required}`
        ).toContain(required);
      }
    }
  });
});

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
