import { describe, expect, it } from 'vitest';

import { BM1_PRESSURE_DYNAMO } from '../../src/data/machines.ts';
import { BM1_PUZZLE } from '../../src/data/puzzles/bm1.ts';
import { MILESTONE_BM1_PRESSURE_DYNAMO } from '../../src/data/rewards.ts';
import { isStagedAction, STAGED_ACTIONS } from '../../src/data/actions.ts';
import { BM1_PROPS, bm1PropInteractables, bm1PropMeshes } from '../../src/levels/branch-a.ts';
import { ActionHistory } from '../../src/game-state/action-history.ts';
import type { MachineContent } from '../../src/game-state/component-registry.ts';
import type { MachineGraph } from '../../src/game-state/machine-graph.ts';
import { DEFAULT_STABLE_STEPS, evaluateRequirements } from '../../src/game-state/validator.ts';
import { PuzzleSystem, type PuzzleUpdate } from '../../src/game-state/puzzle-system.ts';
import { branchContent, branchGraph } from './support/branch-a-content.ts';

/**
 * M9 remainder — BM-1 "Pressure Dynamo", the MVP's staged puzzle (ADR-018, §7).
 *
 * These suites play the *shipped* content end to end: the branch fixture hands L1 the
 * same definitions and placements the composition root will, a live `ActionHistory`
 * plays the §31.4 triggers, and a real `PuzzleSystem` walks §25. No requirement is
 * re-derived by hand here — every expectation flows through `evaluateRequirements`.
 */

const BM1_REQUIREMENTS = BM1_PUZZLE.requirements;

/** BM-1 evaluated against the branch graph with a live action log behind it. */
function evaluateBm1(graph: MachineGraph, content: MachineContent, history: ActionHistory) {
  return evaluateRequirements(BM1_REQUIREMENTS, {
    graph,
    content,
    actions: history.actions,
    previousStreak: 0,
    stableSteps: DEFAULT_STABLE_STEPS
  });
}

/** The branch's initial state, solved only through the BM-1 sockets. */
function assembleBm1(options: { gear?: string; pipe?: string } = {}): {
  graph: MachineGraph;
  content: MachineContent;
} {
  const content = branchContent();
  const attachments = [
    ...(options.gear === undefined ? [] : [{ componentId: options.gear, socketId: 'socket-bm1-drive' }]),
    ...(options.pipe === undefined ? [] : [{ componentId: options.pipe, socketId: 'socket-bm1-line' }])
  ];
  const graph = branchGraph({ attachments });
  return { graph, content };
}

describe('BM-1 — the assembly stage is ordinary propagation (P1–P3 mechanics)', () => {
  it('starts inert: the sources live but nothing is bridged, nothing primed', () => {
    const history = new ActionHistory();
    const { graph, content } = assembleBm1();

    // The machine is `powered`, not `idle`: both sources seed it by construction
    // (exactly as P1's crank does), but no output exists until a part bridges the
    // run. Sources are potential; outputs are achievement.
    const machine = graph.machineState('BM-1');
    expect(machine?.state).toBe('powered');
    expect(machine?.outputs).toEqual([]);

    const result = evaluateBm1(graph, content, history);
    expect(result.satisfied).toBe(false);
    expect(result.reasonCodes).toContain('bm1/structure-drive');
    expect(result.reasonCodes).toContain('bm1/structure-line');
    expect(result.reasonCodes).toContain('bm1/primed');
    expect(result.reasonCodes).toContain('bm1/staged');
  });

  it('a gear in the drive mount and a pipe in the line port power both outputs', () => {
    const history = new ActionHistory();
    const { graph, content } = assembleBm1({ gear: 'gear-bm1', pipe: 'valve-bm1' });

    const machine = graph.machineState('BM-1');
    expect(machine?.state).toBe('running');
    expect(machine?.outputs.find((output) => output.kind === 'rotation')?.value).toBe(1);
    expect(machine?.outputs.find((output) => output.kind === 'pressure')?.value).toBe(1);

    const result = evaluateBm1(graph, content, history);
    expect(result.reasonCodes).not.toContain('bm1/structure-drive');
    expect(result.reasonCodes).not.toContain('bm1/structure-line');
    expect(result.reasonCodes).not.toContain('bm1/drive-up');
    expect(result.reasonCodes).not.toContain('bm1/pressure-up');
    expect(result.reasonCodes).not.toContain('bm1/no-jam');
    expect(result.reasonCodes).toContain('bm1/primed');
    expect(result.reasonCodes).toContain('bm1/staged');
  });

  it('the blanking plate fits the drive mount and cannot bridge (P1 lesson, restated)', () => {
    const history = new ActionHistory();
    const { graph, content } = assembleBm1({ gear: 'plate-bm1', pipe: 'valve-bm1' });

    const result = evaluateBm1(graph, content, history);
    expect(result.reasonCodes).toContain('bm1/structure-drive');
    expect(result.reasonCodes).toContain('bm1/drive-up');
    expect(result.reasonCodes).not.toContain('bm1/structure-line');
    expect(result.reasonCodes).not.toContain('bm1/pressure-up');
  });

describe('BM-1 — the shut-off valve and the priming vocabulary', () => {
  it('the shut-off valve fits the line port and conducts nothing (P3 lesson, restated)', () => {
    const history = new ActionHistory();
    const { graph, content } = assembleBm1({ gear: 'gear-bm1', pipe: 'shutoff-bm1' });

    const result = evaluateBm1(graph, content, history);
    expect(result.reasonCodes).toContain('bm1/structure-line');
    expect(result.reasonCodes).toContain('bm1/pressure-up');
    expect(result.reasonCodes).not.toContain('bm1/structure-drive');
    expect(result.reasonCodes).not.toContain('bm1/drive-up');
  });

  it('all three priming actions satisfy `primed`, in any order', () => {
    const { graph, content } = assembleBm1({ gear: 'gear-bm1', pipe: 'valve-bm1' });
    const history = new ActionHistory();

    history.append('bm1/prime-bleed');
    expect(evaluateBm1(graph, content, history).reasonCodes).toContain('bm1/primed');
    history.append('bm1/prime-feed');
    history.append('bm1/prime-return');
    expect(evaluateBm1(graph, content, history).reasonCodes).not.toContain('bm1/primed');
  });

  it('priming actions name only the shipped staged vocabulary (§24.1 ids are data)', () => {
    expect([...(BM1_PRESSURE_DYNAMO.primingActions ?? [])]).toEqual(STAGED_ACTIONS.slice(0, 3));
    for (const action of STAGED_ACTIONS) {
      expect(isStagedAction(action)).toBe(true);
    }
    expect(isStagedAction('x/not-a-staged-action')).toBe(false);
  });
});

describe('BM-1 — the activation sequence (ADR-018)', () => {
  it('an early engage never completes: the engage must be witnessed after priming', () => {
    const { graph, content } = assembleBm1({ gear: 'gear-bm1', pipe: 'valve-bm1' });
    const history = new ActionHistory();

    history.append('bm1/engage');
    // `primed` is unsatisfied, so the sequence reports `unmet` first: a player who
    // never primed gets "the stage is not finished" before they get "the order is
    // wrong". The out-of-order case below is the one that has primed, after engaging.
    let result = evaluateBm1(graph, content, history);
    expect(result.satisfied).toBe(false);
    expect(result.requirements.find((requirement) => requirement.id === 'bm1/staged')?.reason).toBe(
      'sequence/unmet'
    );

    history.append('bm1/prime-feed');
    history.append('bm1/prime-return');
    history.append('bm1/prime-bleed');
    // Now every step is satisfied but the only engage precedes the priming: the
    // player must throw the lever *again* — which is the recovery the prompt asks for.
    result = evaluateBm1(graph, content, history);
    expect(result.reasonCodes).toContain('bm1/staged');
    expect(result.requirements.find((requirement) => requirement.id === 'bm1/staged')?.reason).toBe(
      'sequence/out-of-order'
    );
    history.append('bm1/engage');
    result = evaluateBm1(graph, content, history);
    expect(result.satisfied).toBe(true);
  });
});


describe('BM-1 — a real PuzzleSystem walks §25 to Complete (EC-PZ-01/02)', () => {
  it('the correct play latches exactly once, with the BM-1 milestone', () => {
    const { graph, content } = assembleBm1({ gear: 'gear-bm1', pipe: 'valve-bm1' });
    const history = new ActionHistory();
    const puzzle = new PuzzleSystem(BM1_PUZZLE, graph, content, {
      readActions: () => history.actions,
      stableSteps: DEFAULT_STABLE_STEPS
    });

    let update = puzzle.update(true);
    expect(update.satisfied).toBe(false);

    history.append('bm1/prime-feed');
    history.append('bm1/prime-return');
    history.append('bm1/prime-bleed');
    history.append('bm1/engage');
    // One satisfied evaluation only *opens* the hysteresis window (§25 Assembled);
    // each open window re-evaluates regardless of the changed flag — so stepping
    // again climbs the streak through Validated to the latch. A single call never
    // walks them all because each guard needs the previous state's confirmation
    // (EC-PZ-01: confirmation is `confirmed`, never a bare `satisfied`).
    // Drive the SM two openings and two windows: record every step so a failure reads
    // as a walk-through of the §25 table (InProgress -> Assembled -> Validated ->
    // Activated -> Complete) rather than as a bare assertion. The completion event is
    // captured, not read off the last step: the latch fires mid-walk and a later
    // iteration's update drains the event buffer — asserting on the final update
    // would test loop arithmetic instead of the latch (EC-PZ-02).
    let completion: PuzzleUpdate | undefined;
    for (let step = 0; step < 2 * (DEFAULT_STABLE_STEPS + 1) + 2; step += 1) {
      update = puzzle.update(true);
      if (update.events.length > 0) completion = update;
      // eslint-disable-next-line no-console
      console.log(
        `step ${step}: state=${update.state} streak=${update.streak} satisfied=${String(update.satisfied)} codes=[${update.reasonCodes.join('|')}]`
      );
    }
    expect(puzzle.state).toBe('Complete');
    expect(update.state).toBe('Complete');
    expect(puzzle.reasonCodes).toEqual([]);
    expect(completion).toBeDefined();
    // The walk emits the §25 transitions too; exactly one of them is the latch.
    const completed = completion?.events.filter((event) => event.type === 'PuzzleCompleted') ?? [];
    expect(completed).toHaveLength(1);
    expect(completed[0]).toMatchObject({ type: 'PuzzleCompleted', milestoneId: MILESTONE_BM1_PRESSURE_DYNAMO });
  });

  it('props and their visuals read the same log the validator reads (ADR-018)', () => {
    expect(BM1_PROPS.map((prop) => prop.id)).toEqual([...STAGED_ACTIONS]);
    expect(bm1PropInteractables(false).every((prop) => prop.enabled === false)).toBe(true);
    expect(bm1PropInteractables(true).every((prop) => prop.enabled === true)).toBe(true);
    expect(bm1PropInteractables(true).every((prop) => prop.kind === 'prop')).toBe(true);

    const dark = bm1PropMeshes(() => false);
    expect(new Set(dark.map((mesh) => mesh.color)).size).toBe(1);
    const lit = bm1PropMeshes((action) => action === 'bm1/prime-feed');
    const feed = lit[BM1_PROPS.findIndex((prop) => prop.id === 'bm1/prime-feed')];
    const engage = lit[BM1_PROPS.findIndex((prop) => prop.id === 'bm1/engage')];
    expect(feed?.color).not.toBe(engage?.color);
  });
});

});
