/**
 * LAB WORLD — one authored dataset feeding several consumers (ARCH §40).
 *
 *  - physics: `PHYSICS_COLLIDERS` (static AABBs handed to `KinematicPhysics`)
 *  - render:  `LAB_WORLD_MESHES` (`LabWorldMesh[]` handed to the port's
 *             `setLabWorld`) — boxes to stand on and walls to slide along,
 *             nothing decorative beyond the identity the branch needs later.
 *  - gameplay: `LAB_INTERACTABLES` (focus targets), `LAB_CARRYABLE` (the M3 test
 *             object) and `LAB_SOCKETS` (the M4 dock placement).
 *
 * Ground plane at y=0 (walkable), four walls, two step blocks (0.2 m and the
 * 0.35 m step-height limit), one taller block that must report a wall. Spawn sits
 * in the middle of the floor with clear headroom everywhere.
 *
 * Component *identity* lives in `data/` (definitions); this file places instances
 * and derives the boxes it hands to physics/render from those definitions, so a
 * component's footprint is authored exactly once.
 */

import { CRATE_DEF } from '../data/components.ts';
import { DOCK_A_DEF } from '../data/sockets.ts';
import type { SocketInstance } from '../game-state/component-model.ts';
import type { ComponentInstance } from '../game-state/component-registry.ts';
import type { Interactable } from '../gameplay/interaction-system.ts';
import type { CarryableBinding } from '../gameplay/manipulation-system.ts';
import type { StaticCollider } from '../ports/physics-port.ts';
import type { LabWorldMesh } from '../ports/render-port.ts';

/** Colliders + render meshes for one placed piece of a level (shared by level files). */
export interface PlacedWorld {
  readonly colliders: ReadonlyArray<StaticCollider>;
  readonly meshes: ReadonlyArray<LabWorldMesh>;
}

export interface LabWorldDefinition extends PlacedWorld {
  readonly spawn: { readonly x: number; readonly y: number; readonly z: number };
}

interface BoxSpec {
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
  readonly color: number;
}

const LAB_FLOOR = 0x3a3f45;
const LAB_WALL = 0x2a2e33;
const LAB_STEP = 0x8b939c;
const LAB_TALL = 0xd2604f;
const LAB_INTERACT = 0x5fb8a6;

const BOXES: ReadonlyArray<BoxSpec> = [
  // Floor: 40 x 1 x 40, top surface at y = 0.
  { min: [-20, -1, -20], max: [20, 0, 20], color: LAB_FLOOR },
  // Walls: 1 m thick, 4 m tall, just outside the floor so the floor edge is a cliff.
  { min: [-21, 0, -21], max: [21, 4, -20], color: LAB_WALL },
  { min: [-21, 0, 20], max: [21, 4, 21], color: LAB_WALL },
  { min: [-21, 0, -20], max: [-20, 4, 20], color: LAB_WALL },
  { min: [20, 0, -20], max: [21, 4, 20], color: LAB_WALL },
  // Low step (easy): 0.2 m tall block.
  { min: [3, 0, -2], max: [5, 0.2, 2], color: LAB_STEP },
  // Limit step (hard): exactly the 0.35 m step-height limit.
  { min: [-5, 0, -2], max: [-3, 0.35, 2], color: LAB_STEP },
  // Tall block: must be a wall, never a step.
  { min: [-1.5, 0, 6], max: [1.5, 1.5, 9], color: LAB_TALL }
];

const SPAWN = { x: 0, y: 0.01, z: -6 } as const;

/** Where the crate starts: 1 m ahead of spawn (forward is -Z). */
const CRATE_SPAWN = { center: { x: 0, y: 0.4, z: -7 }, yaw: 0 } as const;

/** The M3/M4 carryable instance: identity from `data/`, placement from here. */
export const LAB_CARRYABLE: CarryableBinding = {
  instanceId: 'crate-a',
  definition: CRATE_DEF,
  spawn: { center: { ...CRATE_SPAWN.center }, yaw: CRATE_SPAWN.yaw }
};

/**
 * The crate as a *registered* instance (M6). The L1 content bundle lists every
 * placed component, so integrity checking and tag lookups cover the lab props too;
 * its placement stays in `LAB_CARRYABLE.spawn` (one source, read by both).
 */
export const LAB_COMPONENTS: ReadonlyArray<ComponentInstance> = [
  {
    id: LAB_CARRYABLE.instanceId,
    defId: LAB_CARRYABLE.definition.id,
    kind: 'carryable',
    spawnAnchorId: 'anchor/lab-crate',
    flags: {}
  }
];

/** The dock the crate must be carried to (its definition is in `data/sockets.ts`). */
export const LAB_SOCKETS: ReadonlyArray<SocketInstance> = [
  {
    id: 'socket-a',
    defId: DOCK_A_DEF.id,
    pose: { center: { x: 3, y: 0.7, z: -2 }, yaw: 0 },
    // Detection volume: forgiving enough to dock without pixel-hunting, tight
    // enough that the dock marker reads as one place (ARCH §21.2).
    halfExtents: { x: 0.5, y: 0.4, z: 0.5 }
  }
];

function boxAround(
  center: { readonly x: number; readonly y: number; readonly z: number },
  halfExtents: { readonly x: number; readonly y: number; readonly z: number }
): { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } } {
  return {
    min: { x: center.x - halfExtents.x, y: center.y - halfExtents.y, z: center.z - halfExtents.z },
    max: { x: center.x + halfExtents.x, y: center.y + halfExtents.y, z: center.z + halfExtents.z }
  };
}

const CRATE_BOX = boxAround(CRATE_SPAWN.center, CRATE_DEF.halfExtents);

/**
 * Interaction targets (ARCH §18). Targets are data, not colliders: the player can
 * pass through them; they exist so the interaction ray has something to rank,
 * filter (range/LOS/disabled) and highlight.
 */
export const LAB_INTERACTABLES: ReadonlyArray<Interactable> = [
  // Ahead of spawn: the everyday focus target and the carryable. Its box derives
  // from the L1 definition plus the spawn anchor, so the two can never drift.
  {
    id: LAB_CARRYABLE.instanceId,
    kind: 'loose',
    min: CRATE_BOX.min,
    max: CRATE_BOX.max,
    enabled: true,
    verb: 'Grab',
    // A carried object is not an inspect target (ARCH §18 context filter). While
    // attached it is disabled outright — the detach path is M5.
    contexts: ['Exploration']
  },
  // A dock out past the low step: reachable on foot, never from spawn.
  { id: 'socket-a', kind: 'socket', min: { x: 2.6, y: 0.35, z: -2.4 }, max: { x: 3.4, y: 1.05, z: -1.6 }, enabled: true, verb: 'Insert', socketId: 'socket-a' },
  // Far away: range filter demonstration.
  { id: 'crate-far', kind: 'loose', min: { x: 6, y: 0, z: 6 }, max: { x: 7, y: 1, z: 7 }, enabled: true, verb: 'Inspect' },
  // Disabled: must never produce a prompt.
  { id: 'crate-locked', kind: 'loose', min: { x: -0.4, y: 0, z: -4.4 }, max: { x: 0.4, y: 0.8, z: -3.6 }, enabled: false, verb: 'Inspect' }
];

export const LAB_WORLD: LabWorldDefinition = {
  colliders: BOXES.map((box) => ({
    min: { x: box.min[0], y: box.min[1], z: box.min[2] },
    max: { x: box.max[0], y: box.max[1], z: box.max[2] }
  })),
  meshes: [
    ...BOXES.map((box) => ({
      kind: 'box' as const,
      min: { x: box.min[0], y: box.min[1], z: box.min[2] },
      max: { x: box.max[0], y: box.max[1], z: box.max[2] },
      color: box.color
    })),
    // Interactable props are rendered from the same authored data (visual only).
    // Carryables are excluded: they are presented from their live poses instead
    // (`RenderPort.setCarryables`), so each is drawn once, where it actually is.
    ...LAB_INTERACTABLES.filter((item) => item.id !== LAB_CARRYABLE.instanceId).map((item) => ({
      kind: 'box' as const,
      min: { x: item.min.x, y: item.min.y, z: item.min.z },
      max: { x: item.max.x, y: item.max.y, z: item.max.z },
      color: LAB_INTERACT
    }))
  ],
  spawn: SPAWN
};
