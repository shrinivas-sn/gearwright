import { describe, expect, it } from 'vitest';

import { B1_PUZZLE } from '../../src/data/puzzles/index.ts';
import { PuzzleSystem } from '../../src/game-state/puzzle-system.ts';
import type { MachineGraph } from '../../src/game-state/machine-graph.ts';
import { shippedContent, shippedGraph } from './support/branch-a-content.ts';

/**
 * BRANCH B SOLVABILITY — B1 "Feedwater" through the *shipped* content.
 *
 * Branch B is the ARCH §6 expansion claim: a second branch added by content alone,
 * with no core system change. This suite proves the content actually plays — the
 * correct build completes through the real `PuzzleSystem`, and each near-miss fails
 * for the reason the objective line names — against the same bundle `main.ts`
 * assembles, not a fixture.
 */

function b1Scene(): { graph: MachineGraph; puzzle: PuzzleSystem } {
  const content = shippedContent();
  const graph = shippedGraph();
  return { graph, puzzle: new PuzzleSystem(B1_PUZZLE, graph, content) };
}

/** Drive the fixed step's evaluation (§14 step 8) until the latch has settled. */
function run(graph: MachineGraph, puzzle: PuzzleSystem, updates = 6): void {
  for (let i = 0; i < updates; i += 1) {
    graph.recomputeIfDirty();
    puzzle.update(true);
  }
}

function seat(graph: MachineGraph, componentId: string, socketId: string): void {
  expect(graph.attach(componentId, socketId)).toBe('Ok');
}

describe('B1 "Feedwater" — Branch B through the shipped content (ARCH §6)', () => {
  it('opens with the header empty: the structural requirements fail, the machine idle', () => {
    const { graph, puzzle } = b1Scene();
    run(graph, puzzle);

    // The boiler is a declared source, so the machine is *powered* (something could
    // flow) but never reaches an output — which is exactly why the outlet is the
    // question the puzzle asks.
    expect(graph.machineState('B1-feedwater')?.state).toBe('powered');
    expect(graph.machineState('B1-feedwater')?.outputs).toHaveLength(0);
    expect(puzzle.state).toBe('InProgress');
    // The opening objective line (§33.1) reads its reasons from frame one. `no-jam`
    // passes while the machine is idle — there is nothing to be jammed yet.
    expect(puzzle.reasonCodes).toEqual(['b1/two-lines', 'b1/both-seated', 'b1/pressure-up']);
  });

  it('completes when both feedwater ports hold an open valve', () => {
    const { graph, puzzle } = b1Scene();
    seat(graph, 'valve-b1-1', 'socket-b1-flow-a');
    seat(graph, 'valve-b1-2', 'socket-b1-flow-b');
    run(graph, puzzle);

    // Both parallel runs conduct, so the outlet reads the combined value and the
    // machine is running — which is the puzzle's activation input (§25).
    expect(graph.machineState('B1-feedwater')?.outputs[0]?.value).toBe(2);
    expect(graph.machineState('B1-feedwater')?.state).toBe('running');
    expect(puzzle.state).toBe('Complete');
  });

  it('refuses a half-filled header: one line is not enough', () => {
    const { graph, puzzle } = b1Scene();
    seat(graph, 'valve-b1-1', 'socket-b1-flow-a');
    run(graph, puzzle);

    // The single run conducts, so it is *connected* — the coverage and output floors
    // are what catch the half-done circuit.
    expect(puzzle.reasonCodes).toEqual(['b1/both-seated', 'b1/pressure-up']);
    expect(puzzle.state).toBe('InProgress');
  });

  it('refuses the shut-off valve: it fits, conducts nothing, and jams the run', () => {
    const { graph, puzzle } = b1Scene();
    // Both ports filled — but one with the near-miss, which carries the same tags.
    seat(graph, 'shutoff-b1', 'socket-b1-flow-a');
    seat(graph, 'valve-b1-2', 'socket-b1-flow-b');
    run(graph, puzzle);

    expect(graph.machineState('B1-feedwater')?.state).toBe('jammed');
    expect(puzzle.reasonCodes).toContain('b1/no-jam');
    expect(puzzle.state).toBe('InProgress');
  });
});
