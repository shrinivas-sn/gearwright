/**
 * CONTENT — machine definitions (ARCH §23.1, §40 `data/`).
 *
 * A machine is data: the nodes it is scoped to, the **declared adjacencies** that
 * only the machine knows, and the outputs validation may read. Nothing here is a
 * transform, so a machine's meaning cannot drift with the visuals (§24.3).
 *
 * M5 authors the machine P1 assembles. Its placement (which sockets exist where,
 * and that both shafts start mounted) is level data — `levels/branch-a.ts` — so the
 * same machine definition can be placed more than once, exactly like a socket.
 */

import type { MachineDefinition } from '../game-state/component-model.ts';
import { BM1_PRIMING_ACTIONS } from './actions.ts';

/**
 * P1 "First Mesh" — carry a gear into the mesh socket and the two shafts become one
 * drive. The link exists *only while* a component carrying `gear` and a rotation
 * `through` port occupies `socket-mesh`, so a blanking plate that physically fits
 * cannot complete it (ARCH §21.4: snapping never decides completion).
 */
export const P1_MESH_MACHINE: MachineDefinition = {
  id: 'P1-mesh',
  title: 'First Mesh',
  rootNodes: [
    { kind: 'component', id: 'shaft-a' },
    { kind: 'component', id: 'shaft-b' }
  ],
  links: [
    {
      id: 'link-mesh',
      viaSocketId: 'socket-mesh',
      viaTags: ['gear'],
      carrier: 'rotation',
      from: { kind: 'component', id: 'shaft-a' },
      to: { kind: 'component', id: 'shaft-b' }
      // The sense comes from the shaft's `drive` port and is flipped by whichever
      // part declares `reverses` (an idler gear turns the driven shaft the other
      // way) — direction stays a property of the parts, not of the wiring.
    }
  ],
  outputs: [{ node: { kind: 'component', id: 'shaft-b' }, kind: 'rotation' }],
  // Declared ceiling: above it the machine reports `overpressure` (§24.1 safety).
  maxOutput: 1.5
};

/**
 * P2 "Right Turn" (M8). One declared adjacency: a gear in the mesh socket bridges
 * the crank to the output.
 *
 * The **sense is not declared here** — it comes from the crank's `drive` port and is
 * flipped by whichever gear declares `reverses`. So a plain gear leaves the output
 * `cw` and an idler flips it to `ccw`, purely from capability data: the
 * rotation-direction predicate (§7) is a consequence of the parts, never of wiring,
 * and no code knows what an "idler" is.
 */
export const P2_RIGHT_TURN_MACHINE: MachineDefinition = {
  id: 'P2-right-turn',
  title: 'Right Turn',
  rootNodes: [
    { kind: 'component', id: 'p2-crank' },
    { kind: 'component', id: 'p2-output' }
  ],
  links: [
    {
      id: 'link-p2-mesh',
      viaSocketId: 'socket-p2-mesh',
      viaTags: ['gear'],
      carrier: 'rotation',
      from: { kind: 'component', id: 'p2-crank' },
      to: { kind: 'component', id: 'p2-output' }
    }
  ],
  outputs: [{ node: { kind: 'component', id: 'p2-output' }, kind: 'rotation' }],
  maxOutput: 1.5
};

/**
 * P3 "Three Valves" (M8). One boiler, two outlets, three declared runs:
 *
 *   - `link-p3-valve-a`  boiler → main      (valve A)
 *   - `link-p3-valve-b`  boiler → aux       (valve B)
 *   - `link-p3-valve-c-main` / `-c-aux`  boiler → both  (valve C is a cross-run)
 *
 * Two links deliberately share `socket-p3-valve-c`, which is how a *single* placed
 * part can satisfy both outlets — a multi-solution puzzle expressed entirely as
 * declared adjacency (§24.3), with no bespoke routing code. `maxOutput` sits above
 * every reachable sum so a correctly routed machine never reports `overpressure`;
 * the shut-off valve's declared block is what jams it instead.
 */
export const P3_THREE_VALVES_MACHINE: MachineDefinition = {
  id: 'P3-three-valves',
  title: 'Three Valves',
  rootNodes: [
    { kind: 'component', id: 'p3-boiler' },
    { kind: 'component', id: 'p3-out-main' },
    { kind: 'component', id: 'p3-out-aux' }
  ],
  links: [
    {
      id: 'link-p3-valve-a',
      viaSocketId: 'socket-p3-valve-a',
      viaTags: ['pipe'],
      carrier: 'pressure',
      from: { kind: 'component', id: 'p3-boiler' },
      to: { kind: 'component', id: 'p3-out-main' }
    },
    {
      id: 'link-p3-valve-b',
      viaSocketId: 'socket-p3-valve-b',
      viaTags: ['pipe'],
      carrier: 'pressure',
      from: { kind: 'component', id: 'p3-boiler' },
      to: { kind: 'component', id: 'p3-out-aux' }
    },
    {
      id: 'link-p3-valve-c-main',
      viaSocketId: 'socket-p3-valve-c',
      viaTags: ['pipe'],
      carrier: 'pressure',
      from: { kind: 'component', id: 'p3-boiler' },
      to: { kind: 'component', id: 'p3-out-main' }
    },
    {
      id: 'link-p3-valve-c-aux',
      viaSocketId: 'socket-p3-valve-c',
      viaTags: ['pipe'],
      carrier: 'pressure',
      from: { kind: 'component', id: 'p3-boiler' },
      to: { kind: 'component', id: 'p3-out-aux' }
    }
  ],
  outputs: [
    { node: { kind: 'component', id: 'p3-out-main' }, kind: 'pressure' },
    { node: { kind: 'component', id: 'p3-out-aux' }, kind: 'pressure' }
  ],
  maxOutput: 3
};

/**
 * BM-1 "Pressure Dynamo" (ADR-018, ARCH §7) — the branch machine, and the MVP's one
 * **staged** puzzle: assembly → priming → activation.
 *
 * Four fixed nodes and two declared runs:
 *
 *   - `link-bm1-drive`  bm1-crank → bm1-dynamo  (a gear in `socket-bm1-drive`)
 *   - `link-bm1-line`   bm1-boiler → bm1-gauge  (a pipe in `socket-bm1-line`)
 *
 * The two carriers are deliberately kept on **separate output nodes**: `MachineGraph`
 * records one node state per node (the alphabetically-first carrier that reaches it
 * wins), so hanging a rotation output and a pressure output on the same component
 * would report one carrier's value under the other's kind. Two nodes is also the
 * physically honest reading — the dynamo turns, the gauge reads.
 *
 * `primingActions` is the *only* thing here that is not graph data: §24.1's `primed`
 * state is a question about what the player did, answered from the §12.2 action
 * history (ADR-018). It is declared per machine so the validator never hard-codes a
 * puzzle id.
 */
export const BM1_PRESSURE_DYNAMO: MachineDefinition = {
  id: 'BM-1',
  title: 'Pressure Dynamo',
  rootNodes: [
    { kind: 'component', id: 'bm1-crank' },
    { kind: 'component', id: 'bm1-dynamo' },
    { kind: 'component', id: 'bm1-boiler' },
    { kind: 'component', id: 'bm1-gauge' }
  ],
  links: [
    {
      id: 'link-bm1-drive',
      viaSocketId: 'socket-bm1-drive',
      viaTags: ['gear'],
      carrier: 'rotation',
      from: { kind: 'component', id: 'bm1-crank' },
      to: { kind: 'component', id: 'bm1-dynamo' }
    },
    {
      id: 'link-bm1-line',
      viaSocketId: 'socket-bm1-line',
      viaTags: ['pipe'],
      carrier: 'pressure',
      from: { kind: 'component', id: 'bm1-boiler' },
      to: { kind: 'component', id: 'bm1-gauge' }
    }
  ],
  outputs: [
    { node: { kind: 'component', id: 'bm1-dynamo' }, kind: 'rotation' },
    { node: { kind: 'component', id: 'bm1-gauge' }, kind: 'pressure' }
  ],
  // Above every reachable value (each output is 1), so a correctly built dynamo never
  // reports `overpressure`; the shut-off valve's declared block is what jams it.
  maxOutput: 1.5,
  primingActions: BM1_PRIMING_ACTIONS
};

export const MACHINE_DEFINITIONS: ReadonlyArray<MachineDefinition> = [
  P1_MESH_MACHINE,
  // M8 — Branch A's second and third machines.
  P2_RIGHT_TURN_MACHINE,
  P3_THREE_VALVES_MACHINE,
  // ADR-018 / M9 remainder — the branch machine, staged.
  BM1_PRESSURE_DYNAMO
];

export function machineDefinitionOf(machineId: string): MachineDefinition | null {
  return MACHINE_DEFINITIONS.find((machine) => machine.id === machineId) ?? null;
}
