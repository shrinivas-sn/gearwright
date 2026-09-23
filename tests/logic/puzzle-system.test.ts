import { describe, expect, it } from 'vitest';

import { P1_PUZZLE } from '../../src/data/puzzles/p1.ts';
import { MachineGraph } from '../../src/game-state/machine-graph.ts';
import {
  PuzzleSystem,
  type PuzzleActivation,
  type PuzzleDefinition
} from '../../src/game-state/puzzle-system.ts';
import { DEFAULT_STABLE_STEPS } from '../../src/game-state/validator.ts';
import { p1Content } from './support/p1-mesh.ts';
import { P1_INITIAL_ATTACHMENTS } from '../../src/levels/branch-a.ts';

/**
 * TEST §9 — puzzle state tests (ARCH §25), run against the *shipped* P1 content.
 *
 * The SM owns exactly two things the pure validator does not: the stable-frame
 * hysteresis counter (EC-PZ-01) and the completion latch (EC-PZ-02), so both get
 * their own assertions here. `Validated` needs an activation that has not been met
 * yet, which is why the parked machine below names a machine that does not exist —
 * activation is data (§25), so a test can declare it.
 */

/** A puzzle whose activation can never be met: it parks the SM in `Validated`. */
const NEVER_ACTIVATES: PuzzleActivation = { kind: 'machineRunning', machineId: 'P9-nonexistent' };

interface Harness {
  readonly graph: MachineGraph;
  readonly puzzle: PuzzleSystem;
}

function build(
  options: { readonly activation?: PuzzleActivation; readonly stableSteps?: number } = {}
): Harness {
  const content = p1Content();
  const graph = new MachineGraph();
  graph.configure(content);
  graph.reset(P1_INITIAL_ATTACHMENTS);
  graph.recomputeIfDirty();

  const definition: PuzzleDefinition = {
    ...P1_PUZZLE,
    activation: options.activation ?? P1_PUZZLE.activation
  };
  const puzzle = new PuzzleSystem(definition, graph, content, {
    stableSteps: options.stableSteps ?? DEFAULT_STABLE_STEPS
  });
  return { graph, puzzle };
}

describe('PuzzleSystem — the §25 state machine', () => {
  it('evaluates once at start (the objective needs its reasons), then stays dirty-driven', () => {
    const { puzzle } = build();

    // The first update is not skipped: §33.1's objective line reads `reasonCodes`.
    const first = puzzle.update(false);
    expect(first.puzzleId).toBe('P1');
    expect(first.satisfied).toBe(false);
    expect(first.reasonCodes).toEqual(['p1/drive-through-gear', 'p1/output-turning']);

    // Nothing changed and no window is open: the steady state costs nothing.
    const idle = puzzle.update(false);
    expect(idle.satisfied).toBeNull();
    expect(idle.streak).toBe(0);
    expect(idle.events).toEqual([]);
  });

  it('reports the failing requirement ids, and only when the set changes (§24.2)', () => {
    const { puzzle } = build();

    const first = puzzle.update(true);
    expect(first.state).toBe('InProgress');
    expect(first.satisfied).toBe(false);
    expect(first.reasonCodes).toEqual(['p1/drive-through-gear', 'p1/output-turning']);
    expect(first.events.map((event) => event.type)).toEqual(['RequirementFailed', 'RequirementFailed']);

    // Same failures next evaluation: no repeated events (hints and HUD read edges).
    expect(puzzle.update(true).events).toEqual([]);
  });

  it('walks InProgress → Assembled → Validated → Activated → Complete, completing once', () => {
    const { graph, puzzle } = build();

    graph.attach('gear-a', 'socket-mesh');
    const attached = graph.recomputeIfDirty();
    expect(attached?.machines[0]?.state).toBe('running');

    // Satisfied but not yet stable: the player can see "it is built" before it counts.
    const first = puzzle.update(attached !== null);
    expect(first.satisfied).toBe(true);
    expect(first.streak).toBe(1);
    expect(first.state).toBe('Assembled');
    expect(first.events.map((event) => event.type)).toEqual(['PuzzleStateChanged']);

    expect(puzzle.update(false).state).toBe('Assembled');

    const third = puzzle.update(false);
    expect(third.state).toBe('Complete');
    expect(third.events.map((event) => event.type)).toEqual([
      'PuzzleStateChanged',
      'PuzzleStateChanged',
      'PuzzleCompleted',
      'PuzzleStateChanged'
    ]);
    expect(third.events.filter((event) => event.type === 'PuzzleCompleted')).toHaveLength(1);

    // Terminal (EC-PZ-03): a later structural change cannot reopen it.
    graph.detach('gear-a');
    const after = puzzle.update(graph.recomputeIfDirty() !== null);
    expect(after.state).toBe('Complete');
    expect(after.satisfied).toBeNull();
    expect(after.events).toEqual([]);
  });

  it('never completes on transient validity (EC-PZ-01)', () => {
    const { graph, puzzle } = build();
    graph.attach('gear-a', 'socket-mesh');
    expect(puzzle.update(true).state).toBe('Assembled');

    // Break the structure before the window closes: the streak resets and the puzzle
    // drops back to InProgress.
    graph.detach('gear-a');
    const broken = puzzle.update(graph.recomputeIfDirty() !== null);
    expect(broken.state).toBe('InProgress');
    expect(broken.streak).toBe(0);
    expect(broken.events.map((event) => event.type)).toContain('PuzzleStateChanged');

    // Re-assembling starts a fresh window.
    graph.attach('gear-a', 'socket-mesh');
    expect(puzzle.update(true).streak).toBe(1);
  });

  it('parks in Validated until the declared activation is actually met (§25)', () => {
    const { graph, puzzle } = build({ activation: NEVER_ACTIVATES, stableSteps: 1 });
    graph.attach('gear-a', 'socket-mesh');

    const validated = puzzle.update(true);
    expect(validated.state).toBe('Validated');
    expect(validated.satisfied).toBe(true);
    expect(validated.events.map((event) => event.type)).toEqual([
      'PuzzleStateChanged',
      'PuzzleStateChanged'
    ]);

    // A structure that stops satisfying drops out of Validated.
    graph.detach('gear-a');
    expect(puzzle.update(true).state).toBe('InProgress');
  });

  it('reset() re-opens the window without ever rewinding a completed puzzle (EC-PZ-03/04)', () => {
    const parked = build({ activation: NEVER_ACTIVATES, stableSteps: 1 });
    parked.graph.attach('gear-a', 'socket-mesh');
    expect(parked.puzzle.update(true).state).toBe('Validated');

    parked.puzzle.reset();
    expect(parked.puzzle.state).toBe('InProgress');

    // The window starts over rather than resuming mid-count: one satisfied
    // evaluation is one frame again, even though the structure never moved.
    const afterReset = parked.puzzle.update(false);
    expect(afterReset.streak).toBe(1);
    expect(afterReset.state).toBe('Validated');

    // A completed puzzle is never rewound by a reset: the reward ledger must not be
    // double-grantable through one (M7 consumes this).
    const finished = build({ stableSteps: 1 });
    finished.graph.attach('gear-a', 'socket-mesh');
    expect(finished.puzzle.update(true).state).toBe('Complete');

    finished.puzzle.reset();
    expect(finished.puzzle.state).toBe('Complete');
  });
});
