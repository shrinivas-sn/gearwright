/**
 * L1 — the machine connectivity model (ARCH §23, §40 `game-state/machine-graph.ts`).
 *
 * Two deliberately different kinds of thing live here:
 *
 *  1. **Attachment edges** (§23.1) — the *canonical* record of "this part is in
 *     this socket". Only `attach`/`detach`/`reset` may change them, and both are
 *     atomic: a rejected call leaves the graph byte-identical.
 *  2. **Derived topology** — flow/transmission edges, per-node states and machine
 *     outputs, recomputed from the attachment edges plus component capability data.
 *     Nothing derived is ever stored next to its source, so nothing can desync.
 *
 * Propagation is deterministic by construction (ARCH §23.2): every collection is
 * sorted before it is walked, every magnitude is quantised, and traversal order is
 * a function of node ids only. Two runs on the same graph produce identical
 * outputs — directly tested, because a validator that reads derived state is only
 * as trustworthy as its determinism.
 *
 * Nothing here reads a transform. Propagation and validation consume graph
 * structure and *declared relations*, which is what makes a puzzle immune to mesh
 * jitter, interpolation error and quality tier (ARCH §24.3).
 */

import { EMPTY_MACHINE_CONTENT, type MachineContent } from './component-registry.ts';
import type {
  ComponentDefinition,
  MachineDefinition,
  NodeRef,
  PortCarrier,
  PortDefinition,
  SocketDefinition,
  SocketInstance,
  SpinDirection
} from './component-model.ts';

/** Canonical attachment record: "this component is in this socket". */
export interface Attachment {
  readonly componentId: string;
  readonly socketId: string;
}

export type AttachResult = 'Ok' | 'Occupied' | 'AlreadyAttached';

/** Why the graph was recomputed ('invalidate' = explicit, e.g. a valve toggled). */
export type MachineChangeReason = 'attach' | 'detach' | 'reset' | 'invalidate';

/** Edge kinds of the LTG (ARCH §23.1). */
export type TopologyEdgeKind = 'attachment' | 'flow' | 'transmission';

/** One derived edge. `carrier: null` means the edge is mechanical only. */
export interface TopologyEdge {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly kind: TopologyEdgeKind;
  readonly carrier: PortCarrier | null;
  /** Magnitude multiplier applied when the carrier passes through. */
  readonly transfer: number;
  /** True when the carrier may pass; false = a declared block (closed valve). */
  readonly conducts: boolean;
  /** True when the carrier's sense is inverted on this edge (a reversing train). */
  readonly reverses: boolean;
  /** Set when a machine link derived this edge. */
  readonly linkId: string | null;
}

export type NodePhase = 'powered' | 'unpowered' | 'blocked';

export interface NodeStateEntry {
  readonly nodeId: string;
  readonly phase: NodePhase;
  /** Carrier that reached the node (null when unpowered). */
  readonly carrier: PortCarrier | null;
  readonly value: number;
  readonly spin: SpinDirection | null;
}

/** Machine functional state (ARCH §12.2 `idle/running/jammed/powered`). */
export type MachineRuntimeState = 'idle' | 'powered' | 'running' | 'jammed';

export type MachineWarning = 'no-source' | 'blocked-path' | 'cycle' | 'overpressure';

export interface MachineOutputValue {
  readonly nodeId: string;
  readonly kind: string;
  readonly value: number;
  readonly spin: SpinDirection | null;
}

/** One machine's derived state — the only thing validation may read (§23.4). */
export interface MachineDerivedState {
  readonly machineId: string;
  readonly state: MachineRuntimeState;
  readonly outputs: ReadonlyArray<MachineOutputValue>;
  readonly nodeStates: ReadonlyArray<NodeStateEntry>;
  readonly warnings: ReadonlyArray<MachineWarning>;
}

export interface DerivedTopology {
  /** Sorted node ids (components and sockets). */
  readonly nodeIds: ReadonlyArray<string>;
  /** Sorted by edge id. */
  readonly edges: ReadonlyArray<TopologyEdge>;
  /** Sorted by machine id. */
  readonly machines: ReadonlyArray<MachineDerivedState>;
}

export const EMPTY_TOPOLOGY: DerivedTopology = { nodeIds: [], edges: [], machines: [] };

export interface MachineChanged {
  readonly reason: MachineChangeReason;
  readonly componentId: string | null;
  readonly socketId: string | null;
  /** Number of attachment edges after the change (cheap structural summary). */
  readonly attachments: number;
  /**
   * Machines whose *derived* state changed, sorted by machine id. A structural
   * change with no functional consequence reports an empty list — that is how
   * "recompute only when something changed" stays true (ARCH §23.2).
   */
  readonly machines: ReadonlyArray<MachineDerivedState>;
}

/** Quantum for derived magnitudes (ARCH §23.2: "derived values are quantised"). */
const QUANTUM = 1e-3;

export function quantise(value: number): number {
  return Number.isFinite(value) ? Math.round(value / QUANTUM) * QUANTUM : 0;
}

/** Namespaced node id, so a component and a socket can share a name safely. */
export function nodeIdOf(ref: NodeRef): string {
  return ref.kind === 'component' ? `component:${ref.id}` : `socket:${ref.id}`;
}

function componentNode(componentId: string): string {
  return `component:${componentId}`;
}

function socketNode(socketId: string): string {
  return `socket:${socketId}`;
}

function compareId(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** A port may send when it is an output or bidirectional. */
function canSend(port: PortDefinition): boolean {
  return port.direction === 'out' || port.direction === 'bidir';
}

/** A port may receive when it is an input or bidirectional. */
function canReceive(port: PortDefinition): boolean {
  return port.direction === 'in' || port.direction === 'bidir';
}

/** First port (by id) of a component carrying `carrier` that satisfies `accept`. */
function portFor(
  definition: ComponentDefinition | null,
  carrier: PortCarrier,
  accept: (port: PortDefinition) => boolean
): PortDefinition | null {
  if (!definition?.ports) return null;
  const matches = definition.ports
    .filter((port) => port.carrier === carrier && accept(port))
    .sort((a, b) => compareId(a.id, b.id));
  return matches[0] ?? null;
}

interface ContentIndex {
  readonly sockets: ReadonlyMap<string, SocketInstance>;
  readonly socketDefinitions: ReadonlyMap<string, SocketDefinition>;
  readonly machines: ReadonlyArray<MachineDefinition>;
}

function buildIndex(content: MachineContent): ContentIndex {
  const sockets = new Map<string, SocketInstance>();
  for (const socket of content.sockets) sockets.set(socket.id, socket);
  const socketDefinitions = new Map<string, SocketDefinition>();
  for (const definition of content.socketDefinitions) socketDefinitions.set(definition.id, definition);
  return {
    sockets,
    socketDefinitions,
    machines: [...content.machines].sort((a, b) => compareId(a.id, b.id))
  };
}

function flip(spin: SpinDirection | null): SpinDirection | null {
  if (spin === null) return null;
  return spin === 'cw' ? 'ccw' : 'cw';
}

function sortEdges(edges: TopologyEdge[]): TopologyEdge[] {
  return edges.sort(
    (a, b) => compareId(a.id, b.id) || compareId(a.from, b.from) || compareId(a.to, b.to)
  );
}

export class MachineGraph {
  /** componentId → socketId (one attachment per component). */
  private readonly byComponent = new Map<string, string>();
  /** socketId → componentId (one occupant per socket). */
  private readonly bySocket = new Map<string, string>();
  private dirty = false;
  private pending: Omit<MachineChanged, 'machines'> | null = null;

  private content: MachineContent = EMPTY_MACHINE_CONTENT;
  private index: ContentIndex = buildIndex(EMPTY_MACHINE_CONTENT);
  private topology: DerivedTopology = EMPTY_TOPOLOGY;
  /**
   * True when the derived topology no longer matches the attachment edges. Reads
   * rebuild it lazily, so no caller can ever observe a stale machine — the graph's
   * derived view is a *view*, not a cache anyone has to remember to refresh.
   */
  private topologyStale = false;
  /** Per-machine signature of the last reported derived state (change detection). */
  private readonly signatures = new Map<string, string>();

  /** Load/replace the level's machinery. Marks the graph dirty (nothing cached). */
  configure(content: MachineContent): void {
    this.content = content;
    this.index = buildIndex(content);
    this.signatures.clear();
    this.invalidate();
  }

  /** The level's machinery content (read-only; used by callers that validate). */
  get contentBundle(): MachineContent {
    return this.content;
  }

  /**
   * Attach a component to a socket. Rejects (without touching the graph) when the
   * socket already has an occupant or the component is already attached, so no
   * duplicate edge is representable (EC-SNAP-06, EC-MAN-04).
   */
  attach(componentId: string, socketId: string): AttachResult {
    if (this.byComponent.has(componentId)) return 'AlreadyAttached';
    if (this.bySocket.has(socketId)) return 'Occupied';

    this.byComponent.set(componentId, socketId);
    this.bySocket.set(socketId, componentId);
    this.mark('attach', componentId, socketId);
    return 'Ok';
  }

  /** Remove an attachment. Returns false when there was nothing to remove. */
  detach(componentId: string): boolean {
    const socketId = this.byComponent.get(componentId);
    if (socketId === undefined) return false;

    this.byComponent.delete(componentId);
    this.bySocket.delete(socketId);
    this.mark('detach', componentId, socketId);
    return true;
  }

  occupantOf(socketId: string): string | null {
    return this.bySocket.get(socketId) ?? null;
  }

  attachmentOf(componentId: string): string | null {
    return this.byComponent.get(componentId) ?? null;
  }

  /** Occupancy is *derived* (ARCH §21.3): never written directly, so it cannot desync. */
  isSocketFree(socketId: string): boolean {
    return !this.bySocket.has(socketId);
  }

  get attachmentCount(): number {
    return this.byComponent.size;
  }

  /** Canonical edge list, sorted by component id for deterministic iteration. */
  get attachments(): ReadonlyArray<Attachment> {
    return [...this.byComponent.entries()]
      .map(([componentId, socketId]) => ({ componentId, socketId }))
      .sort((a, b) => compareId(a.componentId, b.componentId));
  }

  get isDirty(): boolean {
    return this.dirty;
  }

  /** Structural change signal: recompute runs only when something actually changed. */
  markDirty(): void {
    this.dirty = true;
    this.topologyStale = true;
  }

  /**
   * Explicit invalidation — a valve toggled, a crank turned (ARCH §23.2). Not a
   * structural change, so no attachment summary is reported for it.
   */
  invalidate(): void {
    this.dirty = true;
    this.topologyStale = true;
    if (this.pending === null) {
      this.pending = {
        reason: 'invalidate',
        componentId: null,
        socketId: null,
        attachments: this.byComponent.size
      };
    }
  }

  /**
   * Consume the pending change, recomputing the derived topology when dirty.
   * Returns null when nothing happened at all (the common case: this is called
   * once per fixed step and must be free while the machine is at rest).
   */
  recomputeIfDirty(): MachineChanged | null {
    if (!this.dirty) return null;
    this.dirty = false;
    const structural: Omit<MachineChanged, 'machines'> = this.pending ?? {
      reason: 'invalidate',
      componentId: null,
      socketId: null,
      attachments: this.byComponent.size
    };
    this.pending = null;

    this.topology = this.propagate();
    this.topologyStale = false;

    // Only machines whose derived state actually changed are reported.
    const changed: MachineDerivedState[] = [];
    for (const machine of this.topology.machines) {
      const signature = JSON.stringify(machine);
      if (this.signatures.get(machine.machineId) !== signature) changed.push(machine);
      this.signatures.set(machine.machineId, signature);
    }

    return { ...structural, machines: changed };
  }

  /** Rebuild from a canonical edge list (level load / save restore). */
  reset(attachments: ReadonlyArray<Attachment> = []): void {
    this.byComponent.clear();
    this.bySocket.clear();
    for (const edge of attachments) {
      this.byComponent.set(edge.componentId, edge.socketId);
      this.bySocket.set(edge.socketId, edge.componentId);
    }
    this.dirty = true;
    this.topologyStale = true;
    this.pending = {
      reason: 'reset',
      componentId: null,
      socketId: null,
      attachments: this.byComponent.size
    };
  }

  /**
   * The current derived topology. Rebuilt on read when the attachment edges have
   * moved, so a validator can never read a machine that no longer exists.
   */
  get derived(): DerivedTopology {
    if (this.topologyStale) {
      this.topology = this.propagate();
      this.topologyStale = false;
    }
    return this.topology;
  }

  machineState(machineId: string): MachineDerivedState | null {
    return this.derived.machines.find((machine) => machine.machineId === machineId) ?? null;
  }

  outputsOf(machineId: string): ReadonlyArray<MachineOutputValue> {
    return this.machineState(machineId)?.outputs ?? [];
  }

  /** Derived state of one node, or null when it is not part of any machine. */
  nodeStateOf(nodeId: string): NodeStateEntry | null {
    for (const machine of this.derived.machines) {
      const entry = machine.nodeStates.find((state) => state.nodeId === nodeId);
      if (entry) return entry;
    }
    return null;
  }

  private mark(reason: MachineChangeReason, componentId: string, socketId: string): void {
    this.dirty = true;
    this.topologyStale = true;
    this.pending = { reason, componentId, socketId, attachments: this.byComponent.size };
  }

  /**
   * The whole derivation, in one pass per machine (ARCH §23.2). Everything is
   * rebuilt from the attachment edges: nothing here is incremental, because at
   * MVP machine sizes (well under 100 nodes) a full recompute is free and an
   * incremental one would be a second source of truth.
   */
  private propagate(): DerivedTopology {
    const edges = sortEdges(this.deriveEdges());
    const nodeIds = [...new Set(edges.flatMap((edge) => [edge.from, edge.to]))].sort();

    const machines: MachineDerivedState[] = [];
    for (const machine of this.index.machines) machines.push(this.deriveMachine(machine, edges));

    return { nodeIds, edges, machines };
  }

  /** Every edge the attachment edges and the content imply, sorted by id. */
  private deriveEdges(): TopologyEdge[] {
    const edges: TopologyEdge[] = [];
    const registry = this.content.registry;

    for (const edge of this.attachments) {
      const component = registry.definitionFor(edge.componentId);
      const socket = this.index.sockets.get(edge.socketId) ?? null;
      const socketDefinition = socket ? this.index.socketDefinitions.get(socket.defId) ?? null : null;
      const carrier = socketDefinition?.carrier ?? null;
      const partNode = componentNode(edge.componentId);
      const mountNode = socketNode(edge.socketId);

      if (carrier === null || socketDefinition === null) {
        // Mechanical-only attachment: it links the two nodes, both ways.
        edges.push({
          id: `attachment:${edge.socketId}:${edge.componentId}:out`,
          from: partNode,
          to: mountNode,
          kind: 'attachment',
          carrier: null,
          transfer: 1,
          conducts: true,
          reverses: false,
          linkId: null
        });
        edges.push({
          id: `attachment:${edge.socketId}:${edge.componentId}:in`,
          from: mountNode,
          to: partNode,
          kind: 'attachment',
          carrier: null,
          transfer: 1,
          conducts: true,
          reverses: false,
          linkId: null
        });
        continue;
      }

      // Carried attachment: direction is decided by *both* sides' declarations.
      const sender = portFor(component, carrier, canSend);
      const receiver = portFor(component, carrier, canReceive);
      if (sender && socketDefinition.portDirection !== 'out') {
        edges.push({
          id: `attachment:${edge.socketId}:${edge.componentId}:out`,
          from: partNode,
          to: mountNode,
          kind: 'attachment',
          carrier,
          transfer: 1,
          conducts: sender.conducts !== false,
          reverses: sender.reverses === true,
          linkId: null
        });
      }
      if (receiver && socketDefinition.portDirection !== 'in') {
        edges.push({
          id: `attachment:${edge.socketId}:${edge.componentId}:in`,
          from: mountNode,
          to: partNode,
          kind: 'attachment',
          carrier,
          transfer: 1,
          conducts: receiver.conducts !== false,
          reverses: receiver.reverses === true,
          linkId: null
        });
      }

      // Ownership conduction: the socket is wired to a named port on its owner,
      // so a part attached to a socket is connected to the structure mounting it.
      const ownerId = socketDefinition.ownerComponentId;
      const ownerPortId = socketDefinition.ownerPortId;
      if (!ownerId || !ownerPortId) continue;
      const owner = registry.definitionFor(ownerId);
      const ownerPort = owner?.ports?.find((port) => port.id === ownerPortId) ?? null;
      if (!ownerPort || ownerPort.carrier !== carrier) continue;

      const ownerNode = componentNode(ownerId);
      if (canReceive(ownerPort) && socketDefinition.portDirection !== 'out') {
        edges.push({
          id: `transmission:${edge.socketId}:${ownerId}:in`,
          from: mountNode,
          to: ownerNode,
          kind: 'transmission',
          carrier,
          transfer: 1,
          conducts: ownerPort.conducts !== false,
          reverses: ownerPort.reverses === true,
          linkId: null
        });
      }
      if (canSend(ownerPort) && socketDefinition.portDirection !== 'in') {
        edges.push({
          id: `transmission:${edge.socketId}:${ownerId}:out`,
          from: ownerNode,
          to: mountNode,
          kind: 'transmission',
          carrier,
          transfer: 1,
          conducts: ownerPort.conducts !== false,
          reverses: ownerPort.reverses === true,
          linkId: null
        });
      }
    }

    // Declared adjacencies (ARCH §24.3). A link exists only while a compatible
    // component occupies its socket, and it conducts through that component's
    // matching port — so capability data, not geometry, decides connectivity.
    for (const machine of this.index.machines) {
      for (const link of [...machine.links].sort((a, b) => compareId(a.id, b.id))) {
        const bridgeId = this.bySocket.get(link.viaSocketId);
        if (bridgeId === undefined) continue;
        const bridge = registry.definitionFor(bridgeId);
        if (!bridge) continue;
        const tags = new Set(bridge.tags);
        if (!link.viaTags.every((tag) => tags.has(tag))) continue;

        const bridgePort = portFor(bridge, link.carrier, (port) => port.role !== 'source');
        if (!bridgePort) continue;

        const from = nodeIdOf(link.from);
        const to = nodeIdOf(link.to);
        const bridgeNode = `component:${bridgeId}`;
        const transfer = link.transfer ?? 1;
        const conducts = bridgePort.conducts !== false;
        const reverses = bridgePort.reverses === true;

        // A link is *directional* (ARCH §22 "directionality matters"): it transmits
        // from `from` through the bridge to `to`, and nothing else. Reverse edges
        // would fabricate a connection the machine does not declare — and would
        // make "a gear must be here" true for any part sitting in the socket.
        // `reverses` is applied once — on the way *out* of the bridge. Applying it to
        // both halves would cancel itself and an idler gear would change nothing.
        edges.push({ id: `flow:${link.id}:${link.viaSocketId}:a`, from, to: bridgeNode, kind: 'flow', carrier: link.carrier, transfer, conducts, reverses: false, linkId: link.id });
        edges.push({ id: `flow:${link.id}:${link.viaSocketId}:b`, from: bridgeNode, to, kind: 'flow', carrier: link.carrier, transfer, conducts, reverses, linkId: link.id });
      }
    }

    return edges;
  }

  /** One machine's scope, propagation, node states and outputs. */
  private deriveMachine(machine: MachineDefinition, allEdges: ReadonlyArray<TopologyEdge>): MachineDerivedState {
    const scope = this.scopeOf(machine, machine.rootNodes.map(nodeIdOf), allEdges);
    const edges = allEdges.filter((edge) => scope.has(edge.from) && scope.has(edge.to));

    const carriers = new Set<PortCarrier>();
    for (const edge of edges) if (edge.carrier) carriers.add(edge.carrier);
    for (const nodeId of scope) {
      if (!nodeId.startsWith('component:')) continue;
      const definition = this.content.registry.definitionFor(nodeId.slice('component:'.length));
      for (const port of definition?.ports ?? []) if (port.role === 'source') carriers.add(port.carrier);
    }

    const warnings = new Set<MachineWarning>();
    const nodeStates = new Map<string, NodeStateEntry>();

    for (const carrier of [...carriers].sort()) {
      const seeds: Array<{ node: string; value: number; spin: SpinDirection | null }> = [];
      for (const nodeId of [...scope].sort()) {
        if (!nodeId.startsWith('component:')) continue;
        const definition = this.content.registry.definitionFor(nodeId.slice('component:'.length));
        const source = portFor(definition, carrier, (port) => port.role === 'source');
        if (source) seeds.push({ node: nodeId, value: quantise(source.value ?? 1), spin: source.spin ?? null });
      }
      if (seeds.length === 0) continue;

      // Deterministic BFS: sorted frontier, edges sorted by id, magnitudes summed at
      // equal hop distance, so convergent paths never depend on visit order.
      const distance = new Map<string, number>();
      const value = new Map<string, number>();
      const spin = new Map<string, SpinDirection | null>();
      const blocked = new Set<string>();

      for (const seed of seeds) {
        distance.set(seed.node, 0);
        if (!value.has(seed.node)) value.set(seed.node, 0);
        value.set(seed.node, quantise(value.get(seed.node)! + seed.value));
        spin.set(seed.node, seed.spin);
      }

      let frontier = [...new Set(seeds.map((seed) => seed.node))].sort();
      while (frontier.length > 0) {
        const next: string[] = [];
        for (const nodeId of frontier) {
          const here = distance.get(nodeId) ?? 0;
          const out = edges
            .filter((edge) => edge.from === nodeId && edge.carrier === carrier)
            .sort((a, b) => compareId(a.id, b.id) || compareId(a.to, b.to));
          for (const edge of out) {
            const contribution = quantise((value.get(nodeId) ?? 0) * edge.transfer);
            if (!edge.conducts) {
              // The carrier was refused here: the node is reached but not powered.
              blocked.add(edge.to);
              if (!value.has(edge.to)) value.set(edge.to, contribution);
              continue;
            }
            const there = distance.get(edge.to);
            if (there === undefined) {
              distance.set(edge.to, here + 1);
              value.set(edge.to, contribution);
              spin.set(edge.to, edge.reverses ? flip(spin.get(nodeId) ?? null) : spin.get(nodeId) ?? null);
              next.push(edge.to);
            } else if (there === here + 1) {
              value.set(edge.to, quantise((value.get(edge.to) ?? 0) + contribution));
            } else if (there <= here) {
              // A back edge: the carrier can already reach this node by a shorter
              // path, i.e. the chain contains a loop. Flagged, never fatal (TEST §4).
              warnings.add('cycle');
            }
          }
        }
        frontier = [...new Set(next)].sort();
      }

      for (const nodeId of [...distance.keys()].sort()) {
        if (nodeStates.has(nodeId)) continue; // an earlier (sorted) carrier reached it first
        nodeStates.set(nodeId, {
          nodeId,
          phase: 'powered',
          carrier,
          value: value.get(nodeId) ?? 0,
          spin: spin.get(nodeId) ?? null
        });
      }
      for (const nodeId of [...blocked].sort()) {
        if (nodeStates.has(nodeId)) continue;
        nodeStates.set(nodeId, {
          nodeId,
          phase: 'blocked',
          carrier,
          value: value.get(nodeId) ?? 0,
          spin: null
        });
      }
    }

    for (const nodeId of [...scope].sort()) {
      if (!nodeStates.has(nodeId)) {
        nodeStates.set(nodeId, { nodeId, phase: 'unpowered', carrier: null, value: 0, spin: null });
      }
    }

    const outputs: MachineOutputValue[] = [];
    for (const output of [...machine.outputs].sort((a, b) => compareId(nodeIdOf(a.node), nodeIdOf(b.node)))) {
      const nodeId = nodeIdOf(output.node);
      const state = nodeStates.get(nodeId);
      if (!state || state.phase !== 'powered') continue;
      outputs.push({ nodeId, kind: output.kind, value: state.value, spin: state.spin });
    }
    if (machine.maxOutput !== undefined && outputs.some((output) => output.value > machine.maxOutput!)) {
      warnings.add('overpressure');
    }

    const entries = [...nodeStates.values()];
    const hasSource = entries.some((state) => state.phase === 'powered');
    const hasBlocked = entries.some((state) => state.phase === 'blocked');
    if (!hasSource && machine.outputs.length > 0) warnings.add('no-source');
    if (hasBlocked) warnings.add('blocked-path');

    const state: MachineRuntimeState = !hasSource
      ? 'idle'
      : hasBlocked
        ? 'jammed'
        : outputs.length > 0
          ? 'running'
          : 'powered';

    return {
      machineId: machine.id,
      state,
      outputs,
      nodeStates: entries.sort((a, b) => compareId(a.nodeId, b.nodeId)),
      warnings: [...warnings].sort()
    };
  }

  /**
   * A machine's node set: its roots plus everything reachable from them over the
   * derived edges, treated as undirected. Reachability (not direction) defines
   * scope, so a machine can be inspected *before* it is correctly assembled —
   * which is exactly what a requirement has to describe.
   *
   * Expansion stops at a socket belonging to a *different* machine: two machines
   * may share a structural part, and without this a shared frame would merge their
   * scopes and let one machine's source power the other's output.
   */
  private scopeOf(
    machine: MachineDefinition,
    roots: ReadonlyArray<string>,
    edges: ReadonlyArray<TopologyEdge>
  ): Set<string> {
    const adjacency = new Map<string, string[]>();
    const link = (from: string, to: string): void => {
      if (!adjacency.has(from)) adjacency.set(from, []);
      adjacency.get(from)!.push(to);
    };
    for (const edge of edges) {
      link(edge.from, edge.to);
      link(edge.to, edge.from);
    }

    const isForeignSocket = (nodeId: string): boolean => {
      const socketMachineId = this.machineIdOfSocketNode(nodeId);
      return socketMachineId !== null && socketMachineId !== machine.id;
    };

    const scope = new Set<string>();
    const queue = [...roots].sort();
    while (queue.length > 0) {
      const nodeId = queue.shift()!;
      if (scope.has(nodeId)) continue;
      // Another machine's socket is not this machine's node: skipping it entirely
      // (rather than just not expanding past it) keeps a shared frame from putting
      // a neighbouring machine's machinery into this machine's node states.
      if (isForeignSocket(nodeId)) continue;
      scope.add(nodeId);
      for (const neighbour of [...(adjacency.get(nodeId) ?? [])].sort()) {
        if (!scope.has(neighbour)) queue.push(neighbour);
      }
    }
    return scope;
  }

  /** The machine a socket node belongs to, or null for components / unknown sockets. */
  private machineIdOfSocketNode(nodeId: string): string | null {
    if (!nodeId.startsWith('socket:')) return null;
    const socket = this.index.sockets.get(nodeId.slice('socket:'.length));
    if (!socket) return null;
    return this.index.socketDefinitions.get(socket.defId)?.machineId ?? null;
  }
}
