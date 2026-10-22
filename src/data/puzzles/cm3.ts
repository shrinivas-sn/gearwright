/**
 * CONTENT — the CM-3 "Great Crucible" puzzle (Branch C, ARCH §7 template beats 5–6; ADR-018).
 *
 * CM-3 is the Crucible's capstone and the third staged puzzle the game ships: assembly →
 * priming → activation. It reuses ADR-018's vocabulary exactly — two of its requirements ask
 * what the player *did*, not what the graph says:
 *
 *   - `cm3/primed` — every action in `CM3_GREAT_CRUCIBLE.primingActions` has been performed,
 *     **in any order** (blast, quench and slag lines).
 *   - `cm3/staged` — an *ordered* sequence whose second step must be witnessed by the pour
 *     lever **after** a priming witness, so throwing it early is a real failure with a real
 *     reason code (`sequence/out-of-order`).
 *
 * The structural half is ordinary propagation with the branch's own lessons attached: a
 * `gear` bridges the crank to the vessel and must turn it **clockwise** (an idler flips the
 * sense), a `pipe` bridges the furnace to the casting outlet, and a shut-off valve or a
 * blanking plate fits and conducts nothing (§21.4). Nothing in code knows what a
 * "crucible" is.
 *
 * "Assembly before priming" is enforced in the world, not the validator: the props are §18
 * targets enabled from the machine's `Assembled` state (see `levels/branch-c.ts`), the same
 * rule BM-1 and BM-2 use.
 */

import type { PuzzleDefinition } from '../../game-state/puzzle-system.ts';
import { CM3_ENGAGE_ACTION, CM3_PRIMING_ACTIONS } from '../actions.ts';

export const CM3_PUZZLE: PuzzleDefinition = {
  id: 'CM-3',
  title: 'Great Crucible',
  milestoneId: 'milestone/cm3-great-crucible',
  activation: { kind: 'machineRunning', machineId: 'CM-3' },
  requirements: [
    {
      id: 'cm3/structure-drive',
      kind: 'connected',
      from: { kind: 'component', id: 'cm3-crank' },
      to: { kind: 'component', id: 'cm3-vessel' },
      through: 'gear'
    },
    {
      id: 'cm3/structure-feed',
      kind: 'connected',
      from: { kind: 'component', id: 'cm3-boiler' },
      to: { kind: 'component', id: 'cm3-outlet' },
      through: 'pipe'
    },
    {
      id: 'cm3/drive-sense',
      kind: 'output',
      machineId: 'CM-3',
      output: 'rotation',
      min: 1,
      direction: 'cw'
    },
    {
      id: 'cm3/feed-up',
      kind: 'output',
      machineId: 'CM-3',
      output: 'pressure',
      min: 1
    },
    {
      id: 'cm3/no-jam',
      kind: 'safety',
      machineId: 'CM-3',
      condition: 'unjammed'
    },
    {
      id: 'cm3/primed',
      kind: 'state',
      machineId: 'CM-3',
      state: 'primed'
    },
    {
      id: 'cm3/staged',
      kind: 'sequence',
      ordered: true,
      steps: [
        [{ id: 'cm3/staged-primed', kind: 'state', machineId: 'CM-3', state: 'primed' }],
        [{ id: 'cm3/staged-running', kind: 'state', machineId: 'CM-3', state: 'running' }]
      ],
      witnesses: [[...CM3_PRIMING_ACTIONS], [CM3_ENGAGE_ACTION]]
    }
  ],
  objectiveText: {
    'cm3/structure-drive': 'Couple the crank to the vessel with a gear.',
    'cm3/structure-feed': 'Run furnace pressure to the casting outlet.',
    'cm3/drive-sense': 'The vessel must turn clockwise — the idler runs the wrong way.',
    'cm3/feed-up': 'The outlet needs working pressure, not just a fitted pipe.',
    'cm3/no-jam': 'Do not dead-end the feed — a shut-off valve blocks the run.',
    'cm3/primed': 'Prime all three lines: blast, quench and slag (any order).',
    'cm3/staged': 'Prime the lines, then pull the pour lever.'
  }
};
