/**
 * L1 — the puzzle validator (ARCH §24, §40 `game-state/validator.ts`).
 *
 * **Central rule (§24):** completion is a function of the machine graph, never of
 * component positions. Every predicate here reads attachment edges, the derived
 * topology or derived machine outputs — there is no transform, no distance and no
 * physics value anywhere in this file, which is what makes validation immune to
 * mesh jitter, interpolation error and quality tier (§24.3).
 *
 * The validator is **pure and does not act** (§24.4): it reports, repeatedly and
 * without side effects. The completion latch and the state machine belong to
 * `PuzzleSystem`, which owns the hysteresis counter — so the stable-frame rule is
 * expressed here as *data* (`previousStreak` in, `streak` out) rather than as
 * hidden module state (EC-PZ-01: "hysteresis counter in `PuzzleSystem`, never in
 * `Validator`").
 *
 * **Staged requirements (ADR-018).** Two requirement forms cannot be answered from the
 * graph at all: `state: 'primed'` and `sequence.ordered`. Both ask what the *player
 * did*, so both read the §12.2 action history as an **input** (`context.actions`) and
 * stay pure — the same trade the stable-frame rule makes with `previousStreak`. The
 * log itself is owned by `ActionHistory`; the rules that read it
 * (`coversAll`, `witnessesInOrder`) live there too, so the validator and the
 * composition cannot drift apart.
 */

import { coversAll, witnessesInOrder } from './action-history.ts';
import type { MachineContent } from './component-registry.ts';
import type {
  ComponentTag,
  MachineOutputKind,
  NodeRef,
  SocketKind,
  SpinDirection
} from './component-model.ts';
import { nodeIdOf, type MachineGraph, type TopologyEdge } from './machine-graph.ts';

/** Stable frames a satisfied result must hold before it counts (ARCH §24.2). */
export const DEFAULT_STABLE_STEPS = 3;

/** Requirement discriminants (ARCH §24.1). `id` is authored: reason codes are hint keys. */
export interface RequirementBase {
  /** Stable identifier, reported in `reasonCodes` for hints + debug (§24.2/§24.5). */
  readonly id: string;
}

export type Requirement =
  | (RequirementBase & {
      readonly kind: 'connected';
      readonly from: NodeRef;
      readonly to: NodeRef;
      /** A path that passes through a component carrying this tag. */
      readonly through?: ComponentTag;
    })
  | (RequirementBase & {
      readonly kind: 'componentAt';
      readonly componentTag: ComponentTag;
      readonly socketKind: SocketKind;
      readonly count: number;
    })
  | (RequirementBase & {
      readonly kind: 'output';
      readonly machineId: string;
      readonly output: MachineOutputKind;
      readonly min: number;
      readonly direction?: SpinDirection;
      readonly equals?: number;
    })
  | (RequirementBase & {
      readonly kind: 'state';
      /**
       * `primed` is part of the vocabulary but is not a function of a static
       * graph: priming is an *ordered player sequence* (BM-1, staged validation),
       * so it reports `state/unsupported-primed` until the staged model lands.
       * It never silently passes.
       */
      readonly machineId: string;
      readonly state: 'running' | 'powered' | 'primed';
    })
  | (RequirementBase & {
      readonly kind: 'sequence';
      readonly steps: ReadonlyArray<ReadonlyArray<Requirement>>;
      /**
       * `ordered: false` is the AND of each step's OR — a static predicate, evaluated
       * from the graph alone.
       *
       * `ordered: true` (ADR-018) additionally requires the steps to have been
       * *witnessed* in the declared order by the player's actions, and so needs a
       * witness list per step: `witnesses[i]` names the actions that may witness step
       * `i`. Missing or empty witness lists are `sequence/no-witness` (an authoring
       * error, never a silent pass); witnesses that exist but not in order are
       * `sequence/out-of-order`.
       */
      readonly ordered: boolean;
      readonly witnesses?: ReadonlyArray<ReadonlyArray<string>> | undefined;
    })
  | (RequirementBase & {
      readonly kind: 'safety';
      readonly machineId: string;
      readonly condition: 'overpressure' | 'unjammed';
    })
  | (RequirementBase & { readonly kind: 'not'; readonly requirement: Requirement })
  | (RequirementBase & { readonly kind: 'any'; readonly requirements: ReadonlyArray<Requirement> });

/** Why a requirement failed — the vocabulary hints and feedback read (§24.5). */
export type ValidationReason =
  | 'connected/unreachable'
  | 'connected/no-through-node'
  | 'connected/unknown-node'
  | 'componentAt/missing'
  | 'componentAt/unknown-socket-kind'
  | 'output/no-machine'
  | 'output/unreached'
  | 'output/below-min'
  | 'output/not-equal'
  | 'output/wrong-direction'
  | 'output/wrong-kind'
  | 'state/no-machine'
  | 'state/mismatch'
  /**
   * `primed` is a staged stage: it is answered from the §12.2 action history
   * (ADR-018). This reason means the question *cannot* be answered here — the machine
   * declares no priming actions, or the caller supplied no history. It is never a
   * silent pass, and `state/not-primed` is the ordinary "priming is not finished".
   */
  | 'state/unsupported-primed'
  | 'state/not-primed'
  | 'sequence/no-witness'
  | 'sequence/out-of-order'
  | 'sequence/empty'
  | 'sequence/unmet'
  | 'not/held'
  | 'any/none'
  | 'safety/overpressure'
  | 'safety/jammed'
  | 'safety/no-machine';

export interface RequirementResult {
  readonly id: string;
  readonly kind: Requirement['kind'];
  readonly satisfied: boolean;
  /** null when satisfied. */
  readonly reason: ValidationReason | null;
}

export interface ValidationResult {
  /** Every requirement held in this evaluation. */
  readonly satisfied: boolean;
  /** True once `satisfied` has held for `stableSteps` consecutive evaluations. */
  readonly confirmed: boolean;
  /** Consecutive satisfied evaluations including this one. Caller-owned state. */
  readonly streak: number;
  readonly requirements: ReadonlyArray<RequirementResult>;
  /** Ids of the requirements that failed (ARCH §24.2 reasonCodes). */
  readonly reasonCodes: ReadonlyArray<string>;
}

export interface ValidationContext {
  /** The attachment edges + derived topology (the only machine truth). */
  readonly graph: MachineGraph;
  /** Content lookup for capability tags and socket kinds. */
  readonly content: MachineContent;
  /**
   * The player's action log (ADR-018), in order, for the staged requirements
   * (`state: 'primed'`, `sequence.ordered`). `undefined` means "no history supplied":
   * a staged requirement then refuses (`state/unsupported-primed`,
   * `sequence/out-of-order`) rather than passing silently. The validator never holds
   * the log — it reads this snapshot, exactly as it reads `previousStreak`.
   */
  readonly actions?: ReadonlyArray<string> | undefined;
  /** Consecutive satisfied evaluations before this one (owned by the caller). */
  readonly previousStreak?: number | undefined;
  readonly stableSteps?: number | undefined;
}

/**
 * Evaluate a requirement set (ARCH §24.2). Pure: same inputs, same result, and
 * no state is mutated anywhere — including the graph.
 */
export function evaluateRequirements(
  requirements: ReadonlyArray<Requirement>,
  context: ValidationContext
): ValidationResult {
  const results = requirements.map((requirement) => evaluate(requirement, context));
  const satisfied = results.every((result) => result.satisfied);
  const stableSteps = Math.max(1, context.stableSteps ?? DEFAULT_STABLE_STEPS);
  const streak = satisfied ? (context.previousStreak ?? 0) + 1 : 0;

  return {
    satisfied,
    confirmed: satisfied && streak >= stableSteps,
    streak,
    requirements: results,
    reasonCodes: results.filter((result) => !result.satisfied).map((result) => result.id)
  };
}

/** Evaluate one requirement. Exported so hints can ask about a single objective. */
export function evaluate(requirement: Requirement, context: ValidationContext): RequirementResult {
  const fail = (reason: ValidationReason): RequirementResult => ({
    id: requirement.id,
    kind: requirement.kind,
    satisfied: false,
    reason
  });
  const pass = (): RequirementResult => ({
    id: requirement.id,
    kind: requirement.kind,
    satisfied: true,
    reason: null
  });

  switch (requirement.kind) {
    case 'connected': {
      const from = nodeIdOf(requirement.from);
      const to = nodeIdOf(requirement.to);
      const edges = reachableEdges(context.graph.derived.edges);
      if (!hasNode(context, from) || !hasNode(context, to)) return fail('connected/unknown-node');

      if (requirement.through === undefined) {
        return reaches(edges, from, to) ? pass() : fail('connected/unreachable');
      }
      // A tagged component may be installed (in the topology) or still lying loose
      // (only in the registry). "No such part exists" and "the part is not in the
      // machine" are different failures, and the player needs the right one.
      const installed = context.graph.derived.nodeIds.filter((nodeId) => nodeId.startsWith('component:'));
      const loose = context.content.registry
        .byTag(requirement.through)
        .map((instance) => `component:${instance.id}`);
      const via = [...new Set([...installed, ...loose])]
        .filter((nodeId) => context.content.registry.hasTag(nodeId.slice('component:'.length), requirement.through!))
        .sort();
      if (via.length === 0) return fail('connected/no-through-node');
      for (const nodeId of via) {
        if (reaches(edges, from, nodeId) && reaches(edges, nodeId, to)) return pass();
      }
      return fail('connected/unreachable');
    }

    case 'componentAt': {
      let count = 0;
      let knownKind = false;
      for (const edge of context.graph.attachments) {
        const instance = context.content.registry.get(edge.componentId);
        if (!instance) continue;
        const socket = context.content.sockets.find((candidate) => candidate.id === edge.socketId);
        const definition = socket
          ? context.content.socketDefinitions.find((candidate) => candidate.id === socket.defId)
          : null;
        if (!definition || definition.socketKind !== requirement.socketKind) continue;
        knownKind = true;
        if (context.content.registry.hasTag(edge.componentId, requirement.componentTag)) count += 1;
      }
      if (!knownKind && count < requirement.count) return fail('componentAt/unknown-socket-kind');
      return count >= requirement.count ? pass() : fail('componentAt/missing');
    }

    case 'output': {
      const machine = context.graph.machineState(requirement.machineId);
      if (!machine) return fail('output/no-machine');
      const output = machine.outputs.find((candidate) => candidate.kind === requirement.output);
      if (!output) return fail('output/unreached');
      if (requirement.equals !== undefined && output.value !== requirement.equals) {
        return fail('output/not-equal');
      }
      if (output.value < requirement.min) return fail('output/below-min');
      if (requirement.direction !== undefined && output.spin !== requirement.direction) {
        return fail('output/wrong-direction');
      }
      return pass();
    }

    case 'state': {
      const machine = context.graph.machineState(requirement.machineId);
      if (!machine) return fail('state/no-machine');
      if (requirement.state !== 'primed') {
        return machine.state === requirement.state ? pass() : fail('state/mismatch');
      }
      // Staged (ADR-018): `primed` is a question about what the player did, answered
      // from the machine's declared priming actions and the §12.2 action log. Both
      // halves must exist; a machine with no priming stage (or a caller with no
      // history) cannot be "primed", so the requirement refuses instead of passing.
      const primingActions =
        context.content.machines.find((machine_definition) => machine_definition.id === requirement.machineId)
          ?.primingActions ?? [];
      const actions = context.actions;
      if (primingActions.length === 0 || actions === undefined) return fail('state/unsupported-primed');
      return coversAll(actions, primingActions) ? pass() : fail('state/not-primed');
    }

    case 'sequence': {
      if (requirement.steps.length === 0) return fail('sequence/empty');
      // Unordered: every step must be satisfiable by some requirement in it.
      for (const step of requirement.steps) {
        const fulfilled = step.some((candidate) => evaluate(candidate, context).satisfied);
        if (!fulfilled) return fail('sequence/unmet');
      }
      if (!requirement.ordered) return pass();

      // Ordered (ADR-018): the steps also have to have been *witnessed* in order by
      // the player's actions. Every step needs a non-empty witness list, and the
      // witnesses must appear in the log in the declared order — earliest-match, so a
      // player who engaged too early can recover by engaging again after priming.
      const witnesses = requirement.witnesses ?? [];
      const declared = witnesses.length === requirement.steps.length && witnesses.every((step) => step.length > 0);
      if (!declared) return fail('sequence/no-witness');
      return witnessesInOrder(context.actions ?? [], witnesses) ? pass() : fail('sequence/out-of-order');
    }

    case 'safety': {
      const machine = context.graph.machineState(requirement.machineId);
      if (!machine) return fail('safety/no-machine');
      if (requirement.condition === 'overpressure') {
        return machine.warnings.includes('overpressure') ? fail('safety/overpressure') : pass();
      }
      return machine.state === 'jammed' ? fail('safety/jammed') : pass();
    }

    case 'not': {
      const inner = evaluate(requirement.requirement, context);
      return inner.satisfied ? fail('not/held') : pass();
    }

    case 'any': {
      if (requirement.requirements.length === 0) return fail('any/none');
      for (const candidate of requirement.requirements) {
        if (evaluate(candidate, context).satisfied) return pass();
      }
      return fail('any/none');
    }
  }
}

/** Only edges the carrier can actually pass count as connections (a closed valve does not). */
function reachableEdges(edges: ReadonlyArray<TopologyEdge>): ReadonlyArray<TopologyEdge> {
  return edges.filter((edge) => edge.conducts);
}

function hasNode(context: ValidationContext, nodeId: string): boolean {
  if (context.graph.derived.nodeIds.includes(nodeId)) return true;
  // A component with no attachment is still a legitimate (unreachable) node.
  return nodeId.startsWith('component:') && context.content.registry.get(nodeId.slice('component:'.length)) !== null;
}

/** Directed reachability over conducting edges (a connection is not symmetric). */
function reaches(edges: ReadonlyArray<TopologyEdge>, from: string, to: string): boolean {
  if (from === to) return true;
  const out = new Map<string, string[]>();
  for (const edge of edges) {
    if (!out.has(edge.from)) out.set(edge.from, []);
    out.get(edge.from)!.push(edge.to);
  }

  const seen = new Set<string>([from]);
  const queue = [from];
  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    for (const next of [...(out.get(nodeId) ?? [])].sort()) {
      if (next === to) return true;
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return false;
}

/** Collect every requirement id in a tree (debug + hint tooling). */
export function requirementIds(requirements: ReadonlyArray<Requirement>): ReadonlyArray<string> {
  const ids: string[] = [];
  const visit = (requirement: Requirement): void => {
    ids.push(requirement.id);
    if (requirement.kind === 'not') visit(requirement.requirement);
    if (requirement.kind === 'any') requirement.requirements.forEach(visit);
    if (requirement.kind === 'sequence') requirement.steps.forEach((step) => step.forEach(visit));
  };
  requirements.forEach(visit);
  return ids;
}
