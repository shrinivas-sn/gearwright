/**
 * L1 — the upgrade pipeline (ARCH §28).
 *
 * The MVP shipped this framework's *shape* and no content: `InventorySystem.spendMaterial`
 * existed "for the upgrade framework" and nothing called it. This is that consumer, with
 * two authored upgrades fed by the materials all three branches already pay.
 *
 * §28.1's one indirection point is `valueOf(category, base)`: a consumer never reads an
 * upgrade level, so adding an upgrade is data, and changing how modifiers stack is one
 * edit here. The maths is deliberately boring:
 *
 *     effective = clamp((base + Σ additive) * Π multiplicative, min, max)
 *
 * additive before multiplicative, in a fixed order (§28.1's determinism note), with the
 * clamp last so a level can never take a value outside its declared range.
 *
 * §28.3 rule 2 is the invariant to keep: **a modifier may never change validation
 * semantics.** Nothing here may touch a socket's `accepts`, a requirement, or a puzzle
 * state — upgrades change how the player moves and reaches, never what a machine accepts.
 * Purchases are the only writer, through `purchase()`, and the only currency is the
 * inventory's materials (§28.3 rule 1).
 *
 * Unknown ids, bad levels and non-finite modifiers are rejected, never clamped: a save
 * that names an upgrade the content no longer ships loads *ignoring* it (the codec's
 * tolerance), and a definition with nonsense numbers fails at construction.
 */

import type { MaterialKind } from './inventory-system.ts';

/**
 * The modifier categories a consumer may ask about. Closed on purpose: a typo would
 * otherwise silently return the base value and look like "the upgrade did nothing".
 */
export type UpgradeCategory =
  /** ARCH §18's `interactRange`, in metres. */
  | 'interactRange'
  /** Multiplier on the carried walk/run speeds the manipulation layer scales. */
  | 'carrySpeedScale';

export const UPGRADE_CATEGORIES: ReadonlyArray<UpgradeCategory> = [
  'interactRange',
  'carrySpeedScale'
];

export interface UpgradeCost {
  readonly kind: MaterialKind;
  readonly amount: number;
}

/**
 * One level's effect. Every level lists both halves of the pipeline (possibly empty), so
 * "what does level 2 do" is readable without reading `valueOf`.
 */
export interface UpgradeLevelDefinition {
  readonly additive: Readonly<Partial<Record<UpgradeCategory, number>>>;
  readonly multiplicative: Readonly<Partial<Record<UpgradeCategory, number>>>;
  /** What this level costs, paid from the inventory when it is forged. */
  readonly cost: ReadonlyArray<UpgradeCost>;
}

export interface UpgradeDefinition {
  readonly id: string;
  readonly title: string;
  /** One line, in the same voice as the objective text: what the level buys. */
  readonly description: string;
  /** Levels are `1…maxLevel`; `0` is "not forged yet". */
  readonly maxLevel: number;
  readonly levels: ReadonlyArray<UpgradeLevelDefinition>;
}

export type UpgradePurchaseResult =
  | 'Ok'
  | 'Unknown'
  | 'Maxed'
  | 'CannotAfford'
  | 'NotSaved';

/** Paid from the inventory; false means at least one kind was short. */
export type UpgradeCostPaid = (costs: ReadonlyArray<UpgradeCost>) => boolean;

/** clamp(value, min, max) with a finite guard — a poisoned value falls back to the base. */
function clampTo(value: number, min: number | undefined, max: number | undefined): number {
  if (!Number.isFinite(value)) return 0;
  const floor = min === undefined ? Number.NEGATIVE_INFINITY : min;
  const ceiling = max === undefined ? Number.POSITIVE_INFINITY : max;
  return Math.min(Math.max(value, floor), ceiling);
}

/**
 * Validate a definition table at construction. Catching a bad row here means `valueOf`
 * and `costsFor` never have to defend against one at call time — the same "fail loudly
 * at load" rule the content bundle follows (§13 CONFIG/DATA LOAD).
 */
function assertDefinitions(definitions: ReadonlyArray<UpgradeDefinition>): void {
  const seen = new Set<string>();
  for (const definition of definitions) {
    if (definition.id === '' || seen.has(definition.id)) {
      throw new RangeError(`UpgradeSystem: duplicate or empty upgrade id "${definition.id}"`);
    }
    seen.add(definition.id);
    if (!Number.isInteger(definition.maxLevel) || definition.maxLevel < 1) {
      throw new RangeError(`UpgradeSystem: ${definition.id} maxLevel must be a positive integer`);
    }
    if (definition.levels.length !== definition.maxLevel) {
      throw new RangeError(
        `UpgradeSystem: ${definition.id} declares ${definition.maxLevel} levels but lists ${definition.levels.length}`
      );
    }
    definition.levels.forEach((level, index) => {
      for (const value of [
        ...Object.values(level.additive),
        ...Object.values(level.multiplicative)
      ]) {
        if (!Number.isFinite(value)) {
          throw new RangeError(`UpgradeSystem: ${definition.id} level ${index + 1} has a non-finite modifier`);
        }
      }
      if (level.cost.length === 0) {
        throw new RangeError(`UpgradeSystem: ${definition.id} level ${index + 1} costs nothing`);
      }
      for (const entry of level.cost) {
        if (!Number.isInteger(entry.amount) || entry.amount <= 0) {
          throw new RangeError(`UpgradeSystem: ${definition.id} level ${index + 1} has a non-positive cost`);
        }
      }
    });
  }
}

/** The ranges the composer clamps a modifier into, per category. */
const CATEGORY_BOUNDS: Readonly<Partial<Record<UpgradeCategory, { min: number; max: number }>>> = {
  // ARCH §18: 3.0 m default. A 5 m reach would let the player work a machine from across
  // the aisle, which is a different game; 4 m is two levels of half a metre.
  interactRange: { min: 1, max: 4 },
  // Carried locomotion starts at 0.6 walk / 0.85 run and must stay under a free run.
  carrySpeedScale: { min: 0.1, max: 1 }
};

export class UpgradeSystem {
  private readonly definitions: ReadonlyMap<string, UpgradeDefinition>;
  private readonly order: ReadonlyArray<UpgradeDefinition>;
  private levels = new Map<string, number>();

  constructor(definitions: ReadonlyArray<UpgradeDefinition> = []) {
    assertDefinitions(definitions);
    this.order = [...definitions];
    this.definitions = new Map(definitions.map((definition) => [definition.id, definition]));
  }

  /** Every shipped upgrade, in authored order (the forge shows them in this order). */
  get all(): ReadonlyArray<UpgradeDefinition> {
    return this.order;
  }

  definitionOf(id: string): UpgradeDefinition | null {
    return this.definitions.get(id) ?? null;
  }

  levelOf(id: string): number {
    return this.levels.get(id) ?? 0;
  }

  isMaxed(id: string): boolean {
    const definition = this.definitions.get(id);
    return definition !== undefined && this.levelOf(id) >= definition.maxLevel;
  }

  /**
   * What the next level costs, or `null` when the upgrade is unknown or maxed. The forge
   * reads this to write its own verb; it never parses the cost out of a string.
   */
  costsFor(id: string): ReadonlyArray<UpgradeCost> | null {
    const definition = this.definitions.get(id);
    if (definition === undefined) return null;
    const level = this.levelOf(id);
    if (level >= definition.maxLevel) return null;
    return definition.levels[level]?.cost ?? null;
  }

  /**
   * §28.3 rule 1: the only write path. `pay` is the inventory's own spend (a callback, so
   * this module never imports a system — the composition passes `spendMaterial`), and it
   * is called once with the whole cost so a multi-kind level is atomic.
   */
  purchase(id: string, pay: UpgradeCostPaid): UpgradePurchaseResult {
    const definition = this.definitions.get(id);
    if (definition === undefined) return 'Unknown';
    if (this.isMaxed(id)) return 'Maxed';
    const costs = this.costsFor(id);
    if (costs === null) return 'Maxed';
    if (!pay(costs)) return 'CannotAfford';
    this.levels.set(id, this.levelOf(id) + 1);
    return 'Ok';
  }

  /**
   * §28.1's pipeline: additive, then multiplicative, then the category's own clamp. A
   * category with no bounds falls back to the *base* clamp, so a new category is never
   * silently unbounded.
   */
  valueOf(category: UpgradeCategory, base: number): number {
    const bounds = CATEGORY_BOUNDS[category];
    let additive = 0;
    let multiplicative = 1;
    for (const definition of this.order) {
      const level = this.levelOf(definition.id);
      if (level <= 0) continue;
      for (let index = 0; index < level; index += 1) {
        const row = definition.levels[index];
        if (row === undefined) continue;
        additive += row.additive[category] ?? 0;
        multiplicative *= row.multiplicative[category] ?? 1;
      }
    }
    return clampTo((base + additive) * multiplicative, bounds?.min, bounds?.max);
  }

  /** The forge's own read model: what it can offer, and what it costs. */
  forgeOptions(): ReadonlyArray<{
    readonly id: string;
    readonly title: string;
    readonly description: string;
    readonly level: number;
    readonly maxLevel: number;
    readonly costs: ReadonlyArray<UpgradeCost>;
  }> {
    const options = [];
    for (const definition of this.order) {
      const costs = this.costsFor(definition.id);
      if (costs === null) continue;
      options.push({
        id: definition.id,
        title: definition.title,
        description: definition.description,
        level: this.levelOf(definition.id),
        maxLevel: definition.maxLevel,
        costs
      });
    }
    return options;
  }

  // --- snapshot / restore (SaveCodec reads these, §28.3 rule 3) --------------------

  snapshot(): Readonly<Record<string, number>> {
    const out: Record<string, number> = {};
    for (const [id, level] of this.levels) {
      if (level > 0) out[id] = level;
    }
    return out;
  }

  /**
   * Restore from a canonical snapshot. Unknown ids and out-of-range levels are *ignored*,
   * exactly like `InventorySystem.restore`'s unknown material keys — the codec's schema
   * check rejects the malformed save first, and a save from a build that shipped one more
   * upgrade must still load.
   */
  restore(levels: Readonly<Record<string, number>>): void {
    this.levels = new Map();
    for (const [id, level] of Object.entries(levels)) {
      const definition = this.definitions.get(id);
      if (definition === undefined) continue;
      if (!Number.isInteger(level) || level < 1) continue;
      this.levels.set(id, Math.min(level, definition.maxLevel));
    }
  }

  /** New Game only (ARCH §12.2 upgrade-levels row). */
  resetAll(): void {
    this.levels = new Map();
  }
}
