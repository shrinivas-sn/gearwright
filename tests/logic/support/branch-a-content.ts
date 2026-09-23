/**
 * Shared fixture: the whole of Branch A, assembled exactly the way the composition
 * root does it (definitions from `data/`, placement from `levels/`).
 *
 * P1's fixture (`p1-mesh.ts`) hands L1 only P1; this one hands it the *branch*, so
 * the M8 suites can prove the thing that actually ships — several puzzles sharing
 * one machine graph — rather than three isolated worlds. L1 never imports content,
 * so this hand-off is where the two halves meet.
 */

import { COMPONENT_DEFINITIONS } from '../../../src/data/components.ts';
import { MACHINE_DEFINITIONS } from '../../../src/data/machines.ts';
import { SOCKET_DEFINITIONS } from '../../../src/data/sockets.ts';
import type { MachineDefinition, SocketInstance } from '../../../src/game-state/component-model.ts';
import { ComponentRegistry, type MachineContent } from '../../../src/game-state/component-registry.ts';
import { MachineGraph } from '../../../src/game-state/machine-graph.ts';
import {
  BRANCH_A_COMPONENTS,
  BRANCH_A_INITIAL_ATTACHMENTS,
  BRANCH_A_SOCKETS
} from '../../../src/levels/branch-a.ts';

export interface BranchContentOptions {
  /** Override the machine set (defaults to every shipped definition). */
  readonly machines?: ReadonlyArray<MachineDefinition> | undefined;
  /** Override socket placement — used by the transform-independence proof. */
  readonly sockets?: ReadonlyArray<SocketInstance> | undefined;
  /** Override the canonical starting edges. */
  readonly attachments?: ReadonlyArray<{ readonly componentId: string; readonly socketId: string }> | undefined;
}

export function branchContent(options: BranchContentOptions = {}): MachineContent {
  return {
    registry: new ComponentRegistry(COMPONENT_DEFINITIONS, BRANCH_A_COMPONENTS),
    sockets: options.sockets ?? BRANCH_A_SOCKETS,
    socketDefinitions: SOCKET_DEFINITIONS,
    machines: options.machines ?? MACHINE_DEFINITIONS
  };
}

/** A graph at the branch's initial state (P1's two shafts and P2's crank/output mounted). */
export function branchGraph(options: BranchContentOptions = {}): MachineGraph {
  const graph = new MachineGraph();
  graph.configure(branchContent(options));
  graph.reset(options.attachments ?? BRANCH_A_INITIAL_ATTACHMENTS);
  graph.recomputeIfDirty();
  return graph;
}

/**
 * Every socket pose shifted by ±1 m and rotated 180° (ARCH §24.3). Validation reads
 * graph structure and declared relations only, so a machine must reach an identical
 * verdict under this — that is the whole point of the transform-independence rule.
 */
export function perturbedSockets(): ReadonlyArray<SocketInstance> {
  return BRANCH_A_SOCKETS.map((socket) => ({
    ...socket,
    pose: {
      center: {
        x: socket.pose.center.x + 1,
        y: socket.pose.center.y - 1,
        z: socket.pose.center.z + 1
      },
      yaw: socket.pose.yaw + Math.PI
    }
  }));
}
