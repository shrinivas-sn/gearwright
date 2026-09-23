/**
 * L1 — the scanner's reveal derivation (ARCH §29.3, §40 `game-state/`).
 *
 * §29.3 describes the scanner as a *context*, not an SM state, with one job:
 *
 *   → consumes: LTG, failed reason codes, socket definitions
 *   → presents: highlight rig (L4), flow-path overlay, labels from data
 *   → reads reason codes from Validator; **it never re-computes rules itself**
 *
 * This module is that consumption, and nothing else. It is pure and stateless —
 * there is no `ScannerSystem`, because the scanner owns no canonical state: the
 * player's *use* of it is a presentation mode (duration + cooldown, L4), and the
 * *targets* are a function of authored data plus the already-derived topology.
 *
 * The "never re-computes rules" rule is enforced structurally, not by convention:
 *
 *   1. **It never asks whether a requirement is satisfied.** There is no call into
 *      the validator, no reachability test made for the purpose of passing or
 *      failing, and no mutation. The caller hands it a requirement id the validator
 *      *already* reported as failed (`PuzzleSystem.reasonCodes`).
 *   2. **It collects, it does not decide.** Every target is something the
 *      requirement *names* (`named`) or something its declared capabilities point
 *      at (`candidate`): a component carrying the requirement's tag, a socket whose
 *      definition `accepts` that tag, a socket of the required `socketKind`, or —
 *      for a machine-addressed requirement — that machine's own sockets and the
 *      parts mounted in them.
 *   3. **The route is presentation of derived state.** `connected` yields the
 *      conducting chain between its two named endpoints *when the derived topology
 *      already contains one*; when it does not, it yields the two endpoints, so the
 *      player sees exactly where the link is missing. Either way the path is read
 *      from `MachineGraph.derived` — no second opinion about connectivity is
 *      computed here.
 *
 * Nested requirements (`sequence`, `not`, `any`) are descended rather than
 * evaluated: the union of everything the step set names is the honest answer when
 * the validator reported the *top-level* id, and it never claims to know which child
 * failed. `indexRequirements` walks the same trees, so a nested id in `reasonCodes`
 * resolves to its requirement.
 *
 * Output is deterministic (§23.2): targets are deduped and sorted by kind then id,
 * roles resolve with `named` winning, and the route walk visits sorted adjacency.
 * Two runs on the same graph produce byte-identical reveals.
 */


import type { MachineContent } from './component-registry.ts';
import { nodeIdOf, type MachineGraph, type TopologyEdge } from './machine-graph.ts';
import type { ComponentTag, NodeRef, SocketKind } from './component-model.ts';
import type { Requirement } from './validator.ts';

/**
 * What a highlighted entity *is* to the failed requirement.
 *
 * `named` — the requirement names it (an endpoint of a connection, or anything
 * inside a machine the requirement addresses). `candidate` — the requirement's
 * declared capabilities point at it: a part that carries the required tag, or a
 * socket that would accept such a part.
 */
export type ScannerTargetRole = 'named' | 'candidate';

/** Entity namespace, mirroring `NodeRef` so a resolved node id is reportable. */
export type ScannerTargetKind = 'component' | 'socket';

export interface ScannerTarget {
  readonly kind: ScannerTargetKind;
  readonly id: string;
  readonly role: ScannerTargetRole;
}

/**
 * Everything the scanner presents for one failed requirement. Ids only: positions are
 * level data and live in the composition, which is the only layer that knows both the
 * level and the graph (§12.2 "placement is not here").
 */
export interface ScannerReveal {
  readonly requirementId: string;
  /** Deduped, sorted by kind then id. */
  readonly targets: ReadonlyArray<ScannerTarget>;
  /**
   * Node ids of the requirement's route, in draw order (`[]` when the requirement
   * names no route, or when that route is a single node — not a path).
   */
  readonly route: ReadonlyArray<string>;
}

/**
 * Requirement id → requirement, for every requirement in the supplied trees (nested
 * ones included). The composition builds this once from `PUZZLE_DEFINITIONS`; the
 * scanner resolves `PuzzleSystem.reasonCodes` through it. The first authored id wins,
 * so the mapping is stable no matter how many places re-use an id.
 */
export function indexRequirements(
  requirements: ReadonlyArray<Requirement>
): ReadonlyMap<string, Requirement> {
  const index = new Map<string, Requirement>();
  const visit = (requirement: Requirement): void => {
    if (!index.has(requirement.id)) index.set(requirement.id, requirement);
    if (requirement.kind === 'not') visit(requirement.requirement);
    if (requirement.kind === 'any') requirement.requirements.forEach(visit);
    if (requirement.kind === 'sequence') {
      requirement.steps.forEach((step) => step.forEach(visit));
    }
  };
  requirements.forEach(visit);
  return index;
}

/** The route a `connected` requirement describes, as drawable node ids. */
function routeFor(requirement: Requirement, graph: MachineGraph): ReadonlyArray<string> {
  if (requirement.kind !== 'connected') return [];
  const from = nodeIdOf(requirement.from);
  const to = nodeIdOf(requirement.to);
  if (from === to) return [from];
  const chain = conductingChain(graph.derived.edges, from, to);
  // No conducting chain yet: the requirement's own two ends *are* the read — this is
  // the link that has to be closed. Never invent waypoints that do not conduct.
  return chain ?? [from, to];
}

/**
 * Shortest conducting chain `from → to` over the derived edges, or null.
 *
 * Deterministic: adjacency is built from edges sorted by (from, to) and the queue is
 * walked in that order, so the first chain found is a function of node ids only.
 * `from === to` is the caller's case — a one-node route is not a path.
 */
function conductingChain(
  edges: ReadonlyArray<TopologyEdge>,
  from: string,
  to: string
): ReadonlyArray<string> | null {
  const adjacency = new Map<string, string[]>();
  const conducting = edges
    .filter((edge) => edge.conducts)
    .sort((a, b) =>
      a.from < b.from ? -1 : a.from > b.from ? 1 : a.to < b.to ? -1 : a.to > b.to ? 1 : 0
    );
  for (const edge of conducting) {
    const next = adjacency.get(edge.from);
    if (next === undefined) adjacency.set(edge.from, [edge.to]);
    else next.push(edge.to);
  }

  const previous = new Map<string, string>();
  const seen = new Set<string>([from]);
  const queue = [from];
  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    for (const next of adjacency.get(nodeId) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      previous.set(next, nodeId);
      if (next === to) return rebuildRoute(previous, from, to);
      queue.push(next);
    }
  }
  return null;
}

/** Walk the predecessor map back from `to`; a broken map degrades to the two ends. */
function rebuildRoute(
  previous: ReadonlyMap<string, string>,
  from: string,
  to: string
): ReadonlyArray<string> {
  const chain = [to];
  let nodeId = to;
  while (nodeId !== from) {
    const step = previous.get(nodeId);
    if (step === undefined) return [from, to];
    chain.unshift(step);
    nodeId = step;
  }
  return chain;
}

/** One collectable target before dedupe/sort. */
interface Draft {
  readonly kind: ScannerTargetKind;
  readonly id: string;
  readonly role: ScannerTargetRole;
}

/**
 * Collects the targets of one requirement tree. Roles resolve with `named` winning: an
 * entity the requirement names is never demoted to a candidate by a later branch.
 */
function collect(
  requirement: Requirement,
  content: MachineContent,
  graph: MachineGraph,
  named: Map<string, Draft>,
  candidates: Map<string, Draft>,
  routes: string[][]
): void {
  switch (requirement.kind) {
    case 'connected': {
      addNamed(named, candidates, requirement.from);
      addNamed(named, candidates, requirement.to);
      // The carrier: parts that carry the tag, and the sockets that would accept one.
      if (requirement.through !== undefined) {
        for (const instance of content.registry.byTag(requirement.through)) {
          add(candidates, { kind: 'component', id: instance.id, role: 'candidate' });
        }
        for (const socket of content.sockets) {
          if (!socketAccepts(content, socket.id, requirement.through)) continue;
          add(candidates, { kind: 'socket', id: socket.id, role: 'candidate' });
        }
      }
      routes.push([...routeFor(requirement, graph)]);
      return;
    }

    case 'componentAt': {
      for (const instance of content.registry.byTag(requirement.componentTag)) {
        add(candidates, { kind: 'component', id: instance.id, role: 'candidate' });
      }
      for (const socket of content.sockets) {
        if (!socketHasKind(content, socket.id, requirement.socketKind)) continue;
        add(candidates, { kind: 'socket', id: socket.id, role: 'candidate' });
      }
      return;
    }

    case 'output':
    case 'state':
    case 'safety': {
      // The requirement addresses a machine: its sockets and whatever is mounted in
      // them are what the machine *is*, which is what a reveal can point at.
      for (const socket of content.sockets) {
        if (!socketBelongsTo(content, socket.id, requirement.machineId)) continue;
        addNamed(named, candidates, { kind: 'socket', id: socket.id });
        const occupant = graph.occupantOf(socket.id);
        if (occupant !== null) addNamed(named, candidates, { kind: 'component', id: occupant });
      }
      return;
    }

    case 'sequence': {
      requirement.steps.forEach((step) =>
        step.forEach((child) => collect(child, content, graph, named, candidates, routes))
      );
      return;
    }

    case 'not': {
      collect(requirement.requirement, content, graph, named, candidates, routes);
      return;
    }

    case 'any': {
      requirement.requirements.forEach((child) =>
        collect(child, content, graph, named, candidates, routes)
      );
      return;
    }
  }
}

/** A named entity: promoted out of `candidates` if a weaker branch collected it first. */
function addNamed(named: Map<string, Draft>, candidates: Map<string, Draft>, ref: NodeRef): void {
  candidates.delete(`${ref.kind}:${ref.id}`);
  add(named, { kind: ref.kind, id: ref.id, role: 'named' });
}

function add(map: Map<string, Draft>, draft: Draft): void {
  const key = `${draft.kind}:${draft.id}`;
  if (map.has(key)) return; // already collected, at this or a stronger role
  map.set(key, draft);
}

function socketDefinitionOf(content: MachineContent, socketId: string) {
  const instance = content.sockets.find((socket) => socket.id === socketId);
  if (instance === undefined) return null;
  return content.socketDefinitions.find((definition) => definition.id === instance.defId) ?? null;
}

function socketHasKind(content: MachineContent, socketId: string, kind: SocketKind): boolean {
  return socketDefinitionOf(content, socketId)?.socketKind === kind;
}

function socketAccepts(content: MachineContent, socketId: string, tag: ComponentTag): boolean {
  return socketDefinitionOf(content, socketId)?.accepts.includes(tag) === true;
}

function socketBelongsTo(content: MachineContent, socketId: string, machineId: string): boolean {
  return socketDefinitionOf(content, socketId)?.machineId === machineId;
}

/** Sort key: kind, then id — a function of the data, never of insertion order. */
function compareTargets(a: Draft, b: Draft): number {
  if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * The reveal for one failed requirement (§29.3). Pure: the same inputs produce the same
 * output, `graph` and `content` are only read, and no requirement is evaluated.
 */
export function scannerRevealFor(
  requirement: Requirement,
  content: MachineContent,
  graph: MachineGraph
): ScannerReveal {
  const named = new Map<string, Draft>();
  const candidates = new Map<string, Draft>();
  const routes: string[][] = [];
  collect(requirement, content, graph, named, candidates, routes);

  const targets: Draft[] = [...named.values(), ...candidates.values()].sort(compareTargets);
  const route = routes.find((candidate) => candidate.length > 1) ?? [];

  return { requirementId: requirement.id, targets, route };
}
