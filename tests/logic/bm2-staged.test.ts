import { describe, expect, it } from 'vitest';

import { BM2_STEAM_ENGINE } from '../../src/data/machines.ts';
import { BM2_PUZZLE } from '../../src/data/puzzles/bm2.ts';
import { MILESTONE_BM2_STEAM_ENGINE } from '../../src/data/rewards.ts';
import { isStagedAction, STAGED_ACTIONS } from '../../src/data/actions.ts';
import { BM2_PROPS, bm2PropInteractables, bm2PropMeshes } from '../../src/levels/branch-b.ts';
import { ActionHistory } from '../../src/game-state/action-history.ts';
import { MachineGraph } from '../../src/game-state/machine-graph.ts';
import type { MachineContent } from '../../src/game-state/component-registry.ts';
import { DEFAULT_STABLE_STEPS, evaluateRequirements } from '../../src/game-state/validator.ts';
import { PuzzleSystem, type PuzzleUpdate } from '../../src/game-state/puzzle-system.ts';
import { shippedContent } from './support/branch-a-content.ts';

/**
 * BRANCH B — BM-2 "Steam Engine", the second staged puzzle (ADR-018).
 *
 * ADR-018's staged pattern is not BM-1-specific: this plays the *shipped* Branch B
 * content through the same validator, the same `ActionHistory` and the same
 * `PuzzleSystem`, proving assembly → priming → activation generalises with content
 * alone. No requirement is re-derived by hand — every expectation flows through
 * `evaluateRequirements`.
 */

const BM2_REQUIREMENTS = BM2_PUZZLE.requirements;

/** BM-2 assembled only through its own sockets, on the shipped content bundle. */
function assembleBm2(options: { gear?: string; pipe?: string } = {}): {
  graph: MachineGraph;
  content: MachineContent;
} {
  const content = shippedContent();
  const attachments = [
    ...(options.gear === undefined ? [] : [{ componentId: options.gear, socketId: 'socket-bm2-drive' }]),
    ...(options.pipe === undefined ? [] : [{ componentId: options.pipe, socketId: 'socket-bm2-steam' }])
  ];
  const graph = new MachineGraph();
  graph.configure(content);
  graph.reset(attachments);
  graph.recomputeIfDirty();
  return { graph, content };
}

function evaluateBm2(graph: MachineGraph, content: MachineContent, history: ActionHistory) {
  return evaluateRequirements(BM2_REQUIREMENTS, {
    graph,
    content,
    actions: history.actions,
    previousStreak: 0,
    stableSteps: DEFAULT_STABLE_STEPS
  });
}

describe('BM-2 — assembly is ordinary propagation, and both carriers must arrive', () => {
  it('starts with both sources seeded but nothing bridged', () => {
    const history = new ActionHistory();
    const { graph, content } = assembleBm2();

    const machine = graph.machineState('BM-2');
    expect(machine?.state).toBe('powered');
    expect(machine?.outputs).toEqual([]);

    const result = evaluateBm2(graph, content, history);
    expect(result.satisfied).toBe(false);
    expect(result.reasonCodes).toContain('bm2/structure-drive');
    expect(result.reasonCodes).toContain('bm2/structure-steam');
    expect(result.reasonCodes).toContain('bm2/primed');
    expect(result.reasonCodes).toContain('bm2/staged');
  });

  it('a gear in the drive mount and a pipe in the steam port power both outputs', () => {
    const history = new ActionHistory();
    const { graph, content } = assembleBm2({ gear: 'gear-bm2', pipe: 'valve-bm2' });

    const machine = graph.machineState('BM-2');
    expect(machine?.state).toBe('running');
    expect(machine?.outputs.find((output) => output.kind === 'rotation')?.value).toBe(1);
    expect(machine?.outputs.find((output) => output.kind === 'pressure')?.value).toBe(1);

    const result = evaluateBm2(graph, content, history);
    expect(result.reasonCodes).not.toContain('bm2/structure-drive');
    expect(result.reasonCodes).not.toContain('bm2/structure-steam');
    expect(result.reasonCodes).not.toContain('bm2/flywheel-up');
    expect(result.reasonCodes).not.toContain('bm2/steam-up');
    expect(result.reasonCodes).not.toContain('bm2/no-jam');
    // Only the staged half is outstanding.
    expect(result.reasonCodes).toContain('bm2/primed');
    expect(result.reasonCodes).toContain('bm2/staged');
  });

  it('the blanking plate fits the drive mount and cannot bridge; the shut-off blocks steam', () => {
    const history = new ActionHistory();
    const { graph, content } = assembleBm2({ gear: 'plate-bm2', pipe: 'shutoff-bm2' });

    const result = evaluateBm2(graph, content, history);
    expect(result.reasonCodes).toContain('bm2/structure-drive');
    expect(result.reasonCodes).toContain('bm2/flywheel-up');
    expect(result.reasonCodes).toContain('bm2/structure-steam');
    expect(result.reasonCodes).toContain('bm2/steam-up');
    expect(result.reasonCodes).toContain('bm2/no-jam');
  });
});

describe('BM-2 — the priming vocabulary and the activation order (ADR-018)', () => {
  it('primes from all three lines in any order, and the vocabulary is the shipped set', () => {
    const { graph, content } = assembleBm2({ gear: 'gear-bm2', pipe: 'valve-bm2' });
    const history = new ActionHistory();

    history.append('bm2/prime-drain');
    expect(evaluateBm2(graph, content, history).reasonCodes).toContain('bm2/primed');
    history.append('bm2/prime-inlet');
    history.append('bm2/prime-outlet');
    expect(evaluateBm2(graph, content, history).reasonCodes).not.toContain('bm2/primed');

    expect([...(BM2_STEAM_ENGINE.primingActions ?? [])]).toEqual(STAGED_ACTIONS.slice(4, 7));
    for (const action of STAGED_ACTIONS) expect(isStagedAction(action)).toBe(true);
  });

  it('an engage before priming does not complete; engaging after priming does', () => {
    const { graph, content } = assembleBm2({ gear: 'gear-bm2', pipe: 'valve-bm2' });
    const history = new ActionHistory();

    history.append('bm2/engage');
    history.append('bm2/prime-inlet');
    history.append('bm2/prime-outlet');
    history.append('bm2/prime-drain');

    let result = evaluateBm2(graph, content, history);
    expect(result.reasonCodes).toContain('bm2/staged');
    expect(result.requirements.find((entry) => entry.id === 'bm2/staged')?.reason).toBe(
      'sequence/out-of-order'
    );

    history.append('bm2/engage');
    result = evaluateBm2(graph, content, history);
    expect(result.satisfied).toBe(true);
  });

  it('a real PuzzleSystem latches exactly once, with the BM-2 milestone', () => {
    const { graph, content } = assembleBm2({ gear: 'gear-bm2', pipe: 'valve-bm2' });
    const history = new ActionHistory();
    const puzzle = new PuzzleSystem(BM2_PUZZLE, graph, content, {
      readActions: () => history.actions,
      stableSteps: DEFAULT_STABLE_STEPS
    });

    history.append('bm2/prime-inlet');
    history.append('bm2/prime-outlet');
    history.append('bm2/prime-drain');
    history.append('bm2/engage');

    let completion: PuzzleUpdate | undefined;
    for (let step = 0; step < 2 * (DEFAULT_STABLE_STEPS + 1) + 2; step += 1) {
      const update = puzzle.update(true);
      if (update.events.length > 0) completion = update;
    }

    expect(puzzle.state).toBe('Complete');
    expect(puzzle.reasonCodes).toEqual([]);
    const completed = completion?.events.filter((event) => event.type === 'PuzzleCompleted') ?? [];
    expect(completed).toHaveLength(1);
    expect(completed[0]).toMatchObject({
      type: 'PuzzleCompleted',
      milestoneId: MILESTONE_BM2_STEAM_ENGINE
    });
  });

  it('props and their visuals read the same log the validator reads (ADR-018)', () => {
    expect(BM2_PROPS.map((prop) => prop.id)).toEqual([...STAGED_ACTIONS.slice(4)]);
    expect(bm2PropInteractables(false).every((prop) => prop.enabled === false)).toBe(true);
    expect(bm2PropInteractables(true).every((prop) => prop.kind === 'prop')).toBe(true);

    const dark = bm2PropMeshes(() => false);
    expect(new Set(dark.map((mesh) => mesh.color)).size).toBe(1);
    const lit = bm2PropMeshes((action) => action === 'bm2/prime-inlet');
    const inlet = lit[BM2_PROPS.findIndex((prop) => prop.id === 'bm2/prime-inlet')];
    const throttle = lit[BM2_PROPS.findIndex((prop) => prop.id === 'bm2/engage')];
    expect(inlet?.color).not.toBe(throttle?.color);
  });
});
