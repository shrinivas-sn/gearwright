import { describe, expect, it } from 'vitest';

import { UPGRADE_DEFINITIONS, UPGRADE_LOAD, UPGRADE_REACH } from '../../src/data/upgrades.ts';
import { InventorySystem, type MaterialKind } from '../../src/game-state/inventory-system.ts';
import {
  UpgradeSystem,
  type UpgradeCost,
  type UpgradeDefinition
} from '../../src/game-state/upgrade-system.ts';

/**
 * ARCH §28's modifier pipeline and its purchase path.
 *
 * The repo shipped the *shape* of this framework from the start (an inventory that can
 * spend, a save schema that names upgrade levels) and no content, so these tests are the
 * first to hold a real upgrade table to the spec: one write path, additive before
 * multiplicative, a clamp last, and never a validation change.
 */

/** The shipped table, wired to a real inventory — the same pair the composition builds. */
function shipped(startingMaterials: Partial<Record<MaterialKind, number>> = {}) {
  const inventory = new InventorySystem();
  for (const [kind, amount] of Object.entries(startingMaterials)) {
    inventory.addMaterial(kind as MaterialKind, amount as number);
  }
  const upgrades = new UpgradeSystem(UPGRADE_DEFINITIONS);
  const pay = (costs: ReadonlyArray<UpgradeCost>): boolean => {
    // Atomic: every kind must be affordable before any is spent, so a two-kind level can
    // never half-charge (the composition passes the same shape over `spendMaterial`).
    for (const cost of costs) {
      if (inventory.materialCount(cost.kind) < cost.amount) return false;
    }
    for (const cost of costs) inventory.spendMaterial(cost.kind, cost.amount);
    return true;
  };
  return { inventory, upgrades, pay };
}

describe('UpgradeSystem — the §28 modifier pipeline', () => {
  it('leaves a base value untouched with no levels', () => {
    const { upgrades } = shipped();
    expect(upgrades.valueOf('interactRange', 3)).toBe(3);
    expect(upgrades.valueOf('carrySpeedScale', 1)).toBe(1);
  });

  it('applies additive modifiers before multiplicative ones, then clamps', () => {
    const definitions2: UpgradeDefinition[] = [
      {
        id: 'test/additive',
        title: 'Additive',
        description: 'test',
        maxLevel: 1,
        levels: [{ additive: { carrySpeedScale: 0.2 }, multiplicative: {}, cost: [{ kind: 'scrap', amount: 1 }] }]
      },
      {
        id: 'test/multiply',
        title: 'Multiply',
        description: 'test',
        maxLevel: 1,
        levels: [{ additive: {}, multiplicative: { carrySpeedScale: 1.1 }, cost: [{ kind: 'scrap', amount: 1 }] }]
      }
    ];
    const { upgrades, pay } = shipped({ scrap: 4 });
    const system = new UpgradeSystem(definitions2);
    // (0.6 + 0.2) * 1.1 = 0.88 — additive first. Multiplicative-first would give
    // 0.6 * 1.1 + 0.2 = 0.86, so the two orders are distinguishable inside the clamp.
    expect(system.purchase('test/additive', pay)).toBe('Ok');
    expect(system.purchase('test/multiply', pay)).toBe('Ok');
    expect(system.valueOf('carrySpeedScale', 0.6)).toBeCloseTo(0.88, 6);
    // The *category's* clamp still applies: a multiplier may never exceed an uncarried run.
    expect(system.valueOf('carrySpeedScale', 2)).toBe(1);
    // Not the shipped table, so the shared system above is untouched.
    expect(upgrades.valueOf('carrySpeedScale', 1)).toBe(1);
  });

  it('sums every level of an upgrade, not just the last one', () => {
    const { upgrades, pay } = shipped({ scrap: 4, brass: 5, sealant: 2 });
    expect(upgrades.purchase(UPGRADE_REACH, pay)).toBe('Ok');
    expect(upgrades.valueOf('interactRange', 3)).toBeCloseTo(3.5, 6);
    expect(upgrades.purchase(UPGRADE_REACH, pay)).toBe('Ok');
    expect(upgrades.valueOf('interactRange', 3)).toBeCloseTo(4, 6);
  });

  it('never lets a modifier escape its category bounds', () => {
    const { upgrades, pay } = shipped({ scrap: 4, brass: 5, sealant: 2 });
    upgrades.purchase(UPGRADE_REACH, pay);
    upgrades.purchase(UPGRADE_REACH, pay);
    // 3 m + 1.0 = 4 m is the ceiling, but a caller asking from further out still clamps.
    expect(upgrades.valueOf('interactRange', 5)).toBe(4);
    expect(upgrades.valueOf('interactRange', 0)).toBe(1);
  });
});

describe('UpgradeSystem — purchasing', () => {
  it('charges exactly the declared cost and raises the level by one', () => {
    const { inventory, upgrades, pay } = shipped({ scrap: 5, brass: 5 });
    const before = inventory.materialCounts;
    expect(upgrades.purchase(UPGRADE_REACH, pay)).toBe('Ok');
    const after = inventory.materialCounts;
    expect(after.scrap).toBe(before.scrap - 2);
    expect(after.brass).toBe(before.brass - 2);
    expect(upgrades.levelOf(UPGRADE_REACH)).toBe(1);
  });

  it('changes nothing when the materials are short', () => {
    const { inventory, upgrades, pay } = shipped({ scrap: 1, brass: 1 });
    expect(upgrades.purchase(UPGRADE_REACH, pay)).toBe('CannotAfford');
    expect(upgrades.levelOf(UPGRADE_REACH)).toBe(0);
    expect(inventory.materialCounts.scrap).toBe(1);
    expect(inventory.materialCounts.brass).toBe(1);
    expect(upgrades.valueOf('interactRange', 3)).toBe(3);
  });

  it('does not half-charge a two-kind level', () => {
    const { inventory, upgrades, pay } = shipped({ scrap: 5, brass: 1 });
    expect(upgrades.purchase(UPGRADE_REACH, pay)).toBe('CannotAfford');
    // The scrap was never spent: the level is atomic.
    expect(inventory.materialCounts.scrap).toBe(5);
    expect(inventory.materialCounts.brass).toBe(1);
  });

  it('stops at max level and refuses unknown ids', () => {
    const { upgrades, pay } = shipped({ scrap: 9, brass: 9, sealant: 9, alloy: 9 });
    upgrades.purchase(UPGRADE_REACH, pay);
    upgrades.purchase(UPGRADE_REACH, pay);
    expect(upgrades.purchase(UPGRADE_REACH, pay)).toBe('Maxed');
    expect(upgrades.isMaxed(UPGRADE_REACH)).toBe(true);
    expect(upgrades.purchase('upgrade/does-not-exist', pay)).toBe('Unknown');
    expect(upgrades.costsFor('upgrade/does-not-exist')).toBeNull();
    expect(upgrades.costsFor(UPGRADE_LOAD)?.map((cost) => cost.kind)).toEqual(['sealant', 'scrap']);
  });

  it('reports what the forge can offer, in authored order', () => {
    const { upgrades } = shipped();
    const options = upgrades.forgeOptions();
    expect(options.map((option) => option.id)).toEqual([UPGRADE_REACH, UPGRADE_LOAD]);
    expect(options[0]?.level).toBe(0);
    expect(options[0]?.maxLevel).toBe(2);
    // A maxed upgrade leaves the offer list — the forge has nothing to sell.
    const { upgrades: second, pay } = shipped({ scrap: 9, brass: 9, sealant: 9, alloy: 9 });
    second.purchase(UPGRADE_REACH, pay);
    second.purchase(UPGRADE_REACH, pay);
    expect(second.forgeOptions().map((option) => option.id)).toEqual([UPGRADE_LOAD]);
  });
});

describe('UpgradeSystem — snapshot and restore', () => {
  it('round-trips forged levels and ignores unknown ids', () => {
    const { upgrades, pay } = shipped({ scrap: 9, brass: 9, sealant: 9, alloy: 9 });
    upgrades.purchase(UPGRADE_REACH, pay);
    upgrades.purchase(UPGRADE_LOAD, pay);
    const snapshot = upgrades.snapshot();
    expect(snapshot).toEqual({ [UPGRADE_REACH]: 1, [UPGRADE_LOAD]: 1 });

    const { upgrades: restored } = shipped();
    restored.restore({ ...snapshot, 'upgrade/removed': 2 });
    expect(restored.levelOf(UPGRADE_REACH)).toBe(1);
    expect(restored.valueOf('interactRange', 3)).toBeCloseTo(3.5, 6);
    expect(restored.levelOf('upgrade/removed')).toBe(0);
  });

  it('clamps a level past the shipped max instead of trusting the save', () => {
    const { upgrades } = shipped();
    upgrades.restore({ [UPGRADE_REACH]: 99 });
    expect(upgrades.levelOf(UPGRADE_REACH)).toBe(2);
    expect(upgrades.valueOf('interactRange', 3)).toBe(4);
  });

  it('resetAll returns a new game to nothing forged', () => {
    const { upgrades, pay } = shipped({ scrap: 9, brass: 9 });
    upgrades.purchase(UPGRADE_REACH, pay);
    upgrades.resetAll();
    expect(upgrades.levelOf(UPGRADE_REACH)).toBe(0);
    expect(upgrades.snapshot()).toEqual({});
    expect(upgrades.valueOf('interactRange', 3)).toBe(3);
  });
});

describe('UpgradeSystem — bad definitions fail loudly', () => {
  const base: UpgradeDefinition = {
    id: 'test/ok',
    title: 'Ok',
    description: 'test',
    maxLevel: 1,
    levels: [{ additive: { interactRange: 1 }, multiplicative: {}, cost: [{ kind: 'scrap', amount: 1 }] }]
  };

  it('rejects a duplicate id, a level-count mismatch and a free level', () => {
    expect(() => new UpgradeSystem([base, base])).toThrow(RangeError);
    expect(() => new UpgradeSystem([{ ...base, maxLevel: 2 }])).toThrow(RangeError);
    expect(() =>
      new UpgradeSystem([{ ...base, levels: [{ ...base.levels[0]!, cost: [] }] }])
    ).toThrow(RangeError);
  });

  it('rejects a non-finite modifier and a non-positive cost', () => {
    expect(() =>
      new UpgradeSystem([
        {
          ...base,
          levels: [{ additive: { interactRange: Number.POSITIVE_INFINITY }, multiplicative: {}, cost: [{ kind: 'scrap', amount: 1 }] }]
        }
      ])
    ).toThrow(RangeError);
    expect(() =>
      new UpgradeSystem([
        { ...base, levels: [{ additive: {}, multiplicative: {}, cost: [{ kind: 'scrap', amount: 0 }] }] }
      ])
    ).toThrow(RangeError);
  });
});
