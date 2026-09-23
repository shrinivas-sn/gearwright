import { describe, expect, it } from 'vitest';

import { P1_PUZZLE, P2_PUZZLE, P3_PUZZLE } from '../../src/data/puzzles/index.ts';
import { PuzzleSystem, type PuzzleDefinition } from '../../src/game-state/puzzle-system.ts';
import { MachineGraph } from '../../src/game-state/machine-graph.ts';
import { BRANCH_A_INITIAL_ATTACHMENTS } from '../../src/levels/branch-a.ts';
import {
  branchContent,
  perturbedSockets,
  type BranchContentOptions
} from './support/branch-a-content.ts';

/**
 * BRANCH A SOLVABILITY (ARCH §41 M8) — P2 and P3 through the shipped content, plus
 * the property M8's gate actually rests on: the branch's puzzles share one machine
 * graph and stay independent.
 *
 * These are headless solver simulations (TEST §4/§6): every accepted configuration is
 * *placed* and driven through the real `PuzzleSystem`, so "the puzzle is solvable"
 * is proven by the same code path the player's build runs — not by re-deriving the
 * predicate in the test.
 *
 * M8's gate is "no new bespoke architecture": every case below is content plus the
 * §24 requirement union. Nothing here needs a system change, which is the point.
 */

/**
 * A scene built the way `main.ts` builds one, but with the puzzle SMs optional so a
 * case can drive exactly one of them.
 */
function scene(
  definitions: ReadonlyArray<PuzzleDefinition>,
  options: BranchContentOptions = {}
): { graph: MachineGraph; systems: PuzzleSystem[] } {
  const content = branchContent(options);
  const graph = new MachineGraph();
  graph.configure(content);
  graph.reset(options.attachments ?? BRANCH_A_INITIAL_ATTACHMENTS);
  graph.recomputeIfDirty();
  return { graph, systems: definitions.map((definition) => new PuzzleSystem(definition, graph, content)) };
}

/**
 * Drive puzzles the way the fixed step does (ARCH §14 step 8): the graph's change
 * signal is what opens an evaluation. Three confirmed steps is the default stable
 * window, and the SM walks Assembled → Validated → Activated → Complete in one
 * update, so a handful is comfortably past the latch.
 */
function run(graph: MachineGraph, systems: ReadonlyArray<PuzzleSystem>, updates = 6): void {
  for (let i = 0; i < updates; i += 1) {
    graph.recomputeIfDirty();
    for (const system of systems) system.update(true);
  }
}

function seat(graph: MachineGraph, componentId: string, socketId: string): void {
  expect(graph.attach(componentId, socketId)).toBe('Ok');
}

/** Canonical edge list, sorted by component id (`graph.attachments` already is). */
function edges(attachments: ReadonlyArray<{ readonly componentId: string; readonly socketId: string }>) {
  return [...attachments].sort((a, b) => a.componentId.localeCompare(b.componentId));
}

describe('P2 "Right Turn" — directionality, authored entirely in data (ARCH §41 M8)', () => {
  it('opens with both shafts mounted, the mesh empty and both requirements failing', () => {
    const { graph, systems } = scene([P2_PUZZLE]);
    const puzzle = systems[0]!;
    run(graph, systems);

    // The branch opens with P1's shafts and P2's crank/output already mounted.
    expect(edges(graph.attachments)).toEqual(edges(BRANCH_A_INITIAL_ATTACHMENTS));
    expect(graph.machineState('P2-right-turn')?.state).not.toBe('running');
    expect(puzzle.state).toBe('InProgress');
    // The opening objective line (§33.1) reads its reasons from frame one.
    expect(puzzle.reasonCodes).toEqual(['p2/drive-through-gear', 'p2/output-clockwise']);
  });

  it('completes when the plain gear bridges the crank to the output (clockwise)', () => {
    const { graph, systems } = scene([P2_PUZZLE]);
    seat(graph, 'gear-p2', 'socket-p2-mesh');
    run(graph, systems);

    // The machine really propagates, and the sense comes from the parts + the crank
    // port — not from the wiring (`data/machines.ts` declares none).
    expect(graph.machineState('P2-right-turn')?.outputs[0]?.spin).toBe('cw');
    expect(systems[0]!.state).toBe('Complete');
  });

  it('refuses the idler: the drive IS bridged, but the output turns counter-clockwise', () => {
    const { graph, systems } = scene([P2_PUZZLE]);
    seat(graph, 'idler-p2', 'socket-p2-mesh');
    run(graph, systems);

    // `reverses` on the idler's mesh port is the only difference, and it is enough.
    expect(graph.machineState('P2-right-turn')?.outputs[0]?.spin).toBe('ccw');
    expect(systems[0]!.state).toBe('InProgress');
    // Exactly one requirement fails — and it is the direction one, not the connection.
    expect(systems[0]!.reasonCodes).toEqual(['p2/output-clockwise']);
  });

  it('reaches the same verdict under perturbed transforms (§24.3)', () => {
    const { graph, systems } = scene([P2_PUZZLE]);
    const perturbed = scene([P2_PUZZLE], { sockets: perturbedSockets() });

    seat(graph, 'gear-p2', 'socket-p2-mesh');
    seat(perturbed.graph, 'gear-p2', 'socket-p2-mesh');
    run(graph, systems);
    run(perturbed.graph, perturbed.systems);

    // ±1 m and ±180° on every socket: validation reads the graph, so nothing moves.
    expect(perturbed.systems[0]!.state).toBe(systems[0]!.state);
    expect(perturbed.graph.machineState('P2-right-turn')?.outputs[0]?.spin).toBe('cw');
  });
});

describe('P3 "Three Valves" — pressure routing, sequence-free multi-solution (ARCH §41 M8)', () => {
  it('opens with nothing plumbed in: both outlets unpowered, both routes failing', () => {
    const { graph, systems } = scene([P3_PUZZLE]);
    const puzzle = systems[0]!;
    run(graph, systems);

    // No valve port is occupied: P3's own mounted structure is all there is.
    expect(graph.attachments.some((edge) => edge.socketId.startsWith('socket-p3-'))).toBe(false);
    expect(graph.machineState('P3-three-valves')?.state).not.toBe('running');
    // Both routes fail, and so does the pressure condition — there is no output at
    // all yet (`output/unreached`), which is a different failure from "too low".
    // `p3/no-jam` passes: an idle machine is not a jammed one.
    expect(puzzle.reasonCodes).toEqual(['p3/route-main', 'p3/route-aux', 'p3/pressure-up']);
  });

  // The three accepted pairings. Each is a *different graph* satisfying the same
  // predicates (EC-PZ-08) — the multi-solution is declared adjacency, not code.
  const acceptedPairs: ReadonlyArray<readonly [string, string]> = [
    ['valve-p3-1', 'socket-p3-valve-a'], // A + B: one run to each outlet
    ['valve-p3-2', 'socket-p3-valve-b']
  ];

  it('accepts A+B (a serviceable run to each outlet)', () => {
    const { graph, systems } = scene([P3_PUZZLE]);
    for (const [componentId, socketId] of acceptedPairs) seat(graph, componentId, socketId);
    run(graph, systems);

    expect(systems[0]!.state).toBe('Complete');
    const outputs = graph.machineState('P3-three-valves')?.outputs ?? [];
    expect(outputs).toHaveLength(2);
    expect(outputs.every((output) => output.value >= 1)).toBe(true);
  });

  it('accepts A+C (the cross-run backs up the auxiliary outlet)', () => {
    const { graph, systems } = scene([P3_PUZZLE]);
    seat(graph, 'valve-p3-1', 'socket-p3-valve-a');
    seat(graph, 'valve-p3-2', 'socket-p3-valve-c');
    run(graph, systems);
    expect(systems[0]!.state).toBe('Complete');
  });

  it('accepts B+C (the cross-run backs up the main outlet)', () => {
    const { graph, systems } = scene([P3_PUZZLE]);
    seat(graph, 'valve-p3-1', 'socket-p3-valve-b');
    seat(graph, 'valve-p3-2', 'socket-p3-valve-c');
    run(graph, systems);
    expect(systems[0]!.state).toBe('Complete');
  });

  it('accepts a lone cross-run: one part reaches both outlets', () => {
    const { graph, systems } = scene([P3_PUZZLE]);
    // `socket-p3-valve-c` carries two declared links, so a single valve satisfies
    // both `connected` requirements — the clearest statement of "multi-solution".
    seat(graph, 'valve-p3-1', 'socket-p3-valve-c');
    run(graph, systems);
    expect(systems[0]!.state).toBe('Complete');
  });

  it('is order-free: the same pair seated in either order judges identically', () => {
    const first = scene([P3_PUZZLE]);
    seat(first.graph, 'valve-p3-1', 'socket-p3-valve-a');
    seat(first.graph, 'valve-p3-2', 'socket-p3-valve-c');
    run(first.graph, first.systems);

    const second = scene([P3_PUZZLE]);
    seat(second.graph, 'valve-p3-2', 'socket-p3-valve-c');
    seat(second.graph, 'valve-p3-1', 'socket-p3-valve-a');
    run(second.graph, second.systems);

    expect(second.systems[0]!.state).toBe(first.systems[0]!.state);
  });

  it('refuses a run to only one outlet (the other stays dead)', () => {
    const { graph, systems } = scene([P3_PUZZLE]);
    seat(graph, 'valve-p3-1', 'socket-p3-valve-a');
    run(graph, systems);

    expect(systems[0]!.state).toBe('InProgress');
    expect(systems[0]!.reasonCodes).toEqual(['p3/route-aux']);
  });

  it('refuses the shut-off valve: it fits a port and conducts nothing', () => {
    const { graph, systems } = scene([P3_PUZZLE]);
    seat(graph, 'shutoff-p3', 'socket-p3-valve-a');
    seat(graph, 'valve-p3-1', 'socket-p3-valve-b');
    run(graph, systems);

    // The declared block refuses the carrier, so the main outlet is never reached
    // AND the machine reports `jammed` — the same two data consequences P1's
    // blanking plate demonstrates for rotation, restated for pressure.
    const reasonCodes = systems[0]!.reasonCodes;
    expect(reasonCodes).toContain('p3/route-main');
    expect(reasonCodes).toContain('p3/no-jam');
    expect(graph.machineState('P3-three-valves')?.state).toBe('jammed');
    expect(systems[0]!.state).toBe('InProgress');
  });
});

describe('Branch A — several puzzles, one shared machine graph (ARCH §41 M8)', () => {
  it('keeps P1, P2 and P3 independent, and never reverts completed progress', () => {
    const { graph, systems } = scene([P1_PUZZLE, P2_PUZZLE, P3_PUZZLE]);
    const [p1, p2, p3] = systems as [PuzzleSystem, PuzzleSystem, PuzzleSystem];
    run(graph, systems);

    // Solve P1 first (its own mesh socket), the way a player would meet the branch.
    seat(graph, 'gear-a', 'socket-mesh');
    run(graph, systems);
    expect(p1.state).toBe('Complete');
    // Neither neighbour is affected by P1's edge, its completion or its gear's tag.
    expect(p2.state).toBe('InProgress');
    expect(p3.state).toBe('InProgress');

    // P2 tried the wrong way, then corrected.
    seat(graph, 'idler-p2', 'socket-p2-mesh');
    run(graph, systems);
    expect(p2.state).toBe('InProgress');
    expect(p2.reasonCodes).toEqual(['p2/output-clockwise']);

    graph.detach('idler-p2');
    seat(graph, 'gear-p2', 'socket-p2-mesh');
    run(graph, systems);
    expect(p2.state).toBe('Complete');
    // Progress is never taken away (EC-PZ-03), and the latch never re-fires.
    expect(p1.state).toBe('Complete');

    // P3 finally, with the cross-run.
    seat(graph, 'valve-p3-1', 'socket-p3-valve-a');
    seat(graph, 'valve-p3-2', 'socket-p3-valve-c');
    run(graph, systems);
    expect(p3.state).toBe('Complete');
    expect(p1.state).toBe('Complete');
    expect(p2.state).toBe('Complete');
  });
});
