/**
 * CONTENT — the C3 "Slag Run" puzzle (Branch C, ARCH §7 template beat 4).
 *
 * C3 is the Crucible's **open-ended problem**: one furnace, two consumers, three routes, and
 * more than one arrangement that works. The machine (`data/machines.ts`) declares:
 *
 *   - route A → the casting floor
 *   - route B → the quench tank
 *   - route C → *both* (the cross-run)
 *
 * Two accepted builds, and they are different *kinds* of answer:
 *
 *   - **A+B** — one part per consumer, each reading 1.
 *   - **C alone** — one part serving both runs, each reading 2 (its shared bridge carries both
 *     declared links, so the carrier sums there — the same arithmetic P3's cross-run uses).
 *
 * `c3/no-overpressure` is what makes the beat more than a connection puzzle: the machine's
 * ceiling is 2.5, so `C` is a complete answer but **`A+C` or `B+C`** stacks a run on the
 * cross-run, pushes one consumer to 3 and trips the ceiling. The player may route either way,
 * but they must count the feeds — the lesson C1 teaches, restated where the player is choosing
 * freely.
 *
 *   - `c3/cast-route` / `c3/quench-route` (`connected`, `through: 'pipe'`) — both consumers
 *     reachable from the furnace through conducting parts.
 *   - `c3/pressure-up` (`output`, `min: 1`) — pressure arrives at a consumer, not just at a
 *     port.
 *   - `c3/no-overpressure` — the ceiling.
 *   - `c3/no-jam` — a shut-off valve dead-ends its run, so the header must stay unjammed.
 *
 * No requirement names a socket or a count of parts: the arrangement is the player's, and the
 * accepted builds are consequences of the routes' declared links (§24.3).
 */

import type { PuzzleDefinition } from '../../game-state/puzzle-system.ts';

export const C3_PUZZLE: PuzzleDefinition = {
  id: 'C3',
  title: 'Slag Run',
  milestoneId: 'milestone/c3-slag-run',
  activation: { kind: 'machineRunning', machineId: 'C3-slag' },
  requirements: [
    {
      id: 'c3/cast-route',
      kind: 'connected',
      from: { kind: 'component', id: 'c3-boiler' },
      to: { kind: 'component', id: 'c3-out-cast' },
      through: 'pipe'
    },
    {
      id: 'c3/quench-route',
      kind: 'connected',
      from: { kind: 'component', id: 'c3-boiler' },
      to: { kind: 'component', id: 'c3-out-quench' },
      through: 'pipe'
    },
    {
      id: 'c3/pressure-up',
      kind: 'output',
      machineId: 'C3-slag',
      output: 'pressure',
      min: 1
    },
    {
      id: 'c3/no-overpressure',
      kind: 'safety',
      machineId: 'C3-slag',
      condition: 'overpressure'
    },
    {
      id: 'c3/no-jam',
      kind: 'safety',
      machineId: 'C3-slag',
      condition: 'unjammed'
    }
  ],
  objectiveText: {
    'c3/cast-route': 'Route furnace pressure to the casting floor.',
    'c3/quench-route': 'Route furnace pressure to the quench tank.',
    'c3/pressure-up': 'Pressure has to reach the consumers, not just the ports.',
    'c3/no-overpressure': 'One part may serve both runs — do not stack a second run on it.',
    'c3/no-jam': 'A shut-off valve dead-ends its run — the header must stay unjammed.'
  }
};
