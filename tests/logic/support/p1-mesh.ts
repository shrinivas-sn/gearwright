/**
 * Shared fixture: the P1 "First Mesh" machine, assembled exactly the way the
 * composition root does it (definitions from `data/`, placement from `levels/`).
 *
 * L1 never imports content, so a level has to be handed to it as `MachineContent`
 * — and this file is that hand-off in test form. It keeps the propagation and
 * validator suites reading the *same* content the game will ship, rather than
 * test-only definitions that could prove an algorithm the game never uses.
 */

import { COMPONENT_DEFINITIONS } from '../../../src/data/components.ts';
import { P1_MESH_MACHINE } from '../../../src/data/machines.ts';
import { SOCKET_DEFINITIONS } from '../../../src/data/sockets.ts';
import { ComponentRegistry, type MachineContent } from '../../../src/game-state/component-registry.ts';
import { MachineGraph } from '../../../src/game-state/machine-graph.ts';
import type { MachineDefinition } from '../../../src/game-state/component-model.ts';
import {
  P1_COMPONENTS,
  P1_INITIAL_ATTACHMENTS,
  P1_SOCKETS
} from '../../../src/levels/branch-a.ts';

/**
 * P1's own machine only. The branch's full set is `MACHINE_DEFINITIONS`, and M8's
 * suite uses the branch fixture (`branch-a-content.ts`) for that — keeping this one
 * scoped to P1 means a P1-only world never carries machines whose nodes are absent.
 */
export function p1Content(machines: ReadonlyArray<MachineDefinition> = [P1_MESH_MACHINE]): MachineContent {
  return {
    registry: new ComponentRegistry(COMPONENT_DEFINITIONS, P1_COMPONENTS),
    sockets: P1_SOCKETS,
    socketDefinitions: SOCKET_DEFINITIONS,
    machines
  };
}

/** A graph at the level's initial state: both shafts mounted, mesh empty. */
export function p1Graph(machines: ReadonlyArray<MachineDefinition> = [P1_MESH_MACHINE]): MachineGraph {
  const graph = new MachineGraph();
  graph.configure(p1Content(machines));
  graph.reset(P1_INITIAL_ATTACHMENTS);
  graph.recomputeIfDirty();
  return graph;
}

/** The authored machine, for tests that need to vary a single field. */
export function p1Machine(overrides: Partial<MachineDefinition> = {}): MachineDefinition {
  return { ...P1_MESH_MACHINE, ...overrides };
}
