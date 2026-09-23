import { describe, expect, it } from 'vitest';

import {
  BRANCH_A_ID,
  BRANCH_B_ID,
  BRANCH_C_ID,
  BRANCH_DEFINITIONS
} from '../../src/data/branches.ts';
import { HUB_STAGE_DEFINITIONS } from '../../src/data/hub-stages.ts';
import { P1_PUZZLE } from '../../src/data/puzzles/index.ts';
import { MachineGraph } from '../../src/game-state/machine-graph.ts';
import {
  ProgressionSystem,
  type BranchDefinition
} from '../../src/game-state/progression-system.ts';
import { PuzzleSystem } from '../../src/game-state/puzzle-system.ts';
import {
  SaveCodec,
  type SaveCaptureInput,
  type SaveTargets
} from '../../src/game-state/save-codec.ts';
import { BRANCH_A_INITIAL_ATTACHMENTS } from '../../src/levels/branch-a.ts';
import { branchContent } from './support/branch-a-content.ts';

/**
 * PROGRESSION (ARCH §26, §12.2) and the §25 gating states.
 *
 * The load-bearing property is that progression keeps **no second copy** of anything
 * the puzzle SMs already own: branch state and the hub stage are derived from the
 * completed-puzzle set, and the clue seen-id set is its only canonical field. Most of
 * this file exists to pin that down, because a duplicate would be invisible until a
 * save round-trip disagreed with itself.
 */

function scene(): { graph: MachineGraph; puzzle: PuzzleSystem } {
  const content = branchContent();
  const graph = new MachineGraph();
  graph.configure(content);
  graph.reset(BRANCH_A_INITIAL_ATTACHMENTS);
  graph.recomputeIfDirty();
  return { graph, puzzle: new PuzzleSystem(P1_PUZZLE, graph, content) };
}

function progression(): ProgressionSystem {
  return new ProgressionSystem(BRANCH_DEFINITIONS, HUB_STAGE_DEFINITIONS);
}

describe('ProgressionSystem — branch state is derived, never stored (ARCH §26)', () => {
  it('walks branch A Available → InProgress → Complete from its puzzles alone', () => {
    const system = progression();
    expect(system.branchState(BRANCH_A_ID)).toBe('Available');

    system.update(['P1']);
    expect(system.branchState(BRANCH_A_ID)).toBe('InProgress');

    // §6 beats 5–8: P1–P3 are the branch's teaching/combining/open-ended machines; the
    // branch is not Complete until its *final* machine (BM-1) has run, because the
    // reward/access beat and the central-machine clue come after it.
    system.update(['P1', 'P2', 'P3']);
    expect(system.branchState(BRANCH_A_ID)).toBe('InProgress');

    system.update(['P1', 'P2', 'P3', 'BM-1']);
    expect(system.branchState(BRANCH_A_ID)).toBe('Complete');
    expect(system.isBranchComplete(BRANCH_A_ID)).toBe(true);
  });

  it('never opens a sealed branch, and never opens an unknown one', () => {
    const system = progression();
    system.update(['P1', 'P2', 'P3', 'BM-1']);
    // §6: B and C are sealed visuals in the MVP — content absence is explicit data,
    // so a door and progression cannot disagree about it.
    expect(system.branchState(BRANCH_B_ID)).toBe('Locked');
    expect(system.branchState(BRANCH_C_ID)).toBe('Locked');
    // A door naming a branch that does not exist must not open either.
    expect(system.branchState('branch/does-not-exist')).toBe('Locked');
  });

  it('advances the hub stage from branch completion', () => {
    const system = progression();
    expect(system.hubStage.id).toBe('stage/dormant');
    expect(system.hubStageIndex).toBe(0);

    system.update(['P1', 'P2', 'P3', 'BM-1']);
    expect(system.hubStageIndex).toBe(1);
    expect(system.hubStage.id).toBe('stage/pressure-online');

    // Stage 2 requires branch B, which is sealed: there is no stored stage field to
    // corrupt, so an invented "stage 2" save state is not even representable.
    expect(system.isBranchComplete(BRANCH_B_ID)).toBe(false);
    expect(system.hubStageIndex).toBe(1);
  });

  it('gates a branch behind another branch\'s completion', () => {
    const branches: ReadonlyArray<BranchDefinition> = [
      { id: 'a', title: 'A', puzzleIds: ['P1'], requiresBranches: [], sealed: false },
      { id: 'b', title: 'B', puzzleIds: ['P2'], requiresBranches: ['a'], sealed: false }
    ];
    const system = new ProgressionSystem(branches, HUB_STAGE_DEFINITIONS);

    expect(system.branchState('b')).toBe('Locked');
    system.update(['P1']);
    expect(system.branchState('a')).toBe('Complete');
    expect(system.branchState('b')).toBe('Available');
    // The gate and the puzzle SM agree: an unlocked branch's puzzle starts enterable.
    expect(system.initialPuzzleState('P2')).toBe('InProgress');
  });

  it('starts a gated puzzle Locked and an in-scene puzzle InProgress (§25)', () => {
    const system = progression();
    // Branch A is neither sealed nor gated and the MVP ships one scene, so its
    // puzzles are entered at load — exactly the behaviour M6 shipped.
    expect(system.initialPuzzleState('P1')).toBe('InProgress');
    expect(system.initialPuzzleState('unknown-puzzle')).toBe('Locked');

    const sealed: ReadonlyArray<BranchDefinition> = [
      { id: 'sealed', title: 'S', puzzleIds: ['PX'], requiresBranches: [], sealed: true }
    ];
    expect(new ProgressionSystem(sealed, HUB_STAGE_DEFINITIONS).initialPuzzleState('PX')).toBe('Locked');
  });

  it('tracks discovered clues as a seen-id set and resets on New Game', () => {
    const system = progression();
    expect(system.discoverClue('clue/regulator-1')).toBe(true);
    expect(system.discoverClue('clue/regulator-1')).toBe(false);
    system.discoverClue('clue/gallery-1');
    expect(system.discoveredClueIds).toEqual(['clue/gallery-1', 'clue/regulator-1']);

    system.restoreClues(['clue/elsewhere']);
    expect(system.discoveredClueIds).toEqual(['clue/elsewhere']);

    system.update(['P1', 'P2', 'P3', 'BM-1']);
    system.resetAll();
    expect(system.discoveredClueIds).toEqual([]);
    expect(system.branchState(BRANCH_A_ID)).toBe('Available');
    expect(system.hubStage.id).toBe('stage/dormant');
  });
});

describe('PuzzleSystem gating — Locked / Available are real states (ARCH §25)', () => {
  it('evaluates nothing while gated, then walks Locked → Available → InProgress', () => {
    const { graph, puzzle } = scene();
    const gated = new PuzzleSystem(
      P1_PUZZLE,
      graph,
      graph.contentBundle,
      { initialState: 'Locked' }
    );

    // A gated puzzle reports nothing at all — not "every requirement failed".
    const beforeUnlock = gated.update(true);
    expect(gated.state).toBe('Locked');
    expect(beforeUnlock.satisfied).toBeNull();
    expect(beforeUnlock.reasonCodes).toEqual([]);
    expect(gated.isGated).toBe(true);

    expect(gated.unlock()).toBe(true);
    // Idempotent: a repeat unlock is a no-op, never a second edge.
    expect(gated.unlock()).toBe(false);
    expect(gated.state).toBe('Available');
    expect(gated.update(true).reasonCodes).toEqual([]);

    expect(gated.begin()).toBe(true);
    expect(gated.begin()).toBe(false);
    expect(gated.isGated).toBe(false);
    expect(gated.state).toBe('InProgress');
    // Only now does the §33.1 objective line appear.
    expect(gated.update(true).reasonCodes).toEqual(['p1/drive-through-gear', 'p1/output-turning']);

    expect(puzzle.state).toBe('InProgress');
  });

  it('never resets a gated puzzle into play (§25: only a started puzzle re-opens)', () => {
    const { graph } = scene();
    const content = graph.contentBundle;
    const locked = new PuzzleSystem(P1_PUZZLE, graph, content, { initialState: 'Locked' });
    locked.reset();
    expect(locked.state).toBe('Locked');

    locked.unlock();
    locked.reset();
    expect(locked.state).toBe('Available');

    locked.begin();
    locked.reset();
    expect(locked.state).toBe('InProgress');
  });

  it('keeps a saved gating state across a load, and reloads mid-assembly as InProgress', () => {
    const { graph, puzzle } = scene();
    const content = graph.contentBundle;

    const fresh = new PuzzleSystem(P1_PUZZLE, graph, content);
    // §25 lists every state as "Persisted: yes" — a locked branch's puzzle must not
    // come back enterable.
    fresh.restore('Locked');
    expect(fresh.state).toBe('Locked');
    fresh.restore('Available');
    expect(fresh.state).toBe('Available');
    // Every other non-terminal state replays its stable window (the M7 R-6 path).
    fresh.restore('Assembled');
    expect(fresh.state).toBe('InProgress');
    fresh.restore('Validated');
    expect(fresh.state).toBe('InProgress');
    fresh.restore('Complete');
    expect(fresh.state).toBe('Complete');

    expect(puzzle.state).toBe('InProgress');
  });
});

describe('Progression persistence — one canonical field, through the codec (ARCH §31.1)', () => {
  function captureInput(overrides: Partial<SaveCaptureInput> = {}): SaveCaptureInput {
    return {
      savedAt: 1_700_000_000_000,
      playtimeSec: 42,
      slot: 'autosave',
      ledger: { grantedIds: [] },
      inventory: {
        partIds: [],
        materialCounts: { scrap: 0, brass: 0, sealant: 0, alloy: 0 },
        blueprintIds: []
      },
      checkpoint: { id: 'CP-00', anchorId: 'spawn/lab' },
      puzzles: [],
      machineEdges: [],
      components: [],
      ...overrides
    };
  }

  /** Fresh closures over a target progression + puzzle recorder. */
  function targets(progressionRef: ProgressionSystem, puzzleStates: Map<string, string>): SaveTargets {
    return {
      ledger: { restore: () => {}, confirm: () => false },
      inventory: { restore: () => {} },
      checkpoint: { restore: () => {} },
      graph: { reset: () => {} },
      puzzles: [
        { puzzleId: 'P1', restore: (state: string) => puzzleStates.set('P1', state) }
      ],
      progression: {
        restore: (snapshot) => progressionRef.restoreClues(snapshot.clues)
      }
    };
  }

  it('round-trips the clue set, and derives branch/hub state from the puzzles instead of storing it', () => {
    const codec = new SaveCodec([{ id: 'P1', milestoneId: 'milestone/p1-first-mesh' }]);
    const source = progression();
    source.discoverClue('clue/regulator-1');
    source.discoverClue('clue/gallery-1');

    const save = codec.capture(
      captureInput({
        storyClues: source.discoveredClueIds,
        puzzles: [{ puzzleId: 'P1', state: 'Complete' }]
      })
    );
    // The v1 `progression` object carries exactly this: completed puzzles + clues.
    expect(save.progression.storyClues).toEqual(['clue/gallery-1', 'clue/regulator-1']);
    expect(save.progression.completedPuzzles).toEqual(['P1']);

    const decoded = codec.decode(codec.encode(save));
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;

    const restored = progression();
    const puzzleStates = new Map<string, string>();
    codec.apply(decoded.save, targets(restored, puzzleStates));

    expect(restored.discoveredClueIds).toEqual(['clue/gallery-1', 'clue/regulator-1']);
    expect(puzzleStates.get('P1')).toBe('Complete');

    // Nothing about the branch or the hub stage was read from the file — they re-derive.
    restored.update(['P1']);
    expect(restored.branchState(BRANCH_A_ID)).toBe('InProgress');
    expect(restored.hubStage.id).toBe('stage/dormant');
    restored.update(['P1', 'P2', 'P3', 'BM-1']);
    expect(restored.hubStage.id).toBe('stage/pressure-online');
  });

  it('refuses a document whose progression object is missing or malformed', () => {
    const codec = new SaveCodec([]);
    const valid = codec.capture(captureInput());
    const dropProgression = { ...valid } as Record<string, unknown>;
    delete dropProgression['progression'];

    const missing = codec.decode(JSON.stringify(dropProgression));
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.reason).toBe('schema');

    const malformed = codec.decode(
      JSON.stringify({ ...valid, progression: { completedPuzzles: [], storyClues: [7] } })
    );
    expect(malformed.ok).toBe(false);
    if (!malformed.ok) expect(malformed.reason).toBe('schema');
  });
});
