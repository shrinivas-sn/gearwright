import { describe, expect, it } from 'vitest';

import { BLANKING_PLATE_DEF, COMPONENT_DEFINITIONS, CRATE_DEF, GEAR_DEF } from '../../src/data/components.ts';
import { ComponentRegistry, type ComponentInstance } from '../../src/game-state/component-registry.ts';
import { P1_COMPONENTS, P1_LOOSE_PARTS, P1_SHAFTS } from '../../src/levels/branch-a.ts';

/**
 * L1 — the component registry (ARCH §12.2, §22).
 *
 * Two properties are load-bearing and tested here: the registry owns *identity and
 * placement* only (attachment lives in the graph, so a registry instance can never
 * disagree with the machine), and the load-time integrity check catches a level
 * that references a definition it does not ship (EC-GEN-01).
 */

function p1Registry(): ComponentRegistry {
  return new ComponentRegistry(COMPONENT_DEFINITIONS, P1_COMPONENTS);
}

describe('ComponentRegistry — identity and capability lookup', () => {
  it('resolves instances to definitions and exposes their capability tags', () => {
    const registry = p1Registry();

    expect(registry.size).toBe(P1_COMPONENTS.length);
    expect(registry.get('gear-a')?.defId).toBe(GEAR_DEF.id);
    expect(registry.definitionFor('gear-a')?.tags).toEqual(['gear']);
    expect(registry.hasTag('gear-a', 'gear')).toBe(true);
    expect(registry.hasTag('gear-a', 'shaft')).toBe(false);
    expect(registry.definitionFor('ghost')).toBeNull();
    expect(registry.tagsOf('ghost')).toEqual([]);
  });

  it('iterates deterministically, sorted by id', () => {
    const registry = p1Registry();

    const ids = registry.all.map((instance) => instance.id);
    expect(ids).toEqual([...ids].sort());
    expect(ids).toContain('frame-a');
    expect(registry.byTag('shaft').map((instance) => instance.id)).toEqual(['shaft-a', 'shaft-b']);
  });

  it('maps mass class to a rank so handling limits compare by capability', () => {
    const registry = p1Registry();

    expect(registry.massRankOf('gear-a')).toBe(1); // standard
    expect(registry.massRankOf('shaft-a')).toBe(2); // heavy
    expect(registry.massRankOf('ghost')).toBeNull();
  });

  it('lists the parts a puzzle requires', () => {
    const registry = p1Registry();

    // The blanking plate is registered but deliberately *not* required: P1 is solvable
    // without it, and its whole point is that a part can fit and still not count
    // (§21.4, M6 content). Everything else in the P1 set is required.
    expect(registry.requiredFor('P1').map((instance) => instance.id)).toEqual([
      'frame-a',
      'gear-a',
      'shaft-a',
      'shaft-b'
    ]);
    expect(registry.get('plate-a')?.defId).toBe(BLANKING_PLATE_DEF.id);
    expect(registry.requiredFor('P3')).toEqual([]);
  });
});

describe('ComponentRegistry — placement without duplicating attachment', () => {
  it('stores identity, anchors and flags and nothing about the machine', () => {
    const instance = p1Registry().get('gear-a')!;

    // ARCH §21.3: attachment has exactly one owner (the graph). An `attachedTo`
    // here would be a second copy of that truth, so it must not exist.
    expect(Object.keys(instance).sort()).toEqual(['defId', 'flags', 'id', 'kind', 'spawnAnchorId']);
    expect(instance.flags).toMatchObject({ required: 'P1', unique: true });
    expect(instance.spawnAnchorId).toBe('anchor/p1-gear');
  });

  it('gives every authored part a recovery anchor (EC-GEN-01)', () => {
    for (const instance of p1Registry().all) {
      expect(instance.spawnAnchorId.length).toBeGreaterThan(0);
    }
  });

  it('refuses a duplicate instance id instead of silently replacing it', () => {
    const registry = p1Registry();
    const duplicate: ComponentInstance = { ...P1_LOOSE_PARTS[0]!, id: 'gear-a' };

    expect(registry.add(duplicate)).toBe(false);
    expect(registry.size).toBe(P1_COMPONENTS.length);
    expect(registry.get('gear-a')?.defId).toBe(GEAR_DEF.id);
  });

  it('can remove an instance and reports whether anything was removed', () => {
    const registry = p1Registry();

    expect(registry.remove('gear-a')).toBe(true);
    expect(registry.remove('gear-a')).toBe(false);
    expect(registry.get('gear-a')).toBeNull();
  });
});

describe('ComponentRegistry — load-time integrity (ARCH §22, EC-GEN-01)', () => {
  it('is clean for the authored level', () => {
    expect(p1Registry().checkIntegrity(P1_COMPONENTS.map((instance) => instance.id))).toEqual([]);
  });

  it('reports an instance that references a definition the level does not ship', () => {
    const registry = new ComponentRegistry([CRATE_DEF], [{ ...P1_SHAFTS[0]!, defId: 'def/missing' }]);

    expect(registry.checkIntegrity()).toEqual([
      { code: 'UnknownDefinition', detail: 'shaft-a references unknown definition def/missing' }
    ]);
  });

  it('reports a missing required part, so a puzzle cannot be silently unsolvable', () => {
    const registry = new ComponentRegistry(COMPONENT_DEFINITIONS, [P1_SHAFTS[0]!]);

    expect(registry.checkIntegrity(['shaft-a', 'gear-a'])).toEqual([
      { code: 'MissingRequiredPart', detail: 'gear-a' }
    ]);
  });

  it('reports several problems at once and never repairs anything', () => {
    const registry = new ComponentRegistry([], [{ ...P1_SHAFTS[0]!, defId: 'def/missing' }]);

    const errors = registry.checkIntegrity(['frame-a']);

    expect(errors.map((error) => error.code)).toEqual(['UnknownDefinition', 'MissingRequiredPart']);
    expect(registry.size).toBe(1);
  });
});
