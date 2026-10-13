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
  BLANKING_PLATE_DEF,
  BOILER_DEF,
  componentDefinitionOf,
  DRIVEN_SHAFT_DEF,
  GEAR_DEF,
  MANIFOLD_DEF,
  OUTLET_DEF,
  SHAFT_DEF,
  SHUT_OFF_VALVE_DEF,
  VALVE_DEF
} from '../data/components.ts';
import { B1_FLOW_A_DEF, B1_FLOW_B_DEF, BM2_DRIVE_MOUNT_DEF, BM2_STEAM_PORT_DEF } from '../data/sockets.ts';
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

/* --- BM-2 "Steam Engine" --------------------------------------------------- */

/**
 * BM-2 stands at the north end of the Steam Works (z = 32): the crank and its gear
 * mount on the west, the boiler line and the condenser on the east, and a control panel
 * in front carrying the four **staged props**.
 *
 * Its layout mirrors BM-1's deliberately — same mounting line, same panel-in-front
 * arrangement, same two decoys — because a second branch is supposed to prove the
 * machinery generalises, and the props' ids *are* the staged action ids.
 */
const BM2_Z = 32;
const BM2_MACHINE_Y = 1.0;
const BM2_PROP_Y = 1.25;
const BM2_PANEL_Z = 30.6;

export const BM2_ANCHORS: ReadonlyArray<Anchor> = [
  { id: 'anchor/bm2-crank', pose: poseAt(-3.4, BM2_MACHINE_Y, BM2_Z) },
  { id: 'anchor/bm2-flywheel', pose: poseAt(0, BM2_MACHINE_Y, BM2_Z) },
  { id: 'anchor/bm2-condenser', pose: poseAt(3.0, 0.9, BM2_Z) },
  { id: 'anchor/bm2-boiler', pose: poseAt(5.6, 1.1, BM2_Z) },
  // Loose parts wait on the floor in front of the machine, between the panel and the
  // player's approach (the gear and the pipe are the solutions, the blanking plate and
  // the shut-off valve the two "fits, cannot bridge" decoys, §21.4).
  { id: 'anchor/bm2-gear', pose: poseAt(-1.6, 0.07, 29.4) },
  { id: 'anchor/bm2-pipe', pose: poseAt(1.6, 0.12, 29.4) },
  { id: 'anchor/bm2-plate', pose: poseAt(-0.6, 0.04, 29.8) },
  { id: 'anchor/bm2-shutoff', pose: poseAt(0.6, 0.12, 29.8) }
];

export const bm2AnchorPose = anchorLookup(BM2_ANCHORS, 'BM-2');

/** The four fixed nodes: crank (rotation source), flywheel, condenser and boiler. */
export const BM2_FIXED: ReadonlyArray<ComponentInstance> = [
  { id: 'bm2-crank', defId: SHAFT_DEF.id, kind: 'fixed', spawnAnchorId: 'anchor/bm2-crank', flags: {} },
  { id: 'bm2-flywheel', defId: DRIVEN_SHAFT_DEF.id, kind: 'fixed', spawnAnchorId: 'anchor/bm2-flywheel', flags: {} },
  { id: 'bm2-condenser', defId: OUTLET_DEF.id, kind: 'fixed', spawnAnchorId: 'anchor/bm2-condenser', flags: {} },
  { id: 'bm2-boiler', defId: BOILER_DEF.id, kind: 'fixed', spawnAnchorId: 'anchor/bm2-boiler', flags: {} }
];

/** The two halves of the assembly, each with its decoy (decoys registered, not required). */
export const BM2_LOOSE_PARTS: ReadonlyArray<ComponentInstance> = [
  { id: 'gear-bm2', defId: GEAR_DEF.id, kind: 'carryable', spawnAnchorId: 'anchor/bm2-gear', flags: { required: 'BM-2', unique: true } },
  { id: 'valve-bm2', defId: VALVE_DEF.id, kind: 'carryable', spawnAnchorId: 'anchor/bm2-pipe', flags: { required: 'BM-2', unique: true } },
  { id: 'plate-bm2', defId: BLANKING_PLATE_DEF.id, kind: 'carryable', spawnAnchorId: 'anchor/bm2-plate', flags: { unique: true } },
  { id: 'shutoff-bm2', defId: SHUT_OFF_VALVE_DEF.id, kind: 'carryable', spawnAnchorId: 'anchor/bm2-shutoff', flags: { unique: true } }
];

export const BM2_COMPONENTS: ReadonlyArray<ComponentInstance> = [...BM2_FIXED, ...BM2_LOOSE_PARTS];

export const BM2_CARRYABLES: ReadonlyArray<CarryableBinding> = carryablesOf(BM2_LOOSE_PARTS, bm2AnchorPose);

/** The drive mount (west) and the steam port (east), each bridged by one part. */
export const BM2_SOCKETS: ReadonlyArray<SocketInstance> = [
  {
    id: 'socket-bm2-drive',
    defId: BM2_DRIVE_MOUNT_DEF.id,
    pose: poseAt(-1.7, BM2_MACHINE_Y, BM2_Z),
    halfExtents: { x: 0.4, y: 0.4, z: 0.4 }
  },
  {
    id: 'socket-bm2-steam',
    defId: BM2_STEAM_PORT_DEF.id,
    pose: poseAt(4.3, BM2_MACHINE_Y, BM2_Z),
    halfExtents: { x: 0.4, y: 0.4, z: 0.4 }
  }
];

const BM2_IRON_COLOR = 0x6f7b86;
const BM2_PANEL_COLOR = 0x4a5057;
const BM2_SHAFT_COLOR = 0xb8c2cc;
const BM2_FLYWHEEL_COLOR = 0xd2a04f;
const BM2_CONDENSER_COLOR = 0x5fb8a6;
const BM2_BOILER_COLOR = 0xc06a4a;
/** A staged prop: dark until its action is logged, then lit in its accent colour. */
const BM2_PROP_DORMANT = 0x2f3439;

const BM2_BOXES: ReadonlyArray<StructureBox> = [
  // Flywheel plinth (solid) — also the flywheel's physical presence.
  { min: [-1.0, 0, 31.3], max: [1.0, 0.5, 32.5], color: BM2_IRON_COLOR, solid: true },
  // Crank pedestal (solid), clear of the drive socket's volume.
  { min: [-3.8, 0, 31.4], max: [-3.0, 0.8, 32.4], color: BM2_IRON_COLOR, solid: true },
  // Condenser post (solid), clear of the steam port's volume.
  { min: [2.6, 0, 31.5], max: [3.4, 0.6, 32.3], color: BM2_IRON_COLOR, solid: true },
  // Boiler plinth (solid).
  { min: [5.0, 0, 31.1], max: [6.2, 0.5, 32.3], color: BM2_IRON_COLOR, solid: true },
  // Control panel (solid). The props sit *above* its top face (y = 0.95) with a 10 cm
  // gap, so §18 never discards a prop as embedded in its own panel.
  { min: [-2.6, 0, 30.4], max: [2.6, 0.95, 30.8], color: BM2_PANEL_COLOR, solid: true }
];

export const BM2_WORLD: PlacedWorld = {
  colliders: structureColliders(BM2_BOXES),
  meshes: [
    ...structureMeshes(BM2_BOXES),
    componentMesh(bm2AnchorPose('anchor/bm2-crank'), SHAFT_DEF.halfExtents, BM2_SHAFT_COLOR),
    componentMesh(bm2AnchorPose('anchor/bm2-flywheel'), DRIVEN_SHAFT_DEF.halfExtents, BM2_FLYWHEEL_COLOR),
    componentMesh(bm2AnchorPose('anchor/bm2-condenser'), OUTLET_DEF.halfExtents, BM2_CONDENSER_COLOR),
    componentMesh(bm2AnchorPose('anchor/bm2-boiler'), BOILER_DEF.halfExtents, BM2_BOILER_COLOR)
    // The staged props are deliberately absent: their appearance is a function of the
    // action history (ADR-018), composed by `bm2PropMeshes` — the same split BM-1 uses.
  ]
};

/** Half-extents of a prop's interaction volume (matches BM-1's). */
const BM2_PROP_HALF = { x: 0.25, y: 0.2, z: 0.2 };

/** One staged prop. `id` **is** the action id (`data/actions.ts`). */
export interface Bm2Prop {
  readonly id: string;
  readonly title: string;
  readonly verb: string;
  readonly centerX: number;
  readonly accent: number;
}

export const BM2_PROPS: ReadonlyArray<Bm2Prop> = [
  { id: 'bm2/prime-inlet', title: 'Inlet line', verb: 'Open', centerX: -2.0, accent: 0xc06a4a },
  { id: 'bm2/prime-outlet', title: 'Outlet line', verb: 'Open', centerX: -0.7, accent: 0xc06a4a },
  { id: 'bm2/prime-drain', title: 'Drain line', verb: 'Open', centerX: 0.7, accent: 0xc06a4a },
  { id: 'bm2/engage', title: 'Throttle', verb: 'Engage', centerX: 2.0, accent: 0xd2b04f }
];

/**
 * The staged props as §18 targets, enabled from the machine's derived `Assembled`
 * state — "the priming stage only exists on a built machine", exactly as BM-1's are.
 */
export function bm2PropInteractables(enabled: boolean): ReadonlyArray<Interactable> {
  return BM2_PROPS.map((prop): Interactable => ({
    id: prop.id,
    kind: 'prop',
    min: { x: prop.centerX - BM2_PROP_HALF.x, y: BM2_PROP_Y - BM2_PROP_HALF.y, z: BM2_PANEL_Z - BM2_PROP_HALF.z },
    max: { x: prop.centerX + BM2_PROP_HALF.x, y: BM2_PROP_Y + BM2_PROP_HALF.y, z: BM2_PANEL_Z + BM2_PROP_HALF.z },
    enabled,
    verb: prop.verb,
    contexts: ['Exploration'] as const
  }));
}

/**
 * The props' visuals, a pure function of the action history (ADR-018/§26): a prop whose
 * action has been performed is lit in its accent colour, so rendering cannot disagree
 * with validation.
 */
export function bm2PropMeshes(performed: (actionId: string) => boolean): ReadonlyArray<LabWorldMesh> {
  return BM2_PROPS.map((prop): LabWorldMesh => ({
    kind: 'box',
    min: { x: prop.centerX - BM2_PROP_HALF.x, y: BM2_PROP_Y - BM2_PROP_HALF.y, z: BM2_PANEL_Z - BM2_PROP_HALF.z },
    max: { x: prop.centerX + BM2_PROP_HALF.x, y: BM2_PROP_Y + BM2_PROP_HALF.y, z: BM2_PANEL_Z + BM2_PROP_HALF.z },
    color: performed(prop.id) ? prop.accent : BM2_PROP_DORMANT
  }));
}

/** BM-2 starts unassembled: neither the gear nor the pipe is mounted. */
export const BM2_INITIAL_ATTACHMENTS: ReadonlyArray<Attachment> = [];

/* --- Branch B, assembled --------------------------------------------------- */

export const BRANCH_B_COMPONENTS: ReadonlyArray<ComponentInstance> = [...B1_COMPONENTS, ...BM2_COMPONENTS];

export const BRANCH_B_SOCKETS: ReadonlyArray<SocketInstance> = [...B1_SOCKETS, ...BM2_SOCKETS];

export const BRANCH_B_CARRYABLES: ReadonlyArray<CarryableBinding> = [...B1_CARRYABLES, ...BM2_CARRYABLES];

/**
 * The static interaction targets. BM-2's staged props are *not* here: whether they
 * exist is a function of the puzzle's §25 state, so the composition installs them
 * through `bm2PropInteractables` exactly as it does BM-1's.
 */
export const BRANCH_B_INTERACTABLES: ReadonlyArray<Interactable> = [
  ...B1_INTERACTABLES,
  ...interactablesOf(BM2_CARRYABLES)
];

export const BRANCH_B_INITIAL_ATTACHMENTS: ReadonlyArray<Attachment> = [
  ...B1_INITIAL_ATTACHMENTS,
  ...BM2_INITIAL_ATTACHMENTS
];

export const BRANCH_B_WORLD: PlacedWorld = {
  colliders: [...B1_WORLD.colliders, ...BM2_WORLD.colliders],
  meshes: [...B1_WORLD.meshes, ...BM2_WORLD.meshes]
};
