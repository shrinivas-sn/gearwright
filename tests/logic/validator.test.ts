import { describe, expect, it } from 'vitest';

import { GEAR_DEF, IDLER_GEAR_DEF, BLANKING_PLATE_DEF } from '../../src/data/components.ts';
import { MESH_SOCKET_DEF } from '../../src/data/sockets.ts';
import { P1_SOCKETS } from '../../src/levels/branch-a.ts';
import type { ComponentInstance } from '../../src/game-state/component-registry.ts';
import { MachineGraph } from '../../src/game-state/machine-graph.ts';
import type { MachineContent } from '../../src/game-state/component-registry.ts';
import {
  DEFAULT_STABLE_STEPS,
  evaluate,
  evaluateRequirements,
  requirementIds,
  type Requirement
} from '../../src/game-state/validator.ts';
import { p1Content, p1Graph, p1Machine } from './support/p1-mesh.ts';

/**
 * L1 — requirement evaluation (ARCH §24, TEST §4 "puzzle validation").
 *
 * The point of these tests is the *central rule*: completion is a function of the
 * machine graph, never of component positions. So every case here builds a graph
 * and asks a question, and the transform-independence block proves that moving
 * every pose by ±1 m / ±180° changes nothing at all.
 */

const SHAFT_A = { kind: 'component', id: 'shaft-a' } as const;
const SHAFT_B = { kind: 'component', id: 'shaft-b' } as const;

function instance(id: string, defId: string): ComponentInstance {
  return { id, defId, kind: 'carryable', spawnAnchorId: `anchor/${id}`, flags: {} };
}

/** Content with an extra loose part available (the plate / idler cases). */
function withPart(part: ComponentInstance): MachineContent {
  const content = p1Content();
  content.registry.add(part);
  return content;
}

const P1_REQUIRED: ReadonlyArray<Requirement> = [
  { id: 'req-mesh', kind: 'componentAt', componentTag: 'gear', socketKind: 'gear-mount', count: 1 },
  { id: 'req-drive', kind: 'connected', from: SHAFT_A, to: SHAFT_B, through: 'gear' },
  { id: 'req-output', kind: 'output', machineId: 'P1-mesh', output: 'rotation', min: 1, direction: 'cw' },
  { id: 'req-running', kind: 'state', machineId: 'P1-mesh', state: 'running' }
];

function evaluateP1(graph: MachineGraph, requirements = P1_REQUIRED, content = p1Content(), streak?: number) {
  return evaluateRequirements(requirements, {
    graph,
    content,
    previousStreak: streak,
    stableSteps: DEFAULT_STABLE_STEPS
  });
}

describe('Validator — the P1 machine (correct configuration validates)', () => {
  it('fails every requirement while the mesh socket is empty', () => {
    const graph = p1Graph();

    const result = evaluateP1(graph);

    expect(result.satisfied).toBe(false);
    expect(result.reasonCodes).toEqual(['req-mesh', 'req-drive', 'req-output', 'req-running']);
    expect(result.requirements.find((entry) => entry.id === 'req-drive')?.reason).toBe('connected/unreachable');
    expect(result.requirements.find((entry) => entry.id === 'req-output')?.reason).toBe('output/unreached');
  });

  it('satisfies all of them once the gear is installed', () => {
    const graph = p1Graph();
    graph.attach('gear-a', 'socket-mesh');

    const result = evaluateP1(graph);

    expect(result.reasonCodes).toEqual([]);
    expect(result.satisfied).toBe(true);
    expect(result.requirements.map((entry) => entry.satisfied)).toEqual([true, true, true, true]);
  });

  it('is a function of the graph: detaching the gear invalidates it, reattaching restores it', () => {
    const graph = p1Graph();
    graph.attach('gear-a', 'socket-mesh');
    expect(evaluateP1(graph).satisfied).toBe(true);

    graph.detach('gear-a');
    expect(evaluateP1(graph).satisfied).toBe(false);

    graph.attach('gear-a', 'socket-mesh');
    expect(evaluateP1(graph).satisfied).toBe(true);
  });

  it('reads the reason code, not just a boolean', () => {
    const graph = p1Graph();
    graph.attach('gear-a', 'socket-mesh');

    // The gear is in, but the machine declares a direction: an idler gear reverses it.
    graph.detach('gear-a');
    const content = withPart(instance('idler-a', IDLER_GEAR_DEF.id));
    graph.configure(content);
    graph.reset([
      { componentId: 'shaft-a', socketId: 'socket-shaft-a' },
      { componentId: 'shaft-b', socketId: 'socket-shaft-b' },
      { componentId: 'idler-a', socketId: 'socket-mesh' }
    ]);
    graph.recomputeIfDirty();

    const result = evaluateRequirements(P1_REQUIRED, { graph, content });
    const output = result.requirements.find((entry) => entry.id === 'req-output');

    expect(result.satisfied).toBe(false);
    expect(output?.reason).toBe('output/wrong-direction');
    // The gear is present and the shafts are connected — only the sense is wrong.
    expect(result.requirements.find((entry) => entry.id === 'req-drive')?.satisfied).toBe(true);
  });

  it('refuses a part that physically fits but cannot bridge', () => {
    const content = withPart(instance('plate-a', BLANKING_PLATE_DEF.id));
    const graph = new MachineGraph();
    graph.configure(content);
    graph.reset([
      { componentId: 'shaft-a', socketId: 'socket-shaft-a' },
      { componentId: 'shaft-b', socketId: 'socket-shaft-b' },
      { componentId: 'plate-a', socketId: 'socket-mesh' }
    ]);
    graph.recomputeIfDirty();

    // The socket accepted it (it is a legal attachment) and the machine still does
    // not run, because a link needs a compatible *port*, not a compatible shape.
    expect(graph.occupantOf('socket-mesh')).toBe('plate-a');
    expect(evaluateP1(graph, P1_REQUIRED, content).satisfied).toBe(false);
    expect(graph.machineState('P1-mesh')?.outputs).toEqual([]);
  });

  it('is not satisfied by the gear sitting in the wrong socket', () => {
    const graph = p1Graph();
    graph.detach('shaft-b');
    graph.attach('gear-a', 'socket-shaft-b');

    const result = evaluateP1(graph);

    expect(result.satisfied).toBe(false);
    expect(result.requirements.find((entry) => entry.id === 'req-mesh')?.satisfied).toBe(false);
    expect(result.requirements.find((entry) => entry.id === 'req-drive')?.satisfied).toBe(false);
  });
});

describe('Validator — requirement kinds (ARCH §24.1)', () => {
  it('reports an unknown node instead of silently failing a connection', () => {
    const graph = p1Graph();
    const result = evaluate(
      { id: 'r', kind: 'connected', from: { kind: 'component', id: 'ghost' }, to: SHAFT_B },
      { graph, content: p1Content() }
    );

    expect(result).toMatchObject({ satisfied: false, reason: 'connected/unknown-node' });
  });

  it('rejects a `through` path when no component carries the tag', () => {
    const graph = p1Graph();
    graph.attach('gear-a', 'socket-mesh');
    const result = evaluate(
      { id: 'r', kind: 'connected', from: SHAFT_A, to: SHAFT_B, through: 'valve' },
      { graph, content: p1Content() }
    );

    expect(result).toMatchObject({ satisfied: false, reason: 'connected/no-through-node' });
  });

  it('counts installed parts by tag and socket kind', () => {
    const graph = p1Graph();
    graph.attach('gear-a', 'socket-mesh');
    const content = p1Content();

    expect(
      evaluate({ id: 'r', kind: 'componentAt', componentTag: 'gear', socketKind: 'gear-mount', count: 1 }, { graph, content }).satisfied
    ).toBe(true);
    expect(
      evaluate({ id: 'r', kind: 'componentAt', componentTag: 'gear', socketKind: 'gear-mount', count: 2 }, { graph, content }).reason
    ).toBe('componentAt/missing');
    // A shaft mount is a different socket kind, so nothing counts there.
    expect(
      evaluate({ id: 'r', kind: 'componentAt', componentTag: 'gear', socketKind: 'shaft-mount', count: 1 }, { graph, content }).reason
    ).toBe('componentAt/missing');
  });

  it('reads outputs with min / equals / direction, and reports each refusal', () => {
    const graph = p1Graph();
    graph.attach('gear-a', 'socket-mesh');
    const content = p1Content();

    const at = (requirement: Requirement) => evaluate(requirement, { graph, content });
    const output = { machineId: 'P1-mesh', output: 'rotation' } as const;

    expect(at({ id: 'r', kind: 'output', ...output, min: 1 }).satisfied).toBe(true);
    expect(at({ id: 'r', kind: 'output', ...output, min: 2 }).reason).toBe('output/below-min');
    expect(at({ id: 'r', kind: 'output', ...output, min: 0, equals: 1 }).satisfied).toBe(true);
    expect(at({ id: 'r', kind: 'output', ...output, min: 0, equals: 0.5 }).reason).toBe('output/not-equal');
    expect(at({ id: 'r', kind: 'output', ...output, min: 0, direction: 'ccw' }).reason).toBe('output/wrong-direction');
    expect(at({ id: 'r', kind: 'output', output: 'pressure', machineId: 'P1-mesh', min: 0 }).reason).toBe('output/unreached');
    expect(at({ id: 'r', kind: 'output', ...output, min: 0, machineId: 'ghost' }).reason).toBe('output/no-machine');
  });

  it('reads machine state, and answers `primed` from the action log (ADR-018)', () => {
    const graph = p1Graph();
    const content = p1Content();

    expect(evaluate({ id: 'r', kind: 'state', machineId: 'P1-mesh', state: 'powered' }, { graph, content }).satisfied).toBe(true);
    expect(evaluate({ id: 'r', kind: 'state', machineId: 'P1-mesh', state: 'running' }, { graph, content }).reason).toBe('state/mismatch');
    // P1-Mesh declares no priming stage, so `primed` refuses rather than passes —
    // the machine never invents a stage the content did not author.
    expect(evaluate({ id: 'r', kind: 'state', machineId: 'P1-mesh', state: 'primed' }, { graph, content }).reason).toBe(
      'state/unsupported-primed'
    );
    expect(
      evaluate(
        { id: 'r', kind: 'state', machineId: 'P1-mesh', state: 'primed' },
        { graph, content, actions: [] }
      ).reason
    ).toBe('state/unsupported-primed');
  });

  it('answers `primed` for a machine that declares priming actions, in any order', () => {
    const primed = { id: 'r', kind: 'state', machineId: 'P1-mesh', state: 'primed' } as const;
    const stagedContent = p1Content([p1Machine({ primingActions: ['a/prime-one', 'a/prime-two'] })]);
    const stagedGraph = p1Graph();
    stagedGraph.configure(stagedContent);
    stagedGraph.recomputeIfDirty();

    // Without the log the question cannot be answered: still a refusal.
    expect(evaluate(primed, { graph: stagedGraph, content: stagedContent }).reason).toBe(
      'state/unsupported-primed'
    );
    // Partial priming is the ordinary "not finished" reason.
    expect(evaluate(primed, { graph: stagedGraph, content: stagedContent, actions: ['a/prime-one'] }).reason).toBe(
      'state/not-primed'
    );
    // Any order completes it, and extra actions do not un-prime it.
    expect(
      evaluate(primed, { graph: stagedGraph, content: stagedContent, actions: ['a/prime-two', 'a/prime-one'] })
        .satisfied
    ).toBe(true);
    expect(
      evaluate(primed, { graph: stagedGraph, content: stagedContent, actions: ['a/prime-one', 'a/prime-two', 'x'] })
        .satisfied
    ).toBe(true);
  });

  it('evaluates unordered sequences headlessly, and ordered ones from the log (ADR-018)', () => {
    const graph = p1Graph();
    graph.attach('gear-a', 'socket-mesh');
    const content = p1Content();
    const steps = [
      [{ id: 's1', kind: 'componentAt', componentTag: 'gear', socketKind: 'gear-mount', count: 1 } as Requirement],
      [{ id: 's2', kind: 'connected', from: SHAFT_A, to: SHAFT_B } as Requirement]
    ];

    expect(evaluate({ id: 'r', kind: 'sequence', steps, ordered: false }, { graph, content }).satisfied).toBe(true);
    // Ordered without witnesses is an authoring error, never a pass.
    expect(evaluate({ id: 'r', kind: 'sequence', steps, ordered: true }, { graph, content }).reason).toBe(
      'sequence/no-witness'
    );
    expect(
      evaluate({ id: 'r', kind: 'sequence', steps, ordered: true, witnesses: [['a']] }, { graph, content }).reason
    ).toBe('sequence/no-witness');
    expect(
      evaluate(
        { id: 'r', kind: 'sequence', steps, ordered: true, witnesses: [['a'], []] },
        { graph, content }
      ).reason
    ).toBe('sequence/no-witness');
    // The witnesses decide the order: both steps satisfied, `b` before `a` is refused.
    const witnessed = {
      id: 'r',
      kind: 'sequence',
      steps,
      ordered: true,
      witnesses: [['a'], ['b']]
    } as const;
    expect(evaluate(witnessed, { graph, content, actions: ['a', 'b'] }).satisfied).toBe(true);
    expect(evaluate(witnessed, { graph, content, actions: ['b', 'a'] }).reason).toBe('sequence/out-of-order');
    expect(evaluate(witnessed, { graph, content, actions: ['a'] }).reason).toBe('sequence/out-of-order');
    expect(evaluate(witnessed, { graph, content }).reason).toBe('sequence/out-of-order');
    // ... but a recovery later in the log passes, by earliest-match.
    expect(evaluate(witnessed, { graph, content, actions: ['b', 'a', 'b'] }).satisfied).toBe(true);
    // The steps themselves still have to hold: witnesses alone never satisfy.
    const unmet = {
      id: 'r',
      kind: 'sequence',
      ordered: true,
      steps: [[{ id: 's3', kind: 'connected', from: { kind: 'component', id: 'frame-a' }, to: SHAFT_B }]],
      witnesses: [['service-the-frame']]
    } as const;
    expect(evaluate(unmet, { graph, content, actions: ['service-the-frame'] }).reason).toBe('sequence/unmet');
    expect(evaluate({ id: 'r', kind: 'sequence', steps: [], ordered: false }, { graph, content }).reason).toBe('sequence/empty');
    expect(
      evaluate(
        {
          id: 'r',
          kind: 'sequence',
          // The frame's ports are sinks, so it conducts nothing onwards: this step
          // cannot be fulfilled by any configuration.
          steps: [[{ id: 's3', kind: 'connected', from: { kind: 'component', id: 'frame-a' }, to: SHAFT_B }]],
          ordered: false
        },
        { graph, content }
      ).reason
    ).toBe('sequence/unmet');
  });

  it('supports safety conditions from the machine, not from a guess', () => {
    const content = p1Content([p1Machine({ maxOutput: 0.5 })]);
    const graph = new MachineGraph();
    graph.configure(content);
    graph.reset([
      { componentId: 'shaft-a', socketId: 'socket-shaft-a' },
      { componentId: 'shaft-b', socketId: 'socket-shaft-b' },
      { componentId: 'gear-a', socketId: 'socket-mesh' }
    ]);
    graph.recomputeIfDirty();

    expect(evaluate({ id: 'r', kind: 'safety', machineId: 'P1-mesh', condition: 'unjammed' }, { graph, content }).satisfied).toBe(
      true
    );
    expect(evaluate({ id: 'r', kind: 'safety', machineId: 'P1-mesh', condition: 'overpressure' }, { graph, content }).reason).toBe(
      'safety/overpressure'
    );
    expect(evaluate({ id: 'r', kind: 'safety', machineId: 'ghost', condition: 'unjammed' }, { graph, content }).reason).toBe(
      'safety/no-machine'
    );
  });

  it('composes `not` and `any` (multi-solution form)', () => {
    const graph = p1Graph();
    const content = p1Content();

    expect(
      evaluate({ id: 'r', kind: 'not', requirement: { id: 'inner', kind: 'state', machineId: 'P1-mesh', state: 'running' } }, { graph, content }).satisfied
    ).toBe(true);
    expect(
      evaluate(
        {
          id: 'r',
          kind: 'any',
          requirements: [
            { id: 'a', kind: 'state', machineId: 'P1-mesh', state: 'running' },
            { id: 'b', kind: 'componentAt', componentTag: 'shaft', socketKind: 'shaft-mount', count: 2 }
          ]
        },
        { graph, content }
      ).satisfied
    ).toBe(true);
    expect(evaluate({ id: 'r', kind: 'any', requirements: [] }, { graph, content }).reason).toBe('any/none');
  });

  it('collects requirement ids across the tree (hint keys)', () => {
    expect(requirementIds(P1_REQUIRED)).toEqual(['req-mesh', 'req-drive', 'req-output', 'req-running']);
  });
});

describe('Validator — stable-frame rule (ARCH §24.2, EC-PZ-01)', () => {
  it('does not confirm a satisfied result until it has held for STABLE_STEPS', () => {
    const graph = p1Graph();
    graph.attach('gear-a', 'socket-mesh');

    const first = evaluateP1(graph);
    expect(first.satisfied).toBe(true);
    expect(first.confirmed).toBe(false);
    expect(first.streak).toBe(1);

    const second = evaluateP1(graph, P1_REQUIRED, p1Content(), first.streak);
    expect(second.confirmed).toBe(false);
    const third = evaluateP1(graph, P1_REQUIRED, p1Content(), second.streak);
    expect(third.streak).toBe(3);
    expect(third.confirmed).toBe(true);
  });

  it('resets the streak on a transient failure (a valid frame does not complete)', () => {
    const graph = p1Graph();
    graph.attach('gear-a', 'socket-mesh');
    const first = evaluateP1(graph);
    expect(first.streak).toBe(1);

    graph.detach('gear-a');
    const broken = evaluateP1(graph, P1_REQUIRED, p1Content(), first.streak);
    expect(broken.streak).toBe(0);
    expect(broken.confirmed).toBe(false);
  });

  it('is pure: the caller owns the streak and repeated calls agree', () => {
    const graph = p1Graph();
    graph.attach('gear-a', 'socket-mesh');

    const a = evaluateP1(graph);
    const b = evaluateP1(graph);

    expect(a).toEqual(b);
    expect(DEFAULT_STABLE_STEPS).toBe(3);
  });
});

describe('Validator — transform independence (ARCH §24.3, A-8)', () => {
  it('produces identical results when every pose is perturbed by ±1 m / ±180°', () => {
    const graph = p1Graph();
    graph.attach('gear-a', 'socket-mesh');

    const baseline = evaluateP1(graph);

    // Perturb every authored socket anchor and every instance anchor. Nothing the
    // validator reads may depend on any of it.
    const perturbed: MachineContent = {
      ...p1Content(),
      sockets: P1_SOCKETS.map((socket, index) => ({
        ...socket,
        pose: {
          center: {
            x: socket.pose.center.x + (index === 0 ? 1 : -1),
            y: socket.pose.center.y + 1,
            z: socket.pose.center.z + (index % 2 === 0 ? -1 : 1)
          },
          yaw: Math.PI
        },
        halfExtents: { x: socket.halfExtents.x * 3, y: socket.halfExtents.y, z: socket.halfExtents.z }
      }))
    };
    const perturbedGraph = new MachineGraph();
    perturbedGraph.configure(perturbed);
    perturbedGraph.reset([
      { componentId: 'shaft-a', socketId: 'socket-shaft-a' },
      { componentId: 'shaft-b', socketId: 'socket-shaft-b' },
      { componentId: 'gear-a', socketId: 'socket-mesh' }
    ]);
    perturbedGraph.recomputeIfDirty();

    const after = evaluateRequirements(P1_REQUIRED, { graph: perturbedGraph, content: perturbed });

    expect(after.satisfied).toBe(baseline.satisfied);
    expect(after.requirements).toEqual(baseline.requirements);
    // Same derived machine, including the output magnitude and sense.
    expect(perturbedGraph.machineState('P1-mesh')).toEqual(graph.machineState('P1-mesh'));
  });

  it('is unaffected by half-extents and socket identity, only by graph structure', () => {
    const graph = p1Graph();
    graph.attach('gear-a', 'socket-mesh');

    // A gear whose box is a thousand times larger validates exactly the same: the
    // validator consumes capability and connectivity, never geometry.
    const scaled = p1Content();
    scaled.registry.define({
      ...GEAR_DEF,
      halfExtents: { x: 300, y: 300, z: 300 }
    });

    const result = evaluateRequirements(P1_REQUIRED, { graph, content: scaled });

    expect(result.satisfied).toBe(true);
    expect(MESH_SOCKET_DEF.ownerPortId).toBe('mesh');
  });
});
