/**
 * CONTENT — the B3 "Bypass" puzzle (Branch B, ARCH §7 template beat 4; §40 `data/puzzles/`).
 *
 * B3 is the Thermal Line's **open-ended problem**, the beat §7 gives every branch after its
 * combining machine: one source, two consumers, and more than one arrangement that satisfies
 * both — exactly the shape P3 "Three Valves" has in Branch A.
 *
 * The machine (`data/machines.ts`) declares three runs off one header:
 *
 *   - valve A → the heating coil
 *   - valve B → the drawoff
 *   - valve C → *both* (the cross-run)
 *
 * With two serviceable valves the accepted builds are A+B, A+C and B+C, plus a lone
 * cross-run followed by any second part. Nothing here encodes an order, a "correct" socket
 * or a solution count: the requirements are §7's output conditions — pressure reaching each
 * consumer through a conducting part — read from derived machine state (§24.3).
 *
 * Two predicates carry the teaching that P3's single cross-run does not need:
 *
 *   - `b3/two-carriers` (`componentAt`) — **both** serviceable lines must be seated. One
 *     correctly placed valve already routes to its consumer, so this is the requirement that
 *     makes the second carrier matter; without it, "A alone" would look correct to a player
 *     watching one outlet come alive.
 *   - `b3/no-jam` (`safety: 'unjammed'`) — the shut-off valve fits a route port, carries the
 *     same tags and conducts nothing (§21.4), so the run it sits in dead-ends and the machine
 *     jams. Branch A taught that as one boolean on P3; here it is the branch's own near-miss
 *     restated on a three-run header.
 *
 * Activation is the machine's derived `running` state (`machineRunning`), exactly as every
 * other machine in the game confirms it — no new vocabulary.
 */

import type { PuzzleDefinition } from '../../game-state/puzzle-system.ts';

export const B3_PUZZLE: PuzzleDefinition = {
  id: 'B3',
  title: 'Bypass',
  milestoneId: 'milestone/b3-bypass',
  activation: { kind: 'machineRunning', machineId: 'B3-bypass' },
  requirements: [
    {
      id: 'b3/route-heat',
      kind: 'connected',
      from: { kind: 'component', id: 'b3-boiler' },
      to: { kind: 'component', id: 'b3-out-heat' },
      through: 'pipe'
    },
    {
      id: 'b3/route-drain',
      kind: 'connected',
      from: { kind: 'component', id: 'b3-boiler' },
      to: { kind: 'component', id: 'b3-out-drain' },
      through: 'pipe'
    },
    {
      id: 'b3/two-carriers',
      kind: 'componentAt',
      componentTag: 'valve',
      socketKind: 'pipe-port',
      count: 2
    },
    {
      id: 'b3/pressure-up',
      kind: 'output',
      machineId: 'B3-bypass',
      output: 'pressure',
      min: 1
    },
    {
      id: 'b3/no-jam',
      kind: 'safety',
      machineId: 'B3-bypass',
      condition: 'unjammed'
    }
  ],
  objectiveText: {
    'b3/route-heat': 'Route boiler pressure to the heating coil.',
    'b3/route-drain': 'Route boiler pressure to the drawoff.',
    'b3/two-carriers': 'Both serviceable lines must be seated — one route is not enough.',
    'b3/pressure-up': 'Pressure has to reach the consumers, not just the ports.',
    'b3/no-jam': 'A shut-off valve dead-ends its run — the header must stay unjammed.'
  }
};
