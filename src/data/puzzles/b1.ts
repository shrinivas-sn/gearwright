/**
 * CONTENT — the B1 "Feedwater" puzzle (Branch B, ARCH §7 template beat 2).
 *
 * B1 is the Thermal Line's entry machine, and the first shipped puzzle built on the
 * `componentAt` requirement kind. Its three predicates catch three different
 * half-done circuits, which is what makes it a teaching machine rather than a lock:
 *
 *   - `b1/two-lines` (`connected`, `through: 'pipe'`) — a valve must actually bridge
 *     the boiler to the outlet.
 *   - `b1/both-seated` (`componentAt`) — **both** feedwater ports must be occupied.
 *     One correctly seated valve already satisfies the first predicate, so this is the
 *     requirement that makes the second port matter.
 *   - `b1/pressure-up` (`output`, `min: 2`) — both parallel runs must *conduct*. One
 *     correctly seated valve already powers the outlet, so the floor is set at the two
 *     runs' combined value: a half-filled header stays below it.
 *   - `b1/no-jam` (`safety: 'unjammed'`) — a shut-off valve physically fits a feedwater
 *     port and conducts nothing (§21.4), which blocks the run and jams the machine. The
 *     safety predicate names that failure so the objective line can, instead of leaving
 *     the player with "everything looks satisfied but nothing happens".
 *
 * Activation is the machine's own derived `running` state (`machineRunning`), exactly
 * as P1–P3 and BM-1 confirm it — no new activation vocabulary.
 */

import type { PuzzleDefinition } from '../../game-state/puzzle-system.ts';

export const B1_PUZZLE: PuzzleDefinition = {
  id: 'B1',
  title: 'Feedwater',
  milestoneId: 'milestone/b1-feedwater',
  activation: { kind: 'machineRunning', machineId: 'B1-feedwater' },
  requirements: [
    {
      id: 'b1/two-lines',
      kind: 'connected',
      from: { kind: 'component', id: 'b1-boiler' },
      to: { kind: 'component', id: 'b1-outlet' },
      through: 'pipe'
    },
    {
      id: 'b1/both-seated',
      kind: 'componentAt',
      componentTag: 'valve',
      socketKind: 'pipe-port',
      count: 2
    },
    {
      id: 'b1/pressure-up',
      kind: 'output',
      machineId: 'B1-feedwater',
      output: 'pressure',
      min: 2
    },
    {
      id: 'b1/no-jam',
      kind: 'safety',
      machineId: 'B1-feedwater',
      condition: 'unjammed'
    }
  ],
  objectiveText: {
    'b1/two-lines': 'Bridge the boiler to the outlet with pipework.',
    'b1/both-seated': 'Fill both feedwater ports — one line is not enough.',
    'b1/pressure-up': 'Both runs must conduct: fit two open valves, not one.',
    'b1/no-jam': 'A shut-off valve blocks the feed — the header must stay unjammed.'
  }
};
