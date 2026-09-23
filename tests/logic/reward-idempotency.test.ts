import { describe, expect, it } from 'vitest';

import { InventorySystem } from '../../src/game-state/inventory-system.ts';
import { PuzzleSystem, type PuzzleEvent } from '../../src/game-state/puzzle-system.ts';
import { RewardLedger, grantIdOf } from '../../src/game-state/reward-ledger.ts';
import { RewardSystem, type RewardDefinition } from '../../src/gameplay/reward-system.ts';
import { MachineGraph } from '../../src/game-state/machine-graph.ts';
import { SaveCodec, type SaveCaptureInput, type SaveFile } from '../../src/game-state/save-codec.ts';
import { P1_PUZZLE } from '../../src/data/puzzles/p1.ts';
import { MILESTONE_P1_FIRST_MESH, REWARD_DEFINITIONS } from '../../src/data/rewards.ts';
import { p1Content } from './support/p1-mesh.ts';

/**
 * REWARD IDEMPOTENCY (TEST_SUITE_PLAN Â§10) â€” the corruption-class P0 suite.
 * The invariant under everything: inventory and blueprints are functions of
 * the *set* of granted ids, never of the count of events. Every test drives
 * the real grant path (ledger â†’ reward system â†’ inventory) against the real
 * P1 content, and a few go through the full codec capture/decode/apply cycle
 * to prove the ledger's set survives persistence.
 */

const GRANT = grantIdOf('P1', MILESTONE_P1_FIRST_MESH);

/** One grant's material payout, for the "applied exactly once" assertions. */
function scrapOf(inventory: InventorySystem): number {
  return inventory.materialCount('scrap');
}

/** A reward table matching the shipped one, for outcome-level tests. */
const DEFINITIONS: ReadonlyArray<RewardDefinition> = REWARD_DEFINITIONS;

/** Fresh owners + reward system, wired exactly as main.ts wires them. */
function build() {
  const ledger = new RewardLedger();
  const inventory = new InventorySystem();
  const rewards = new RewardSystem(ledger, inventory, DEFINITIONS);
  return { ledger, inventory, rewards };
}

/**
 * A real PuzzleCompleted batch: the P1 machine completed through the shipped
 * content (stableSteps: 1 collapses the hysteresis window for test speed).
 */
function p1CompletionEvents(): PuzzleEvent[] {
  const content = p1Content();
  const graph = new MachineGraph();
  graph.configure(content);
  graph.reset([
    { componentId: 'shaft-a', socketId: 'socket-shaft-a' },
    { componentId: 'shaft-b', socketId: 'socket-shaft-b' }
  ]);
  const puzzle = new PuzzleSystem(P1_PUZZLE, graph, content, { stableSteps: 1 });
  graph.attach('gear-a', 'socket-mesh');
  let events: PuzzleEvent[] = [];
  for (let step = 0; step < 4 && events.length === 0; step += 1) {
    graph.recomputeIfDirty();
    events = [...puzzle.update(true).events];
  }
  if (!events.some((event) => event.type === 'PuzzleCompleted')) {
    throw new Error('fixture failed to complete P1');
  }
  return events;
}

/** The codec + a targets seam that records what a load rebuilt. */
function codecHarness(ledger: RewardLedger, inventory: InventorySystem) {
  const graph = new MachineGraph();
  const checkpoints: Array<{ id: string; anchorId: string }> = [];
  const puzzleStates = new Map<string, string>();
  const codec = new SaveCodec(
    [{ id: 'P1', milestoneId: MILESTONE_P1_FIRST_MESH }],
    ['gear-a', 'plate-a', 'shaft-a', 'shaft-b', 'frame-a', 'socket-mesh', 'socket-shaft-a', 'socket-shaft-b']
  );
  const apply = (save: SaveFile): ReadonlyArray<unknown> =>
    codec.apply(save, {
      ledger,
      inventory,
      checkpoint: {
        restore: (snapshot) => {
          checkpoints.push(snapshot);
        }
      },
      graph,
      puzzles: [
        {
          puzzleId: 'P1',
          restore: (state) => {
            puzzleStates.set('P1', state);
          }
        }
      ]
    });
  return { codec, graph, checkpoints, puzzleStates, apply };
}

/** A capture fixture with overridable canonical sections. */
function captureInput(overrides: Partial<SaveCaptureInput> = {}): SaveCaptureInput {
  return {
    savedAt: 1000,
    playtimeSec: 42,
    slot: 'checkpoint',
    ledger: { grantedIds: [] },
    inventory: {
      partIds: [],
      materialCounts: { scrap: 0, brass: 0, sealant: 0, alloy: 0 },
      blueprintIds: []
    },
    checkpoint: { id: 'CP-00', anchorId: 'spawn/lab' },
    puzzles: [{ puzzleId: 'P1', state: 'InProgress' }],
    machineEdges: [],
    components: [],
    ...overrides
  };
}


describe('reward idempotency â€” the grant path (TEST Â§10)', () => {
  it('R-1: one grant applies once and the ledger holds exactly one entry', () => {
    const { ledger, inventory, rewards } = build();
    const outcome = rewards.grantMilestone(MILESTONE_P1_FIRST_MESH, 'P1');

    expect(outcome.applied).toBe(true);
    expect(outcome.skipped).toEqual([]);
    expect(ledger.size).toBe(1);
    expect(ledger.has(GRANT)).toBe(true);
    expect(scrapOf(inventory)).toBe(3);
    expect(inventory.materialCount('brass')).toBe(1);
  });

  it('R-2: the same grantId 100Ã— applies once â€” zero further inventory changes', () => {
    const { ledger, inventory, rewards } = build();
    rewards.grantMilestone(MILESTONE_P1_FIRST_MESH, 'P1');
    for (let i = 0; i < 100; i += 1) {
      expect(ledger.grant(GRANT)).toBe(false);
      expect(rewards.grantMilestone(MILESTONE_P1_FIRST_MESH, 'P1').applied).toBe(false);
    }
    expect(ledger.size).toBe(1);
    expect(scrapOf(inventory)).toBe(3);
    expect(inventory.materialCount('brass')).toBe(1);
    expect(inventory.blueprintIds).toEqual([]);
  });

  it('R-3: duplicate PuzzleCompleted events grant exactly once (validator true Ã—100 steps)', () => {
    const { ledger, inventory, rewards } = build();
    const events = p1CompletionEvents();
    for (let i = 0; i < 100; i += 1) {
      rewards.consumePuzzleEvents(events);
    }
    expect(ledger.size).toBe(1);
    expect(scrapOf(inventory)).toBe(3);
  });

  it('R-4: complete â†’ save â†’ reload â†’ completion re-evaluates true â†’ ledger blocks re-grant', () => {
    const first = build();
    first.rewards.consumePuzzleEvents(p1CompletionEvents());
    expect(first.ledger.size).toBe(1);

    // Persist through the real codec: rewards AND their inventory effects.
    const harness = codecHarness(first.ledger, first.inventory);
    const saved = harness.codec.encode(harness.codec.capture(captureInput({
      ledger: { grantedIds: first.ledger.grantedIds },
      inventory: {
        partIds: [],
        materialCounts: { scrap: 3, brass: 1, sealant: 0, alloy: 0 },
        blueprintIds: []
      },
      puzzles: [{ puzzleId: 'P1', state: 'Complete' }]
    })));

    // "Reload": decode + apply into the same owners, then re-run 100 completions.
    const decoded = harness.codec.decode(saved);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    harness.apply(decoded.save);
    const events = p1CompletionEvents();
    for (let i = 0; i < 100; i += 1) {
      first.rewards.consumePuzzleEvents(events);
    }
    expect(first.ledger.size).toBe(1);
    expect(scrapOf(first.inventory)).toBe(3);
  });

  it('R-5: complete â†’ reset puzzle â†’ complete again grants nothing further', () => {
    const content = p1Content();
    const graph = new MachineGraph();
    graph.configure(content);
    graph.reset([
      { componentId: 'shaft-a', socketId: 'socket-shaft-a' },
      { componentId: 'shaft-b', socketId: 'socket-shaft-b' }
    ]);
    const puzzle = new PuzzleSystem(P1_PUZZLE, graph, content, { stableSteps: 1 });
    const { ledger, inventory, rewards } = build();

    graph.attach('gear-a', 'socket-mesh');
    graph.recomputeIfDirty();
    let events: PuzzleEvent[] = [];
    for (let step = 0; step < 4 && events.length === 0; step += 1) {
      events = [...puzzle.update(true).events];
    }
    rewards.consumePuzzleEvents(events);
    expect(puzzle.state).toBe('Complete');
    expect(scrapOf(inventory)).toBe(3);

    // The reset cannot rewind a completion (Â§25) and the ledger cannot re-grant.
    puzzle.reset();
    expect(puzzle.state).toBe('Complete');
    graph.recomputeIfDirty();
    let again: PuzzleEvent[] = [];
    for (let step = 0; step < 4; step += 1) {
      again = again.concat([...puzzle.update(true).events]);
    }
    expect(again.some((event) => event.type === 'PuzzleCompleted')).toBe(false);
    rewards.consumePuzzleEvents(again);
    expect(ledger.size).toBe(1);
    expect(scrapOf(inventory)).toBe(3);
  });

  it('R-6: reward applied then crash before save â†’ checkpoint reload replays grants once', () => {
    // The checkpoint was written BEFORE completion; the crash loses the
    // in-memory reward. Reload rebuilds the checkpoint's (empty) ledger, and
    // the re-completion grants exactly once â€” the first, not a duplicate.
    const ledger = new RewardLedger();
    const inventory = new InventorySystem();
    const rewards = new RewardSystem(ledger, inventory, DEFINITIONS);
    const harness = codecHarness(ledger, inventory);

    const checkpointJson = harness.codec.encode(harness.codec.capture(captureInput()));
    const decoded = harness.codec.decode(checkpointJson);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    harness.apply(decoded.save);

    const outcome = rewards.grantMilestone(MILESTONE_P1_FIRST_MESH, 'P1');
    expect(outcome.applied).toBe(true);
    expect(ledger.size).toBe(1);
    expect(scrapOf(inventory)).toBe(3);
  });


  it('R-7: two puzzles granting the same material add correctly (distinct grantIds)', () => {
    const ledger = new RewardLedger();
    const inventory = new InventorySystem();
    const definitions: ReadonlyArray<RewardDefinition> = [
      { id: 'milestone/alpha', title: 'Alpha', materials: [{ kind: 'scrap', amount: 2 }] },
      { id: 'milestone/beta', title: 'Beta', materials: [{ kind: 'scrap', amount: 5 }] }
    ];
    const rewards = new RewardSystem(ledger, inventory, definitions);
    rewards.grantMilestone('milestone/alpha', 'P1');
    rewards.grantMilestone('milestone/beta', 'P2');
    expect(scrapOf(inventory)).toBe(7);
    expect(ledger.size).toBe(2);
  });

  it('R-8: a blueprint unlock applied twice stays one entry', () => {
    const ledger = new RewardLedger();
    const inventory = new InventorySystem();
    const definitions: ReadonlyArray<RewardDefinition> = [
      { id: 'milestone/scanner', title: 'Scanner', blueprints: ['blueprint/scanner'] }
    ];
    const rewards = new RewardSystem(ledger, inventory, definitions);
    rewards.grantMilestone('milestone/scanner', 'P2');
    rewards.grantMilestone('milestone/scanner', 'P2');
    inventory.unlockBlueprint('blueprint/scanner');
    expect(inventory.blueprintIds).toEqual(['blueprint/scanner']);
    expect(inventory.hasBlueprint('blueprint/scanner')).toBe(true);
  });

  it('R-9: a reward naming removed content is skipped with a report, no crash', () => {
    const ledger = new RewardLedger();
    const inventory = new InventorySystem();
    const definitions: ReadonlyArray<RewardDefinition> = [
      {
        id: 'milestone/ghost',
        title: 'Ghost',
        // 'gold' is not in the closed four-kind vocabulary: the grant skips it.
        materials: [{ kind: 'scrap', amount: 1 }, { kind: 'gold' as never, amount: 4 }],
        blueprints: []
      }
    ];
    const rewards = new RewardSystem(ledger, inventory, definitions);
    const outcome = rewards.grantMilestone('milestone/ghost', 'PX');
    expect(outcome.applied).toBe(true);
    expect(outcome.skipped.length).toBe(1);
    expect(outcome.skipped[0]).toContain('UnknownMaterial');
    expect(scrapOf(inventory)).toBe(1);
    expect(ledger.has('PX:milestone/ghost')).toBe(true);
  });

  it('R-10: rewardsGranted present, puzzle state missing â†’ repaired to Complete, no double grant', () => {
    const ledger = new RewardLedger();
    const inventory = new InventorySystem();
    const rewards = new RewardSystem(ledger, inventory, DEFINITIONS);
    const harness = codecHarness(ledger, inventory);

    // Corrupted save: the grant row exists, the puzzle block does not.
    const decoded = harness.codec.decode(harness.codec.encode(
      harness.codec.capture(captureInput({ ledger: { grantedIds: [GRANT] }, puzzles: [] }))
    ));
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    const notes = harness.apply(decoded.save);
    expect(harness.puzzleStates.get('P1')).toBe('Complete');
    expect(notes.some((note) => (note as { code: string }).code === 'ledger-reconciled-puzzle')).toBe(true);

    // The reconciled (not re-applied) grant is in the ledger; re-completion adds nothing.
    expect(ledger.has(GRANT)).toBe(true);
    rewards.consumePuzzleEvents(p1CompletionEvents());
    expect(scrapOf(inventory)).toBe(0);
  });

  it('R-10 dual: puzzle Complete recorded, reward missing â†’ reconciled from the milestone', () => {
    const ledger = new RewardLedger();
    const inventory = new InventorySystem();
    const harness = codecHarness(ledger, inventory);
    const decoded = harness.codec.decode(harness.codec.encode(
      harness.codec.capture(captureInput({ puzzles: [{ puzzleId: 'P1', state: 'Complete' }] }))
    ));
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    const notes = harness.apply(decoded.save);
    expect(ledger.has(GRANT)).toBe(true);
    expect(notes.some((note) => (note as { code: string }).code === 'ledger-confirmed-from-milestone')).toBe(true);
  });

  it('invariant: inventory is a function of the granted SET (duplicated event sequences)', () => {
    const events = p1CompletionEvents();
    const runA = build();
    for (let i = 0; i < 7; i += 1) runA.rewards.consumePuzzleEvents(events);
    const runB = build();
    runB.rewards.consumePuzzleEvents(events);
    expect(runA.inventory.snapshot()).toEqual(runB.inventory.snapshot());
    expect(runA.ledger.grantedIds).toEqual(runB.ledger.grantedIds);
  });
});


