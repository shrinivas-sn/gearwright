/**
 * CONTENT — socket definitions (ARCH §40 `data/`, §21.1 data model).
 *
 * A socket definition is the *logical* half: which component capabilities it
 * accepts, which machine it belongs to and which orientation an attached component
 * adopts. Where a socket physically sits is level data (`levels/lab-world.ts`), so
 * the same dock can be placed many times.
 */

import type { SocketDefinition } from '../game-state/component-model.ts';

/** The one dock M4 needs: accepts the crate, owns its orientation exactly. */
export const DOCK_A_DEF: SocketDefinition = {
  id: 'def/dock-a',
  machineId: 'BM-1',
  ownerComponentId: 'frame-a',
  socketKind: 'crate-dock',
  accepts: ['crate'],
  portDirection: 'in',
  // Yaw 0: the dock faces along +X into the frame, so an attached crate adopts the
  // authored orientation and the player's partial rotation is absorbed (§21.3).
  snapYaw: 0
};

/**
 * A mount that accepts plates at a right angle to the dock's axis. Nothing in the
 * M4 level places it; it exists so the orientation rule has a data-driven case
 * (a component with no allowed axes cannot realise a non-zero `snapYaw`).
 */
export const MOUNT_A_DEF: SocketDefinition = {
  id: 'def/mount-a',
  machineId: 'BM-1',
  ownerComponentId: 'frame-a',
  socketKind: 'gear-mount',
  accepts: ['plate'],
  portDirection: 'bidir',
  snapYaw: Math.PI / 2
};

/**
 * A shaft mount: accepts a shaft and conducts its rotation into the structure.
 * `portDirection: 'in'` means the carrier flows *from* the attached part into the
 * owner — and the owner's matching port (`mount-a`) is a sink, so it stops there.
 */
export const SHAFT_MOUNT_A_DEF: SocketDefinition = {
  id: 'def/mount-shaft-a',
  machineId: 'P1-mesh',
  ownerComponentId: 'frame-a',
  socketKind: 'shaft-mount',
  accepts: ['shaft'],
  portDirection: 'in',
  carrier: 'rotation',
  ownerPortId: 'mount-a',
  snapYaw: 0
};

/** The second shaft mount: same reusable definition shape, other owner port. */
export const SHAFT_MOUNT_B_DEF: SocketDefinition = {
  ...SHAFT_MOUNT_A_DEF,
  id: 'def/mount-shaft-b',
  ownerPortId: 'mount-b'
};

/**
 * The mesh socket: a gear mounted here bridges the two shafts, but only because
 * `data/machines.ts` *declares* that adjacency (§24.3). The socket itself carries
 * no knowledge of the shafts, so the same definition can be placed anywhere.
 */
export const MESH_SOCKET_DEF: SocketDefinition = {
  id: 'def/mesh-socket',
  machineId: 'P1-mesh',
  ownerComponentId: 'frame-a',
  socketKind: 'gear-mount',
  accepts: ['gear', 'plate'],
  portDirection: 'in',
  carrier: 'rotation',
  ownerPortId: 'mesh',
  snapYaw: 0
};

/**
 * P2's crank mount (M8): accepts a shaft and conducts its rotation into the
 * gearbox frame's `crank-mount` sink port. The same definition shape as P1's mount,
 * placed against a different owner — placement is level data, never a restated
 * capability.
 */
export const P2_CRANK_MOUNT_DEF: SocketDefinition = {
  id: 'def/p2-crank-mount',
  machineId: 'P2-right-turn',
  ownerComponentId: 'frame-p2',
  socketKind: 'shaft-mount',
  accepts: ['shaft'],
  portDirection: 'in',
  carrier: 'rotation',
  ownerPortId: 'crank-mount',
  snapYaw: 0
};

/** P2's output mount: same shape, the frame's `output-mount` sink. */
export const P2_OUTPUT_MOUNT_DEF: SocketDefinition = {
  ...P2_CRANK_MOUNT_DEF,
  id: 'def/p2-output-mount',
  ownerPortId: 'output-mount'
};

/**
 * P2's single mesh socket (M8): the one place a gear can bridge the crank to the
 * output, which is what makes the **sense** of the drive the puzzle's variable
 * rather than *whether* it is bridged at all (§7: "socket + orientation" →
 * connection + rotation-direction predicate).
 *
 * It is deliberately a single socket. Two mesh sockets would let both a plain gear
 * and an idler sit in the same train at once, and the derived sense would then
 * depend on edge-visit order rather than on declared data — the exact hidden
 * coupling §24.3 forbids. P2 teaches direction with one socket and a decoy part;
 * P3 carries the branch's multi-solution obligation.
 */
export const P2_MESH_DEF: SocketDefinition = {
  id: 'def/p2-mesh',
  machineId: 'P2-right-turn',
  ownerComponentId: 'frame-p2',
  socketKind: 'gear-mount',
  accepts: ['gear'],
  portDirection: 'in',
  carrier: 'rotation',
  ownerPortId: 'mesh',
  snapYaw: 0
};

/**
 * P3's valve ports (M8). A pipe port conducts nothing into its owner: the routing
 * is *declared* by the machine's links (`data/machines.ts`), so a socket never has
 * to know which output its run reaches. `ownerPortId` is therefore omitted, and the
 * ownership-conduction step is skipped for these sockets.
 */
export const P3_VALVE_A_DEF: SocketDefinition = {
  id: 'def/p3-valve-a',
  machineId: 'P3-three-valves',
  ownerComponentId: 'p3-manifold',
  socketKind: 'pipe-port',
  accepts: ['pipe'],
  portDirection: 'in',
  carrier: 'pressure',
  snapYaw: 0
};

/** Valve B: the run to the auxiliary outlet. */
export const P3_VALVE_B_DEF: SocketDefinition = {
  ...P3_VALVE_A_DEF,
  id: 'def/p3-valve-b'
};

/** Valve C: the cross-run that reaches *both* outlets, so it alone is a solution. */
export const P3_VALVE_C_DEF: SocketDefinition = {
  ...P3_VALVE_A_DEF,
  id: 'def/p3-valve-c'
};

/**
 * BM-1's drive mount (ADR-018): the socket a gear bridges through, exactly as P1's
 * mesh socket does — the machine's declared link supplies the adjacency, so the socket
 * itself knows nothing about the crank or the dynamo.
 *
 * It accepts `plate` as well as `gear` on purpose: the blanking plate *fits* and has
 * no rotation port, so it cannot bridge. BM-1 restates P1's "fits, cannot bridge"
 * lesson (§21.4) as the first half of its assembly stage.
 */
export const BM1_DRIVE_MOUNT_DEF: SocketDefinition = {
  id: 'def/bm1-drive-mount',
  machineId: 'BM-1',
  ownerComponentId: 'bm1-dynamo',
  socketKind: 'gear-mount',
  accepts: ['gear', 'plate'],
  portDirection: 'in',
  carrier: 'rotation',
  snapYaw: 0
};

/**
 * BM-1's line port (ADR-018): the pressure run from the boiler to the gauge. It
 * accepts pipes, which is where the shut-off valve's declared block becomes the second
 * half of the lesson — same id shape, `conducts: false`, no flow.
 */
export const BM1_LINE_PORT_DEF: SocketDefinition = {
  id: 'def/bm1-line-port',
  machineId: 'BM-1',
  ownerComponentId: 'bm1-gauge',
  socketKind: 'pipe-port',
  accepts: ['pipe'],
  portDirection: 'in',
  carrier: 'pressure',
  snapYaw: 0
};

export const SOCKET_DEFINITIONS: ReadonlyArray<SocketDefinition> = [
  DOCK_A_DEF,
  MOUNT_A_DEF,
  SHAFT_MOUNT_A_DEF,
  SHAFT_MOUNT_B_DEF,
  MESH_SOCKET_DEF,
  // M8 — P2 (mirrored mesh) and P3 (three valve ports).
  P2_CRANK_MOUNT_DEF,
  P2_OUTPUT_MOUNT_DEF,
  P2_MESH_DEF,
  P3_VALVE_A_DEF,
  P3_VALVE_B_DEF,
  P3_VALVE_C_DEF,
  // ADR-018 / M9 remainder — BM-1's drive mount and pressure line.
  BM1_DRIVE_MOUNT_DEF,
  BM1_LINE_PORT_DEF
];

export function socketDefinitionOf(defId: string): SocketDefinition | null {
  return SOCKET_DEFINITIONS.find((definition) => definition.id === defId) ?? null;
}
