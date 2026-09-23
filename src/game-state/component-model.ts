/**
 * L1 — the mechanical component model (ARCH §22, §40 `game-state/`).
 *
 * Components are **data + identity, never behaviours**: this file is plain types
 * and closed vocabularies, so compatibility is exhaustively testable. L1 is
 * engine-free and headless (ARCH §11 rule R2) — the only import it may make is L0.
 */

import type { Vec3 } from '../core/vec3.ts';

/** Mass classes (ARCH §22). Handling capability is compared by rank, not by name. */
export type MassClass = 'light' | 'standard' | 'heavy';

export const MASS_RANK: Record<MassClass, number> = { light: 0, standard: 1, heavy: 2 };

export type ComponentKind = 'carryable' | 'fixed' | 'machine-part' | 'tool';

/** `attached` is LMG truth; `held` is runtime-only (ARCH §22). */
export type ComponentState = 'loose' | 'held' | 'attached';

/** Rotation axes a component may allow (ARCH §20.1). */
export type RotationAxis = 'x' | 'y' | 'z';

/**
 * The MVP capability vocabulary (ARCH §22: "tag sets are intentionally small and
 * closed ... so that compatibility is testable exhaustively").
 */
export type ComponentTag = 'crate' | 'gear' | 'shaft' | 'plate' | 'pipe' | 'valve';
export type SocketKind = 'crate-dock' | 'gear-mount' | 'shaft-mount' | 'pipe-port';

/**
 * What a port conducts (ARCH §22): rotation for the gear train (P1/P2), pressure
 * for the steam gallery (P3, BM-1). An open vocabulary so later carriers are data.
 */
export type PortCarrier = 'rotation' | 'pressure';

/** Flow direction at a connection point (ARCH §21.1). */
export type PortDirection = 'in' | 'out' | 'bidir';

/** Rotation sense a port or link imparts (ARCH §23.2 `direction`). */
export type SpinDirection = 'cw' | 'ccw';

/**
 * What a port does for propagation:
 *  - `source`  injects the carrier (a crank input, a pressure source)
 *  - `through` conducts it from any side to any other side
 *  - `sink`    accepts it and does not pass it on (an output/consuming part)
 */
export type PortRole = 'source' | 'through' | 'sink';

/**
 * A named connection point on a component (ARCH §23.1 "a gear transmits rotation
 * between its two shaft ports"). Ports are *data*: the propagation rules read them
 * and nothing else, so adding a component never adds a branch.
 */
export interface PortDefinition {
  readonly id: string;
  readonly carrier: PortCarrier;
  readonly direction: PortDirection;
  readonly role: PortRole;
  /** Magnitude a `source` injects. Quantised by the graph; ignored otherwise. */
  readonly value?: number;
  /** Rotation sense a `source` injects. Only meaningful for `rotation`. */
  readonly spin?: SpinDirection;
  /** Inverts the carrier's sense through this port (a reversing gear train). */
  readonly reverses?: boolean;
  /** `false` stops propagation here (a closed valve). Default true. */
  readonly conducts?: boolean;
}

/**
 * A reference to an LTG node (ARCH §23.1). Ports are named on the edges rather
 * than being nodes of their own: requirements address components and sockets
 * (`through` is a *tag*, §24.1), so port nodes would add indirection without
 * answering any question the validator asks.
 */
export type NodeRef =
  | { readonly kind: 'component'; readonly id: string }
  | { readonly kind: 'socket'; readonly id: string };

/**
 * A **declared adjacency** (ARCH §24.3): two nodes are coupled when a component
 * carrying `viaTags` and a compatible port occupies `viaSocketId`. A gear meshes
 * with the shafts its machine declares — never with whatever happens to be near it
 * in space, so validation cannot read a live transform.
 */
export interface MachineLinkDefinition {
  readonly id: string;
  /** The socket the bridging component must occupy for this link to exist. */
  readonly viaSocketId: string;
  /** Capability tags the bridging component must carry. */
  readonly viaTags: ReadonlyArray<ComponentTag>;
  readonly carrier: PortCarrier;
  readonly from: NodeRef;
  readonly to: NodeRef;
  /**
   * Magnitude multiplier through the bridge. Default 1. The rotation *sense* is not
   * declared here: it comes from the source port that seeds the carrier and is
   * flipped by whichever part declares `reverses`, which is the physical model
   * (§22) and keeps one authority for direction.
   */
  readonly transfer?: number;
}

export type MachineOutputKind = 'rotation' | 'pressure' | 'torque';

/** An output the machine exposes (ARCH §23.2 `outputNodes`). */
export interface MachineOutputDefinition {
  readonly node: NodeRef;
  readonly kind: MachineOutputKind;
}

/**
 * A machine is a named subgraph (ARCH §23.1): the nodes it is scoped to, the
 * adjacencies only the machine knows, and the outputs validation can read.
 *
 * Everything here is data. A socket may name a `machineId` that has no definition
 * yet (M4's lab dock names `BM-1`, whose definition arrives with the branch
 * machine): such a socket is simply inert until the definition lands.
 */
export interface MachineDefinition {
  readonly id: string;
  readonly title: string;
  /** Nodes that seed the machine's scope; the graph walks out from here. */
  readonly rootNodes: ReadonlyArray<NodeRef>;
  readonly links: ReadonlyArray<MachineLinkDefinition>;
  readonly outputs: ReadonlyArray<MachineOutputDefinition>;
  /** Declared ceiling; derived outputs above it raise `overpressure` (§24.1). */
  readonly maxOutput?: number;
  /**
   * ADR-018: the actions that **prime** this machine. A `state: 'primed'` requirement
   * is satisfied when every one of them has been performed — in any order, which is
   * §7's "order-flexible priming" expressed as coverage rather than as a sequence.
   *
   * Priming is a property of *what the player did*, not of the machine's structure, so
   * it is declared here (data) and answered by the validator from the §12.2 action
   * history (`ValidationContext.actions`). A machine with no priming stage omits this,
   * and `primed` then reports `state/unsupported-primed` — never a silent pass.
   */
  readonly primingActions?: ReadonlyArray<string> | undefined;
}

/**
 * Canonical component pose: box centre plus yaw about Y. The *owner* quantises it
 * (the manipulation SM for a loose carryable, the socket for an attached one).
 */
export interface Pose {
  center: Vec3;
  yaw: number;
}

export interface ComponentDefinition {
  readonly id: string;
  readonly kind: ComponentKind;
  /** Capability tags — the component half of the compatibility language. */
  readonly tags: ReadonlyArray<ComponentTag>;
  readonly massClass: MassClass;
  readonly allowedAxes: ReadonlyArray<RotationAxis>;
  /** Half-extents of the component box around its centre, at yaw 0. */
  readonly halfExtents: Vec3;
  /** Focusable but never liftable when false. */
  readonly grabbable: boolean;
  /** Connection points for machine propagation (ARCH §23). Absent = conducts nothing. */
  readonly ports?: ReadonlyArray<PortDefinition>;
}

export interface SocketDefinition {
  readonly id: string;
  readonly machineId: string;
  readonly ownerComponentId: string;
  /** Socket half of the compatibility language (ARCH §21.1 `accepts`). */
  readonly socketKind: SocketKind;
  readonly accepts: ReadonlyArray<ComponentTag>;
  readonly portDirection: 'in' | 'out' | 'bidir';
  /** Carrier this socket conducts into its owner. Absent = a mechanical-only mount. */
  readonly carrier?: PortCarrier;
  /**
   * Which port of the owner component this socket is wired to (ARCH §23.1: the
   * socket is a node *between* the attached part and the structure that mounts it).
   */
  readonly ownerPortId?: string;
  /**
   * Yaw the attached component adopts *exactly*, absorbing the player's partial
   * rotation (ARCH §21.3 "no rotational ambiguity").
   */
  readonly snapYaw: number;
}

/** An authored socket placement: level geometry plus the definition it realises. */
export interface SocketInstance {
  readonly id: string;
  readonly defId: string;
  /** World pose an attached component adopts exactly. */
  readonly pose: Pose;
  /** Half-extents of the detection volume around `pose` (AABB, as everything is). */
  readonly halfExtents: Vec3;
}
