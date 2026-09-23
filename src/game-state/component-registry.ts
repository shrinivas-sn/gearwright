/**
 * L1 — the component registry (ARCH §12.2, §22, §40 `game-state/`).
 *
 * Owns **identity and placement** for the components a level author placed:
 * instance id, definition, canonical pose, recovery anchor, flags. Nothing here
 * is derived from the graph and nothing here may duplicate it — in particular an
 * instance carries no `attachedTo`, because attachment has exactly one owner
 * (`MachineGraph`, ARCH §21.3 "occupancy is derived"). A second copy is the
 * classic desync, and §12.2 gives the graph that column.
 *
 * The registry is also the load-time integrity gate: required parts must exist
 * and every instance must resolve to a definition, otherwise a puzzle can be
 * silently unsolvable (EC-GEN-01).
 */

import {
  MASS_RANK,
  type ComponentDefinition,
  type ComponentKind,
  type ComponentTag,
  type MachineDefinition,
  type SocketDefinition,
  type SocketInstance
} from './component-model.ts';

/** Protection flags for a component instance (ARCH §22). */
export interface ComponentFlags {
  /** Puzzle that requires this part; drives the load-time integrity check. */
  readonly required?: string | undefined;
  readonly unique?: true | undefined;
  readonly indestructible?: true | undefined;
}

/** An authored component instance (ARCH §22 `ComponentInstance`). */
export interface ComponentInstance {
  readonly id: string;
  readonly defId: string;
  readonly kind: ComponentKind;
  /**
   * Where a displaced required part is returned to (ARCH §22 `spawnAnchorId`,
   * EC-GEN-01). An anchor *id*, never a live transform.
   */
  readonly spawnAnchorId: string;
  readonly flags: ComponentFlags;
}

export interface RegistryIntegrityError {
  readonly code: 'UnknownDefinition' | 'MissingRequiredPart' | 'DuplicateInstance' | 'UnknownMassClass';
  readonly detail: string;
}

export class ComponentRegistry {
  private readonly definitions = new Map<string, ComponentDefinition>();
  private readonly instances = new Map<string, ComponentInstance>();

  constructor(
    definitions: ReadonlyArray<ComponentDefinition> = [],
    instances: ReadonlyArray<ComponentInstance> = []
  ) {
    for (const definition of definitions) this.definitions.set(definition.id, definition);
    for (const instance of instances) this.instances.set(instance.id, instance);
  }

  /** Register a definition (level load / test fixture). Replaces by id. */
  define(definition: ComponentDefinition): void {
    this.definitions.set(definition.id, definition);
  }

  /** Register an instance. Returns false when the id is already taken. */
  add(instance: ComponentInstance): boolean {
    if (this.instances.has(instance.id)) return false;
    this.instances.set(instance.id, instance);
    return true;
  }

  /** Remove an instance (consumed part). The graph edge, if any, is the caller's. */
  remove(instanceId: string): boolean {
    return this.instances.delete(instanceId);
  }

  get(instanceId: string): ComponentInstance | null {
    return this.instances.get(instanceId) ?? null;
  }

  definitionOf(defId: string): ComponentDefinition | null {
    return this.definitions.get(defId) ?? null;
  }

  /** The definition behind an instance, or null when the instance is unknown. */
  definitionFor(instanceId: string): ComponentDefinition | null {
    const instance = this.instances.get(instanceId);
    return instance ? this.definitions.get(instance.defId) ?? null : null;
  }

  /** Capability tags of an instance (empty when it cannot be resolved). */
  tagsOf(instanceId: string): ReadonlyArray<ComponentTag> {
    return this.definitionFor(instanceId)?.tags ?? [];
  }

  hasTag(instanceId: string, tag: ComponentTag): boolean {
    return this.tagsOf(instanceId).includes(tag);
  }

  /** Heaviest mass class this registry declares (load-time sanity check). */
  massRankOf(instanceId: string): number | null {
    const definition = this.definitionFor(instanceId);
    return definition ? MASS_RANK[definition.massClass] : null;
  }

  /** Every instance, sorted by id: deterministic iteration (ARCH §23.2). */
  get all(): ReadonlyArray<ComponentInstance> {
    return [...this.instances.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  /** Instances carrying a tag, sorted by id. */
  byTag(tag: ComponentTag): ReadonlyArray<ComponentInstance> {
    return this.all.filter((instance) => this.hasTag(instance.id, tag));
  }

  /** Instances required by a puzzle, sorted by id. */
  requiredFor(puzzleId: string): ReadonlyArray<ComponentInstance> {
    return this.all.filter((instance) => instance.flags.required === puzzleId);
  }

  get size(): number {
    return this.instances.size;
  }

  /**
   * Load-time integrity (ARCH §22 "required parts get extra protections", EC-GEN-01).
   * Pure and read-only: it reports problems, it never repairs them.
   */
  checkIntegrity(requiredInstanceIds: ReadonlyArray<string> = []): ReadonlyArray<RegistryIntegrityError> {
    const errors: RegistryIntegrityError[] = [];
    const seen = new Set<string>();

    for (const instance of this.all) {
      if (!this.definitions.has(instance.defId)) {
        errors.push({
          code: 'UnknownDefinition',
          detail: `${instance.id} references unknown definition ${instance.defId}`
        });
      }
      if (seen.has(instance.id)) {
        errors.push({ code: 'DuplicateInstance', detail: instance.id });
      }
      seen.add(instance.id);
    }

    for (const required of requiredInstanceIds) {
      if (!this.instances.has(required)) {
        errors.push({ code: 'MissingRequiredPart', detail: required });
      }
    }

    return errors;
  }
}

/**
 * Everything L1 needs to answer questions about one level's machinery: the
 * placed components, the placed sockets (with their definitions) and the machine
 * definitions. Assembled by the composition root from `data/` + `levels/` — L1
 * itself never imports content, which is what keeps it headless and testable
 * without a level.
 */
export interface MachineContent {
  readonly registry: ComponentRegistry;
  readonly sockets: ReadonlyArray<SocketInstance>;
  readonly socketDefinitions: ReadonlyArray<SocketDefinition>;
  readonly machines: ReadonlyArray<MachineDefinition>;
}

/** An empty content bundle: a graph with no machines is inert, not broken. */
export const EMPTY_MACHINE_CONTENT: MachineContent = {
  registry: new ComponentRegistry(),
  sockets: [],
  socketDefinitions: [],
  machines: []
};
