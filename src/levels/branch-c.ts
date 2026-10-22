/**
 * LEVEL — Branch C "Great Crucible" placement (ARCH §6 expansion path, §40 `levels/`).
 *
 * Branch C is the third instance of the same claim Branch B proved: a branch is **content** —
 * a `BranchDefinition`, puzzle/reward data, a door anchor and a hub stage (all of which
 * already existed) — with **no core system change**. The room, its machines and its parts are
 * placed here exactly as Branches A and B place theirs, and the composition root consumes the
 * exports at the bottom of this file with no new code path.
 *
 * The room sits behind the hall's north wall, **east of the Steam Works**: x 9–24,
 * z 20–34. Its west wall *is* the Thermal Line's east wall (`levels/branch-b.ts`), its south
 * wall *is* the hall's north wall, which `levels/game-room.ts` now leaves open at the
 * Crucible's doorway (x = 12), and everything else (floor, east wall, north wall) is authored
 * here. B and C therefore share a wall but never a room, and neither branch's door opens into
 * the other's floor.
 *
 * The room holds the branch's whole curve, read left-to-right from the doorway: C1's tuyere
 * line on the west, C3's slag header on the east, C2's quench bay in the middle-west and
 * CM-3's machine line at the north end with its control panel in front.
 *
 * Poses are canonical anchors — once a component is attached, the socket's pose is what it
 * adopts (§21.3) — so these numbers are read by presentation and physics, never by validation
 * (§24.3).
 */

import {
  BLANKING_PLATE_DEF,
  BOILER_DEF,
  componentDefinitionOf,
  CRUCIBLE_VESSEL_DEF,
  GEAR_DEF,
  IDLER_GEAR_DEF,
  MANIFOLD_DEF,
  OUTLET_DEF,
  SHAFT_DEF,
  SHUT_OFF_VALVE_DEF,
  VALVE_DEF
} from '../data/components.ts';
import {
  C1_FLOW_A_DEF,
  C1_FLOW_B_DEF,
  C2_DRIVE_MOUNT_DEF,
  C2_FEED_A_DEF,
  C2_FEED_B_DEF,
  C3_ROUTE_A_DEF,
  C3_ROUTE_B_DEF,
  C3_ROUTE_C_DEF,
  CM3_DRIVE_MOUNT_DEF,
  CM3_FEED_PORT_DEF
} from '../data/sockets.ts';
import type { Attachment } from '../game-state/machine-graph.ts';
import type { Pose, SocketInstance } from '../game-state/component-model.ts';
import type { ComponentInstance } from '../game-state/component-registry.ts';
import type { CarryableBinding } from '../gameplay/manipulation-system.ts';
import type { Interactable } from '../gameplay/interaction-system.ts';
import type { StaticCollider } from '../ports/physics-port.ts';
import type { LabWorldMesh } from '../ports/render-port.ts';
import type { PlacedWorld } from './lab-world.ts';

/* --- Small level helpers (the same shapes `levels/branch-b.ts` uses) -------- */

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

/* --- The Crucible room (behind the hall's north wall, east of the Steam Works) --- */

const ROOM_FLOOR = 0x3a3f45;
const ROOM_WALL = 0x2f343a;
const CRUCIBLE_IRON = 0x707a84;
const CRUCIBLE_BOILER = 0xb8563c;
const CRUCIBLE_FIRE = 0xd2763f;
const CRUCIBLE_CAST = 0x8d949c;

/**
 * Floor, east and north walls. The west wall is the Thermal Line's east wall and the south
 * wall is the hall's north wall (both authored where they already were), so this room adds
 * only what is genuinely new.
 */
const ROOM_BOXES: ReadonlyArray<StructureBox> = [
  { min: [9, -1, 20], max: [24, 0, 34], color: ROOM_FLOOR, solid: true },
  { min: [24, 0, 20], max: [25, 4, 34], color: ROOM_WALL, solid: true },
  { min: [9, 0, 33], max: [25, 4, 34], color: ROOM_WALL, solid: true }
];

/* --- C1 "Tuyere" ------------------------------------------------------------ */

/**
 * C1 sits just inside the doorway on the west side (z = 23.5): the furnace against the
 * Steam Works' east wall, the header the two blast ports are bolted to, and the tuyere at the
 * far end. Its loose parts wait between the doorway and the header, where the player walks.
 */
export const C1_ANCHORS: ReadonlyArray<Anchor> = [
  { id: 'anchor/c1-boiler', pose: poseAt(10.0, 1.1, 23.5) },
  { id: 'anchor/c1-header', pose: poseAt(12.3, 0.3, 23.5) },
  { id: 'anchor/c1-tuyere', pose: poseAt(14.9, 0.9, 23.5) },
  // The two blast ports sit on the header, a little apart so one held valve can only reach one.
  { id: 'anchor/c1-flow-a', pose: poseAt(11.7, 0.8, 23.5) },
  { id: 'anchor/c1-flow-b', pose: poseAt(12.9, 0.8, 23.5) },
  // Two serviceable valves (the ceiling trap needs both) and the shut-off near-miss.
  { id: 'anchor/c1-valve-1', pose: poseAt(10.0, 0.12, 22.2) },
  { id: 'anchor/c1-valve-2', pose: poseAt(11.2, 0.12, 22.2) },
  { id: 'anchor/c1-shutoff', pose: poseAt(12.4, 0.12, 22.2) }
];

export const c1AnchorPose = anchorLookup(C1_ANCHORS, 'C1');

/** The pressure source, the header the ports are bolted to, and the tuyere. */
export const C1_FIXED: ReadonlyArray<ComponentInstance> = [
  { id: 'c1-boiler', defId: BOILER_DEF.id, kind: 'fixed', spawnAnchorId: 'anchor/c1-boiler', flags: {} },
  { id: 'c1-header', defId: MANIFOLD_DEF.id, kind: 'fixed', spawnAnchorId: 'anchor/c1-header', flags: {} },
  { id: 'c1-tuyere', defId: OUTLET_DEF.id, kind: 'fixed', spawnAnchorId: 'anchor/c1-tuyere', flags: {} }
];

/**
 * Both open valves are `required`: the entry lesson is precisely that the player has a second
 * feed available and must choose not to use it, and a lesson that depends on a part being
 * present cannot survive that part being optional. The shut-off valve is the decoy.
 */
export const C1_LOOSE_PARTS: ReadonlyArray<ComponentInstance> = [
  { id: 'valve-c1-1', defId: VALVE_DEF.id, kind: 'carryable', spawnAnchorId: 'anchor/c1-valve-1', flags: { required: 'C1', unique: true } },
  { id: 'valve-c1-2', defId: VALVE_DEF.id, kind: 'carryable', spawnAnchorId: 'anchor/c1-valve-2', flags: { required: 'C1', unique: true } },
  { id: 'shutoff-c1', defId: SHUT_OFF_VALVE_DEF.id, kind: 'carryable', spawnAnchorId: 'anchor/c1-shutoff', flags: { unique: true } }
];

export const C1_COMPONENTS: ReadonlyArray<ComponentInstance> = [...C1_FIXED, ...C1_LOOSE_PARTS];

export const C1_CARRYABLES: ReadonlyArray<CarryableBinding> = carryablesOf(C1_LOOSE_PARTS, c1AnchorPose);

export const C1_SOCKETS: ReadonlyArray<SocketInstance> = [
  { id: 'socket-c1-flow-a', defId: C1_FLOW_A_DEF.id, pose: c1AnchorPose('anchor/c1-flow-a'), halfExtents: { x: 0.4, y: 0.4, z: 0.4 } },
  { id: 'socket-c1-flow-b', defId: C1_FLOW_B_DEF.id, pose: c1AnchorPose('anchor/c1-flow-b'), halfExtents: { x: 0.4, y: 0.4, z: 0.4 } }
];

/** Boiler plinth and tuyere post (solid); the header sits flush on the floor. */
const C1_BOXES: ReadonlyArray<StructureBox> = [
  { min: [9.5, 0, 23.0], max: [10.5, 0.5, 24.0], color: CRUCIBLE_IRON, solid: true },
  { min: [14.4, 0, 23.0], max: [15.4, 0.6, 24.0], color: CRUCIBLE_IRON, solid: true }
];

export const C1_WORLD: PlacedWorld = {
  colliders: [...structureColliders(ROOM_BOXES), ...structureColliders(C1_BOXES)],
  meshes: [
    ...structureMeshes(ROOM_BOXES),
    ...structureMeshes(C1_BOXES),
    componentMesh(c1AnchorPose('anchor/c1-boiler'), BOILER_DEF.halfExtents, CRUCIBLE_BOILER),
    componentMesh(c1AnchorPose('anchor/c1-header'), MANIFOLD_DEF.halfExtents, CRUCIBLE_IRON),
    componentMesh(c1AnchorPose('anchor/c1-tuyere'), OUTLET_DEF.halfExtents, CRUCIBLE_FIRE)
  ]
};

export const C1_INTERACTABLES: ReadonlyArray<Interactable> = interactablesOf(C1_CARRYABLES);

/** C1 starts with nothing plumbed in: the tuyere cold, the header empty. */
export const C1_INITIAL_ATTACHMENTS: ReadonlyArray<Attachment> = [];

/* --- C3 "Slag Run" ---------------------------------------------------------- */

/**
 * C3 stands in the room's east bay (z = 24.8), the mirror of the Steam Works' B2/B3 bays:
 * the furnace against the east wall, the three-port header in front of it, and the two
 * consumers (casting floor and quench tank) on the west side of the header — the side the
 * player approaches from, so both output posts are readable at a glance.
 */
export const C3_ANCHORS: ReadonlyArray<Anchor> = [
  { id: 'anchor/c3-boiler', pose: poseAt(19.8, 1.1, 24.8) },
  { id: 'anchor/c3-header', pose: poseAt(16.8, 0.3, 24.8) },
  { id: 'anchor/c3-out-cast', pose: poseAt(14.2, 0.9, 23.2) },
  { id: 'anchor/c3-out-quench', pose: poseAt(14.2, 0.9, 26.4) },
  // The three route ports, spread along the header's own line (x), in the valve positions.
  { id: 'anchor/c3-route-a', pose: poseAt(15.9, 0.8, 24.8) },
  { id: 'anchor/c3-route-c', pose: poseAt(16.8, 0.8, 24.8) },
  { id: 'anchor/c3-route-b', pose: poseAt(17.7, 0.8, 24.8) },
  // Three serviceable valves (two builds need two) and the shut-off near-miss.
  { id: 'anchor/c3-valve-1', pose: poseAt(15.8, 0.12, 22.9) },
  { id: 'anchor/c3-valve-2', pose: poseAt(17.0, 0.12, 22.9) },
  { id: 'anchor/c3-valve-3', pose: poseAt(18.2, 0.12, 22.9) },
  { id: 'anchor/c3-shutoff', pose: poseAt(16.4, 0.12, 23.9) }
];

export const c3AnchorPose = anchorLookup(C3_ANCHORS, 'C3');

/** The pressure source, the header the three ports are bolted to, and the two consumers. */
export const C3_FIXED: ReadonlyArray<ComponentInstance> = [
  { id: 'c3-boiler', defId: BOILER_DEF.id, kind: 'fixed', spawnAnchorId: 'anchor/c3-boiler', flags: {} },
  { id: 'c3-header', defId: MANIFOLD_DEF.id, kind: 'fixed', spawnAnchorId: 'anchor/c3-header', flags: {} },
  { id: 'c3-out-cast', defId: OUTLET_DEF.id, kind: 'fixed', spawnAnchorId: 'anchor/c3-out-cast', flags: {} },
  { id: 'c3-out-quench', defId: OUTLET_DEF.id, kind: 'fixed', spawnAnchorId: 'anchor/c3-out-quench', flags: {} }
];

/** All three serviceable valves and the shut-off are `required`, the rule P3, B2 and B3 follow. */
export const C3_LOOSE_PARTS: ReadonlyArray<ComponentInstance> = [
  { id: 'valve-c3-1', defId: VALVE_DEF.id, kind: 'carryable', spawnAnchorId: 'anchor/c3-valve-1', flags: { required: 'C3', unique: true } },
  { id: 'valve-c3-2', defId: VALVE_DEF.id, kind: 'carryable', spawnAnchorId: 'anchor/c3-valve-2', flags: { required: 'C3', unique: true } },
  { id: 'valve-c3-3', defId: VALVE_DEF.id, kind: 'carryable', spawnAnchorId: 'anchor/c3-valve-3', flags: { required: 'C3', unique: true } },
  { id: 'shutoff-c3', defId: SHUT_OFF_VALVE_DEF.id, kind: 'carryable', spawnAnchorId: 'anchor/c3-shutoff', flags: { required: 'C3', unique: true } }
];

export const C3_COMPONENTS: ReadonlyArray<ComponentInstance> = [...C3_FIXED, ...C3_LOOSE_PARTS];

export const C3_CARRYABLES: ReadonlyArray<CarryableBinding> = carryablesOf(C3_LOOSE_PARTS, c3AnchorPose);

export const C3_SOCKETS: ReadonlyArray<SocketInstance> = [
  { id: 'socket-c3-route-a', defId: C3_ROUTE_A_DEF.id, pose: c3AnchorPose('anchor/c3-route-a'), halfExtents: { x: 0.4, y: 0.4, z: 0.4 } },
  { id: 'socket-c3-route-b', defId: C3_ROUTE_B_DEF.id, pose: c3AnchorPose('anchor/c3-route-b'), halfExtents: { x: 0.4, y: 0.4, z: 0.4 } },
  { id: 'socket-c3-route-c', defId: C3_ROUTE_C_DEF.id, pose: c3AnchorPose('anchor/c3-route-c'), halfExtents: { x: 0.4, y: 0.4, z: 0.4 } }
];

const C3_CAST_COLOR = 0xb9c0c7;
const C3_QUENCH_COLOR = 0x5fb8a6;

/** Boiler plinth and the two consumer posts (solid); the header sits flush on the floor. */
const C3_BOXES: ReadonlyArray<StructureBox> = [
  { min: [19.3, 0, 24.3], max: [20.3, 0.5, 25.3], color: CRUCIBLE_IRON, solid: true },
  { min: [13.9, 0, 22.9], max: [14.5, 0.5, 23.5], color: CRUCIBLE_IRON, solid: true },
  { min: [13.9, 0, 26.1], max: [14.5, 0.5, 26.7], color: CRUCIBLE_IRON, solid: true }
];

export const C3_WORLD: PlacedWorld = {
  colliders: structureColliders(C3_BOXES),
  meshes: [
    ...structureMeshes(C3_BOXES),
    componentMesh(c3AnchorPose('anchor/c3-boiler'), BOILER_DEF.halfExtents, CRUCIBLE_BOILER),
    componentMesh(c3AnchorPose('anchor/c3-header'), MANIFOLD_DEF.halfExtents, CRUCIBLE_IRON),
    componentMesh(c3AnchorPose('anchor/c3-out-cast'), OUTLET_DEF.halfExtents, C3_CAST_COLOR),
    componentMesh(c3AnchorPose('anchor/c3-out-quench'), OUTLET_DEF.halfExtents, C3_QUENCH_COLOR)
  ]
};

export const C3_INTERACTABLES: ReadonlyArray<Interactable> = interactablesOf(C3_CARRYABLES);

/** C3 starts unplumbed: the header empty, both consumers cold. */
export const C3_INITIAL_ATTACHMENTS: ReadonlyArray<Attachment> = [];

/* --- C2 "Quench" ------------------------------------------------------------ */

/**
 * C2 is the room's middle-west bay (z ≈ 27.6), laid out like the Steam Works' B2: the drive
 * train runs west → east along z = 27.6 (crank, the drive mount, the vessel), and the quench
 * line runs south → north along x = 14.2 (gauge, the two feeds, the furnace). Two lines
 * meeting at one machine is the combining beat's whole read.
 *
 * The loose parts wait in the open floor south of the bay (z 25–26): the drive pair (plain
 * gear vs idler), the plate that fits and cannot bridge, and two serviceable valves plus the
 * shut-off — the ceiling trap needs both serviceable ones.
 */
const C2_DRIVE_Z = 27.6;

export const C2_ANCHORS: ReadonlyArray<Anchor> = [
  { id: 'anchor/c2-crank', pose: poseAt(10.2, 1.0, C2_DRIVE_Z) },
  { id: 'anchor/c2-drive', pose: poseAt(11.6, 1.0, C2_DRIVE_Z) },
  { id: 'anchor/c2-vessel', pose: poseAt(13.0, 1.0, C2_DRIVE_Z) },
  { id: 'anchor/c2-gauge', pose: poseAt(15.0, 0.9, 25.8) },
  { id: 'anchor/c2-boiler', pose: poseAt(15.0, 1.1, 29.0) },
  { id: 'anchor/c2-feed-a', pose: poseAt(14.2, 1.0, 26.7) },
  { id: 'anchor/c2-feed-b', pose: poseAt(14.2, 1.0, 28.1) },
  { id: 'anchor/c2-gear', pose: poseAt(10.6, 0.07, 26.0) },
  { id: 'anchor/c2-idler', pose: poseAt(11.6, 0.07, 26.0) },
  { id: 'anchor/c2-plate', pose: poseAt(12.6, 0.04, 26.0) },
  { id: 'anchor/c2-valve-1', pose: poseAt(10.9, 0.12, 25.0) },
  { id: 'anchor/c2-valve-2', pose: poseAt(11.9, 0.12, 25.0) },
  { id: 'anchor/c2-shutoff', pose: poseAt(12.9, 0.12, 25.0) }
];

export const c2AnchorPose = anchorLookup(C2_ANCHORS, 'C2');

/** The crank, the vessel it drives, the gauge and the furnace. */
export const C2_FIXED: ReadonlyArray<ComponentInstance> = [
  { id: 'c2-crank', defId: SHAFT_DEF.id, kind: 'fixed', spawnAnchorId: 'anchor/c2-crank', flags: {} },
  { id: 'c2-vessel', defId: CRUCIBLE_VESSEL_DEF.id, kind: 'fixed', spawnAnchorId: 'anchor/c2-vessel', flags: {} },
  { id: 'c2-gauge', defId: OUTLET_DEF.id, kind: 'fixed', spawnAnchorId: 'anchor/c2-gauge', flags: {} },
  { id: 'c2-boiler', defId: BOILER_DEF.id, kind: 'fixed', spawnAnchorId: 'anchor/c2-boiler', flags: {} }
];

/**
 * Every loose part is `required` — including the two decoys — because each one carries half of
 * the combining lesson: the gear/idler pair decides the sense, the plate fits and cannot
 * bridge, and the second serviceable valve is what makes the ceiling reachable at all.
 */
export const C2_LOOSE_PARTS: ReadonlyArray<ComponentInstance> = [
  { id: 'gear-c2', defId: GEAR_DEF.id, kind: 'carryable', spawnAnchorId: 'anchor/c2-gear', flags: { required: 'C2', unique: true } },
  { id: 'idler-c2', defId: IDLER_GEAR_DEF.id, kind: 'carryable', spawnAnchorId: 'anchor/c2-idler', flags: { required: 'C2', unique: true } },
  { id: 'plate-c2', defId: BLANKING_PLATE_DEF.id, kind: 'carryable', spawnAnchorId: 'anchor/c2-plate', flags: { required: 'C2', unique: true } },
  { id: 'valve-c2-1', defId: VALVE_DEF.id, kind: 'carryable', spawnAnchorId: 'anchor/c2-valve-1', flags: { required: 'C2', unique: true } },
  { id: 'valve-c2-2', defId: VALVE_DEF.id, kind: 'carryable', spawnAnchorId: 'anchor/c2-valve-2', flags: { required: 'C2', unique: true } },
  { id: 'shutoff-c2', defId: SHUT_OFF_VALVE_DEF.id, kind: 'carryable', spawnAnchorId: 'anchor/c2-shutoff', flags: { required: 'C2', unique: true } }
];

export const C2_COMPONENTS: ReadonlyArray<ComponentInstance> = [...C2_FIXED, ...C2_LOOSE_PARTS];

export const C2_CARRYABLES: ReadonlyArray<CarryableBinding> = carryablesOf(C2_LOOSE_PARTS, c2AnchorPose);

export const C2_SOCKETS: ReadonlyArray<SocketInstance> = [
  { id: 'socket-c2-drive', defId: C2_DRIVE_MOUNT_DEF.id, pose: c2AnchorPose('anchor/c2-drive'), halfExtents: { x: 0.4, y: 0.4, z: 0.4 } },
  { id: 'socket-c2-feed-a', defId: C2_FEED_A_DEF.id, pose: c2AnchorPose('anchor/c2-feed-a'), halfExtents: { x: 0.4, y: 0.4, z: 0.4 } },
  { id: 'socket-c2-feed-b', defId: C2_FEED_B_DEF.id, pose: c2AnchorPose('anchor/c2-feed-b'), halfExtents: { x: 0.4, y: 0.4, z: 0.4 } }
];

const C2_VESSEL_COLOR = 0xa8b0b8;

const C2_BOXES: ReadonlyArray<StructureBox> = [
  // Crank pedestal (solid), clear of the drive socket's volume.
  { min: [9.9, 0, 27.2], max: [10.5, 0.8, 28.0], color: CRUCIBLE_IRON, solid: true },
  // Vessel plinth (solid) — also the vessel's physical presence.
  { min: [12.4, 0, 27.0], max: [13.6, 0.5, 28.2], color: CRUCIBLE_IRON, solid: true },
  // Gauge post (solid).
  { min: [14.7, 0, 25.5], max: [15.3, 0.5, 26.1], color: CRUCIBLE_IRON, solid: true },
  // Furnace plinth (solid).
  { min: [14.5, 0, 28.5], max: [15.5, 0.5, 29.5], color: CRUCIBLE_IRON, solid: true }
];

export const C2_WORLD: PlacedWorld = {
  colliders: structureColliders(C2_BOXES),
  meshes: [
    ...structureMeshes(C2_BOXES),
    componentMesh(c2AnchorPose('anchor/c2-crank'), SHAFT_DEF.halfExtents, CRUCIBLE_CAST),
    componentMesh(c2AnchorPose('anchor/c2-vessel'), CRUCIBLE_VESSEL_DEF.halfExtents, C2_VESSEL_COLOR),
    componentMesh(c2AnchorPose('anchor/c2-gauge'), OUTLET_DEF.halfExtents, CRUCIBLE_FIRE),
    componentMesh(c2AnchorPose('anchor/c2-boiler'), BOILER_DEF.halfExtents, CRUCIBLE_BOILER)
  ]
};

export const C2_INTERACTABLES: ReadonlyArray<Interactable> = interactablesOf(C2_CARRYABLES);

/** C2 starts unassembled, like every other machine in the branch. */
export const C2_INITIAL_ATTACHMENTS: ReadonlyArray<Attachment> = [];

/* --- CM-3 "Great Crucible" -------------------------------------------------- */

/**
 * CM-3 stands at the north end of the Crucible (z = 32): the crank and its vessel on the
 * west, the casting outlet and the furnace on the east, and a control panel in front
 * (z = 30.6) carrying the four staged props.
 *
 * Its layout mirrors BM-1's and BM-2's deliberately — same mounting line, same
 * panel-in-front arrangement — because a third branch is supposed to prove the machinery
 * generalises. The props' ids *are* the staged action ids.
 */
const CM3_Z = 32;
const CM3_MACHINE_Y = 1.0;
const CM3_PROP_Y = 1.25;
const CM3_PANEL_Z = 30.6;

export const CM3_ANCHORS: ReadonlyArray<Anchor> = [
  { id: 'anchor/cm3-crank', pose: poseAt(13.6, CM3_MACHINE_Y, CM3_Z) },
  // The drive mount sits between the crank and the vessel, clear of both meshes.
  { id: 'anchor/cm3-drive', pose: poseAt(15.0, CM3_MACHINE_Y, CM3_Z) },
  { id: 'anchor/cm3-vessel', pose: poseAt(16.4, CM3_MACHINE_Y, CM3_Z) },
  { id: 'anchor/cm3-outlet', pose: poseAt(20.0, 0.9, CM3_Z) },
  // The feed port sits between the outlet and the furnace, clear of both meshes.
  { id: 'anchor/cm3-feed', pose: poseAt(21.0, CM3_MACHINE_Y, CM3_Z) },
  { id: 'anchor/cm3-boiler', pose: poseAt(22.0, 1.1, CM3_Z) },
  // Loose parts wait on the floor in front of the machine, east of the panel: the gear and
  // the pipe are the solutions, the plate and the shut-off are the two "fits, cannot bridge"
  // decoys (§21.4), and the idler is the direction near-miss the branch taught in C2.
  { id: 'anchor/cm3-gear', pose: poseAt(16.8, 0.07, 30.0) },
  { id: 'anchor/cm3-pipe', pose: poseAt(20.4, 0.12, 30.0) },
  { id: 'anchor/cm3-idler', pose: poseAt(17.7, 0.07, 30.0) },
  { id: 'anchor/cm3-plate', pose: poseAt(18.6, 0.04, 30.0) },
  { id: 'anchor/cm3-shutoff', pose: poseAt(21.4, 0.12, 30.0) }
];

export const cm3AnchorPose = anchorLookup(CM3_ANCHORS, 'CM-3');

/** The four fixed nodes: crank (rotation source), vessel, casting outlet and furnace. */
export const CM3_FIXED: ReadonlyArray<ComponentInstance> = [
  { id: 'cm3-crank', defId: SHAFT_DEF.id, kind: 'fixed', spawnAnchorId: 'anchor/cm3-crank', flags: {} },
  { id: 'cm3-vessel', defId: CRUCIBLE_VESSEL_DEF.id, kind: 'fixed', spawnAnchorId: 'anchor/cm3-vessel', flags: {} },
  { id: 'cm3-outlet', defId: OUTLET_DEF.id, kind: 'fixed', spawnAnchorId: 'anchor/cm3-outlet', flags: {} },
  { id: 'cm3-boiler', defId: BOILER_DEF.id, kind: 'fixed', spawnAnchorId: 'anchor/cm3-boiler', flags: {} }
];

/** The two halves of the assembly (required) and the three decoys (registered, not required). */
export const CM3_LOOSE_PARTS: ReadonlyArray<ComponentInstance> = [
  { id: 'gear-cm3', defId: GEAR_DEF.id, kind: 'carryable', spawnAnchorId: 'anchor/cm3-gear', flags: { required: 'CM-3', unique: true } },
  { id: 'valve-cm3', defId: VALVE_DEF.id, kind: 'carryable', spawnAnchorId: 'anchor/cm3-pipe', flags: { required: 'CM-3', unique: true } },
  { id: 'idler-cm3', defId: IDLER_GEAR_DEF.id, kind: 'carryable', spawnAnchorId: 'anchor/cm3-idler', flags: { unique: true } },
  { id: 'plate-cm3', defId: BLANKING_PLATE_DEF.id, kind: 'carryable', spawnAnchorId: 'anchor/cm3-plate', flags: { unique: true } },
  { id: 'shutoff-cm3', defId: SHUT_OFF_VALVE_DEF.id, kind: 'carryable', spawnAnchorId: 'anchor/cm3-shutoff', flags: { unique: true } }
];

export const CM3_COMPONENTS: ReadonlyArray<ComponentInstance> = [...CM3_FIXED, ...CM3_LOOSE_PARTS];

export const CM3_CARRYABLES: ReadonlyArray<CarryableBinding> = carryablesOf(CM3_LOOSE_PARTS, cm3AnchorPose);

/** The drive mount (west) and the feed port (east), each bridged by one part. */
export const CM3_SOCKETS: ReadonlyArray<SocketInstance> = [
  {
    id: 'socket-cm3-drive',
    defId: CM3_DRIVE_MOUNT_DEF.id,
    pose: cm3AnchorPose('anchor/cm3-drive'),
    halfExtents: { x: 0.4, y: 0.4, z: 0.4 }
  },
  {
    id: 'socket-cm3-feed',
    defId: CM3_FEED_PORT_DEF.id,
    pose: cm3AnchorPose('anchor/cm3-feed'),
    halfExtents: { x: 0.4, y: 0.4, z: 0.4 }
  }
];

const CM3_VESSEL_COLOR = 0xa8b0b8;
const CM3_PANEL_COLOR = 0x4a5057;
const CM3_OUTLET_COLOR = 0xd2a04f;
/** A staged prop: dark until its action is logged, then lit in its accent colour. */
const CM3_PROP_DORMANT = 0x2f3439;

const CM3_BOXES: ReadonlyArray<StructureBox> = [
  // Crank pedestal (solid), clear of the drive socket's volume.
  { min: [13.3, 0, 31.6], max: [13.9, 0.8, 32.4], color: CRUCIBLE_IRON, solid: true },
  // Vessel plinth (solid) — also the vessel's physical presence.
  { min: [15.9, 0, 31.4], max: [16.9, 0.5, 32.6], color: CRUCIBLE_IRON, solid: true },
  // Outlet post (solid), clear of the feed port's volume.
  { min: [19.6, 0, 31.6], max: [20.4, 0.6, 32.4], color: CRUCIBLE_IRON, solid: true },
  // Furnace plinth (solid).
  { min: [21.5, 0, 31.5], max: [22.5, 0.5, 32.5], color: CRUCIBLE_IRON, solid: true },
  // Control panel (solid). The props sit *above* its top face (y = 0.95) with a 10 cm gap, so
  // §18 never discards a prop as embedded in its own panel.
  { min: [12.4, 0, 30.4], max: [19.2, 0.95, 30.8], color: CM3_PANEL_COLOR, solid: true }
];

export const CM3_WORLD: PlacedWorld = {
  colliders: structureColliders(CM3_BOXES),
  meshes: [
    ...structureMeshes(CM3_BOXES),
    componentMesh(cm3AnchorPose('anchor/cm3-crank'), SHAFT_DEF.halfExtents, CRUCIBLE_CAST),
    componentMesh(cm3AnchorPose('anchor/cm3-vessel'), CRUCIBLE_VESSEL_DEF.halfExtents, CM3_VESSEL_COLOR),
    componentMesh(cm3AnchorPose('anchor/cm3-outlet'), OUTLET_DEF.halfExtents, CM3_OUTLET_COLOR),
    componentMesh(cm3AnchorPose('anchor/cm3-boiler'), BOILER_DEF.halfExtents, CRUCIBLE_BOILER)
    // The staged props are deliberately absent: their appearance is a function of the action
    // history (ADR-018), composed by `cm3PropMeshes` — the same split BM-1 and BM-2 use.
  ]
};

/** Half-extents of a prop's interaction volume (matches BM-1's and BM-2's). */
const CM3_PROP_HALF = { x: 0.25, y: 0.2, z: 0.2 };

/** One staged prop. `id` **is** the action id (`data/actions.ts`). */
export interface Cm3Prop {
  readonly id: string;
  readonly title: string;
  readonly verb: string;
  readonly centerX: number;
  readonly accent: number;
}

export const CM3_PROPS: ReadonlyArray<Cm3Prop> = [
  { id: 'cm3/prime-blast', title: 'Blast line', verb: 'Open', centerX: 13.4, accent: 0xd2763f },
  { id: 'cm3/prime-quench', title: 'Quench line', verb: 'Open', centerX: 14.6, accent: 0x5fb8a6 },
  { id: 'cm3/prime-slag', title: 'Slag line', verb: 'Open', centerX: 15.8, accent: 0xb8563c },
  { id: 'cm3/engage', title: 'Pour lever', verb: 'Engage', centerX: 17.6, accent: 0xd2b04f }
];

/**
 * The staged props as §18 targets, enabled from the machine's derived `Assembled` state —
 * "the priming stage only exists on a built machine", exactly as BM-1's and BM-2's are.
 */
export function cm3PropInteractables(enabled: boolean): ReadonlyArray<Interactable> {
  return CM3_PROPS.map((prop): Interactable => ({
    id: prop.id,
    kind: 'prop',
    min: { x: prop.centerX - CM3_PROP_HALF.x, y: CM3_PROP_Y - CM3_PROP_HALF.y, z: CM3_PANEL_Z - CM3_PROP_HALF.z },
    max: { x: prop.centerX + CM3_PROP_HALF.x, y: CM3_PROP_Y + CM3_PROP_HALF.y, z: CM3_PANEL_Z + CM3_PROP_HALF.z },
    enabled,
    verb: prop.verb,
    contexts: ['Exploration'] as const
  }));
}

/**
 * The props' visuals, a pure function of the action history (ADR-018/§26): a prop whose action
 * has been performed is lit in its accent colour, so rendering cannot disagree with validation.
 */
export function cm3PropMeshes(performed: (actionId: string) => boolean): ReadonlyArray<LabWorldMesh> {
  return CM3_PROPS.map((prop): LabWorldMesh => ({
    kind: 'box',
    min: { x: prop.centerX - CM3_PROP_HALF.x, y: CM3_PROP_Y - CM3_PROP_HALF.y, z: CM3_PANEL_Z - CM3_PROP_HALF.z },
    max: { x: prop.centerX + CM3_PROP_HALF.x, y: CM3_PROP_Y + CM3_PROP_HALF.y, z: CM3_PANEL_Z + CM3_PROP_HALF.z },
    color: performed(prop.id) ? prop.accent : CM3_PROP_DORMANT
  }));
}

/** CM-3 starts unassembled: neither the gear nor the pipe is mounted. */
export const CM3_INITIAL_ATTACHMENTS: ReadonlyArray<Attachment> = [];

/* --- Branch C, assembled --------------------------------------------------- */

export const BRANCH_C_COMPONENTS: ReadonlyArray<ComponentInstance> = [
  ...C1_COMPONENTS,
  ...C2_COMPONENTS,
  ...C3_COMPONENTS,
  ...CM3_COMPONENTS
];

export const BRANCH_C_SOCKETS: ReadonlyArray<SocketInstance> = [
  ...C1_SOCKETS,
  ...C2_SOCKETS,
  ...C3_SOCKETS,
  ...CM3_SOCKETS
];

export const BRANCH_C_CARRYABLES: ReadonlyArray<CarryableBinding> = [
  ...C1_CARRYABLES,
  ...C2_CARRYABLES,
  ...C3_CARRYABLES,
  ...CM3_CARRYABLES
];

/**
 * The static interaction targets. CM-3's staged props are *not* here: whether they exist is a
 * function of the puzzle's §25 state, so the composition installs them through
 * `cm3PropInteractables` exactly as it does BM-1's and BM-2's.
 */
export const BRANCH_C_INTERACTABLES: ReadonlyArray<Interactable> = [
  ...C1_INTERACTABLES,
  ...C2_INTERACTABLES,
  ...C3_INTERACTABLES,
  ...interactablesOf(CM3_CARRYABLES)
];

export const BRANCH_C_INITIAL_ATTACHMENTS: ReadonlyArray<Attachment> = [
  ...C1_INITIAL_ATTACHMENTS,
  ...C2_INITIAL_ATTACHMENTS,
  ...C3_INITIAL_ATTACHMENTS,
  ...CM3_INITIAL_ATTACHMENTS
];

/**
 * The branch's placed world. The room shell is authored once (in `C1_WORLD`) and shared: C3,
 * C2 and CM-3 contribute only their own structure, so the floor and walls are not duplicated
 * into overlapping colliders (a duplicated floor reports its own support surface twice and
 * makes a resting part's support probe ambiguous).
 */
export const BRANCH_C_WORLD: PlacedWorld = {
  colliders: [
    ...C1_WORLD.colliders,
    ...C3_WORLD.colliders,
    ...C2_WORLD.colliders,
    ...CM3_WORLD.colliders
  ],
  meshes: [...C1_WORLD.meshes, ...C3_WORLD.meshes, ...C2_WORLD.meshes, ...CM3_WORLD.meshes]
};
