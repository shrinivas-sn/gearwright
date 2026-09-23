/**
 * CONTENT — the P1 "First Mesh" puzzle (ARCH §24.1, §40 `data/puzzles/`).
 *
 * Requirements are data read by the pure validator against the machine graph —
 * never against transforms (§24.3). P1 is satisfied when the drive actually runs
 * through the installed gear and reaches the output shaft:
 *
 *   1. `connected` — the crank shaft reaches the driven shaft, but only through
 *      a component carrying the `gear` tag (§24.1 `through`). A blanking plate
 *      physically fits the mesh socket but carries no `gear` tag and no rotation
 *      port, so it can never satisfy this — "snapping never decides completion"
 *      (§21.4), authored entirely in data.
 *   2. `output` — the machine's declared rotation output is actually turning
 *      (value above the authored floor). Together with (1) this is what makes
 *      the machine's derived `running` state the activation confirmation.
 *
 * Activation is the machine's own `running` state (`machineRunning`): when the
 * stable validation lands, the machine is running, and that is the §25
 * "activation input confirmed" for a self-activating machine. `milestoneId`
 * is the completion milestone the reward ledger keys on (M7 consumes it).
 *
 * `objectiveText` is the plain-language rendering of each requirement id for
 * the objective line (§33.1: "requirement text comes from validator reasons" —
 * one authored string per id, never duplicated in markup).
 */

import type { PuzzleDefinition } from '../../game-state/puzzle-system.ts';

export const P1_PUZZLE: PuzzleDefinition = {
  id: 'P1',
  title: 'First Mesh',
  milestoneId: 'milestone/p1-first-mesh',
  activation: { kind: 'machineRunning', machineId: 'P1-mesh' },
  requirements: [
    {
      id: 'p1/drive-through-gear',
      kind: 'connected',
      from: { kind: 'component', id: 'shaft-a' },
      to: { kind: 'component', id: 'shaft-b' },
      through: 'gear'
    },
    {
      id: 'p1/output-turning',
      kind: 'output',
      machineId: 'P1-mesh',
      output: 'rotation',
      min: 0.5
    }
  ],
  objectiveText: {
    'p1/drive-through-gear': 'Bridge the two shafts: mount the gear in the mesh socket.',
    'p1/output-turning': 'The driven shaft must turn: complete the drive through the gear.'
  }
};
