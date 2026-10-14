/**
 * CONTENT — the B2 "Governor" puzzle (Branch B, ARCH §6 beat 3, §7, §24.1).
 *
 * B2 is the Thermal Line's **combining machine**: the machine that puts the two things
 * the branch has taught so far on one frame, and asks for both at once.
 *
 *   - `b2/drive-coupled` (`connected`, `through: 'gear'`) — the crank reaches the
 *     governor only through a part carrying the `gear` tag, so the blanking plate can
 *     be seated and still bridge nothing (§21.4).
 *   - `b2/drive-sense` (`output … direction: 'cw'`) — *which way* the governor turns is
 *     the second half, and it is decided by the parts, not by the wiring: a plain gear
 *     preserves the crank's sense, the idler declares `reverses` and flips it. That is
 *     Branch A's P2 lesson, restated on the thermal branch's own machine — and it is
 *     why this puzzle needs two candidate gears and no new vocabulary.
 *   - `b2/steam-line` and `b2/steam-up` — the branch's *second* carrier. B1 taught two
 *     parallel lines of one carrier; B2 asks for rotation **and** pressure arriving on
 *     different nodes of one machine, so the player has to read the frame as a whole.
 *   - `b2/no-jam` (`safety: 'unjammed'`) — a shut-off valve fits the steam port and
 *     conducts nothing, which blocks the run and jams the machine. Same declared
 *     boolean as B1's, not a special case.
 *
 * Activation is the machine's own derived `running` state (`machineRunning`), exactly
 * as every other shipped machine confirms it — no new activation vocabulary.
 */

import type { PuzzleDefinition } from '../../game-state/puzzle-system.ts';

export const B2_PUZZLE: PuzzleDefinition = {
  id: 'B2',
  title: 'Governor',
  milestoneId: 'milestone/b2-governor',
  activation: { kind: 'machineRunning', machineId: 'B2-governor' },
  requirements: [
    {
      id: 'b2/drive-coupled',
      kind: 'connected',
      from: { kind: 'component', id: 'b2-crank' },
      to: { kind: 'component', id: 'b2-governor' },
      through: 'gear'
    },
    {
      id: 'b2/drive-sense',
      kind: 'output',
      machineId: 'B2-governor',
      output: 'rotation',
      min: 1,
      direction: 'cw'
    },
    {
      id: 'b2/steam-line',
      kind: 'connected',
      from: { kind: 'component', id: 'b2-boiler' },
      to: { kind: 'component', id: 'b2-gauge' },
      through: 'pipe'
    },
    {
      id: 'b2/steam-up',
      kind: 'output',
      machineId: 'B2-governor',
      output: 'pressure',
      min: 1
    },
    {
      id: 'b2/no-jam',
      kind: 'safety',
      machineId: 'B2-governor',
      condition: 'unjammed'
    }
  ],
  objectiveText: {
    'b2/drive-coupled': 'Bridge the crank to the governor with a gear.',
    'b2/drive-sense': 'The governor must turn clockwise — mind which gear you seat.',
    'b2/steam-line': 'Run steam from the boiler to the gauge.',
    'b2/steam-up': 'The gauge needs working pressure, not just a fitted pipe.',
    'b2/no-jam': 'Do not dead-end the steam — a shut-off valve blocks the run.'
  }
};
