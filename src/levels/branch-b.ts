/**
 * LEVEL — Branch B "Thermal Line" placement (ARCH §6 expansion path, §40 `levels/`).
 *
 * Branch B is the ARCH §6 scalability claim made real: a second branch added by
 * content alone — a `BranchDefinition`, puzzle/reward data, a door anchor and a hub
 * stage (all of which already existed) — with **no core system change**. The room,
 * its machines and its parts are placed here exactly as Branch A's are, and the
 * composition root consumes the exports at the bottom of this file with no new code
 * path.
 *
 * The room sits behind the hub's north wall (the Branch B door at x = 0). Its south
 * wall *is* the hall's north wall, which `levels/game-room.ts` now leaves open at the
 * doorway; everything else (floor, west/east walls, north wall) is authored here.
 *
 * B1's placement keeps Branch A's split: definitions in `data/`, placement here. Poses
 * are canonical anchors — once a component is attached, the socket's pose is what it
 * adopts (§21.3) — so these numbers are read by presentation and physics, never by
 * validation (§24.3).
 */

import {
  BOILER_DEF,
  componentDefinitionOf,
  MANIFOLD_DEF,
  OUTLET_DEF,
  SHUT_OFF_VALVE_DEF,
  VALVE_DEF
} from '../data/components.ts';
import { B1_FLOW_A_DEF, B1_FLOW_B_DEF } from '../data/sockets.ts';
import type { Attachment } from '../game-state/machine-graph.ts';
import type { Pose, SocketInstance } from '../game-state/component-model.ts';
import type { ComponentInstance } from '../game-state/component-registry.ts';
import type { CarryableBinding } from '../gameplay/manipulation-system.ts';
import type { Interactable } from '../gameplay/interaction-system.ts';
import type { StaticCollider } from '../ports/physics-port.ts';
import type { LabWorldMesh } from '../ports/render-port.ts';
import type { PlacedWorld } from './lab-world.ts';

/* --- Small level helpers (the same shapes `levels/branch-a.ts` uses) -------- */

interface Anchor {
  readonly id: string;
  readonly pose: Pose;
}

function poseAt(x: number, y: number, z: number, yaw = 0): Pose {
  return { center: { x, y, z }, yaw };
}

function anchorLookup(anchors: ReadonlyArray<Anchor>, label: string) {
  return (anchorId: string): Pose => {
    const anchor = anchors.find((entry) => entry.id === anchorId);
    if (!anchor) throw new Error(`Unknown ${label} anchor: ${anchorId}`);
    return { center: { ...anchor.pose.center }, yaw: anchor.pose.yaw };
  };
}

function componentMesh(
  pose: Pose,
  halfExtents: { readonly x: number; readonly y: number; readonly z: number },
  color: number
): LabWorldMesh {
  return {
    kind: 'box',
    min: { x: pose.center.x - halfExtents.x, y: pose.center.y - halfExtents.y, z: pose.center.z - halfExtents.z },
    max: { x: pose.center.x + halfExtents.x, y: pose.center.y + halfExtents.y, z: pose.center.z + halfExtents.z },
    color
  };
}

interface StructureBox {
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
  readonly color: number;
  readonly solid: boolean;
}

function structureColliders(boxes: ReadonlyArray<StructureBox>): StaticCollider[] {
  return boxes
    .filter((box) => box.solid)
    .map((box) => ({
      min: { x: box.min[0], y: box.min[1], z: box.min[2] },
      max: { x: box.max[0], y: box.max[1], z: box.max[2] }
    }));
}

function structureMeshes(boxes: ReadonlyArray<StructureBox>): LabWorldMesh[] {
  return boxes.map((box) => ({
    kind: 'box' as const,
    min: { x: box.min[0], y: box.min[1], z: box.min[2] },
    max: { x: box.max[0], y: box.max[1], z: box.max[2] },
    color: box.color
  }));
}

function interactablesOf(bindings: ReadonlyArray<CarryableBinding>): Interactable[] {
  return bindings.map((binding): Interactable => {
    const center = binding.spawn.center;
    const half = binding.definition.halfExtents;
    return {
      id: binding.instanceId,
      kind: 'loose',
      min: { x: center.x - half.x, y: center.y - half.y, z: center.z - half.z },
      max: { x: center.x + half.x, y: center.y + half.y, z: center.z + half.z },
      enabled: true,
      verb: 'Grab'
    };
  });
}

function carryablesOf(
  parts: ReadonlyArray<ComponentInstance>,
  poseOf: (anchorId: string) => Pose
): CarryableBinding[] {
  return parts.map((instance) => {
    const definition = componentDefinitionOf(instance.defId);
    if (definition === null) throw new Error(`Unknown component definition: ${instance.defId}`);
    return { instanceId: instance.id, definition, spawn: poseOf(instance.spawnAnchorId) };
  });
}

/* --- The Steam Works room (behind the hub's north wall) -------------------- */

const ROOM_FLOOR = 0x3a3f45;
const ROOM_WALL = 0x33343a;
const THERMAL_IRON = 0x6f7b86;
const THERMAL_BOILER = 0xc06a4a;
const THERMAL_OUTLET = 0xd2a04f;

const ROOM_BOXES: ReadonlyArray<StructureBox> = [
  // Floor: 16 x 1 x 14, top surface at y = 0, meeting the hall's floor at z = 20.
  { min: [-8, -1, 20], max: [8, 0, 34], color: ROOM_FLOOR, solid: true },
  // West and east walls.
  { min: [-9, 0, 20], max: [-8, 4, 34], color: ROOM_WALL, solid: true },
  { min: [8, 0, 20], max: [9, 4, 34], color: ROOM_WALL, solid: true },
  // North wall.
  { min: [-9, 0, 33], max: [9, 4, 34], color: ROOM_WALL, solid: true }
];

/* --- B1 "Feedwater" -------------------------------------------------------- */

export const B1_ANCHORS: ReadonlyArray<Anchor> = [
  { id: 'anchor/b1-boiler', pose: poseAt(-3, 1.1, 28) },
  { id: 'anchor/b1-header', pose: poseAt(0, 0.3, 26.5) },
  { id: 'anchor/b1-outlet', pose: poseAt(3, 0.9, 28) },
  // The two feedwater ports sit on the header, a little in front of the machines.
  { id: 'anchor/b1-flow-a', pose: poseAt(-0.6, 0.8, 26.5) },
  { id: 'anchor/b1-flow-b', pose: poseAt(0.6, 0.8, 26.5) },
  // Loose valves wait on the floor between the doorway and the header.
  { id: 'anchor/b1-valve-1', pose: poseAt(-1.2, 0.12, 24.6) },
  { id: 'anchor/b1-valve-2', pose: poseAt(0, 0.12, 24.6) },
  { id: 'anchor/b1-shutoff', pose: poseAt(1.2, 0.12, 24.6) }
];

export const b1AnchorPose = anchorLookup(B1_ANCHORS, 'B1');

/** The pressure source, the header the ports are bolted to, and the outlet. */
export const B1_FIXED: ReadonlyArray<ComponentInstance> = [
  { id: 'b1-boiler', defId: BOILER_DEF.id, kind: 'fixed', spawnAnchorId: 'anchor/b1-boiler', flags: {} },
  { id: 'b1-header', defId: MANIFOLD_DEF.id, kind: 'fixed', spawnAnchorId: 'anchor/b1-header', flags: {} },
  { id: 'b1-outlet', defId: OUTLET_DEF.id, kind: 'fixed', spawnAnchorId: 'anchor/b1-outlet', flags: {} }
];

/**
 * Two serviceable valves (both required) and one shut-off near-miss. The shut-off
 * valve is the branch's negative case in B1's own idiom: it fits a feedwater port,
 * carries the same tags, and conducts nothing — so the *pressure* predicate is what
 * catches it, not a compatibility check.
 */
export const B1_LOOSE_PARTS: ReadonlyArray<ComponentInstance> = [
  { id: 'valve-b1-1', defId: VALVE_DEF.id, kind: 'carryable', spawnAnchorId: 'anchor/b1-valve-1', flags: { required: 'B1', unique: true } },
  { id: 'valve-b1-2', defId: VALVE_DEF.id, kind: 'carryable', spawnAnchorId: 'anchor/b1-valve-2', flags: { required: 'B1', unique: true } },
  { id: 'shutoff-b1', defId: SHUT_OFF_VALVE_DEF.id, kind: 'carryable', spawnAnchorId: 'anchor/b1-shutoff', flags: { unique: true } }
];

export const B1_COMPONENTS: ReadonlyArray<ComponentInstance> = [...B1_FIXED, ...B1_LOOSE_PARTS];

export const B1_CARRYABLES: ReadonlyArray<CarryableBinding> = carryablesOf(B1_LOOSE_PARTS, b1AnchorPose);

export const B1_SOCKETS: ReadonlyArray<SocketInstance> = [
  { id: 'socket-b1-flow-a', defId: B1_FLOW_A_DEF.id, pose: b1AnchorPose('anchor/b1-flow-a'), halfExtents: { x: 0.35, y: 0.35, z: 0.35 } },
  { id: 'socket-b1-flow-b', defId: B1_FLOW_B_DEF.id, pose: b1AnchorPose('anchor/b1-flow-b'), halfExtents: { x: 0.35, y: 0.35, z: 0.35 } }
];

/** Boiler plinth and outlet stand (solid); the header sits flush on the floor. */
const B1_BOXES: ReadonlyArray<StructureBox> = [
  { min: [-3.6, 0, 27.4], max: [-2.4, 0.5, 28.6], color: THERMAL_IRON, solid: true },
  { min: [2.4, 0, 27.4], max: [3.6, 0.6, 28.6], color: THERMAL_IRON, solid: true }
];

export const B1_WORLD: PlacedWorld = {
  colliders: [...structureColliders(ROOM_BOXES), ...structureColliders(B1_BOXES)],
  meshes: [
    ...structureMeshes(ROOM_BOXES),
    ...structureMeshes(B1_BOXES),
    componentMesh(b1AnchorPose('anchor/b1-boiler'), BOILER_DEF.halfExtents, THERMAL_BOILER),
    componentMesh(b1AnchorPose('anchor/b1-header'), MANIFOLD_DEF.halfExtents, THERMAL_IRON),
    componentMesh(b1AnchorPose('anchor/b1-outlet'), OUTLET_DEF.halfExtents, THERMAL_OUTLET)
  ]
};

export const B1_INTERACTABLES: ReadonlyArray<Interactable> = interactablesOf(B1_CARRYABLES);

/** B1 starts with nothing plumbed in: the outlet unpowered, the header empty. */
export const B1_INITIAL_ATTACHMENTS: ReadonlyArray<Attachment> = [];

/* --- Branch B, assembled --------------------------------------------------- */

export const BRANCH_B_COMPONENTS: ReadonlyArray<ComponentInstance> = [...B1_COMPONENTS];

export const BRANCH_B_SOCKETS: ReadonlyArray<SocketInstance> = [...B1_SOCKETS];

export const BRANCH_B_CARRYABLES: ReadonlyArray<CarryableBinding> = [...B1_CARRYABLES];

export const BRANCH_B_INTERACTABLES: ReadonlyArray<Interactable> = [...B1_INTERACTABLES];

export const BRANCH_B_INITIAL_ATTACHMENTS: ReadonlyArray<Attachment> = [...B1_INITIAL_ATTACHMENTS];

export const BRANCH_B_WORLD: PlacedWorld = {
  colliders: [...B1_WORLD.colliders],
  meshes: [...B1_WORLD.meshes]
};
