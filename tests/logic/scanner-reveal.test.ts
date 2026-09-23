import { describe, expect, it } from 'vitest';

import { BM1_PUZZLE } from '../../src/data/puzzles/bm1.ts';
import { P1_PUZZLE } from '../../src/data/puzzles/p1.ts';
import { PUZZLE_DEFINITIONS } from '../../src/data/puzzles/index.ts';
import { indexRequirements, scannerRevealFor } from '../../src/game-state/scanner-reveal.ts';
import type { MachineContent } from '../../src/game-state/component-registry.ts';
import type { MachineGraph } from '../../src/game-state/machine-graph.ts';
import type { Requirement } from '../../src/game-state/validator.ts';
import { branchContent, branchGraph } from './support/branch-a-content.ts';
import { p1Content, p1Graph } from './support/p1-mesh.ts';

/**
 * TEST §9 — the scanner's reveal derivation (ARCH §29.3). The point of the suite is the
 * *shape* of the answer: a reveal collects what a failed requirement names and what its
 * declared capabilities point at, it descends nested requirements instead of judging
 * them, and it never evaluates a rule (the validator owns every verdict).
 */

/** The requirement with this id inside a puzzle's tree (nested ids included). */
function requirementOf(requirements: ReadonlyArray<Requirement>, id: string): Requirement {
  const found = indexRequirements(requirements).get(id);
  if (found === undefined) throw new Error(`no requirement ${id} in the fixture`);
  return found;
}

/** Everything a reveal says about one entity, as a compact `kind:id(role)` string. */
function targetsOf(content: MachineContent, graph: MachineGraph, requirement: Requirement): string[] {
  return scannerRevealFor(requirement, content, graph).targets.map(
    (target) => `${target.kind}:${target.id}(${target.role})`
  );
}

describe('scannerRevealFor — §29.3 (collects what the requirement names, never evaluates)', () => {
  it("names P1's two shafts and points at the gear and the socket that would take one", () => {
    const content = p1Content();
    const graph = p1Graph();
    const reveal = scannerRevealFor(
      requirementOf(P1_PUZZLE.requirements, 'p1/drive-through-gear'),
      content,
      graph
    );

    expect(reveal.requirementId).toBe('p1/drive-through-gear');
    expect(
      reveal.targets.map((target) => `${target.kind}:${target.id}(${target.role})`)
    ).toEqual([
      // The gear is the carrier the requirement asks for; the mesh socket is where a
      // `gear`-carrying part is accepted. Both come from data (tags + `accepts`), not
      // from any judgement about whether the machine works.
      'component:gear-a(candidate)',
      'component:shaft-a(named)',
      'component:shaft-b(named)',
      'socket:socket-mesh(candidate)'
    ]);
  });

  it('falls back to the requirement’s own two ends while nothing conducts between them', () => {
    const reveal = scannerRevealFor(
      requirementOf(P1_PUZZLE.requirements, 'p1/drive-through-gear'),
      p1Content(),
      p1Graph()
    );
    // No chain exists yet: the read is the missing link itself, never an invented path.
    expect(reveal.route).toEqual(['component:shaft-a', 'component:shaft-b']);
  });

  it('shows the derived conducting chain once the carrier is actually mounted', () => {
    const content = p1Content();
    const graph = p1Graph();
    graph.attach('gear-a', 'socket-mesh');
    graph.recomputeIfDirty();

    const reveal = scannerRevealFor(
      requirementOf(P1_PUZZLE.requirements, 'p1/drive-through-gear'),
      content,
      graph
    );

    // The route is *read* from the graph's derived topology, so it is now the real chain
    // (shaft → socket → gear → socket → shaft) rather than the two endpoints.
    expect(reveal.route.length).toBeGreaterThanOrEqual(3);
    expect(reveal.route[0]).toBe('component:shaft-a');
    expect(reveal.route.at(-1)).toBe('component:shaft-b');
    expect(reveal.route).toContain('component:gear-a');
  });

  it('is a pure read: the graph and its derived state are untouched', () => {
    const content = p1Content();
    const graph = p1Graph();
    const before = {
      attachments: graph.attachmentCount,
      edges: graph.derived.edges.length,
      nodes: graph.derived.nodeIds.length,
      machines: graph.machineState('P1-mesh')?.state
    };

    scannerRevealFor(requirementOf(P1_PUZZLE.requirements, 'p1/drive-through-gear'), content, graph);

    expect({
      attachments: graph.attachmentCount,
      edges: graph.derived.edges.length,
      nodes: graph.derived.nodeIds.length,
      machines: graph.machineState('P1-mesh')?.state
    }).toEqual(before);
    expect(graph.isDirty).toBe(false);
  });

  it('turns a componentAt requirement into parts + sockets of the declared kind', () => {
    const reveal = scannerRevealFor(
      {
        id: 'test/at',
        kind: 'componentAt',
        componentTag: 'gear',
        socketKind: 'gear-mount',
        count: 1
      },
      p1Content(),
      p1Graph()
    );

    expect(reveal.targets.map((target) => `${target.kind}:${target.id}`)).toEqual([
      'component:gear-a',
      'socket:socket-mesh'
    ]);
    expect(reveal.route).toEqual([]);
  });

  it('expands a machine-addressed requirement to that machine’s sockets and mounted parts', () => {
    const content = p1Content();
    const graph = p1Graph();
    const reveal = scannerRevealFor(
      { id: 'test/output', kind: 'output', machineId: 'P1-mesh', output: 'rotation', min: 1 },
      content,
      graph
    );

    // P1's three sockets plus the two shafts mounted in them — and nothing from the lab
    // dock or another machine, even though they share the level's content bundle.
    expect(reveal.targets.map((target) => `${target.kind}:${target.id}`)).toEqual([
      'component:shaft-a',
      'component:shaft-b',
      'socket:socket-mesh',
      'socket:socket-shaft-a',
      'socket:socket-shaft-b'
    ]);
    expect(reveal.targets.every((target) => target.role === 'named')).toBe(true);
  });

  it('descends a sequence without claiming to know which step failed', () => {
    const content = branchContent();
    const graph = branchGraph();
    const targets = targetsOf(content, graph, requirementOf(BM1_PUZZLE.requirements, 'bm1/staged'));

    // Both steps address BM-1, so the union is BM-1's own sockets: the reveal shows the
    // whole staged machine rather than guessing which of the two stages is outstanding.
    expect(targets.length).toBeGreaterThan(0);
    expect(targets.every((entry) => entry.startsWith('socket:'))).toBe(true);

    // The nested ids are addressable in their own right (that is what makes a nested
    // reason code resolvable by the composition).
    const index = indexRequirements(BM1_PUZZLE.requirements);
    expect(index.has('bm1/staged-primed')).toBe(true);
    expect(index.has('bm1/staged-running')).toBe(true);
  });

  it('resolves every shipped requirement, deterministically and without throwing', () => {
    const content = branchContent();
    const graph = branchGraph();
    const index = indexRequirements(
      PUZZLE_DEFINITIONS.flatMap((definition) => [...definition.requirements])
    );

    for (const definition of PUZZLE_DEFINITIONS) {
      for (const requirement of definition.requirements) {
        const first = scannerRevealFor(index.get(requirement.id) ?? requirement, content, graph);
        const second = scannerRevealFor(index.get(requirement.id) ?? requirement, content, graph);
        // Same inputs, same answer — and every kind of requirement in the shipped set
        // has something to point at (a reveal that highlights nothing is a dead feature).
        expect(second).toEqual(first);
        expect(first.requirementId).toBe(requirement.id);
        expect(first.targets.length).toBeGreaterThan(0);
      }
    }
  });

  it('names an entity the level never placed, and leaves it to the composition to skip', () => {
    const reveal = scannerRevealFor(
      {
        id: 'test/ghost',
        kind: 'connected',
        from: { kind: 'component', id: 'ghost-part' },
        to: { kind: 'socket', id: 'ghost-socket' }
      },
      branchContent(),
      branchGraph()
    );

    // The derivation reports ids; it has no opinion about where they are (§12.2). An id
    // with no placement is the composition's to skip, never an exception here.
    expect(reveal.targets.map((target) => `${target.kind}:${target.id}`)).toEqual([
      'component:ghost-part',
      'socket:ghost-socket'
    ]);
    expect(reveal.route).toEqual(['component:ghost-part', 'socket:ghost-socket']);
  });
});
