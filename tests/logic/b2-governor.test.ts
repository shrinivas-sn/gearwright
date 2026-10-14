import { describe, expect, it } from 'vitest';

import { B2_PUZZLE } from '../../src/data/puzzles/b2.ts';
import { MILESTONE_B2_GOVERNOR } from '../../src/data/rewards.ts';
import type { MachineGraph } from '../../src/game-state/machine-graph.ts';
import { DEFAULT_STABLE_STEPS } from '../../src/game-state/validator.ts';
import { PuzzleSystem, type PuzzleUpdate } from '../../src/game-state/puzzle-system.ts';
import { shippedContent, shippedGraph } from './support/branch-a-content.ts';

/**
 * BRANCH B — B2 "Governor", the Thermal Line's **combining machine** (§6 beat 3).
 *
 * This is P2's role played on the thermal branch's own machine: the drive has to be
 * bridged *and* it has to turn the right way, while the branch's second carrier (steam)
 * has to reach its gauge on the same frame. It plays the *shipped* content through the
 * real `PuzzleSystem`, so nothing here is re-derived by hand.
 */

function b2Scene(): { graph: MachineGraph; puzzle: PuzzleSystem } {
  const content = shippedContent();
  const graph = shippedGraph();
  return { graph, puzzle: new PuzzleSystem(B2_PUZZLE, graph, content) };
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

describe('B2 "Governor" — the combining machine (ARCH §6 beat 3, §7)', () => {
  it('opens with both sources live and nothing bridged: the machine is powered, not running', () => {
    const { graph, puzzle } = b2Scene();
    run(graph, puzzle);

    // Two declared sources (the crank's drive port and the boiler) seed the machine, so
    // it is `powered` — potential, not achievement — and has no outputs.
    expect(graph.machineState('B2-governor')?.state).toBe('powered');
    expect(graph.machineState('B2-governor')?.outputs).toEqual([]);
    expect(puzzle.state).toBe('InProgress');
    expect(puzzle.reasonCodes).toEqual([
      'b2/drive-coupled',
      'b2/drive-sense',
      'b2/steam-line',
      'b2/steam-up'
    ]);
    // There is nothing to jam yet, so the safety predicate holds from frame one.
    expect(puzzle.reasonCodes).not.toContain('b2/no-jam');
  });

  it('completes when a plain gear drives the governor and a valve feeds the gauge', () => {
    const { graph, puzzle } = b2Scene();
    seat(graph, 'gear-b2', 'socket-b2-drive');
    seat(graph, 'valve-b2', 'socket-b2-steam');
    run(graph, puzzle);

    const machine = graph.machineState('B2-governor');
    expect(machine?.state).toBe('running');
    const rotation = machine?.outputs.find((output) => output.kind === 'rotation');
    expect(rotation?.value).toBe(1);
    // A plain gear preserves the crank's sense (SHAFT_DEF seeds `cw`), so the
    // direction predicate is satisfied by *which* gear is seated, not by wiring.
    expect(rotation?.spin).toBe('cw');
    expect(machine?.outputs.find((output) => output.kind === 'pressure')?.value).toBe(1);
    expect(puzzle.state).toBe('Complete');
  });

  it('refuses the idler: the very same socket, the same tags — and the wrong sense', () => {
    const { graph, puzzle } = b2Scene();
    seat(graph, 'idler-b2', 'socket-b2-drive');
    seat(graph, 'valve-b2', 'socket-b2-steam');
    run(graph, puzzle);

    // The train is bridged and powered: only the *sense* is wrong, which is exactly the
    // §7 predicate P2 exists to teach, restated on the thermal branch.
    const rotation = graph
      .machineState('B2-governor')
      ?.outputs.find((output) => output.kind === 'rotation');
    expect(rotation?.value).toBe(1);
    expect(rotation?.spin).toBe('ccw');
    expect(puzzle.reasonCodes).toEqual(['b2/drive-sense']);
    expect(puzzle.state).toBe('InProgress');
  });

  it('refuses the shut-off valve: it fits the steam port, conducts nothing, and jams the run', () => {
    const { graph, puzzle } = b2Scene();
    seat(graph, 'gear-b2', 'socket-b2-drive');
    seat(graph, 'shutoff-b2', 'socket-b2-steam');
    run(graph, puzzle);

    expect(graph.machineState('B2-governor')?.state).toBe('jammed');
    expect(puzzle.reasonCodes).toContain('b2/steam-line');
    expect(puzzle.reasonCodes).toContain('b2/steam-up');
    expect(puzzle.reasonCodes).toContain('b2/no-jam');
    // The drive half is unaffected: one carrier's failure never speaks for the other.
    expect(puzzle.reasonCodes).not.toContain('b2/drive-coupled');
    expect(puzzle.reasonCodes).not.toContain('b2/drive-sense');
  });

  it('is not complete until both carriers arrive', () => {
    const { graph, puzzle } = b2Scene();
    // The drive alone: the governor turns, the gauge reads nothing.
    seat(graph, 'gear-b2', 'socket-b2-drive');
    run(graph, puzzle);
    expect(graph.machineState('B2-governor')?.outputs).toHaveLength(1);
    expect(puzzle.reasonCodes).toEqual(['b2/steam-line', 'b2/steam-up']);
    expect(puzzle.state).toBe('InProgress');
  });
});

describe('B2 — a real PuzzleSystem walks §25 to Complete (EC-PZ-01/02)', () => {
  it('the correct play latches exactly once, with the B2 milestone', () => {
    const { graph, puzzle } = b2Scene();

    // The drive first, then the steam line: the machine's activation is its own derived
    // `running` state, so `machineRunning` is confirmed only once both outputs exist.
    seat(graph, 'gear-b2', 'socket-b2-drive');
    seat(graph, 'valve-b2', 'socket-b2-steam');

    let completion: PuzzleUpdate | undefined;
    for (let step = 0; step < 2 * (DEFAULT_STABLE_STEPS + 1) + 2; step += 1) {
      graph.recomputeIfDirty();
      const update = puzzle.update(true);
      if (update.events.length > 0) completion = update;
    }

    expect(puzzle.state).toBe('Complete');
    expect(puzzle.reasonCodes).toEqual([]);
    const completed = completion?.events.filter((event) => event.type === 'PuzzleCompleted') ?? [];
    expect(completed).toHaveLength(1);
    expect(completed[0]).toMatchObject({
      type: 'PuzzleCompleted',
      milestoneId: MILESTONE_B2_GOVERNOR
    });
  });
});
