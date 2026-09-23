/**
 * CONTENT — the P2 "Right Turn" puzzle (ARCH §7, §24.1, §40 `data/puzzles/`).
 *
 * P2 teaches **directionality**: the drive must reach the output, *and* it must
 * turn the right way. The lesson is authored entirely in data —
 *
 *   1. `connected` (through a `gear`) — the crank reaches the output only via a
 *      component carrying the `gear` tag, so a part with no transmission port can
 *      fit the socket and still not bridge it (§21.4).
 *   2. `output … direction: 'cw'` — the machine's derived rotation *sense*. A plain
 *      `GEAR_DEF` preserves the crank's sense; `IDLER_GEAR_DEF` declares `reverses`
 *      and flips it. So picking the wrong gear in the same socket fails the
 *      predicate without any code knowing what an "idler" is (§22/§23.2).
 *
 * The two requirements together are the whole lesson: *whether* the drive is bridged
 * (P1, restated) and *which way* it turns (P2's new idea). Activation is the
 * machine's own `running` state, exactly as P1's is.
 *
 * Scope note (§7's "2 mirror configs"): P2 ships **one** mesh socket on purpose.
 * With two, both a plain gear and an idler could occupy the same train at once, and
 * the derived sense would then depend on edge-visit order rather than on declared
 * data — the hidden coupling §24.3 exists to prevent. A level-global
 * `componentAt`-based guard cannot fix that either, because P1's mesh socket is also
 * `gear-mount`, so a gear in P1 would be counted against P2. The mirror-solution
 * obligation is carried by P3, which is multi-solution by declared adjacency.
 */

import type { PuzzleDefinition } from '../../game-state/puzzle-system.ts';

export const P2_PUZZLE: PuzzleDefinition = {
  id: 'P2',
  title: 'Right Turn',
  milestoneId: 'milestone/p2-right-turn',
  activation: { kind: 'machineRunning', machineId: 'P2-right-turn' },
  requirements: [
    {
      id: 'p2/drive-through-gear',
      kind: 'connected',
      from: { kind: 'component', id: 'p2-crank' },
      to: { kind: 'component', id: 'p2-output' },
      through: 'gear'
    },
    {
      id: 'p2/output-clockwise',
      kind: 'output',
      machineId: 'P2-right-turn',
      output: 'rotation',
      min: 0.5,
      direction: 'cw'
    }
  ],
  objectiveText: {
    'p2/drive-through-gear': 'Bridge the crank to the output with a gear.',
    'p2/output-clockwise': 'The output must turn clockwise — mind which gear you seat.'
  }
};
