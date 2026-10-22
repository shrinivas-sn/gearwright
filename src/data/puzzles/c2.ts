/**
 * CONTENT — the C2 "Quench" puzzle (Branch C, ARCH §6 beat 3, §7).
 *
 * C2 is the Crucible's **combining machine**: it puts Branch A's direction lesson and Branch
 * C's own ceiling on one frame and asks for both at once.
 *
 *   - `c2/drive-coupled` (`connected`, `through: 'gear'`) — the crank reaches the vessel only
 *     through a part carrying the `gear` tag, so the blanking plate can be seated and still
 *     bridge nothing (§21.4).
 *   - `c2/drive-sense` (`output … direction: 'cw'`) — *which way* the vessel turns is decided
 *     by the parts, not the wiring: a plain gear preserves the crank's sense, the idler
 *     declares `reverses` and flips it.
 *   - `c2/quench-line` / `c2/quench-up` — the branch's second carrier, arriving on a
 *     different node (the gauge reads, the vessel turns).
 *   - `c2/no-overpressure` (`safety: 'overpressure'`) — the two quench feeds are parallel,
 *     so seating both pushes the gauge past the machine's ceiling. Exactly one feed, as C1
 *     taught; the new part is doing it while the drive has to be right-handed at the same
 *     time.
 *   - `c2/no-jam` — a shut-off valve fits a feed and conducts nothing.
 *
 * Activation is the machine's derived `running` state, as everywhere else.
 */

import type { PuzzleDefinition } from '../../game-state/puzzle-system.ts';

export const C2_PUZZLE: PuzzleDefinition = {
  id: 'C2',
  title: 'Quench',
  milestoneId: 'milestone/c2-quench',
  activation: { kind: 'machineRunning', machineId: 'C2-quench' },
  requirements: [
    {
      id: 'c2/drive-coupled',
      kind: 'connected',
      from: { kind: 'component', id: 'c2-crank' },
      to: { kind: 'component', id: 'c2-vessel' },
      through: 'gear'
    },
    {
      id: 'c2/drive-sense',
      kind: 'output',
      machineId: 'C2-quench',
      output: 'rotation',
      min: 1,
      direction: 'cw'
    },
    {
      id: 'c2/quench-line',
      kind: 'connected',
      from: { kind: 'component', id: 'c2-boiler' },
      to: { kind: 'component', id: 'c2-gauge' },
      through: 'pipe'
    },
    {
      id: 'c2/quench-up',
      kind: 'output',
      machineId: 'C2-quench',
      output: 'pressure',
      min: 1
    },
    {
      id: 'c2/no-overpressure',
      kind: 'safety',
      machineId: 'C2-quench',
      condition: 'overpressure'
    },
    {
      id: 'c2/no-jam',
      kind: 'safety',
      machineId: 'C2-quench',
      condition: 'unjammed'
    }
  ],
  objectiveText: {
    'c2/drive-coupled': 'Bridge the crank to the vessel with a gear.',
    'c2/drive-sense': 'The vessel must turn clockwise — mind which gear you seat.',
    'c2/quench-line': 'Run the quench feed from the furnace to the gauge.',
    'c2/quench-up': 'The gauge needs working pressure, not just a fitted pipe.',
    'c2/no-overpressure': 'One quench feed is enough — two would over-pressurise the gauge.',
    'c2/no-jam': 'Do not dead-end the quench — a shut-off valve blocks the run.'
  }
};
