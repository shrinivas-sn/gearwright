/**
 * L1 — the inventory (ARCH §27, §40 `game-state/inventory-system.ts`).
 *
 * Three deliberately different resources (§27.1):
 *
 *   - **parts** are unique *instances* (`PartInstanceId[]`), not counts —
 *     instance identity is what makes duplication bugs unrepresentable and
 *     "recover the lost part" tractable (§31);
 *   - **materials** are counts over a closed four-kind vocabulary
 *     (`scrap | brass | sealant | alloy`) — small enough that UI and save stay
 *     simple forever;
 *   - **blueprints** are a `Set` — unlock semantics are naturally idempotent
 *     (R-8).
 *
 * This system **never decides rewards** (§27.2 rule 5): the reward system reads
 * a `RewardDefinition` and calls *into* here. Every mutation is guarded
 * (unknown kinds, non-finite and negative amounts are rejected, not clamped)
 * so a bad reward definition fails loudly at grant time instead of poisoning
 * the canonical state.
 */

export type MaterialKind = 'scrap' | 'brass' | 'sealant' | 'alloy';

export const MATERIAL_KINDS: ReadonlyArray<MaterialKind> = ['scrap', 'brass', 'sealant', 'alloy'];

export type MaterialCounts = Record<MaterialKind, number>;

export interface InventorySnapshot {
  readonly parts: ReadonlyArray<string>;
  readonly materials: MaterialCounts;
  readonly blueprints: ReadonlyArray<string>;
}

export type InventoryGrantResult = 'Ok' | 'UnknownMaterial' | 'InvalidAmount';

/** The four kinds are the closed vocabulary — exhaustively keyed by design. */
function emptyMaterials(): MaterialCounts {
  return { scrap: 0, brass: 0, sealant: 0, alloy: 0 };
}

function isMaterialKind(kind: string): kind is MaterialKind {
  return (MATERIAL_KINDS as ReadonlyArray<string>).includes(kind);
}

export class InventorySystem {
  private readonly partsOwned = new Set<string>();
  private readonly blueprintsOwned = new Set<string>();
  private materials: MaterialCounts = emptyMaterials();

  // --- parts (unique instances) -------------------------------------------------

  addPart(instanceId: string): boolean {
    if (this.partsOwned.has(instanceId)) return false;
    this.partsOwned.add(instanceId);
    return true;
  }

  removePart(instanceId: string): boolean {
    return this.partsOwned.delete(instanceId);
  }

  hasPart(instanceId: string): boolean {
    return this.partsOwned.has(instanceId);
  }

  get partIds(): ReadonlyArray<string> {
    return [...this.partsOwned].sort();
  }

  // --- materials (counts over the closed vocabulary) -----------------------------

  addMaterial(kind: MaterialKind, amount: number): InventoryGrantResult {
    if (!isMaterialKind(kind)) return 'UnknownMaterial';
    if (!Number.isInteger(amount) || amount <= 0) return 'InvalidAmount';
    this.materials[kind] += amount;
    return 'Ok';
  }

  /** Spend is exposed for the upgrade framework (§28); it is not an MVP path. */
  spendMaterial(kind: MaterialKind, amount: number): InventoryGrantResult {
    if (!isMaterialKind(kind)) return 'UnknownMaterial';
    if (!Number.isInteger(amount) || amount <= 0) return 'InvalidAmount';
    if (this.materials[kind] < amount) return 'InvalidAmount';
    this.materials[kind] -= amount;
    return 'Ok';
  }

  materialCount(kind: MaterialKind): number {
    return this.materials[kind];
  }

  get materialCounts(): MaterialCounts {
    return { ...this.materials };
  }

  // --- blueprints (set semantics, R-8) -------------------------------------------

  unlockBlueprint(blueprintId: string): boolean {
    if (this.blueprintsOwned.has(blueprintId)) return false;
    this.blueprintsOwned.add(blueprintId);
    return true;
  }

  hasBlueprint(blueprintId: string): boolean {
    return this.blueprintsOwned.has(blueprintId);
  }

  get blueprintIds(): ReadonlyArray<string> {
    return [...this.blueprintsOwned].sort();
  }

  // --- snapshot / restore (SaveCodec reads these, §31.1) --------------------------

  snapshot(): InventorySnapshot {
    return {
      parts: this.partIds,
      materials: this.materialCounts,
      blueprints: this.blueprintIds
    };
  }

  /**
   * Restore from a canonical snapshot. Unknown material keys are a schema
   * violation the codec must reject first (§31.5); this loader still tolerates
   * only the known four.
   */
  restore(snapshot: InventorySnapshot): void {
    this.partsOwned.clear();
    for (const part of snapshot.parts) this.partsOwned.add(part);
    this.blueprintsOwned.clear();
    for (const blueprint of snapshot.blueprints) this.blueprintsOwned.add(blueprint);
    this.materials = emptyMaterials();
    for (const [kind, count] of Object.entries(snapshot.materials)) {
      if (isMaterialKind(kind)) this.materials[kind] = count;
    }
  }

  /** New Game only (ARCH §12.2 inventory rows). */
  resetAll(): void {
    this.partsOwned.clear();
    this.blueprintsOwned.clear();
    this.materials = emptyMaterials();
  }
}
