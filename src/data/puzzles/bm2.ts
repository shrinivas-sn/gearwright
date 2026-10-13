/**
 * CONTENT — the BM-2 "Steam Engine" puzzle (Branch B, ARCH §7 template beats 5–6;
 * ADR-018).
 *
 * BM-2 is the Thermal Line's capstone and the second staged puzzle the game ships:
 * assembly → priming → activation. It reuses ADR-018's vocabulary exactly — two of its
 * requirements ask what the player *did*, not what the graph says:
 *
 *   - `bm2/primed` — every action in `BM2_STEAM_ENGINE.primingActions` has been
 *     performed, **in any order** (three lines: inlet, outlet, drain).
 *   - `bm2/staged` — an *ordered* sequence whose second step must be witnessed by the
 *     throttle lever **after** a priming witness, so throwing it early is a real
 *     failure with a real reason code (`sequence/out-of-order`).
 *
 * The structural half is ordinary propagation: a `gear` bridges the crank to the
 * flywheel and a `pipe` bridges the boiler to the condenser. The near-misses are the
 * same content lessons Branch A taught — a blanking plate fits the drive mount and
 * cannot turn anything; a shut-off valve fits the steam port and conducts nothing
 * (§21.4) — which is why no code knows what "BM-2" is.
 *
 * "Assembly before priming" is enforced in the world, not the validator: the props are
 * §18 targets enabled from the machine's `Assembled` state (see `levels/branch-b.ts`),
 * which is the same rule BM-1 uses.
 */

import type { PuzzleDefinition } from '../../game-state/puzzle-system.ts';
import { BM2_ENGAGE_ACTION, BM2_PRIMING_ACTIONS } from '../actions.ts';

export const BM2_PUZZLE: PuzzleDefinition = {
  id: 'BM-2',
  title: 'Steam Engine',
  milestoneId: 'milestone/bm2-steam-engine',
  activation: { kind: 'machineRunning', machineId: 'BM-2' },
  requirements: [
    {
      id: 'bm2/structure-drive',
      kind: 'connected',
      from: { kind: 'component', id: 'bm2-crank' },
      to: { kind: 'component', id: 'bm2-flywheel' },
      through: 'gear'
    },
    {
      id: 'bm2/structure-steam',
      kind: 'connected',
      from: { kind: 'component', id: 'bm2-boiler' },
      to: { kind: 'component', id: 'bm2-condenser' },
      through: 'pipe'
    },
    {
      id: 'bm2/flywheel-up',
      kind: 'output',
      machineId: 'BM-2',
      output: 'rotation',
      min: 1
    },
    {
      id: 'bm2/steam-up',
      kind: 'output',
      machineId: 'BM-2',
      output: 'pressure',
      min: 1
    },
    {
      id: 'bm2/no-jam',
      kind: 'safety',
      machineId: 'BM-2',
      condition: 'unjammed'
    },
    {
      id: 'bm2/primed',
      kind: 'state',
      machineId: 'BM-2',
      state: 'primed'
    },
    {
      id: 'bm2/staged',
      kind: 'sequence',
      ordered: true,
      steps: [
        [{ id: 'bm2/staged-primed', kind: 'state', machineId: 'BM-2', state: 'primed' }],
        [{ id: 'bm2/staged-running', kind: 'state', machineId: 'BM-2', state: 'running' }]
      ],
      witnesses: [[...BM2_PRIMING_ACTIONS], [BM2_ENGAGE_ACTION]]
    }
  ],
  objectiveText: {
    'bm2/structure-drive': 'Couple the crank to the flywheel with a gear.',
    'bm2/structure-steam': 'Run steam from the boiler to the condenser.',
    'bm2/flywheel-up': 'The flywheel needs rotation arriving at its drive input.',
    'bm2/steam-up': 'The condenser needs working pressure, not just a fitted pipe.',
    'bm2/no-jam': 'Do not dead-end the steam — a shut-off valve blocks the run.',
    'bm2/primed': 'Prime all three lines: inlet, outlet and drain (any order).',
    'bm2/staged': 'Prime the lines, then open the throttle.'
  }
};
