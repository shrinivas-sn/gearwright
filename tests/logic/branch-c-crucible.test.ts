import { describe, expect, it } from 'vitest';

import { C1_PUZZLE } from '../../src/data/puzzles/c1.ts';
import { C2_PUZZLE } from '../../src/data/puzzles/c2.ts';
import { C3_PUZZLE } from '../../src/data/puzzles/c3.ts';
import { CM3_PUZZLE } from '../../src/data/puzzles/cm3.ts';
import { ActionHistory } from '../../src/game-state/action-history.ts';
import type { MachineGraph } from '../../src/game-state/machine-graph.ts';
import { DEFAULT_STABLE_STEPS, evaluateRequirements } from '../../src/game-state/validator.ts';
import { PuzzleSystem } from '../../src/game-state/puzzle-system.ts';
import type { PuzzleDefinition } from '../../src/game-state/puzzle-system.ts';
import { shippedContent, shippedGraph } from './support/branch-a-content.ts';

/**
 * BRANCH C — the Great Crucible's four machines (§6 template beats 2–6).
 *
 * The branch's new teaching is a **ceiling**: a machine can be over-fed, and `maxOutput`
 * turns that into a reason the player sees (`safety/overpressure`) instead of a latent
 * warning. Everything here drives the *shipped* `PuzzleSystem` and the *shipped* content
 * bundle, so the expectations are the game's own predicates rather than a re-derivation:
 *
 *   - C1 teaches it alone (one feed right, two wrong, a shut-off jammed);
 *   - C2 combines it with Branch A's direction lesson (right-handed drive, single feed);
 *   - C3 keeps it open-ended (A+B or C alone both work; A+C and B+C over-feed a consumer);
 *   - CM-3 stages it (assembly → priming → ordered pour), the ADR-018 pattern's third
 *     instance.
 *
 * The one thing no test can decide for the player is *feel*; these are the functional facts.
 */

function scene(definition: PuzzleDefinition, actions?: ActionHistory) {
  const content = shippedContent();
  const graph = shippedGraph();
  const puzzle = new PuzzleSystem(
    definition,
    graph,
    content,
    actions === undefined ? {} : { readActions: () => actions.actions }
  );
  return { graph, puzzle };
}

/** Let the stable-frame gate confirm: two settled steps after each structural change. */
function settle(graph: MachineGraph, puzzle: PuzzleSystem): void {
  for (let i = 0; i < 2 * (DEFAULT_STABLE_STEPS + 1); i += 1) {
    graph.recomputeIfDirty();
    puzzle.update(true);
  }
}

function seat(graph: MachineGraph, componentId: string, socketId: string): void {
  expect(graph.attach(componentId, socketId)).toBe('Ok');
}

describe('C1 "Tuyere" — the ceiling lesson (Arch §6 beat 2)', () => {
  it('completes with exactly one open valve on the header', () => {
    const { graph, puzzle } = scene(C1_PUZZLE);
    seat(graph, 'valve-c1-1', 'socket-c1-flow-a');
    settle(graph, puzzle);

    expect(puzzle.reasonCodes).toEqual([]);
    expect(puzzle.state).toBe('Complete');
  });

  it('refuses over-feeding: a second open valve trips the machine ceiling', () => {
    const { graph, puzzle } = scene(C1_PUZZLE);
    seat(graph, 'valve-c1-1', 'socket-c1-flow-a');
    seat(graph, 'valve-c1-2', 'socket-c1-flow-b');
    settle(graph, puzzle);

    // The connections are all made and pressure is high — the *only* thing wrong is that
    // there is too much of it, which is the branch's whole teaching.
    expect(graph.machineState('C1-tuyere')?.warnings).toContain('overpressure');
    expect(puzzle.reasonCodes).toEqual(['c1/no-overpressure']);
    expect(puzzle.state).not.toBe('Complete');
  });

  it('refuses a shut-off valve: it fits the port and dead-ends the blast', () => {
    const { graph, puzzle } = scene(C1_PUZZLE);
    seat(graph, 'shutoff-c1', 'socket-c1-flow-a');
    settle(graph, puzzle);

    expect(puzzle.reasonCodes).toContain('c1/blast-line');
    expect(puzzle.reasonCodes).toContain('c1/no-jam');
    expect(puzzle.state).not.toBe('Complete');
    // The two failure modes keep two different reasons, which is why both requirements exist.
    expect(puzzle.reasonCodes).not.toContain('c1/no-overpressure');
  });
});

describe('C2 "Quench" — the combining machine (§6 beat 3)', () => {
  it('completes with a plain gear and a single quench feed', () => {
    const { graph, puzzle } = scene(C2_PUZZLE);
    seat(graph, 'gear-c2', 'socket-c2-drive');
    seat(graph, 'valve-c2-1', 'socket-c2-feed-a');
    settle(graph, puzzle);

    expect(puzzle.reasonCodes).toEqual([]);
    expect(puzzle.state).toBe('Complete');
    // The drive really does turn clockwise — the sense comes from the parts, not the wiring.
    expect(graph.machineState('C2-quench')?.outputs.find((output) => output.kind === 'rotation')?.spin).toBe('cw');
  });

  it('refuses the idler: the vessel would turn the wrong way', () => {
    const { graph, puzzle } = scene(C2_PUZZLE);
    seat(graph, 'idler-c2', 'socket-c2-drive');
    seat(graph, 'valve-c2-1', 'socket-c2-feed-a');
    settle(graph, puzzle);

    expect(puzzle.reasonCodes).toEqual(['c2/drive-sense']);
    expect(graph.machineState('C2-quench')?.outputs.find((output) => output.kind === 'rotation')?.spin).toBe('ccw');
  });

  it('refuses the blanking plate: it fits the mount and cannot bridge it', () => {
    const { graph, puzzle } = scene(C2_PUZZLE);
    seat(graph, 'plate-c2', 'socket-c2-drive');
    seat(graph, 'valve-c2-1', 'socket-c2-feed-a');
    settle(graph, puzzle);

    expect(puzzle.reasonCodes).toContain('c2/drive-coupled');
    expect(puzzle.state).not.toBe('Complete');
  });

  it('refuses two quench feeds: the combining machine carries the ceiling too', () => {
    const { graph, puzzle } = scene(C2_PUZZLE);
    seat(graph, 'gear-c2', 'socket-c2-drive');
    seat(graph, 'valve-c2-1', 'socket-c2-feed-a');
    seat(graph, 'valve-c2-2', 'socket-c2-feed-b');
    settle(graph, puzzle);

    expect(graph.machineState('C2-quench')?.warnings).toContain('overpressure');
    expect(puzzle.reasonCodes).toEqual(['c2/no-overpressure']);
  });
});

describe('C3 "Slag Run" — the open-ended problem (§7 beat 4)', () => {
  it('accepts one part per consumer (A + B)', () => {
    const { graph, puzzle } = scene(C3_PUZZLE);
    seat(graph, 'valve-c3-1', 'socket-c3-route-a');
    seat(graph, 'valve-c3-2', 'socket-c3-route-b');
    settle(graph, puzzle);

    expect(puzzle.reasonCodes).toEqual([]);
    expect(puzzle.state).toBe('Complete');
  });

  it('accepts the cross-run alone (C)', () => {
    const { graph, puzzle } = scene(C3_PUZZLE);
    seat(graph, 'valve-c3-3', 'socket-c3-route-c');
    settle(graph, puzzle);

    expect(puzzle.reasonCodes).toEqual([]);
    expect(puzzle.state).toBe('Complete');
    // The one part really does reach both consumers: two conducting outputs. Each reads 2
    // because the cross-run's two declared links share one bridge, so its carrier sums there
    // — the same arithmetic P3's cross-run uses, and what the 2.5 ceiling is set around.
    const outputs = graph.machineState('C3-slag')?.outputs ?? [];
    expect(outputs).toHaveLength(2);
    expect(outputs.every((output) => output.value === 2)).toBe(true);
  });

  it('refuses a cross-run stacked on a single run (A + C): one consumer is fed twice', () => {
    const { graph, puzzle } = scene(C3_PUZZLE);
    seat(graph, 'valve-c3-1', 'socket-c3-route-a');
    seat(graph, 'valve-c3-3', 'socket-c3-route-c');
    settle(graph, puzzle);

    expect(graph.machineState('C3-slag')?.warnings).toContain('overpressure');
    expect(puzzle.reasonCodes).toEqual(['c3/no-overpressure']);
    expect(puzzle.state).not.toBe('Complete');
  });

  it('refuses a shut-off valve: the run it sits in dead-ends', () => {
    const { graph, puzzle } = scene(C3_PUZZLE);
    seat(graph, 'shutoff-c3', 'socket-c3-route-a');
    seat(graph, 'valve-c3-2', 'socket-c3-route-b');
    settle(graph, puzzle);

    expect(puzzle.reasonCodes).toContain('c3/cast-route');
    expect(puzzle.reasonCodes).toContain('c3/no-jam');
  });
});

describe('CM-3 "Great Crucible" — the staged capstone (§6 beats 5–6, ADR-018)', () => {
  function assembled(actions: ActionHistory) {
    const content = shippedContent();
    const graph = shippedGraph();
    const puzzle = new PuzzleSystem(CM3_PUZZLE, graph, content, {
      readActions: () => actions.actions
    });
    seat(graph, 'gear-cm3', 'socket-cm3-drive');
    seat(graph, 'valve-cm3', 'socket-cm3-feed');
    graph.recomputeIfDirty();
    return { graph, puzzle, content };
  }

  it('builds, then primes, then pours — in that order', () => {
    const actions = new ActionHistory();
    const { graph, puzzle } = assembled(actions);

    puzzle.update(true);
    expect(puzzle.reasonCodes).toContain('cm3/primed');

    actions.append('cm3/prime-quench');
    actions.append('cm3/prime-blast');
    actions.append('cm3/prime-slag');
    puzzle.update(true);
    expect(puzzle.reasonCodes).not.toContain('cm3/primed');
    // Primed but not yet poured: the ordered stage is the one thing left.
    expect(puzzle.reasonCodes).toContain('cm3/staged');

    actions.append('cm3/engage');
    settle(graph, puzzle);
    expect(puzzle.reasonCodes).toEqual([]);
    expect(puzzle.state).toBe('Complete');
  });

  it('refuses a pour thrown before the lines are primed, and recovers on a second pour', () => {
    const actions = new ActionHistory();
    const { graph, puzzle, content } = assembled(actions);

    actions.append('cm3/engage');
    actions.append('cm3/prime-blast');
    actions.append('cm3/prime-quench');
    actions.append('cm3/prime-slag');
    settle(graph, puzzle);

    // The reason code is asserted through the validator directly, because the SM exposes
    // failed requirement *ids* only — and "out of order" is the one failure whose words
    // matter to the player.
    const staged = evaluateRequirements(CM3_PUZZLE.requirements, {
      graph,
      content,
      actions: actions.actions
    }).requirements.find((entry) => entry.id === 'cm3/staged');
    expect(staged?.satisfied).toBe(false);
    expect(staged?.reason).toBe('sequence/out-of-order');

    actions.append('cm3/engage');
    settle(graph, puzzle);
    expect(puzzle.state).toBe('Complete');
  });

  it('refuses an idler on the vessel: the capstone keeps the branch\u2019s direction lesson', () => {
    const actions = new ActionHistory();
    const content = shippedContent();
    const graph = shippedGraph();
    seat(graph, 'idler-cm3', 'socket-cm3-drive');
    seat(graph, 'valve-cm3', 'socket-cm3-feed');
    actions.append('cm3/prime-blast');
    actions.append('cm3/prime-quench');
    actions.append('cm3/prime-slag');
    actions.append('cm3/engage');
    const puzzle = new PuzzleSystem(CM3_PUZZLE, graph, content, {
      readActions: () => actions.actions
    });
    settle(graph, puzzle);

    expect(puzzle.reasonCodes).toEqual(['cm3/drive-sense']);
    expect(puzzle.state).not.toBe('Complete');
  });
});
