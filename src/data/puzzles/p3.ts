/**
 * CONTENT — the P3 "Three Valves" puzzle (ARCH §7, §24.1, §40 `data/puzzles/`).
 *
 * P3 teaches **pressure routing** and is deliberately **sequence-free and
 * multi-solution**: two outlets must both be pressurised, and there is more than one
 * way to do it because the machine declares three runs (`data/machines.ts`) —
 *
 *   - valve A  → main outlet
 *   - valve B  → auxiliary outlet
 *   - valve C  → *both* outlets (the cross-run)
 *
 * With two serviceable valves the accepted configurations are A+B, A+C and B+C —
 * and a lone cross-run (C, then any second part) also works. Nothing here encodes
 * an order or a "correct socket"; the requirements are the §7 output condition
 * (`pressure(out)≥x` at both outlets), read from derived machine state only.
 *
 * The near-miss is the **shut-off valve**: it fits a pipe port and carries the same
 * tags, but declares `conducts: false`, so the carrier is refused at it and the
 * downstream outlet is never powered — P1's "fits, cannot bridge" lesson, restated
 * for pressure as one boolean.
 */

import type { PuzzleDefinition } from '../../game-state/puzzle-system.ts';

export const P3_PUZZLE: PuzzleDefinition = {
  id: 'P3',
  title: 'Three Valves',
  milestoneId: 'milestone/p3-three-valves',
  activation: { kind: 'machineRunning', machineId: 'P3-three-valves' },
  requirements: [
    {
      id: 'p3/route-main',
      kind: 'connected',
      from: { kind: 'component', id: 'p3-boiler' },
      to: { kind: 'component', id: 'p3-out-main' },
      through: 'pipe'
    },
    {
      id: 'p3/route-aux',
      kind: 'connected',
      from: { kind: 'component', id: 'p3-boiler' },
      to: { kind: 'component', id: 'p3-out-aux' },
      through: 'pipe'
    },
    {
      id: 'p3/pressure-up',
      kind: 'output',
      machineId: 'P3-three-valves',
      output: 'pressure',
      min: 1
    },
    {
      id: 'p3/no-jam',
      kind: 'safety',
      machineId: 'P3-three-valves',
      condition: 'unjammed'
    }
  ],
  objectiveText: {
    'p3/route-main': 'Route boiler pressure to the main outlet.',
    'p3/route-aux': 'Route boiler pressure to the auxiliary outlet.',
    'p3/pressure-up': 'Both outlets must hold working pressure.',
    'p3/no-jam': 'Do not dead-end the flow — a shut-off valve blocks the run.'
  }
};
