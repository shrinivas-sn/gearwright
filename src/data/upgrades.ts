/**
 * CONTENT — upgrade definitions (ARCH §28, §40 `data/`).
 *
 * Two upgrades, two levels each, spending the four materials every branch already pays:
 * the §27.1 promise that materials are "only used for upgrades/repairs" finally has a
 * reader. Both are **numeric** modifiers (§28.2's split: capability unlocks ride
 * blueprints), and both stay clear of §28.3 rule 2 — reach and carried speed change how
 * the player works, never what a socket accepts or a puzzle requires.
 *
 * Costs are deliberately affordable before Branch C: Branch A alone pays 5 scrap, 5
 * brass, 2 sealant and 1 alloy, which is exactly `upgrade/reach` 1–2. A player who never
 * leaves the Pressure Gallery can still feel their first forge, and the later branches
 * fund `upgrade/load` and the second levels.
 */

import type { UpgradeDefinition } from '../game-state/upgrade-system.ts';

/** Reach — ARCH §18's `interactRange`, +0.5 m per level (3 m → 3.5 → 4 m). */
export const UPGRADE_REACH = 'upgrade/reach';
/** Load — the carried walk/run scale, +12% per level on the manipulation layer's base. */
export const UPGRADE_LOAD = 'upgrade/load';

export const UPGRADE_DEFINITIONS: ReadonlyArray<UpgradeDefinition> = [
  {
    id: UPGRADE_REACH,
    title: 'Longer Reach',
    description: 'Work a machine from a step further back.',
    maxLevel: 2,
    levels: [
      {
        additive: { interactRange: 0.5 },
        multiplicative: {},
        cost: [
          { kind: 'scrap', amount: 2 },
          { kind: 'brass', amount: 2 }
        ]
      },
      {
        // The second level pays for itself in feel: 4 m is the clamp, so this is the last
        // one — a further level would stop being a modifier and start being a different reach.
        additive: { interactRange: 0.5 },
        multiplicative: {},
        cost: [
          { kind: 'brass', amount: 3 },
          { kind: 'sealant', amount: 2 }
        ]
      }
    ]
  },
  {
    id: UPGRADE_LOAD,
    title: 'Stronger Carry',
    description: 'Move faster while carrying a part.',
    maxLevel: 2,
    levels: [
      {
        // The carried walk/run scales start at 0.6 / 0.85 in the manipulation layer; each
        // level is a proportional lift, so the upgrade stays honest if those are ever retuned.
        additive: {},
        multiplicative: { carrySpeedScale: 1.12 },
        cost: [
          { kind: 'sealant', amount: 2 },
          { kind: 'scrap', amount: 2 }
        ]
      },
      {
        additive: {},
        multiplicative: { carrySpeedScale: 1.12 },
        cost: [
          { kind: 'alloy', amount: 2 },
          { kind: 'brass', amount: 2 }
        ]
      }
    ]
  }
];
