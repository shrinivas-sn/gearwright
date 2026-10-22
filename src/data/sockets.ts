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

/**
 * B1's two feedwater ports (Branch B). Same shape as P3's pipe ports: routing is
 * declared by the machine's links, so `ownerPortId` is omitted and the ownership
 * conduction step is skipped.
 *
 * Two ports (not one) is the whole lesson: the machine's `componentAt` requirement asks
 * that **both** be occupied, so a single valve — the P3 answer — is not enough. The
 * ports are distinct sockets, so the declared links stay honest data.
 */
export const B1_FLOW_A_DEF: SocketDefinition = {
  id: 'def/b1-flow-a',
  machineId: 'B1-feedwater',
  ownerComponentId: 'b1-header',
  socketKind: 'pipe-port',
  accepts: ['pipe'],
  portDirection: 'in',
  carrier: 'pressure',
  snapYaw: 0
};

/** B1's second feedwater port: same reusable definition shape, other placement. */
export const B1_FLOW_B_DEF: SocketDefinition = {
  ...B1_FLOW_A_DEF,
  id: 'def/b1-flow-b'
};

/**
 * BM-2's drive mount (Branch B): the gear-mount a gear bridges the crank to the
 * flywheel through, exactly as BM-1's drive mount does. Accepts `plate` too, so the
 * blanking plate "fits and cannot bridge" lesson holds in the thermal branch.
 */
export const BM2_DRIVE_MOUNT_DEF: SocketDefinition = {
  id: 'def/bm2-drive-mount',
  machineId: 'BM-2',
  ownerComponentId: 'bm2-flywheel',
  socketKind: 'gear-mount',
  accepts: ['gear', 'plate'],
  portDirection: 'in',
  carrier: 'rotation',
  snapYaw: 0
};

/** BM-2's steam port: the pressure run from the boiler to the condenser. */
export const BM2_STEAM_PORT_DEF: SocketDefinition = {
  id: 'def/bm2-steam-port',
  machineId: 'BM-2',
  ownerComponentId: 'bm2-condenser',
  socketKind: 'pipe-port',
  accepts: ['pipe'],
  portDirection: 'in',
  carrier: 'pressure',
  snapYaw: 0
};

/**
 * B2's drive mount (Branch B): the gear-mount the governor's train is bridged through,
 * the same definition shape as BM-1's and BM-2's. Accepting `plate` as well as `gear` is
 * what keeps the branch's "fits, cannot bridge" lesson (§21.4) in every machine — a
 * blanking plate seats here and turns nothing.
 */
export const B2_DRIVE_MOUNT_DEF: SocketDefinition = {
  id: 'def/b2-drive-mount',
  machineId: 'B2-governor',
  ownerComponentId: 'b2-governor',
  socketKind: 'gear-mount',
  accepts: ['gear', 'plate'],
  portDirection: 'in',
  carrier: 'rotation',
  snapYaw: 0
};

/**
 * B2's steam port: the pressure run from the boiler to the gauge. Same shape as B1's
 * feedwater ports — routing is declared by the machine's links, so `ownerPortId` is
 * omitted and the ownership-conduction step is skipped.
 */
export const B2_STEAM_PORT_DEF: SocketDefinition = {
  id: 'def/b2-steam-port',
  machineId: 'B2-governor',
  ownerComponentId: 'b2-gauge',
  socketKind: 'pipe-port',
  accepts: ['pipe'],
  portDirection: 'in',
  carrier: 'pressure',
  snapYaw: 0
};

/**
 * B3's route ports (Branch B's open-ended beat). Same closed shape as P3's valve ports:
 * routing is *declared* by the machine's links, so a socket never names an owner port and
 * the ownership-conduction step is skipped.
 *
 * Three ports, and the third is the lesson: A reaches the heating coil, B the drawoff, and
 * C reaches **both**, which is what makes the machine multi-solution (A+B, A+C, B+C).
 */
export const B3_ROUTE_A_DEF: SocketDefinition = {
  id: 'def/b3-route-a',
  machineId: 'B3-bypass',
  ownerComponentId: 'b3-header',
  socketKind: 'pipe-port',
  accepts: ['pipe'],
  portDirection: 'in',
  carrier: 'pressure',
  snapYaw: 0
};

/** Route B: the run to the drawoff. */
export const B3_ROUTE_B_DEF: SocketDefinition = {
  ...B3_ROUTE_A_DEF,
  id: 'def/b3-route-b'
};

/** Route C: the cross-run that reaches *both* consumers, so it alone is half a solution. */
export const B3_ROUTE_C_DEF: SocketDefinition = {
  ...B3_ROUTE_A_DEF,
  id: 'def/b3-route-c'
};

/* --- Branch C "Great Crucible" -------------------------------------------- */

/**
 * C1's two blast ports: the branch's **entry** lesson, and the Crucible's own idiom.
 *
 * Both feed the same tuyere, so two seated open valves push the output past the machine's
 * ceiling and trip `overpressure` — the first shipped puzzle where the *safe* answer is to
 * leave a port empty. A shut-off valve in either port still blocks (and jams) as everywhere
 * else, so the puzzle has a right count *and* a right kind of part, read from two different
 * declared facts rather than from geometry.
 */
export const C1_FLOW_A_DEF: SocketDefinition = {
  id: 'def/c1-flow-a',
  machineId: 'C1-tuyere',
  ownerComponentId: 'c1-header',
  socketKind: 'pipe-port',
  accepts: ['pipe'],
  portDirection: 'in',
  carrier: 'pressure',
  snapYaw: 0
};

/** C1's second blast port: same reusable definition shape, other placement. */
export const C1_FLOW_B_DEF: SocketDefinition = {
  ...C1_FLOW_A_DEF,
  id: 'def/c1-flow-b'
};

/**
 * C2's drive mount (the combining machine): a gear-mount the crank's motion is bridged
 * through. Accepts `plate` as well as `gear`, keeping §21.4's "fits, cannot bridge" lesson
 * in every machine of the branch.
 */
export const C2_DRIVE_MOUNT_DEF: SocketDefinition = {
  id: 'def/c2-drive-mount',
  machineId: 'C2-quench',
  ownerComponentId: 'c2-vessel',
  socketKind: 'gear-mount',
  accepts: ['gear', 'plate'],
  portDirection: 'in',
  carrier: 'rotation',
  snapYaw: 0
};

/** C2's two quench feeds: parallel pressure runs, so the ceiling applies to the drive's machine too. */
export const C2_FEED_A_DEF: SocketDefinition = {
  id: 'def/c2-feed-a',
  machineId: 'C2-quench',
  ownerComponentId: 'c2-gauge',
  socketKind: 'pipe-port',
  accepts: ['pipe'],
  portDirection: 'in',
  carrier: 'pressure',
  snapYaw: 0
};

/** C2's second quench feed. */
export const C2_FEED_B_DEF: SocketDefinition = {
  ...C2_FEED_A_DEF,
  id: 'def/c2-feed-b'
};

/**
 * C3's three slag routes (the branch's open-ended beat). Same closed shape as P3's and B3's
 * route ports: routing is declared by the machine's links, so no owner port is named.
 *
 * A reaches the casting floor, B the quench tank, and C reaches **both** — which, under the
 * machine's ceiling, makes `C` alone and `A+B` the two accepted builds while `A+C`, `B+C`
 * would double one consumer. The routes are data; the ceiling is the lesson.
 */
export const C3_ROUTE_A_DEF: SocketDefinition = {
  id: 'def/c3-route-a',
  machineId: 'C3-slag',
  ownerComponentId: 'c3-header',
  socketKind: 'pipe-port',
  accepts: ['pipe'],
  portDirection: 'in',
  carrier: 'pressure',
  snapYaw: 0
};

/** Route B: the run to the quench tank. */
export const C3_ROUTE_B_DEF: SocketDefinition = {
  ...C3_ROUTE_A_DEF,
  id: 'def/c3-route-b'
};

/** Route C: the cross-run that reaches *both* consumers on its own. */
export const C3_ROUTE_C_DEF: SocketDefinition = {
  ...C3_ROUTE_A_DEF,
  id: 'def/c3-route-c'
};

/** CM-3's drive mount: the capstone's gear-mount (accepts a plate that fits and cannot bridge). */
export const CM3_DRIVE_MOUNT_DEF: SocketDefinition = {
  id: 'def/cm3-drive-mount',
  machineId: 'CM-3',
  ownerComponentId: 'cm3-vessel',
  socketKind: 'gear-mount',
  accepts: ['gear', 'plate'],
  portDirection: 'in',
  carrier: 'rotation',
  snapYaw: 0
};

/** CM-3's feed port: the pressure run from the furnace to the casting outlet. */
export const CM3_FEED_PORT_DEF: SocketDefinition = {
  id: 'def/cm3-feed-port',
  machineId: 'CM-3',
  ownerComponentId: 'cm3-outlet',
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
  BM1_LINE_PORT_DEF,
  // Branch B — B1's two feedwater ports.
  B1_FLOW_A_DEF,
  B1_FLOW_B_DEF,
  // Branch B — BM-2's drive mount and steam port.
  BM2_DRIVE_MOUNT_DEF,
  BM2_STEAM_PORT_DEF,
  // Branch B — B2's drive mount and steam port (the combining machine).
  B2_DRIVE_MOUNT_DEF,
  B2_STEAM_PORT_DEF,
  // Branch B — B3's three route ports (the open-ended beat).
  B3_ROUTE_A_DEF,
  B3_ROUTE_B_DEF,
  B3_ROUTE_C_DEF,
  // Branch C — C1's blast ports, C2's drive and quench feeds, C3's routes, CM-3's drive
  // and feed.
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
];

export function socketDefinitionOf(defId: string): SocketDefinition | null {
  return SOCKET_DEFINITIONS.find((definition) => definition.id === defId) ?? null;
}
