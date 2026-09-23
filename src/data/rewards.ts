/**
 * CONTENT — reward definitions (ARCH §27, §40 `data/rewards/`).
 *
 * Pure data: the reward system reads these and calls into the inventory — it
 * never invents rewards (§27.2 rule 5), and a definition naming unknown
 * content is skipped with a reported reason, never a crash (R-9).
 *
 * MVP scope (§27.3): materials exist to establish the grant pipeline; the one
 * blueprint (the scanner unlock) is deliberately reserved for P2's milestone,
 * so P1 proves materials only. Upgrades consume nothing in the MVP (§28).
 */

import type { RewardDefinition } from '../gameplay/reward-system.ts';

/** Completion milestones, authored in the matching `data/puzzles/` file. */
export const MILESTONE_P1_FIRST_MESH = 'milestone/p1-first-mesh';
export const MILESTONE_P2_RIGHT_TURN = 'milestone/p2-right-turn';
export const MILESTONE_P3_THREE_VALVES = 'milestone/p3-three-valves';
/** BM-1 (ADR-018): the branch machine — the last completion a branch build needs. */
export const MILESTONE_BM1_PRESSURE_DYNAMO = 'milestone/bm1-pressure-dynamo';

/**
 * The MVP's single blueprint (ARCH §27.3): the scanner unlock, granted on **P2**
 * completion, so the unlock → new-capability → new-interaction pipeline has one
 * real instance. Its *use* (the L3 scanner mechanic) is M10 work; the grant and its
 * idempotent set semantics land here, with the reward that proves them.
 */
export const SCANNER_BLUEPRINT = 'blueprint/scanner';

export const REWARD_DEFINITIONS: ReadonlyArray<RewardDefinition> = [
  {
    id: MILESTONE_P1_FIRST_MESH,
    title: 'First Mesh',
    materials: [
      { kind: 'scrap', amount: 3 },
      { kind: 'brass', amount: 1 }
    ],
    blueprints: []
  },
  {
    // §27.3: P2's milestone is the one that proves the blueprint pipeline.
    id: MILESTONE_P2_RIGHT_TURN,
    title: 'Right Turn',
    materials: [
      { kind: 'scrap', amount: 2 },
      { kind: 'sealant', amount: 1 }
    ],
    blueprints: [SCANNER_BLUEPRINT]
  },
  {
    id: MILESTONE_P3_THREE_VALVES,
    title: 'Three Valves',
    materials: [
      { kind: 'brass', amount: 2 },
      { kind: 'alloy', amount: 1 }
    ],
    blueprints: []
  },
  {
    // §27.3 keeps the MVP's ONE blueprint on P2, so the branch machine pays in the
    // materials the upgrade pipeline will consume (§28): no new resource kind, and no
    // second unlock competing with the scanner's.
    id: MILESTONE_BM1_PRESSURE_DYNAMO,
    title: 'Pressure Dynamo',
    materials: [
      { kind: 'brass', amount: 3 },
      { kind: 'alloy', amount: 2 }
    ],
    blueprints: []
  }
];
