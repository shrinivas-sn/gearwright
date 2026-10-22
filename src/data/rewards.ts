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

/** Branch B — B1 "Feedwater" (the thermal branch's entry machine). */
export const MILESTONE_B1_FEEDWATER = 'milestone/b1-feedwater';
/** Branch B — B2 "Governor" (the thermal branch's combining machine). */
export const MILESTONE_B2_GOVERNOR = 'milestone/b2-governor';
/** Branch B — B3 "Bypass" (the thermal branch's open-ended problem). */
export const MILESTONE_B3_BYPASS = 'milestone/b3-bypass';
/** Branch B — BM-2 "Steam Engine" (the thermal branch's staged capstone). */
export const MILESTONE_BM2_STEAM_ENGINE = 'milestone/bm2-steam-engine';

/** Branch C — C1 "Tuyere" (the Crucible's entry machine). */
export const MILESTONE_C1_TUYERE = 'milestone/c1-tuyere';
/** Branch C — C2 "Quench" (the Crucible's combining machine). */
export const MILESTONE_C2_QUENCH = 'milestone/c2-quench';
/** Branch C — C3 "Slag Run" (the Crucible's open-ended problem). */
export const MILESTONE_C3_SLAG_RUN = 'milestone/c3-slag-run';
/** Branch C — CM-3 "Great Crucible" (the Crucible's staged capstone). */
export const MILESTONE_CM3_GREAT_CRUCIBLE = 'milestone/cm3-great-crucible';

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
    // Branch B's reward uses only existing materials, exactly like BM-1: an expansion
    // must not invent a resource kind to feel bigger (§27.2 rule 5).
    id: MILESTONE_B1_FEEDWATER,
    title: 'Feedwater',
    materials: [
      { kind: 'brass', amount: 2 },
      { kind: 'sealant', amount: 2 }
    ],
    blueprints: []
  },
  {
    // The combining machine pays like its neighbours — materials the upgrade pipeline
    // will consume (§28), no new resource kind and no second blueprint competing with
    // the scanner's (§27.2 rule 5).
    id: MILESTONE_B2_GOVERNOR,
    title: 'Governor',
    materials: [
      { kind: 'scrap', amount: 2 },
      { kind: 'brass', amount: 2 }
    ],
    blueprints: []
  },
  {
    // The open-ended beat pays in the same vocabulary as its neighbours (§27.2 rule 5):
    // no new resource kind, no second blueprint competing with the scanner's.
    id: MILESTONE_B3_BYPASS,
    title: 'Bypass',
    materials: [
      { kind: 'brass', amount: 2 },
      { kind: 'scrap', amount: 1 }
    ],
    blueprints: []
  },
  {
    // The thermal branch's capstone pays in materials, exactly like BM-1 — no new
    // resource kind, no second blueprint competing with the scanner's (§27.2 rule 5).
    id: MILESTONE_BM2_STEAM_ENGINE,
    title: 'Steam Engine',
    materials: [
      { kind: 'brass', amount: 3 },
      { kind: 'alloy', amount: 1 },
      { kind: 'sealant', amount: 1 }
    ],
    blueprints: []
  },
  {
    // Branch C pays in the same materials vocabulary as A and B (§27.2 rule 5): a third
    // branch must not invent a resource kind to feel bigger, and the MVP keeps its one
    // blueprint on P2.
    id: MILESTONE_C1_TUYERE,
    title: 'Tuyere',
    materials: [
      { kind: 'scrap', amount: 2 },
      { kind: 'alloy', amount: 1 }
    ],
    blueprints: []
  },
  {
    id: MILESTONE_C2_QUENCH,
    title: 'Quench',
    materials: [
      { kind: 'brass', amount: 2 },
      { kind: 'sealant', amount: 1 }
    ],
    blueprints: []
  },
  {
    id: MILESTONE_C3_SLAG_RUN,
    title: 'Slag Run',
    materials: [
      { kind: 'scrap', amount: 2 },
      { kind: 'alloy', amount: 2 }
    ],
    blueprints: []
  },
  {
    // The Crucible's capstone pays like the other two staged machines — materials only.
    id: MILESTONE_CM3_GREAT_CRUCIBLE,
    title: 'Great Crucible',
    materials: [
      { kind: 'brass', amount: 3 },
      { kind: 'alloy', amount: 2 },
      { kind: 'sealant', amount: 1 }
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
