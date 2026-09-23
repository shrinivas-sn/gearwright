/**
 * LEVEL — Branch A machinery placement (ARCH §40 `levels/`, §12.2).
 *
 * Placement is level data: what exists, and where. Definitions are content
 * (`data/`), so this file names instances and their anchors and never restates a
 * capability. M5 needed the component and socket *identities* so the machine could
 * be exercised headlessly; M6 completes the placement — anchors that resolve,
 * colliders to bump into, render boxes to read — so the shipped bundle really
 * contains P1.
 *
 * Poses are canonical *anchors*: once a component is attached, the socket's pose is
 * what the component adopts (§21.3), so these numbers are never read as live
 * transforms by validation — only by presentation and physics.
 */

import {
  BLANKING_PLATE_DEF,
  BM1_DYNAMO_DEF,
  BOILER_DEF,
  componentDefinitionOf,
  DRIVEN_SHAFT_DEF,
  FRAME_DEF,
  GEAR_DEF,
  GEARBOX_FRAME_DEF,
  IDLER_GEAR_DEF,
  MANIFOLD_DEF,
  OUTLET_DEF,
  SHAFT_DEF,
  SHUT_OFF_VALVE_DEF,
  VALVE_DEF
} from '../data/components.ts';
import {
  BM1_DRIVE_MOUNT_DEF,
  BM1_LINE_PORT_DEF,
  MESH_SOCKET_DEF,
  P2_CRANK_MOUNT_DEF,
  P2_MESH_DEF,
  P2_OUTPUT_MOUNT_DEF,
  P3_VALVE_A_DEF,
  P3_VALVE_B_DEF,
  P3_VALVE_C_DEF,
  SHAFT_MOUNT_A_DEF,
  SHAFT_MOUNT_B_DEF
} from '../data/sockets.ts';
import type { Attachment } from '../game-state/machine-graph.ts';
import type { Pose, SocketInstance } from '../game-state/component-model.ts';
import type { ComponentInstance } from '../game-state/component-registry.ts';
import type { CarryableBinding } from '../gameplay/manipulation-system.ts';
import type { Interactable } from '../gameplay/interaction-system.ts';
import type { LabWorldMesh } from '../ports/render-port.ts';
import type { PlacedWorld } from './lab-world.ts';

/**
 * Where the P1 machine stands. Its mounting line runs along Z — crank mount at
 * z = +0.6, mesh socket at z = 0, driven mount at z = -0.6 — all at hand height
 * (y = 1.2), and the player approaches the mesh socket from +X. The frame is out at
 * x = -8 so it clears the lab's step blocks (which end at x = -5).
 */
const P1_X = -8;
const P1_SOCKET_Y = 1.2;

/**
 * Named spawn anchors (ARCH §22 `spawnAnchorId`): where each part belongs when it is
 * not mounted. Instances below reference these by id, so a part's home is authored
 * exactly once and the loose-part bindings are derived from the same numbers.
 */
export const P1_ANCHORS: ReadonlyArray<{ readonly id: string; readonly pose: Pose }> = [
  { id: 'anchor/p1-frame', pose: { center: { x: P1_X, y: P1_SOCKET_Y, z: 0 }, yaw: 0 } },
  { id: 'anchor/p1-shaft-a', pose: { center: { x: P1_X, y: P1_SOCKET_Y, z: 0.6 }, yaw: 0 } },
  { id: 'anchor/p1-shaft-b', pose: { center: { x: P1_X, y: P1_SOCKET_Y, z: -0.6 }, yaw: 0 } },
  // Loose parts wait on the floor in front of the machine.
  { id: 'anchor/p1-gear', pose: { center: { x: -6.2, y: 0.07, z: 1.5 }, yaw: 0 } },
  { id: 'anchor/p1-plate', pose: { center: { x: -6.6, y: 0.04, z: 2.7 }, yaw: 0 } }
];

/** A fresh copy of an anchor pose (never a shared mutable object). */
export function p1AnchorPose(anchorId: string): Pose {
  const anchor = P1_ANCHORS.find((entry) => entry.id === anchorId);
  if (!anchor) throw new Error(`Unknown P1 anchor: ${anchorId}`);
  return { center: { ...anchor.pose.center }, yaw: anchor.pose.yaw };
}

/** The frame that carries the two shaft mounts and the mesh socket. */
export const P1_FRAME: ComponentInstance = {
  id: 'frame-a',
  defId: FRAME_DEF.id,
  kind: 'fixed',
  spawnAnchorId: 'anchor/p1-frame',
  flags: { required: 'P1' }
};

/**
 * Both shafts start mounted, so the *only* thing missing from P1's machine is the
 * gear. That is what makes "the machine validates once the gear is in" a statement
 * about one attachment edge rather than about a pile of setup.
 */
export const P1_SHAFTS: ReadonlyArray<ComponentInstance> = [
  // `shaft-a` is the machine's crank input (it owns the source port); `shaft-b` is
  // the driven output and has none.
  { id: 'shaft-a', defId: SHAFT_DEF.id, kind: 'fixed', spawnAnchorId: 'anchor/p1-shaft-a', flags: { required: 'P1' } },
  { id: 'shaft-b', defId: DRIVEN_SHAFT_DEF.id, kind: 'fixed', spawnAnchorId: 'anchor/p1-shaft-b', flags: { required: 'P1' } }
];

/**
 * The parts the player can pick up. `gear-a` is the solution; `plate-a` is the
 * deliberate near-miss — the mesh socket accepts plates, but a blanking plate has
 * no rotation port, so installing it *fits* and *cannot* bridge (§21.4 "snapping
 * never decides completion"). It is registered but not `required`: P1 is solvable
 * without it, and the plate's whole point is that the machine does not care that it
 * was seated.
 */
export const P1_LOOSE_PARTS: ReadonlyArray<ComponentInstance> = [
  { id: 'gear-a', defId: GEAR_DEF.id, kind: 'carryable', spawnAnchorId: 'anchor/p1-gear', flags: { required: 'P1', unique: true } },
  { id: 'plate-a', defId: BLANKING_PLATE_DEF.id, kind: 'carryable', spawnAnchorId: 'anchor/p1-plate', flags: { unique: true } }
];

export const P1_COMPONENTS: ReadonlyArray<ComponentInstance> = [P1_FRAME, ...P1_SHAFTS, ...P1_LOOSE_PARTS];

/** The level's carryables: identity from `data/`, placement from the anchors above. */
export const P1_CARRYABLES: ReadonlyArray<CarryableBinding> = P1_LOOSE_PARTS.map((instance) => {
  const definition = componentDefinitionOf(instance.defId);
  if (definition === null) throw new Error(`Unknown P1 component definition: ${instance.defId}`);
  return { instanceId: instance.id, definition, spawn: p1AnchorPose(instance.spawnAnchorId) };
});

/**
 * The three mounts, placed in world space. Socket *poses* are read by presentation,
 * physics and the snap layer only — validation never touches a transform (§24.3),
 * which is what lets the same socket definition be placed anywhere.
 */
export const P1_SOCKETS: ReadonlyArray<SocketInstance> = [
  {
    id: 'socket-shaft-a',
    defId: SHAFT_MOUNT_A_DEF.id,
    pose: p1AnchorPose('anchor/p1-shaft-a'),
    halfExtents: { x: 0.35, y: 0.35, z: 0.35 }
  },
  {
    id: 'socket-shaft-b',
    defId: SHAFT_MOUNT_B_DEF.id,
    pose: p1AnchorPose('anchor/p1-shaft-b'),
    halfExtents: { x: 0.35, y: 0.35, z: 0.35 }
  },
  {
    // Forgiving enough to seat a gear without pixel-hunting, tight enough to read as
    // one place (ARCH §21.2); the gear's own box is 0.6 × 0.14 × 0.6.
    id: 'socket-mesh',
    defId: MESH_SOCKET_DEF.id,
    pose: p1AnchorPose('anchor/p1-frame'),
    halfExtents: { x: 0.4, y: 0.4, z: 0.4 }
  }
];

const FRAME_COLOR = 0x8b939c;
const SHAFT_COLOR = 0xb8c2cc;

/** An authored machine box: `solid` ones also become colliders. */
interface MachineBox {
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
  readonly color: number;
  readonly solid: boolean;
}

const MACHINE_BOXES: ReadonlyArray<MachineBox> = [
  // Base rail under the mounting line: the machine's footprint (solid).
  { min: [P1_X - 0.6, 0, -1.0], max: [P1_X + 0.6, 0.7, 1.0], color: FRAME_COLOR, solid: true },
  // Back plate behind the mounts (solid). It stops clear of the gear's seated box, so
  // a correctly seated gear can never be reported as embedded.
  { min: [P1_X - 0.55, 0.7, -1.0], max: [P1_X - 0.45, 1.7, 1.0], color: FRAME_COLOR, solid: true },
  // Top cap: closes the frame visually, high enough to clear every socket volume.
  { min: [P1_X - 0.55, 1.7, -1.0], max: [P1_X + 0.55, 1.8, 1.0], color: FRAME_COLOR, solid: true },
  // Bearing blocks around the two shaft mounts (solid). A mounted shaft passes
  // through its block, which is exactly what a bearing looks like.
  { min: [P1_X - 0.3, 1.02, 0.45], max: [P1_X + 0.3, 1.38, 0.75], color: FRAME_COLOR, solid: true },
  { min: [P1_X - 0.3, 1.02, -0.75], max: [P1_X + 0.3, 1.38, -0.45], color: FRAME_COLOR, solid: true }
];

/** A shaft's render box, derived from its definition at its mount anchor. */
function shaftMesh(
  anchorId: string,
  halfExtents: { readonly x: number; readonly y: number; readonly z: number }
): LabWorldMesh {
  const center = p1AnchorPose(anchorId).center;
  return {
    kind: 'box',
    min: { x: center.x - halfExtents.x, y: center.y - halfExtents.y, z: center.z - halfExtents.z },
    max: { x: center.x + halfExtents.x, y: center.y + halfExtents.y, z: center.z + halfExtents.z },
    color: SHAFT_COLOR
  };
}

/**
 * Physics + render placement for the machine. The socket detection volumes are not
 * here: they are derived from definition + placement by the snap layer, so a socket
 * cannot be mirrored twice with two different sizes.
 */
export const P1_WORLD: PlacedWorld = {
  colliders: MACHINE_BOXES.filter((box) => box.solid).map((box) => ({
    min: { x: box.min[0], y: box.min[1], z: box.min[2] },
    max: { x: box.max[0], y: box.max[1], z: box.max[2] }
  })),
  meshes: [
    ...MACHINE_BOXES.map((box) => ({
      kind: 'box' as const,
      min: { x: box.min[0], y: box.min[1], z: box.min[2] },
      max: { x: box.max[0], y: box.max[1], z: box.max[2] },
      color: box.color
    })),
    shaftMesh('anchor/p1-shaft-a', SHAFT_DEF.halfExtents),
    shaftMesh('anchor/p1-shaft-b', DRIVEN_SHAFT_DEF.halfExtents)
  ]
};

/**
 * Interaction targets (ARCH §18): one per carryable, with its box derived from the
 * same anchor + definition the physics and presentation read. The world composition
 * flips kind/verb to `attached`/`Remove` while a part is mounted, which is how the
 * detach affordance is reached (§19).
 */
export const P1_INTERACTABLES: ReadonlyArray<Interactable> = P1_CARRYABLES.map(
  (binding): Interactable => {
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
  }
);

/** Canonical edges the level starts with: the two shafts, nothing in the mesh. */
export const P1_INITIAL_ATTACHMENTS: ReadonlyArray<Attachment> = [
  { componentId: 'shaft-a', socketId: 'socket-shaft-a' },
  { componentId: 'shaft-b', socketId: 'socket-shaft-b' }
];

/* ============================================================================
 * M8 — P2 "Right Turn" (directionality) and P3 "Three Valves" (pressure)
 *
 * Same split as P1: definitions in `data/`, placement here. Nothing below is read
 * as a live transform by validation — poses exist for physics, presentation and the
 * snap layer only (§24.3), which is what lets P2/P3 be added without touching a
 * single system.
 * ==========================================================================*/

/**
 * A named anchor + its pose, plus the lookup that hands out copies. Every part
 * below references an anchor id, so a component's home is authored exactly once
 * and its loose binding, physics box and render box all derive from it.
 */
interface Anchor {
  readonly id: string;
  readonly pose: Pose;
}

function poseAt(
  x: number,
  y: number,
  z: number,
  yaw = 0
): Pose {
  return { center: { x, y, z }, yaw };
}

/** A fresh copy of an anchor pose, or a hard error (content typos must not be silent). */
function anchorLookup(anchors: ReadonlyArray<Anchor>, label: string) {
  return (anchorId: string): Pose => {
    const anchor = anchors.find((entry) => entry.id === anchorId);
    if (!anchor) throw new Error(`Unknown ${label} anchor: ${anchorId}`);
    return { center: { ...anchor.pose.center }, yaw: anchor.pose.yaw };
  };
}

/** Render box for a placed component, derived from its definition at its anchor. */
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

/** Authored structure box: `solid` ones also become colliders. */
interface StructureBox {
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
  readonly color: number;
  readonly solid: boolean;
}

function structureColliders(boxes: ReadonlyArray<StructureBox>) {
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

/** Carryables become interaction targets with their box derived from anchor + definition. */
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

/* --- P2 "Right Turn" ------------------------------------------------------- */

/**
 * P2 stands at x = +8, mirrored across the lab from P1 — the mounting line runs
 * along Z (crank at z = +1.2, output at z = -1.2) with the mesh socket between them,
 * so a seated gear reads as part of one train.
 */
const P2_X = 8;
const P2_Y = 1.2;

export const P2_ANCHORS: ReadonlyArray<Anchor> = [
  { id: 'anchor/p2-frame', pose: poseAt(P2_X, P2_Y, 0) },
  { id: 'anchor/p2-crank', pose: poseAt(P2_X, P2_Y, 1.2) },
  { id: 'anchor/p2-output', pose: poseAt(P2_X, P2_Y, -1.2) },
  { id: 'anchor/p2-mesh', pose: poseAt(P2_X, P2_Y, 0) },
  // Loose parts wait on the floor in front of the gearbox.
  { id: 'anchor/p2-gear', pose: poseAt(9.6, 0.07, 1.6) },
  { id: 'anchor/p2-idler', pose: poseAt(9.6, 0.07, 2.8) }
];

export const p2AnchorPose = anchorLookup(P2_ANCHORS, 'P2');

export const P2_FRAME: ComponentInstance = {
  id: 'frame-p2',
  defId: GEARBOX_FRAME_DEF.id,
  kind: 'fixed',
  spawnAnchorId: 'anchor/p2-frame',
  flags: {}
};

/**
 * Both shafts start mounted, so the only missing part of P2's train is the gear —
 * exactly P1's shape, which is what keeps "the machine validates once the *right*
 * gear is in" a statement about one edge and one declared sense.
 */
export const P2_SHAFTS: ReadonlyArray<ComponentInstance> = [
  { id: 'p2-crank', defId: SHAFT_DEF.id, kind: 'fixed', spawnAnchorId: 'anchor/p2-crank', flags: {} },
  { id: 'p2-output', defId: DRIVEN_SHAFT_DEF.id, kind: 'fixed', spawnAnchorId: 'anchor/p2-output', flags: {} }
];

/**
 * The two candidate gears: the plain one preserves the crank's sense, the idler
 * reverses it. **Both are `required`** — the near-miss has to be present for the
 * lesson to exist, and the registry protects it like any other required part.
 */
export const P2_LOOSE_PARTS: ReadonlyArray<ComponentInstance> = [
  { id: 'gear-p2', defId: GEAR_DEF.id, kind: 'carryable', spawnAnchorId: 'anchor/p2-gear', flags: { required: 'P2', unique: true } },
  { id: 'idler-p2', defId: IDLER_GEAR_DEF.id, kind: 'carryable', spawnAnchorId: 'anchor/p2-idler', flags: { required: 'P2', unique: true } }
];

export const P2_COMPONENTS: ReadonlyArray<ComponentInstance> = [P2_FRAME, ...P2_SHAFTS, ...P2_LOOSE_PARTS];

export const P2_CARRYABLES: ReadonlyArray<CarryableBinding> = carryablesOf(P2_LOOSE_PARTS, p2AnchorPose);

export const P2_SOCKETS: ReadonlyArray<SocketInstance> = [
  {
    id: 'socket-p2-crank-mount',
    defId: P2_CRANK_MOUNT_DEF.id,
    pose: p2AnchorPose('anchor/p2-crank'),
    halfExtents: { x: 0.35, y: 0.35, z: 0.35 }
  },
  {
    id: 'socket-p2-output-mount',
    defId: P2_OUTPUT_MOUNT_DEF.id,
    pose: p2AnchorPose('anchor/p2-output'),
    halfExtents: { x: 0.35, y: 0.35, z: 0.35 }
  },
  // The one mesh position: forgiving enough to seat a gear without pixel-hunting,
  // tight enough to read as one place (§21.2).
  {
    id: 'socket-p2-mesh',
    defId: P2_MESH_DEF.id,
    pose: p2AnchorPose('anchor/p2-mesh'),
    halfExtents: { x: 0.4, y: 0.4, z: 0.4 }
  }
];

const P2_FRAME_COLOR = 0x9a8f7c;
const P2_SHAFT_COLOR = 0xb8c2cc;

const P2_BOXES: ReadonlyArray<StructureBox> = [
  // Base rail under the mounting line (solid).
  { min: [P2_X - 0.6, 0, -1.6], max: [P2_X + 0.6, 0.7, 1.6], color: P2_FRAME_COLOR, solid: true },
  // Back plate (solid), clear of the gear's seated box (x 7.7–8.3) on the far side.
  { min: [P2_X - 0.55, 0.7, -1.6], max: [P2_X - 0.45, 1.7, 1.6], color: P2_FRAME_COLOR, solid: true },
  // Top cap, high enough to clear every socket volume.
  { min: [P2_X - 0.55, 1.7, -1.6], max: [P2_X + 0.55, 1.8, 1.6], color: P2_FRAME_COLOR, solid: true },
  // Bearing blocks around the two shaft mounts (solid).
  { min: [P2_X - 0.3, 1.02, 1.05], max: [P2_X + 0.3, 1.38, 1.35], color: P2_FRAME_COLOR, solid: true },
  { min: [P2_X - 0.3, 1.02, -1.35], max: [P2_X + 0.3, 1.38, -1.05], color: P2_FRAME_COLOR, solid: true }
];

export const P2_WORLD: PlacedWorld = {
  colliders: structureColliders(P2_BOXES),
  meshes: [
    ...structureMeshes(P2_BOXES),
    componentMesh(p2AnchorPose('anchor/p2-crank'), SHAFT_DEF.halfExtents, P2_SHAFT_COLOR),
    componentMesh(p2AnchorPose('anchor/p2-output'), DRIVEN_SHAFT_DEF.halfExtents, P2_SHAFT_COLOR)
  ]
};

export const P2_INTERACTABLES: ReadonlyArray<Interactable> = interactablesOf(P2_CARRYABLES);

export const P2_INITIAL_ATTACHMENTS: ReadonlyArray<Attachment> = [
  { componentId: 'p2-crank', socketId: 'socket-p2-crank-mount' },
  { componentId: 'p2-output', socketId: 'socket-p2-output-mount' }
];

/* --- P3 "Three Valves" ----------------------------------------------------- */

/**
 * P3 sits behind the spawn at z ≈ -14: the boiler on its plinth, the two outlets
 * either side, and the three valve ports in a row on the manifold in front of them.
 *
 * Valve A routes to the main outlet, B to the auxiliary, and **C crosses to both** —
 * which is the whole multi-solution structure, and is expressed only by the
 * machine's declared links (`data/machines.ts`).
 */
const P3_BOILER_Y = 1.1;
const P3_OUTLET_Y = 0.8;
const P3_VALVE_Y = 0.8;
const P3_VALVE_Z = -13;

export const P3_ANCHORS: ReadonlyArray<Anchor> = [
  { id: 'anchor/p3-boiler', pose: poseAt(0, P3_BOILER_Y, -14.6) },
  { id: 'anchor/p3-out-main', pose: poseAt(-2.4, P3_OUTLET_Y, -14) },
  { id: 'anchor/p3-out-aux', pose: poseAt(2.4, P3_OUTLET_Y, -14) },
  { id: 'anchor/p3-manifold', pose: poseAt(0, 0.3, P3_VALVE_Z) },
  { id: 'anchor/p3-valve-a', pose: poseAt(-1.2, P3_VALVE_Y, P3_VALVE_Z) },
  { id: 'anchor/p3-valve-b', pose: poseAt(0, P3_VALVE_Y, P3_VALVE_Z) },
  { id: 'anchor/p3-valve-c', pose: poseAt(1.2, P3_VALVE_Y, P3_VALVE_Z) },
  // Loose valves on the floor between the spawn and the machine.
  { id: 'anchor/p3-valve-1', pose: poseAt(-0.8, 0.12, -11.6) },
  { id: 'anchor/p3-valve-2', pose: poseAt(0.8, 0.12, -11.6) },
  { id: 'anchor/p3-shutoff', pose: poseAt(0, 0.12, -11) }
];

export const p3AnchorPose = anchorLookup(P3_ANCHORS, 'P3');

export const P3_FIXED: ReadonlyArray<ComponentInstance> = [
  { id: 'p3-boiler', defId: BOILER_DEF.id, kind: 'fixed', spawnAnchorId: 'anchor/p3-boiler', flags: {} },
  { id: 'p3-out-main', defId: OUTLET_DEF.id, kind: 'fixed', spawnAnchorId: 'anchor/p3-out-main', flags: {} },
  { id: 'p3-out-aux', defId: OUTLET_DEF.id, kind: 'fixed', spawnAnchorId: 'anchor/p3-out-aux', flags: {} },
  // Registered so the socket definitions' `ownerComponentId` names a real instance;
  // it declares no ports, so it conducts nothing (see `MANIFOLD_DEF`).
  { id: 'p3-manifold', defId: MANIFOLD_DEF.id, kind: 'fixed', spawnAnchorId: 'anchor/p3-manifold', flags: {} }
];

/**
 * Two serviceable valves and one shut-off near-miss. The shut-off valve is the
 * puzzle's negative case: it fits any port and conducts nothing.
 */
export const P3_LOOSE_PARTS: ReadonlyArray<ComponentInstance> = [
  { id: 'valve-p3-1', defId: VALVE_DEF.id, kind: 'carryable', spawnAnchorId: 'anchor/p3-valve-1', flags: { required: 'P3', unique: true } },
  { id: 'valve-p3-2', defId: VALVE_DEF.id, kind: 'carryable', spawnAnchorId: 'anchor/p3-valve-2', flags: { required: 'P3', unique: true } },
  { id: 'shutoff-p3', defId: SHUT_OFF_VALVE_DEF.id, kind: 'carryable', spawnAnchorId: 'anchor/p3-shutoff', flags: { required: 'P3', unique: true } }
];

export const P3_COMPONENTS: ReadonlyArray<ComponentInstance> = [...P3_FIXED, ...P3_LOOSE_PARTS];

export const P3_CARRYABLES: ReadonlyArray<CarryableBinding> = carryablesOf(P3_LOOSE_PARTS, p3AnchorPose);

export const P3_SOCKETS: ReadonlyArray<SocketInstance> = [
  { id: 'socket-p3-valve-a', defId: P3_VALVE_A_DEF.id, pose: p3AnchorPose('anchor/p3-valve-a'), halfExtents: { x: 0.4, y: 0.4, z: 0.4 } },
  { id: 'socket-p3-valve-b', defId: P3_VALVE_B_DEF.id, pose: p3AnchorPose('anchor/p3-valve-b'), halfExtents: { x: 0.4, y: 0.4, z: 0.4 } },
  { id: 'socket-p3-valve-c', defId: P3_VALVE_C_DEF.id, pose: p3AnchorPose('anchor/p3-valve-c'), halfExtents: { x: 0.4, y: 0.4, z: 0.4 } }
];

const P3_IRON_COLOR = 0x6f7b86;
const P3_BOILER_COLOR = 0xc06a4a;
const P3_OUTLET_COLOR = 0x5fb8a6;

const P3_BOXES: ReadonlyArray<StructureBox> = [
  // Boiler plinth (solid); the boiler itself sits on top of it.
  { min: [-0.6, 0, -15.2], max: [0.6, 0.5, -14.0], color: P3_IRON_COLOR, solid: true },
  // Outlet supports (solid), one under each outlet.
  { min: [-2.7, 0, -14.3], max: [-2.1, 0.5, -13.7], color: P3_IRON_COLOR, solid: true },
  { min: [2.1, 0, -14.3], max: [2.7, 0.5, -13.7], color: P3_IRON_COLOR, solid: true }
];

export const P3_WORLD: PlacedWorld = {
  colliders: structureColliders(P3_BOXES),
  meshes: [
    ...structureMeshes(P3_BOXES),
    componentMesh(p3AnchorPose('anchor/p3-boiler'), BOILER_DEF.halfExtents, P3_BOILER_COLOR),
    componentMesh(p3AnchorPose('anchor/p3-out-main'), OUTLET_DEF.halfExtents, P3_OUTLET_COLOR),
    componentMesh(p3AnchorPose('anchor/p3-out-aux'), OUTLET_DEF.halfExtents, P3_OUTLET_COLOR),
    componentMesh(p3AnchorPose('anchor/p3-manifold'), MANIFOLD_DEF.halfExtents, P3_IRON_COLOR)
  ]
};

export const P3_INTERACTABLES: ReadonlyArray<Interactable> = interactablesOf(P3_CARRYABLES);

/** P3 starts with nothing plumbed in: both outlets unpowered, the machine idle. */
export const P3_INITIAL_ATTACHMENTS: ReadonlyArray<Attachment> = [];

/* --- BM-1 "Pressure Dynamo" ------------------------------------------------ */

/**
 * BM-1 stands at the far north end of the gallery (z = -18): the crank and its gear
 * mount on the west side, the boiler line and the pressure gauge on the east, and a
 * control panel in front carrying the four **staged props** (three priming lines and
 * the engage lever).
 *
 * The props are authored here, not in the puzzle: their ids *are* the staged action ids
 * (`data/actions.ts`), so the composition can record a press without knowing which
 * puzzle is being played, and the machine's `primingActions` can name facts about the
 * world rather than about code.
 */
const BM1_Z = -18;
const BM1_MACHINE_Y = 1.0;
const BM1_PROP_Y = 1.25;
const BM1_PANEL_Z = -16.6;

export const BM1_ANCHORS: ReadonlyArray<Anchor> = [
  { id: 'anchor/bm1-crank', pose: poseAt(-3.4, BM1_MACHINE_Y, BM1_Z) },
  { id: 'anchor/bm1-dynamo', pose: poseAt(0, BM1_MACHINE_Y, BM1_Z) },
  { id: 'anchor/bm1-gauge', pose: poseAt(3.0, 0.9, BM1_Z) },
  { id: 'anchor/bm1-boiler', pose: poseAt(5.6, 1.1, BM1_Z) },
  // Loose parts wait on the floor in front of the machine, between the panel and the
  // player's approach: the gear and the pipe are the two solutions, the blanking plate
  // and the shut-off valve are the two "fits, cannot bridge" decoys (§21.4).
  { id: 'anchor/bm1-gear', pose: poseAt(-1.6, 0.12, -15.4) },
  { id: 'anchor/bm1-pipe', pose: poseAt(1.6, 0.12, -15.4) },
  { id: 'anchor/bm1-plate', pose: poseAt(-0.6, 0.07, -14.7) },
  { id: 'anchor/bm1-shutoff', pose: poseAt(0.6, 0.12, -14.7) }
];

export const bm1AnchorPose = anchorLookup(BM1_ANCHORS, 'BM-1');

/** The four fixed nodes: crank (rotation source), dynamo, gauge and boiler. */
export const BM1_FIXED: ReadonlyArray<ComponentInstance> = [
  { id: 'bm1-crank', defId: SHAFT_DEF.id, kind: 'fixed', spawnAnchorId: 'anchor/bm1-crank', flags: {} },
  { id: 'bm1-dynamo', defId: BM1_DYNAMO_DEF.id, kind: 'fixed', spawnAnchorId: 'anchor/bm1-dynamo', flags: {} },
  { id: 'bm1-gauge', defId: OUTLET_DEF.id, kind: 'fixed', spawnAnchorId: 'anchor/bm1-gauge', flags: {} },
  { id: 'bm1-boiler', defId: BOILER_DEF.id, kind: 'fixed', spawnAnchorId: 'anchor/bm1-boiler', flags: {} }
];

/**
 * The two halves of the assembly, each with its decoy. Nothing here is optional: the
 * gear and the pipe are `required` for BM-1, and the decoys are registered (not
 * required) so the load-time integrity check (EC-GEN-01) can still account for them.
 */
export const BM1_LOOSE_PARTS: ReadonlyArray<ComponentInstance> = [
  { id: 'gear-bm1', defId: GEAR_DEF.id, kind: 'carryable', spawnAnchorId: 'anchor/bm1-gear', flags: { required: 'BM-1', unique: true } },
  { id: 'valve-bm1', defId: VALVE_DEF.id, kind: 'carryable', spawnAnchorId: 'anchor/bm1-pipe', flags: { required: 'BM-1', unique: true } },
  { id: 'plate-bm1', defId: BLANKING_PLATE_DEF.id, kind: 'carryable', spawnAnchorId: 'anchor/bm1-plate', flags: { unique: true } },
  { id: 'shutoff-bm1', defId: SHUT_OFF_VALVE_DEF.id, kind: 'carryable', spawnAnchorId: 'anchor/bm1-shutoff', flags: { unique: true } }
];

export const BM1_COMPONENTS: ReadonlyArray<ComponentInstance> = [...BM1_FIXED, ...BM1_LOOSE_PARTS];

export const BM1_CARRYABLES: ReadonlyArray<CarryableBinding> = carryablesOf(BM1_LOOSE_PARTS, bm1AnchorPose);

/**
 * BM-1's loose parts as §18 targets, exactly like P1–P3's.
 *
 * They are `carryable` components in the registry and carryables in the manipulation
 * SM, but a part the interaction layer does not know is a part the player can see and
 * never pick up: grab requires a `FocusTarget`, and a missing target produces none — so
 * the branch's capstone could never be assembled. This export exists to be the one
 * place that says "these are reachable", and `shipped-content-integrity` asserts that
 * every carryable has a target.
 */
export const BM1_INTERACTABLES: ReadonlyArray<Interactable> = interactablesOf(BM1_CARRYABLES);

/** The drive mount (west) and the line port (east), each bridged by one part. */
export const BM1_SOCKETS: ReadonlyArray<SocketInstance> = [
  {
    id: 'socket-bm1-drive',
    defId: BM1_DRIVE_MOUNT_DEF.id,
    pose: poseAt(-1.7, BM1_MACHINE_Y, BM1_Z),
    halfExtents: { x: 0.4, y: 0.4, z: 0.4 }
  },
  {
    id: 'socket-bm1-line',
    defId: BM1_LINE_PORT_DEF.id,
    pose: poseAt(4.3, BM1_MACHINE_Y, BM1_Z),
    halfExtents: { x: 0.4, y: 0.4, z: 0.4 }
  }
];

/* --- BM-1 placement: structure, props, renders ----------------------------- */

const BM1_IRON_COLOR = 0x6f7b86;
const BM1_PANEL_COLOR = 0x4a5057;
const BM1_SHAFT_COLOR = 0xb8c2cc;
const BM1_DYNAMO_COLOR = 0xb08a4a;
const BM1_GAUGE_COLOR = 0x5fb8a6;
const BM1_BOILER_COLOR = 0xc06a4a;
/** A staged prop: dark until its action is logged, then lit in its accent colour. */
const BM1_PROP_DORMANT = 0x2f3439;

const BM1_BOXES: ReadonlyArray<StructureBox> = [
  // Dynamo plinth (solid) — also the dynamo's physical presence.
  { min: [-1.0, 0, -18.7], max: [1.0, 0.5, -17.5], color: BM1_IRON_COLOR, solid: true },
  // Crank pedestal (solid), clear of the drive socket's volume.
  { min: [-3.8, 0, -18.6], max: [-3.0, 0.8, -17.6], color: BM1_IRON_COLOR, solid: true },
  // Gauge post (solid), clear of the line port's volume.
  { min: [2.6, 0, -18.5], max: [3.4, 0.6, -17.7], color: BM1_IRON_COLOR, solid: true },
  // Boiler plinth (solid).
  { min: [5.0, 0, -18.9], max: [6.2, 0.5, -17.7], color: BM1_IRON_COLOR, solid: true },
  // Control panel (solid). The props sit *above* its top face (y = 0.95) with a 10 cm
  // gap: §18 discards any interactable whose box overlaps a collider, and a prop
  // embedded in its own panel is exactly Bug 14's mistake in another costume.
  { min: [-2.6, 0, -16.9], max: [2.6, 0.95, -16.5], color: BM1_PANEL_COLOR, solid: true }
];

export const BM1_WORLD: PlacedWorld = {
  colliders: structureColliders(BM1_BOXES),
  meshes: [
    ...structureMeshes(BM1_BOXES),
    componentMesh(bm1AnchorPose('anchor/bm1-crank'), SHAFT_DEF.halfExtents, BM1_SHAFT_COLOR),
    componentMesh(bm1AnchorPose('anchor/bm1-dynamo'), BM1_DYNAMO_DEF.halfExtents, BM1_DYNAMO_COLOR),
    componentMesh(bm1AnchorPose('anchor/bm1-gauge'), OUTLET_DEF.halfExtents, BM1_GAUGE_COLOR),
    componentMesh(bm1AnchorPose('anchor/bm1-boiler'), BOILER_DEF.halfExtents, BM1_BOILER_COLOR)
    // The staged props are deliberately *absent* here: their appearance is a function
    // of the action history (ADR-018), so the composition composes `bm1PropMeshes`
    // into the world instead — the same split the hub uses for its stages (§26).
  ]
};

/** Half-extents of a prop's interaction volume. */
const BM1_PROP_HALF = { x: 0.25, y: 0.2, z: 0.2 };

/**
 * One staged prop (ADR-018). `id` **is** the action id: the composition records a
 * press by prop id, and the machine's `primingActions` names the same ids, so the
 * whole staged vocabulary is data (`data/actions.ts`) rather than a code path.
 */
export interface Bm1Prop {
  readonly id: string;
  readonly title: string;
  readonly verb: string;
  readonly centerX: number;
  /** Colour the prop takes once its action has been performed. */
  readonly accent: number;
}

export const BM1_PROPS: ReadonlyArray<Bm1Prop> = [
  { id: 'bm1/prime-feed', title: 'Feed line', verb: 'Open', centerX: -2.0, accent: 0x5fb8a6 },
  { id: 'bm1/prime-return', title: 'Return line', verb: 'Open', centerX: -0.7, accent: 0x5fb8a6 },
  { id: 'bm1/prime-bleed', title: 'Bleed line', verb: 'Open', centerX: 0.7, accent: 0x5fb8a6 },
  { id: 'bm1/engage', title: 'Engage lever', verb: 'Engage', centerX: 2.0, accent: 0xd2b04f }
];

/**
 * The staged props as interaction targets. `enabled` is the §18 expression of
 * "assembly first": the priming stage only exists on a machine that is **assembled**
 * (§25's `Assembled` is exactly that fact), so a prop cannot be pressed on a pile of
 * loose parts. The validator needs no notion of "when" for this — and could not observe
 * one if it had.
 */
export function bm1PropInteractables(enabled: boolean): ReadonlyArray<Interactable> {
  return BM1_PROPS.map((prop): Interactable => ({
    id: prop.id,
    kind: 'prop',
    min: {
      x: prop.centerX - BM1_PROP_HALF.x,
      y: BM1_PROP_Y - BM1_PROP_HALF.y,
      z: BM1_PANEL_Z - BM1_PROP_HALF.z
    },
    max: {
      x: prop.centerX + BM1_PROP_HALF.x,
      y: BM1_PROP_Y + BM1_PROP_HALF.y,
      z: BM1_PANEL_Z + BM1_PROP_HALF.z
    },
    enabled,
    verb: prop.verb,
    contexts: ['Exploration'] as const
  }));
}

/**
 * The props' visuals, as a pure function of the action history (ADR-018/§26): a prop
 * whose action has been performed is lit in its accent colour. Rendering cannot
 * disagree with validation, because both read the same log.
 */
export function bm1PropMeshes(performed: (actionId: string) => boolean): ReadonlyArray<LabWorldMesh> {
  return BM1_PROPS.map((prop): LabWorldMesh => ({
    kind: 'box',
    min: {
      x: prop.centerX - BM1_PROP_HALF.x,
      y: BM1_PROP_Y - BM1_PROP_HALF.y,
      z: BM1_PANEL_Z - BM1_PROP_HALF.z
    },
    max: {
      x: prop.centerX + BM1_PROP_HALF.x,
      y: BM1_PROP_Y + BM1_PROP_HALF.y,
      z: BM1_PANEL_Z + BM1_PROP_HALF.z
    },
    color: performed(prop.id) ? prop.accent : BM1_PROP_DORMANT
  }));
}

/** BM-1 starts unassembled: neither the gear nor the pipe is mounted. */
export const BM1_INITIAL_ATTACHMENTS: ReadonlyArray<Attachment> = [];

/* --- Branch A, assembled --------------------------------------------------- */

/**
 * The branch's whole placement, in one place. The composition root consumes these
 * exactly as it consumed P1's three exports in M6 — adding a puzzle is concatenation
 * here, never a new code path (M8's gate).
 */
export const BRANCH_A_COMPONENTS: ReadonlyArray<ComponentInstance> = [
  ...P1_COMPONENTS,
  ...P2_COMPONENTS,
  ...P3_COMPONENTS,
  ...BM1_COMPONENTS
];

export const BRANCH_A_SOCKETS: ReadonlyArray<SocketInstance> = [
  ...P1_SOCKETS,
  ...P2_SOCKETS,
  ...P3_SOCKETS,
  ...BM1_SOCKETS
];

export const BRANCH_A_CARRYABLES: ReadonlyArray<CarryableBinding> = [
  ...P1_CARRYABLES,
  ...P2_CARRYABLES,
  ...P3_CARRYABLES,
  ...BM1_CARRYABLES
];

/**
 * The static interaction targets. BM-1's staged props are *not* here: whether they
 * exist is a function of the puzzle's §25 state (assembly first), so the composition
 * installs them through `bm1PropInteractables` exactly as it installs the hub's clue
 * plates from branch state.
 */
export const BRANCH_A_INTERACTABLES: ReadonlyArray<Interactable> = [
  ...P1_INTERACTABLES,
  ...P2_INTERACTABLES,
  ...P3_INTERACTABLES,
  ...BM1_INTERACTABLES
];

export const BRANCH_A_INITIAL_ATTACHMENTS: ReadonlyArray<Attachment> = [
  ...P1_INITIAL_ATTACHMENTS,
  ...P2_INITIAL_ATTACHMENTS,
  ...P3_INITIAL_ATTACHMENTS,
  ...BM1_INITIAL_ATTACHMENTS
];

/// The branch's physics + render placement (every machine's boxes and statics).
export const BRANCH_A_WORLD: PlacedWorld = {
  colliders: [...P1_WORLD.colliders, ...P2_WORLD.colliders, ...P3_WORLD.colliders, ...BM1_WORLD.colliders],
  meshes: [...P1_WORLD.meshes, ...P2_WORLD.meshes, ...P3_WORLD.meshes, ...BM1_WORLD.meshes]
};
