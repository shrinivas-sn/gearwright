/**
 * CONTENT — the C1 "Tuyere" puzzle (Branch C, ARCH §6 beat 2, §7).
 *
 * C1 is the Crucible's entry machine, and the first shipped puzzle whose teaching is a
 * **ceiling** rather than a connection:
 *
 *   - `c1/blast-line` (`connected`, `through: 'pipe'`) — the furnace must actually reach the
 *     tuyere through pipework.
 *   - `c1/pressure-up` (`output`, `min: 1`) — one run's worth has to arrive. The machine's
 *     `maxOutput` is 1.5, so this and the next requirement together say *exactly one feed*.
 *   - `c1/no-overpressure` (`safety: 'overpressure'`) — two open valves sum to 2 and trip
 *     the ceiling. This is the lesson: more feed is not more correct, and the safe answer is
 *     a counted one. It is the first use of the `overpressure` condition as an objective
 *     rather than as a latent warning.
 *   - `c1/no-jam` (`safety: 'unjammed'`) — a shut-off valve fits a blast port and conducts
 *     nothing (§21.4), so it dead-ends the run and jams the machine. Same declared boolean
 *     as every other machine's, so the two failure modes keep two different reason codes.
 *
 * Activation is the machine's own derived `running` state (`machineRunning`), exactly as
 * every other shipped machine confirms it — no new activation vocabulary.
 */

import type { PuzzleDefinition } from '../../game-state/puzzle-system.ts';

export const C1_PUZZLE: PuzzleDefinition = {
  id: 'C1',
  title: 'Tuyere',
  milestoneId: 'milestone/c1-tuyere',
  activation: { kind: 'machineRunning', machineId: 'C1-tuyere' },
  requirements: [
    {
      id: 'c1/blast-line',
      kind: 'connected',
      from: { kind: 'component', id: 'c1-boiler' },
      to: { kind: 'component', id: 'c1-tuyere' },
      through: 'pipe'
    },
    {
      id: 'c1/pressure-up',
      kind: 'output',
      machineId: 'C1-tuyere',
      output: 'pressure',
      min: 1
    },
    {
      id: 'c1/no-overpressure',
      kind: 'safety',
      machineId: 'C1-tuyere',
      condition: 'overpressure'
    },
    {
      id: 'c1/no-jam',
      kind: 'safety',
      machineId: 'C1-tuyere',
      condition: 'unjammed'
    }
  ],
  objectiveText: {
    'c1/blast-line': 'Run pipework from the furnace to the tuyere.',
    'c1/pressure-up': 'The tuyere needs pressure behind it, not just a fitted pipe.',
    'c1/no-overpressure': 'One feed is enough — two would over-pressurise the tuyere.',
    'c1/no-jam': 'A shut-off valve blocks the blast — the header must stay unjammed.'
  }
};
