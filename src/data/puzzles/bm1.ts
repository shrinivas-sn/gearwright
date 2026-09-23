/**
 * CONTENT — the BM-1 "Pressure Dynamo" puzzle (ARCH §7, §24.1; ADR-018).
 *
 * BM-1 is the branch's capstone and the MVP's only **staged** puzzle: assembly →
 * priming → activation (§7). What makes it staged is that two of its requirements are
 * questions about *what the player did*, not about the graph:
 *
 *   - `bm1/primed` — every action in `BM1_PRESSURE_DYNAMO.primingActions` has been
 *     performed, **in any order** (§7's "order-flexible priming"). Three priming lines
 *     (feed, return, bleed) means the stage is a small open problem, not a lock.
 *   - `bm1/staged` — an *ordered* sequence (ADR-018) whose second step must be
 *     witnessed by the engage lever **after** a priming witness. Engaging the dynamo
 *     before it is primed is therefore a real failure with a real reason code
 *     (`sequence/out-of-order`), and re-engaging after priming resolves it — the SM's
 *     hysteresis window makes that a recovery, not a trap.
 *
 * The structural half is ordinary propagation, combining P1–P3's mechanics:
 * a `gear` must bridge `bm1/structure-drive` (crank → dynamo) and a `pipe` must bridge
 * `bm1/structure-line` (boiler → gauge). The two near-misses come from existing content
 * rather than new code: a blanking plate fits the drive mount and cannot turn anything,
 * and the shut-off valve fits the line port and conducts nothing (§21.4).
 *
 * "Assembly before priming" is enforced in the *world*, not in the validator: the
 * priming props are §18 targets whose `enabled` flag is derived from §25's `Assembled`
 * state (the state that means "the structure is complete"), so the priming stage cannot
 * physically be performed on a machine that is not built yet. That keeps the validator
 * free of any notion of "when", which it has no way to observe.
 */

import type { PuzzleDefinition } from '../../game-state/puzzle-system.ts';
import { BM1_ENGAGE_ACTION, BM1_PRIMING_ACTIONS } from '../actions.ts';

export const BM1_PUZZLE: PuzzleDefinition = {
  id: 'BM-1',
  title: 'Pressure Dynamo',
  milestoneId: 'milestone/bm1-pressure-dynamo',
  activation: { kind: 'machineRunning', machineId: 'BM-1' },
  requirements: [
    {
      id: 'bm1/structure-drive',
      kind: 'connected',
      from: { kind: 'component', id: 'bm1-crank' },
      to: { kind: 'component', id: 'bm1-dynamo' },
      through: 'gear'
    },
    {
      id: 'bm1/structure-line',
      kind: 'connected',
      from: { kind: 'component', id: 'bm1-boiler' },
      to: { kind: 'component', id: 'bm1-gauge' },
      through: 'pipe'
    },
    // Both carriers must actually arrive: bridging is not the same as transmitting
    // (a shut-off valve bridges nothing, by its own declaration).
    {
      id: 'bm1/drive-up',
      kind: 'output',
      machineId: 'BM-1',
      output: 'rotation',
      min: 1
    },
    {
      id: 'bm1/pressure-up',
      kind: 'output',
      machineId: 'BM-1',
      output: 'pressure',
      min: 1
    },
    {
      id: 'bm1/no-jam',
      kind: 'safety',
      machineId: 'BM-1',
      condition: 'unjammed'
    },
    // The priming stage: coverage of the machine's declared priming actions, any order.
    {
      id: 'bm1/primed',
      kind: 'state',
      machineId: 'BM-1',
      state: 'primed'
    },
    // The stage order: a priming witness, then an engage witness (ADR-018). Step 1's
    // requirement is the priming fact itself; step 2's is the machine actually running,
    // so "engage and nothing happens" cannot complete the puzzle.
    {
      id: 'bm1/staged',
      kind: 'sequence',
      ordered: true,
      steps: [
        [{ id: 'bm1/staged-primed', kind: 'state', machineId: 'BM-1', state: 'primed' }],
        [{ id: 'bm1/staged-running', kind: 'state', machineId: 'BM-1', state: 'running' }]
      ],
      witnesses: [[...BM1_PRIMING_ACTIONS], [BM1_ENGAGE_ACTION]]
    }
  ],
  objectiveText: {
    'bm1/structure-drive': 'Couple the crank to the dynamo with a gear.',
    'bm1/structure-line': 'Run pressure from the boiler to the gauge.',
    'bm1/drive-up': 'The dynamo needs rotation arriving at its drive input.',
    'bm1/pressure-up': 'The gauge needs working pressure, not just a fitted pipe.',
    'bm1/no-jam': 'Do not dead-end the feed — a shut-off valve blocks the run.',
    'bm1/primed': 'Prime all three lines: feed, return and bleed (any order).',
    'bm1/staged': 'Prime the lines, then engage the dynamo.'
  }
};
