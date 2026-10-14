import { describe, expect, it } from 'vitest';

import { B3_PUZZLE } from '../../src/data/puzzles/b3.ts';
import { MILESTONE_B3_BYPASS } from '../../src/data/rewards.ts';
import type { MachineGraph } from '../../src/game-state/machine-graph.ts';
import { DEFAULT_STABLE_STEPS } from '../../src/game-state/validator.ts';
import { PuzzleSystem, type PuzzleUpdate } from '../../src/game-state/puzzle-system.ts';
import { shippedContent, shippedGraph } from './support/branch-a-content.ts';

/**
 * BRANCH B — B3 "Bypass", the Thermal Line's **open-ended problem** (§7 template beat 4).
 *
 * This is P3's role played on the thermal branch: one source, two consumers, three routes —
 * and the cross-run (`socket-b3-route-c`) declares a link to *each* consumer, so A+B, A+C
 * and B+C are all correct. Nothing here re-derives a requirement by hand: every expectation
 * flows through the shipped `PuzzleSystem` and the shipped content bundle.
 */

function b3Scene(): { graph: MachineGraph; puzzle: PuzzleSystem } {
  const content = shippedContent();
  const graph = shippedGraph();
  return { graph, puzzle: new PuzzleSystem(B3_PUZZLE, graph, content) };
}

function run(graph: MachineGraph, puzzle: PuzzleSystem, updates = 6): void {
  for (let i = 0; i < updates; i += 1) {
    graph.recomputeIfDirty();
    puzzle.update(true);
  }
}

function seat(graph: MachineGraph, componentId: string, socketId: string): void {
  expect(graph.attach(componentId, socketId)).toBe('Ok');
}

describe('B3 "Bypass" — the open-ended beat (ARCH §7)', () => {
  it('opens with the boiler live and every route empty', () => {
    const { graph, puzzle } = b3Scene();
    run(graph, puzzle);

    // The boiler is a declared source, so the machine is *powered* — potential, not
    // achievement — and reaches neither consumer.
    expect(graph.machineState('B3-bypass')?.state).toBe('powered');
    expect(graph.machineState('B3-bypass')?.outputs).toEqual([]);
    expect(puzzle.state).toBe('InProgress');
    expect(puzzle.reasonCodes).toEqual([
      'b3/route-heat',
      'b3/route-drain',
      'b3/two-carriers',
      'b3/pressure-up'
    ]);
    // Nothing is seated yet, so nothing can be jammed.
    expect(puzzle.reasonCodes).not.toContain('b3/no-jam');
  });

  it('accepts both serviceable valves on their own routes (A + B)', () => {
    const { graph, puzzle } = b3Scene();
    seat(graph, 'valve-b3-1', 'socket-b3-route-a');
    seat(graph, 'valve-b3-2', 'socket-b3-route-b');
    run(graph, puzzle);

    expect(puzzle.state).toBe('Complete');
    expect(puzzle.reasonCodes).toEqual([]);
  });

  it('accepts the cross-run with either serviceable valve (A + C and B + C)', () => {
    const heat = b3Scene();
    seat(heat.graph, 'valve-b3-1', 'socket-b3-route-a');
    seat(heat.graph, 'valve-b3-2', 'socket-b3-route-c');
    run(heat.graph, heat.puzzle);
    expect(heat.puzzle.state).toBe('Complete');

    const drain = b3Scene();
    seat(drain.graph, 'valve-b3-2', 'socket-b3-route-b');
    seat(drain.graph, 'valve-b3-1', 'socket-b3-route-c');
    run(drain.graph, drain.puzzle);
    expect(drain.puzzle.state).toBe('Complete');
  });

  it('refuses one route: the consumer it does not reach stays cold', () => {
    const { graph, puzzle } = b3Scene();
    seat(graph, 'valve-b3-1', 'socket-b3-route-a');
    run(graph, puzzle);

    // The heating coil is reached, so its requirement passes; the drawoff and the
    // coverage floor are what catch the half-done build (§7's "one is not enough").
    expect(puzzle.reasonCodes).toEqual(['b3/route-drain', 'b3/two-carriers']);
    expect(puzzle.state).toBe('InProgress');
  });

  it('refuses the shut-off valve: it fits a route, conducts nothing and dead-ends the run', () => {
    const { graph, puzzle } = b3Scene();
    seat(graph, 'shutoff-b3', 'socket-b3-route-a');
    seat(graph, 'valve-b3-2', 'socket-b3-route-b');
    run(graph, puzzle);

    // The dead-ended route and the jam are what fail. The pressure floor still reads its
    // first pressure output — the drawoff, which the serviceable valve does feed — exactly
    // as P3's does, so "one consumer is cold" is the `connected` predicate's job here.
    expect(puzzle.reasonCodes).toEqual(['b3/route-heat', 'b3/no-jam']);
    expect(puzzle.state).toBe('InProgress');
  });

  it('is still completable after a dead-ended attempt: the answer is the parts, not a reset', () => {
    const { graph, puzzle } = b3Scene();
    seat(graph, 'shutoff-b3', 'socket-b3-route-a');
    seat(graph, 'valve-b3-2', 'socket-b3-route-b');
    run(graph, puzzle);
    expect(puzzle.state).toBe('InProgress');

    // Swap the near-miss for a serviceable valve in the same port: the record of the
    // attempt must not have latched anything the machine cannot undo.
    expect(graph.detach('shutoff-b3')).toBe(true);
    seat(graph, 'valve-b3-1', 'socket-b3-route-a');
    run(graph, puzzle);

    expect(puzzle.state).toBe('Complete');
    expect(puzzle.reasonCodes).toEqual([]);
  });

  it('a real PuzzleSystem latches exactly once, with the B3 milestone', () => {
    const { graph, puzzle } = b3Scene();
    seat(graph, 'valve-b3-1', 'socket-b3-route-a');
    seat(graph, 'valve-b3-2', 'socket-b3-route-c');

    let completion: PuzzleUpdate | undefined;
    for (let step = 0; step < 2 * (DEFAULT_STABLE_STEPS + 1) + 2; step += 1) {
      const update = puzzle.update(true);
      if (update.events.length > 0) completion = update;
    }

    expect(puzzle.state).toBe('Complete');
    const completed = completion?.events.filter((event) => event.type === 'PuzzleCompleted') ?? [];
    expect(completed).toHaveLength(1);
    expect(completed[0]).toMatchObject({
      type: 'PuzzleCompleted',
      milestoneId: MILESTONE_B3_BYPASS
    });
  });
});
