import { describe, expect, it } from 'vitest';

import { FeedbackModel } from '../../src/gameplay/feedback-model.ts';
import type {
  ManipulationEvent,
  ManipulationStepResult
} from '../../src/gameplay/manipulation-system.ts';
import type { MachineChanged, MachineDerivedState } from '../../src/game-state/machine-graph.ts';
import type { PuzzleUpdate } from '../../src/game-state/puzzle-system.ts';

/**
 * TEST §9/§6 — the feedback translation model (ARCH §32.1). It is plain logic, so
 * the whole "what is warranted" contract is pinned headlessly: edges rather than
 * levels, one celebration per completion, and objective changes only on change.
 */

function manipulationResult(events: ReadonlyArray<ManipulationEvent>): ManipulationStepResult {
  return {
    state: 'Exploration',
    previousState: 'Exploration',
    heldId: null,
    pose: { center: { x: 0, y: 0, z: 0 }, yaw: 0 },
    blocked: false,
    events
  };
}

function derived(
  state: MachineDerivedState['state'],
  spin: MachineDerivedState['outputs'][number]['spin'] = 'cw'
): MachineDerivedState {
  return {
    machineId: 'P1-mesh',
    state,
    outputs: [{ nodeId: 'component:shaft-b', kind: 'rotation', value: state === 'running' ? 1 : 0, spin }],
    nodeStates: [],
    warnings: []
  };
}

function machineChanged(state: MachineDerivedState): MachineChanged {
  return {
    reason: 'attach',
    componentId: 'gear-a',
    socketId: 'socket-mesh',
    attachments: 3,
    machines: [state]
  };
}

function puzzleUpdate(overrides: Partial<PuzzleUpdate> = {}): PuzzleUpdate {
  return {
    puzzleId: 'P1',
    state: 'InProgress',
    previousState: 'InProgress',
    satisfied: false,
    streak: 0,
    reasonCodes: [],
    events: [],
    ...overrides
  };
}

describe('FeedbackModel — §32.1 translation and dedupe', () => {
  it('emits nothing at all when nothing was reported', () => {
    const model = new FeedbackModel();
    expect(model.step({})).toEqual([]);
    expect(model.step({ manipulation: null, machine: null, puzzles: [] })).toEqual([]);
  });

  it('turns manipulation edges into attach / refuse / detach intents', () => {
    const model = new FeedbackModel();

    const intents = model.step({
      manipulation: manipulationResult([
        { type: 'Attached', id: 'gear-a' },
        { type: 'AttachRefused', id: 'plate-a', reason: 'Occupied' },
        { type: 'Detached', id: 'gear-a' },
        { type: 'Grabbed', id: 'gear-a' }
      ])
    });

    expect(intents).toEqual([
      { kind: 'attach-confirmed', componentId: 'gear-a' },
      { kind: 'attach-refused', componentId: 'plate-a', reason: 'Occupied' },
      { kind: 'detach-confirmed', componentId: 'gear-a' }
    ]);
  });

  it('reports machine running/idle as edges carrying the output spin', () => {
    const model = new FeedbackModel();

    expect(model.step({ machine: machineChanged(derived('running')) })).toEqual([
      { kind: 'machine-running', machineId: 'P1-mesh', spin: 'cw' }
    ]);

    // Unchanged levels produce nothing: feedback is an edge stream, not a per-frame one.
    expect(model.step({ machine: machineChanged(derived('running')) })).toEqual([]);

    expect(model.step({ machine: machineChanged(derived('idle', null)) })).toEqual([
      { kind: 'machine-idle', machineId: 'P1-mesh' }
    ]);

    // A machine that never ran going idle is not an event either.
    expect(model.step({ machine: machineChanged(derived('idle', null)) })).toEqual([]);
  });

  it('celebrates a completion exactly once, even if the latch were re-reported', () => {
    const model = new FeedbackModel();
    const completed = puzzleUpdate({
      state: 'Complete',
      previousState: 'Activated',
      satisfied: true,
      events: [{ type: 'PuzzleCompleted', puzzleId: 'P1', milestoneId: 'milestone/p1-first-mesh' }]
    });

    expect(model.step({ puzzles: [completed] })).toEqual([
      { kind: 'puzzle-stage', puzzleId: 'P1', state: 'Complete' },
      { kind: 'puzzle-completed', puzzleId: 'P1', milestoneId: 'milestone/p1-first-mesh' },
      { kind: 'objective-changed', puzzleId: 'P1', reasonCode: null }
    ]);

    // Re-reported: the stage is unchanged and the celebration is already spent.
    expect(model.step({ puzzles: [completed] })).toEqual([]);
  });

  it('reports objective changes only when the failed-requirement set changes (§25)', () => {
    const model = new FeedbackModel();
    const failing = puzzleUpdate({
      reasonCodes: ['p1/drive-through-gear', 'p1/output-turning']
    });

    expect(model.step({ puzzles: [failing] }).map((intent) => intent.kind)).toEqual([
      'puzzle-stage',
      'objective-changed'
    ]);
    expect(model.step({ puzzles: [failing] })).toEqual([]);

    const progressed = puzzleUpdate({ reasonCodes: ['p1/output-turning'] });
    expect(model.step({ puzzles: [progressed] })).toEqual([
      { kind: 'objective-changed', puzzleId: 'P1', reasonCode: 'p1/output-turning' }
    ]);
  });
});
