import { describe, expect, it } from 'vitest';

import { CRATE_DEF, SHAFT_DEF } from '../../src/data/components.ts';
import { MACHINE_DEFINITIONS } from '../../src/data/machines.ts';
import { SOCKET_DEFINITIONS } from '../../src/data/sockets.ts';
import { ComponentRegistry, type MachineContent } from '../../src/game-state/component-registry.ts';
import { MachineGraph } from '../../src/game-state/machine-graph.ts';
import { LAB_SOCKETS } from '../../src/levels/lab-world.ts';
import { P1_MESH_MACHINE } from '../../src/data/machines.ts';
import { MESH_SOCKET_DEF } from '../../src/data/sockets.ts';
import { p1Content, p1Graph, p1Machine } from './support/p1-mesh.ts';

/**
 * L1 — attachment edges and derived occupancy (ARCH §21.3, §23.1).
 *
 * The graph is the canonical record of "this part is in this socket", so these
 * tests are about atomicity and derivation: a rejected call must leave the graph
 * byte-identical, and occupancy must never be stored separately from the edges.
 */

describe('MachineGraph — attach', () => {
  it('creates exactly one edge and derives occupancy from it', () => {
    const graph = new MachineGraph();

    expect(graph.attach('crate-a', 'socket-a')).toBe('Ok');

    expect(graph.attachmentCount).toBe(1);
    expect(graph.occupantOf('socket-a')).toBe('crate-a');
    expect(graph.attachmentOf('crate-a')).toBe('socket-a');
    expect(graph.isSocketFree('socket-a')).toBe(false);
    expect(graph.attachments).toEqual([{ componentId: 'crate-a', socketId: 'socket-a' }]);
  });

  it('rejects a second component on an occupied socket, leaving the graph untouched (EC-SNAP-06)', () => {
    const graph = new MachineGraph();
    graph.attach('crate-a', 'socket-a');
    graph.recomputeIfDirty();

    expect(graph.attach('crate-b', 'socket-a')).toBe('Occupied');

    expect(graph.occupantOf('socket-a')).toBe('crate-a');
    expect(graph.attachmentOf('crate-b')).toBeNull();
    expect(graph.attachmentCount).toBe(1);
    // A rejected change is not a change: nothing to recompute.
    expect(graph.isDirty).toBe(false);
  });

  it('rejects a second attachment for the same component (no duplicate edge)', () => {
    const graph = new MachineGraph();
    graph.attach('crate-a', 'socket-a');

    expect(graph.attach('crate-a', 'socket-b')).toBe('AlreadyAttached');
    expect(graph.attachments).toEqual([{ componentId: 'crate-a', socketId: 'socket-a' }]);
    expect(graph.isSocketFree('socket-b')).toBe(true);
  });
});

describe('MachineGraph — detach', () => {
  it('removes the edge and frees the socket', () => {
    const graph = new MachineGraph();
    graph.attach('crate-a', 'socket-a');

    expect(graph.detach('crate-a')).toBe(true);

    expect(graph.attachmentCount).toBe(0);
    expect(graph.occupantOf('socket-a')).toBeNull();
    expect(graph.isSocketFree('socket-a')).toBe(true);
  });

  it('reports false when there was nothing to remove', () => {
    const graph = new MachineGraph();
    expect(graph.detach('crate-a')).toBe(false);
    expect(graph.isDirty).toBe(false);
  });

  it('survives an attach → detach → attach burst with exactly one edge (EC-SNAP-07)', () => {
    const graph = new MachineGraph();
    expect(graph.attach('crate-a', 'socket-a')).toBe('Ok');
    expect(graph.detach('crate-a')).toBe(true);
    expect(graph.attach('crate-a', 'socket-a')).toBe('Ok');

    expect(graph.attachmentCount).toBe(1);
    expect(graph.attachments).toEqual([{ componentId: 'crate-a', socketId: 'socket-a' }]);
  });
});

describe('MachineGraph — structural change signal', () => {
  it('reports each structural change exactly once, then stays clean', () => {
    const graph = new MachineGraph();

    graph.attach('crate-a', 'socket-a');
    const attached = graph.recomputeIfDirty();
    expect(attached).toMatchObject({ reason: 'attach', componentId: 'crate-a', socketId: 'socket-a' });
    expect(graph.isDirty).toBe(false);
    expect(graph.recomputeIfDirty()).toBeNull();

    graph.detach('crate-a');
    expect(graph.recomputeIfDirty()).toMatchObject({ reason: 'detach' });
    expect(graph.recomputeIfDirty()).toBeNull();
  });

  it('rebuilds from a canonical edge list and marks the rebuild dirty', () => {
    const graph = new MachineGraph();
    graph.reset([
      { componentId: 'b-part', socketId: 'socket-b' },
      { componentId: 'a-part', socketId: 'socket-a' }
    ]);

    // Sorted by component id: deterministic iteration order (ARCH §23.2).
    expect(graph.attachments).toEqual([
      { componentId: 'a-part', socketId: 'socket-a' },
      { componentId: 'b-part', socketId: 'socket-b' }
    ]);
    expect(graph.recomputeIfDirty()).toMatchObject({ reason: 'reset', attachments: 2 });
  });

  it('produces identical results for identical command scripts', () => {
    const run = (): unknown => {
      const graph = new MachineGraph();
      graph.attach('crate-a', 'socket-a');
      graph.attach('crate-a', 'socket-b');
      graph.detach('crate-a');
      graph.attach('crate-a', 'socket-b');
      return { edges: graph.attachments, change: graph.recomputeIfDirty() };
    };

    expect(run()).toEqual(run());
  });
});

describe('MachineGraph — derived topology (ARCH §23.1)', () => {
  it('derives attachment, transmission and flow edges from the canonical edges', () => {
    const graph = p1Graph();
    graph.attach('gear-a', 'socket-mesh');

    const topology = graph.derived;
    const kinds = new Set(topology.edges.map((edge) => edge.kind));
    expect(kinds).toEqual(new Set(['attachment', 'transmission', 'flow']));

    // The mesh link is the only thing that connects the two shafts, and it does so
    // through the gear component — not through the frame they share.
    const link = topology.edges.filter((edge) => edge.linkId === 'link-mesh');
    expect(link.map((edge) => [edge.from, edge.to])).toEqual([
      ['component:shaft-a', 'component:gear-a'],
      ['component:gear-a', 'component:shaft-b']
    ]);
    expect(link.every((edge) => edge.carrier === 'rotation' && edge.conducts)).toBe(true);

    // Sorted by id: iteration order is a function of ids alone (ARCH §23.2).
    const ids = topology.edges.map((edge) => edge.id);
    expect(ids).toEqual([...ids].sort());
    expect(topology.nodeIds).toEqual([...topology.nodeIds].sort());
  });

  it('enforces port direction on both sides of an attachment', () => {
    const attachmentEdges = (portDirection: 'in' | 'out' | 'bidir'): string[] => {
      const content = p1Content();
      const graph = new MachineGraph();
      graph.configure({
        ...content,
        socketDefinitions: content.socketDefinitions.map((definition) =>
          definition.id === MESH_SOCKET_DEF.id ? { ...definition, portDirection } : definition
        )
      });
      graph.reset([{ componentId: 'gear-a', socketId: 'socket-mesh' }]);
      return graph.derived.edges
        .filter((edge) => edge.id.startsWith('attachment:socket-mesh:gear-a'))
        .map((edge) => `${edge.from}->${edge.to}`)
        .sort();
    };

    // The socket decides which way the carrier may cross it, the part decides what
    // it can send/receive: only the directions both sides allow exist.
    expect(attachmentEdges('in')).toEqual(['component:gear-a->socket:socket-mesh']);
    expect(attachmentEdges('out')).toEqual(['socket:socket-mesh->component:gear-a']);
    expect(attachmentEdges('bidir')).toEqual([
      'component:gear-a->socket:socket-mesh',
      'socket:socket-mesh->component:gear-a'
    ]);
  });

  it('keeps the frame a dead end: sharing a structure is not a connection', () => {
    const graph = p1Graph();
    graph.attach('gear-a', 'socket-mesh');

    // The frame accepts a carrier from each mount (its ports are sinks), so it must
    // never conduct shaft-a's rotation on to shaft-b by itself.
    const fromFrame = graph.derived.edges.filter((edge) => edge.from === 'component:frame-a');

    expect(fromFrame).toEqual([]);
    expect(graph.nodeStateOf('component:frame-a')).toMatchObject({ phase: 'powered', value: 1 });
  });
});

describe('MachineGraph — propagation (ARCH §23.2, TEST §4 LMG)', () => {
  it('reaches the output only through a valid path', () => {
    const graph = p1Graph();

    // Empty mesh socket: the source is live, but nothing conducts to the output.
    expect(graph.machineState('P1-mesh')).toMatchObject({ state: 'powered', outputs: [] });
    expect(graph.nodeStateOf('component:shaft-b')).toMatchObject({ phase: 'unpowered' });

    graph.attach('gear-a', 'socket-mesh');

    expect(graph.machineState('P1-mesh')).toMatchObject({ state: 'running' });
    expect(graph.outputsOf('P1-mesh')).toEqual([
      { nodeId: 'component:shaft-b', kind: 'rotation', value: 1, spin: 'cw' }
    ]);
  });

  it('leaves a wrongly placed part unpowered (an orphan changes nothing)', () => {
    const graph = p1Graph();
    graph.detach('shaft-b');
    graph.attach('gear-a', 'socket-shaft-b');

    expect(graph.machineState('P1-mesh')?.outputs).toEqual([]);
    // The output is still a root of the machine, so it is reported — as unpowered.
    expect(graph.nodeStateOf('component:shaft-b')).toMatchObject({ phase: 'unpowered', value: 0 });
    // The gear is mounted but nothing drives it: an attachment is not a connection.
    expect(graph.nodeStateOf('component:gear-a')).toMatchObject({ phase: 'unpowered' });
  });

  it('flags a cycle in the chain instead of crashing', () => {
    const returnLink = {
      ...P1_MESH_MACHINE.links[0]!,
      id: 'link-return',
      from: { kind: 'component', id: 'shaft-b' } as const,
      to: { kind: 'component', id: 'shaft-a' } as const
    };
    const machine = p1Machine({ links: [P1_MESH_MACHINE.links[0]!, returnLink] });
    const graph = new MachineGraph();
    graph.configure(p1Content([machine]));
    graph.reset([
      { componentId: 'shaft-a', socketId: 'socket-shaft-a' },
      { componentId: 'shaft-b', socketId: 'socket-shaft-b' },
      { componentId: 'gear-a', socketId: 'socket-mesh' }
    ]);

    const state = graph.machineState('P1-mesh');

    expect(state?.warnings).toContain('cycle');
    expect(state?.outputs).toEqual([
      { nodeId: 'component:shaft-b', kind: 'rotation', value: 1, spin: 'cw' }
    ]);
    expect(state?.state).toBe('running');
  });

  it('restores the derived state when the bridge is reattached', () => {
    const graph = p1Graph();
    graph.attach('gear-a', 'socket-mesh');
    const running = JSON.stringify(graph.machineState('P1-mesh'));

    graph.detach('gear-a');
    expect(graph.machineState('P1-mesh')?.outputs).toEqual([]);

    graph.attach('gear-a', 'socket-mesh');
    expect(JSON.stringify(graph.machineState('P1-mesh'))).toBe(running);
  });

  it('reports only the machines whose derived state actually changed', () => {
    const graph = p1Graph();

    // An explicit invalidation recomputes but changes nothing functional.
    graph.invalidate();
    expect(graph.recomputeIfDirty()?.machines).toEqual([]);

    graph.attach('gear-a', 'socket-mesh');
    const change = graph.recomputeIfDirty();

    expect(change).toMatchObject({ reason: 'attach', componentId: 'gear-a', socketId: 'socket-mesh' });
    expect(change?.machines.map((machine) => machine.machineId)).toEqual(['P1-mesh']);
    expect(change?.machines[0]?.state).toBe('running');
  });

  it('does nothing at all when clean', () => {
    const graph = p1Graph();
    const before = graph.derived;

    expect(graph.isDirty).toBe(false);
    expect(graph.recomputeIfDirty()).toBeNull();
    // Reading is free and never rebuilds: the view is the same object.
    expect(graph.derived).toBe(before);
  });

  it('never exposes a stale machine: a read after a change is already correct', () => {
    const graph = p1Graph();
    expect(graph.machineState('P1-mesh')?.state).toBe('powered');

    graph.attach('gear-a', 'socket-mesh');

    // No recompute call in between — a read must not need one.
    expect(graph.machineState('P1-mesh')?.state).toBe('running');
  });

  it('is deterministic for identical command scripts', () => {
    const run = (): string => {
      const graph = p1Graph();
      graph.attach('gear-a', 'socket-mesh');
      graph.detach('gear-a');
      graph.attach('gear-a', 'socket-mesh');
      return JSON.stringify(graph.derived);
    };

    expect(run()).toBe(run());
  });

  it('treats a socket whose machine has no definition as inert', () => {
    // The M4 lab dock names machine `BM-1`, whose definition arrives with the
    // branch machine: the graph must ignore it, not fail on it.
    const content: MachineContent = {
      registry: new ComponentRegistry(
        [CRATE_DEF],
        [{ id: 'crate-a', defId: CRATE_DEF.id, kind: 'carryable', spawnAnchorId: 'anchor/crate', flags: {} }]
      ),
      sockets: LAB_SOCKETS,
      socketDefinitions: SOCKET_DEFINITIONS,
      machines: MACHINE_DEFINITIONS
    };
    const graph = new MachineGraph();
    graph.configure(content);
    graph.recomputeIfDirty(); // settle: the first recompute announces the initial state
    graph.attach('crate-a', 'socket-a');

    // The attachment exists as a mechanical edge...
    expect(graph.derived.edges.some((edge) => edge.from === 'component:crate-a')).toBe(true);
    // ...but it belongs to no machine, so nothing functional changed and the dock's
    // socket never enters P1's node states.
    expect(graph.recomputeIfDirty()?.machines).toEqual([]);
    const nodeIds = graph.machineState('P1-mesh')?.nodeStates.map((state) => state.nodeId) ?? [];
    expect(nodeIds).not.toContain('socket:socket-a');
    expect(nodeIds).not.toContain('component:crate-a');
  });

  it('stops machine scope at another machine\'s socket (a shared frame leaks nothing)', () => {
    const foreignSocket = {
      id: 'socket-other',
      defId: 'def/other-mount',
      pose: { center: { x: 4, y: 1, z: 0 }, yaw: 0 },
      halfExtents: { x: 0.3, y: 0.3, z: 0.3 }
    };
    const content = p1Content();
    const withForeign: MachineContent = {
      ...content,
      registry: content.registry,
      sockets: [...content.sockets, foreignSocket],
      socketDefinitions: [
        ...content.socketDefinitions,
        {
          id: 'def/other-mount',
          machineId: 'P2-other',
          ownerComponentId: 'frame-a',
          socketKind: 'shaft-mount',
          accepts: ['shaft'],
          portDirection: 'in',
          carrier: 'rotation',
          ownerPortId: 'mount-a',
          snapYaw: 0
        }
      ]
    };
    withForeign.registry.add({
      id: 'part-x',
      defId: SHAFT_DEF.id,
      kind: 'fixed',
      spawnAnchorId: 'anchor/part-x',
      flags: {}
    });

    const graph = new MachineGraph();
    graph.configure(withForeign);
    graph.reset([...[
      { componentId: 'shaft-a', socketId: 'socket-shaft-a' },
      { componentId: 'shaft-b', socketId: 'socket-shaft-b' },
      { componentId: 'part-x', socketId: 'socket-other' }
    ]]);

    const nodeIds = graph.machineState('P1-mesh')?.nodeStates.map((state) => state.nodeId) ?? [];

    expect(nodeIds).not.toContain('socket:socket-other');
    expect(nodeIds).not.toContain('component:part-x');
    expect(nodeIds).toContain('component:frame-a');
  });
});
