/**
 * CONTENT — component definitions (ARCH §40 `data/`).
 *
 * Definitions are data: identity, capability tags, mass class, allowed axes and
 * footprint. Everything mechanical about a component is declared here, so nothing
 * downstream needs a per-component branch.
 *
 * M4 ships the one carryable the snap milestone needs, plus a deliberately
 * incompatible definition (`PLATE_DEF`) so the rejection paths are exercised from
 * data rather than from test-only fixtures.
 */

import type { ComponentDefinition } from '../game-state/component-model.ts';

/** The M3 test object, now defined by data rather than by the level. */
export const CRATE_DEF: ComponentDefinition = {
  id: 'def/crate',
  kind: 'carryable',
  tags: ['crate'],
  massClass: 'light',
  // A crate on a floor turns about Y only; 'x'/'z' would need an oriented box
  // (ARCH §20.1 "impossible rotations are unrepresentable").
  allowedAxes: ['y'],
  halfExtents: { x: 0.4, y: 0.4, z: 0.4 },
  grabbable: true
};

/**
 * A flat plate: same handling class, different capability tags, and no allowed
 * rotation axis. It docks nowhere the crate docks, which is exactly what makes
 * `Incompatible` and `BadOrientation` reachable without new geometry.
 */
export const PLATE_DEF: ComponentDefinition = {
  id: 'def/plate',
  kind: 'carryable',
  tags: ['plate'],
  massClass: 'standard',
  allowedAxes: [],
  halfExtents: { x: 0.35, y: 0.05, z: 0.35 },
  grabbable: true
};

/**
 * Structural frame: a fixed part that provides sockets and passes nothing on.
 *
 * Its ports are deliberately `sink`s — the frame *accepts* a carrier from each part
 * mounted in it and conducts it nowhere. Interconnecting them would make every
 * socket of a frame mutually reachable, i.e. a machine would validate with nothing
 * installed in it (ARCH §24.3: connections come from declared relations, not from
 * whatever happens to share a structure).
 */
export const FRAME_DEF: ComponentDefinition = {
  id: 'def/frame',
  kind: 'fixed',
  tags: [],
  massClass: 'heavy',
  allowedAxes: [],
  halfExtents: { x: 1.2, y: 0.5, z: 0.35 },
  grabbable: false,
  ports: [
    { id: 'mount-a', carrier: 'rotation', direction: 'in', role: 'sink' },
    { id: 'mount-b', carrier: 'rotation', direction: 'in', role: 'sink' },
    { id: 'mesh', carrier: 'rotation', direction: 'in', role: 'sink' }
  ]
};

/**
 * Drive shaft: the machine's crank input. Fixed structural part; its `drive` port
 * is the `source` propagation seeds from (ARCH §23.2 "nodes with source
 * capability"). The `mesh` port is where a gear's transmission arrives.
 */
export const SHAFT_DEF: ComponentDefinition = {
  id: 'def/shaft',
  kind: 'fixed',
  tags: ['shaft'],
  massClass: 'heavy',
  allowedAxes: [],
  halfExtents: { x: 0.16, y: 0.16, z: 0.5 },
  grabbable: false,
  ports: [
    { id: 'drive', carrier: 'rotation', direction: 'out', role: 'source', value: 1, spin: 'cw' },
    { id: 'mesh', carrier: 'rotation', direction: 'in', role: 'sink' }
  ]
};

/**
 * The P1 gear: a `through` part with an in and an out mesh face, so rotation
 * arrives on one side and leaves on the other (ARCH §23.1). It is grabbable and
 * Y-rotatable like the crate, which is what P1 has the player do with it.
 */
/**
 * The driven shaft: the output end. It has **no source port**, which is what makes
 * "the output is powered" a real statement about the graph — if both shafts could
 * source rotation, the machine would validate with nothing installed in it.
 */
export const DRIVEN_SHAFT_DEF: ComponentDefinition = {
  id: 'def/driven-shaft',
  kind: 'fixed',
  tags: ['shaft'],
  massClass: 'heavy',
  allowedAxes: [],
  halfExtents: { x: 0.16, y: 0.16, z: 0.5 },
  grabbable: false,
  ports: [{ id: 'mesh', carrier: 'rotation', direction: 'in', role: 'sink' }]
};

export const GEAR_DEF: ComponentDefinition = {
  id: 'def/gear',
  kind: 'carryable',
  tags: ['gear'],
  massClass: 'standard',
  allowedAxes: ['y'],
  halfExtents: { x: 0.3, y: 0.07, z: 0.3 },
  grabbable: true,
  ports: [
    { id: 'mesh-in', carrier: 'rotation', direction: 'in', role: 'through' },
    { id: 'mesh-out', carrier: 'rotation', direction: 'out', role: 'through' }
  ]
};

/**
 * An idler gear: same capability tags, but its mesh face *reverses* the sense, so
 * any machine it bridges turns the other way. This is the data case that makes
 * `output.direction` (P2's directionality predicate) expressible without code.
 */
export const IDLER_GEAR_DEF: ComponentDefinition = {
  id: 'def/idler-gear',
  kind: 'carryable',
  tags: ['gear'],
  massClass: 'standard',
  allowedAxes: ['y'],
  halfExtents: { x: 0.28, y: 0.07, z: 0.28 },
  grabbable: true,
  ports: [{ id: 'mesh', carrier: 'rotation', direction: 'bidir', role: 'through', reverses: true }]
};

/**
 * A shut-off plate: the mesh socket accepts it (`plate`), so the player *can* fit
 * it, but it carries no rotation port and no `gear` tag — a part that physically
 * fits and cannot bridge. That is the "correct machine validates, incorrect does
 * not" case, authored in data rather than enforced in code.
 */
export const BLANKING_PLATE_DEF: ComponentDefinition = {
  id: 'def/blanking-plate',
  kind: 'carryable',
  tags: ['plate'],
  massClass: 'light',
  allowedAxes: ['y'],
  halfExtents: { x: 0.3, y: 0.04, z: 0.3 },
  grabbable: true
};

/**
 * The P2 gearbox frame (M8). Same structural idea as `FRAME_DEF`: three sink ports,
 * so a socket definition names the owner *instance* and one of them, exactly as
 * P1's mounts do.
 */
export const GEARBOX_FRAME_DEF: ComponentDefinition = {
  id: 'def/gearbox-frame',
  kind: 'fixed',
  tags: [],
  massClass: 'heavy',
  allowedAxes: [],
  halfExtents: { x: 1.2, y: 0.5, z: 0.35 },
  grabbable: false,
  ports: [
    { id: 'crank-mount', carrier: 'rotation', direction: 'in', role: 'sink' },
    { id: 'output-mount', carrier: 'rotation', direction: 'in', role: 'sink' },
    { id: 'mesh', carrier: 'rotation', direction: 'in', role: 'sink' }
  ]
};

/**
 * P3's pressure source (M8). The `pressure` carrier was declared in the model from
 * M5; this is the first content that seeds it, so P3's outlets are powered purely
 * by the propagation rule (§23.2) and never by a per-puzzle branch.
 */
export const BOILER_DEF: ComponentDefinition = {
  id: 'def/boiler',
  kind: 'fixed',
  tags: [],
  massClass: 'heavy',
  allowedAxes: [],
  halfExtents: { x: 0.45, y: 0.6, z: 0.45 },
  grabbable: false,
  ports: [{ id: 'pressure-out', carrier: 'pressure', direction: 'out', role: 'source', value: 1 }]
};

/**
 * A pressure outlet: a `sink` with no source port, so "this outlet is powered" is a
 * statement about the graph rather than about an empty machine being trivially on
 * (the same reason `DRIVEN_SHAFT_DEF` has none).
 */
export const OUTLET_DEF: ComponentDefinition = {
  id: 'def/outlet',
  kind: 'fixed',
  tags: [],
  massClass: 'standard',
  allowedAxes: [],
  halfExtents: { x: 0.28, y: 0.3, z: 0.28 },
  grabbable: false,
  ports: [{ id: 'pressure-in', carrier: 'pressure', direction: 'in', role: 'sink' }]
};

/**
 * An open valve / pipe run (P3): a `through` part conducting pressure either way,
 * carrying both the `pipe` and `valve` capability tags. The `valve` tag is what its
 * socket's `socketKind` (`pipe-port`) pairs with, so compatibility stays the closed,
 * testable vocabulary of §22.
 */
export const VALVE_DEF: ComponentDefinition = {
  id: 'def/valve',
  kind: 'carryable',
  tags: ['pipe', 'valve'],
  massClass: 'standard',
  allowedAxes: ['y'],
  halfExtents: { x: 0.3, y: 0.12, z: 0.12 },
  grabbable: true,
  ports: [{ id: 'flow', carrier: 'pressure', direction: 'bidir', role: 'through' }]
};

/**
 * The P3 valve manifold: the fixed structure the three pipe ports are bolted to. It
 * declares **no ports on purpose** — P3's routing is declared by the machine's
 * links, so the manifold conducts nothing and a socket never has to name an owner
 * port (the socket definitions therefore omit `ownerPortId`).
 */
export const MANIFOLD_DEF: ComponentDefinition = {
  id: 'def/manifold',
  kind: 'fixed',
  tags: [],
  massClass: 'heavy',
  allowedAxes: [],
  halfExtents: { x: 1.6, y: 0.3, z: 0.4 },
  grabbable: false
};

/**
 * A shut-off valve (P3's near-miss): *fits* a pipe port and carries the same tags,
 * but its port declares `conducts: false` — so the carrier is refused at it. It is
 * the pressure analogue of P1's blanking plate "fits and cannot bridge" (§21.4),
 * authored as one boolean rather than as a code path.
 */
export const SHUT_OFF_VALVE_DEF: ComponentDefinition = {
  id: 'def/shut-off-valve',
  kind: 'carryable',
  tags: ['pipe', 'valve'],
  massClass: 'standard',
  allowedAxes: ['y'],
  halfExtents: { x: 0.3, y: 0.12, z: 0.12 },
  grabbable: true,
  ports: [{ id: 'flow', carrier: 'pressure', direction: 'bidir', role: 'through', conducts: false }]
};

/**
 * BM-1's dynamo (ADR-018 content): the machine that **combines the branch's two
 * carriers** — rotation at `drive-in` from the gear train, pressure at `feed-in` from
 * the boiler line. §7 gives BM-1 "P1–P3 mechanics", so both halves are ordinary
 * propagation: nothing here knows it belongs to a staged puzzle.
 *
 * Both ports are `sink`s and the component declares no source, so "the dynamo is being
 * driven" is a statement about the graph — the same reason `DRIVEN_SHAFT_DEF` and
 * `OUTLET_DEF` have no source port of their own.
 */
export const BM1_DYNAMO_DEF: ComponentDefinition = {
  id: 'def/bm1-dynamo',
  kind: 'fixed',
  tags: [],
  massClass: 'heavy',
  allowedAxes: [],
  halfExtents: { x: 0.7, y: 0.65, z: 0.5 },
  grabbable: false,
  ports: [
    { id: 'drive-in', carrier: 'rotation', direction: 'in', role: 'sink' },
    { id: 'feed-in', carrier: 'pressure', direction: 'in', role: 'sink' }
  ]
};

export const COMPONENT_DEFINITIONS: ReadonlyArray<ComponentDefinition> = [
  CRATE_DEF,
  PLATE_DEF,
  FRAME_DEF,
  SHAFT_DEF,
  DRIVEN_SHAFT_DEF,
  GEAR_DEF,
  IDLER_GEAR_DEF,
  BLANKING_PLATE_DEF,
  // M8 — P2 (directionality) and P3 (pressure routing) content.
  GEARBOX_FRAME_DEF,
  BOILER_DEF,
  OUTLET_DEF,
  VALVE_DEF,
  SHUT_OFF_VALVE_DEF,
  MANIFOLD_DEF,
  // ADR-018 / M9 remainder — BM-1's dynamo.
  BM1_DYNAMO_DEF
];

export function componentDefinitionOf(defId: string): ComponentDefinition | null {
  return COMPONENT_DEFINITIONS.find((definition) => definition.id === defId) ?? null;
}
