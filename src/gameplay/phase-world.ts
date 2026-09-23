/**
 * L2 — Phase-2/3 world composition (ARCH §40 `gameplay/`): input -> player ->
 * camera -> interaction -> manipulation, stepped in the exact order ARCH §14
 * mandates. Constructed by the composition root and driven from the fixed step —
 * no DOM, no rendering here.
 *
 * Each system is stepped through an explicit `WorldSystems` bundle so tests can
 * substitute fakes per seam (TEST §3), and so later phases extend the sequence
 * by adding one field rather than rewriting the wiring.
 */

import { InputSystem, type ActionState, type RawInputSample } from './input-system.ts';
import { PlayerController, type PlayerDynamicState } from './player-controller.ts';
import { CameraRig, type CameraPoseState } from './camera-rig.ts';
import { type FocusChanged, type InteractionSystem } from './interaction-system.ts';
import { type ManipulationStepResult, type ManipulationSystem } from './manipulation-system.ts';
import { type SnapCandidateView, type SnapSystem } from './snap-system.ts';
import { type FeedbackIntent, type FeedbackModel } from './feedback-model.ts';
import type { MachineChanged, MachineGraph } from '../game-state/machine-graph.ts';
import type { PuzzleSystem, PuzzleUpdate } from '../game-state/puzzle-system.ts';

/**
 * Locomotion scale while something is held (ARCH §15: the Manipulation context is
 * a *slow strafe*). One number, owned by the composition that knows both systems.
 */
const MANIPULATION_MOVE_SCALE = 0.55;

export interface WorldSystems {
  readonly input: InputSystem;
  readonly player: PlayerController;
  readonly camera: CameraRig;
  /** Optional from M2 onward (targeting); absent keeps Phase-2 wiring intact. */
  readonly interaction?: InteractionSystem | undefined;
  /** Optional from M3 onward (grab/carry/rotate/release). */
  readonly manipulation?: ManipulationSystem | undefined;
  /** Optional from M4 onward (socket candidates + attach). */
  readonly snap?: SnapSystem | undefined;
  /** Optional from M4 onward: the L1 attachment graph (dirty-driven recompute). */
  readonly graph?: MachineGraph | undefined;
  /**
   * Optional from M6 onward: the puzzle SMs + completion latches (§25). M8 made
   * this a list — a branch ships several puzzles, and each is stepped independently
   * (they share the one machine graph, which is the whole point of §23).
   */
  readonly puzzles?: ReadonlyArray<PuzzleSystem> | undefined;
  /** Optional from M6 onward: the deterministic feedback model (§32.1). */
  readonly feedback?: FeedbackModel | undefined;
  /**
   * Optional from ADR-018 onward: the staged action log, as a cheap change token. A
   * staged requirement can change outcome with no structural change at all, so puzzle
   * evaluation has to be driven by *both* inputs. The world never reads the log itself;
   * it only watches the version move (§35.3).
   */
  readonly stagedVersion?: (() => number) | undefined;
}

export interface WorldStepResult {
  readonly actions: ActionState;
  readonly player: PlayerDynamicState;
  readonly camera: CameraPoseState;
  readonly cameraYaw: number;
  /** Focus edge event for this step, or null (M2+). */
  readonly focus: FocusChanged | null;
  /** Manipulation state after this step, or null when absent (M3+). */
  readonly manipulation: ManipulationStepResult | null;
  /** Snap candidate after this step, or null (M4+). */
  readonly snap: SnapCandidateView | null;
  /** Structural machine change consumed this step, or null (M4+). */
  readonly machine: MachineChanged | null;
  /** Puzzle evaluations after this step (one per composed puzzle; M6/M8). */
  readonly puzzles: ReadonlyArray<PuzzleUpdate>;
  /** Feedback intents this step produced, or null when no model is composed (M6+). */
  readonly feedback: ReadonlyArray<FeedbackIntent> | null;
}

export interface WorldConfig {
  /** Seconds of zero look input before the camera recentres behind the player. */
  readonly lookIdleEpsilon?: number | undefined;
}

export class PhaseWorld {
  private readonly systems: WorldSystems;
  private lookIdleTime = 0;
  private manipulationContextActive = false;
  /** Last staged-log version seen (ADR-018): a move means "an action happened". */
  private stagedVersion = 0;
  /** Last attached-ness published to the interaction layer, per carryable (M6). */
  private readonly attachedState = new Map<string, boolean>();
  /** Last free/occupied state published to the interaction layer, per socket (M6). */
  private readonly socketFreeState = new Map<string, boolean>();

  constructor(systems: WorldSystems) {
    this.systems = systems;
  }

  get input(): InputSystem {
    return this.systems.input;
  }

  get player(): PlayerController {
    return this.systems.player;
  }

  get camera(): CameraRig {
    return this.systems.camera;
  }

  get interaction(): InteractionSystem | null {
    return this.systems.interaction ?? null;
  }

  get manipulation(): ManipulationSystem | null {
    return this.systems.manipulation ?? null;
  }

  get snap(): SnapSystem | null {
    return this.systems.snap ?? null;
  }

  get puzzles(): ReadonlyArray<PuzzleSystem> {
    return this.systems.puzzles ?? [];
  }

  get feedback(): FeedbackModel | null {
    return this.systems.feedback ?? null;
  }

  get graph(): MachineGraph | null {
    return this.systems.graph ?? null;
  }

  /**
   * One fixed step, in ARCH §14 order: input sampled -> player moved -> camera
   * solved -> focus resolved -> manipulation ticked. Returns the authoritative
   * snapshot of every system.
   */
  step(dt: number, raw: RawInputSample): WorldStepResult {
    // Contexts are exclusive (ARCH §19), so the input context follows the
    // manipulation state. Applied *before* sampling, so this step's action set is
    // already the right one — at most one step of latency, fully deterministic.
    const holding = this.systems.manipulation?.isHolding ?? false;
    if (holding !== this.manipulationContextActive) {
      this.manipulationContextActive = holding;
      this.systems.input.setContext(holding ? 'Manipulation' : 'Exploration');
    }

    const actions = this.systems.input.sample(raw);

    const player = this.systems.player.step(dt, {
      moveX: actions.moveX,
      moveZ: actions.moveZ,
      run: actions.run,
      cameraYaw: this.systems.camera.currentYaw,
      speedScale: holding ? MANIPULATION_MOVE_SCALE : 1
    });

    const lookActive = actions.lookDeltaX !== 0 || actions.lookDeltaY !== 0;
    this.lookIdleTime = lookActive ? 0 : this.lookIdleTime + dt;

    const camera = this.systems.camera.step(dt, {
      lookDeltaX: actions.lookDeltaX,
      lookDeltaY: actions.lookDeltaY,
      player: { position: player.position, facingYaw: player.facingYaw },
      // Manipulation framing (ARCH §17): eased by the rig, never snapped.
      mode: holding ? 'manipulation' : 'follow',
      idleTime: this.lookIdleTime,
      playerMoving: Math.hypot(player.velocity.x, player.velocity.z) > 0.4
    });

    // Interaction runs next: it consumes the solved camera pose (ARCH §14 order).
    const interaction = this.systems.interaction;
    const focus =
      interaction?.update({ eye: camera.eye, target: camera.target, anchor: player.position }) ?? null;
    const focusTarget = interaction?.focus ?? null;

    // Manipulation last: it owns held-object state and the SM (ARCH §14 step 5).
    const manipulation =
      this.systems.manipulation?.step(dt, {
        focus: focusTarget,
        actions,
        player: {
          position: player.position,
          facingYaw: player.facingYaw,
          cameraYaw: this.systems.camera.currentYaw
        }
      }) ?? null;

    // The interaction context follows the *resulting* hold state: the same ray
    // filters differently per context (ARCH §18), and the carried object is out of
    // the picture while it is in the player's hands.
    if (interaction && manipulation) {
      const nextContext = manipulation.heldId !== null ? 'Manipulation' : 'Exploration';
      if (interaction.activeContext !== nextContext) interaction.setContext(nextContext);
    }

    // Snap (ARCH §14 step 6): candidate detection, ranking and assist. It reads the
    // pose the SM just produced, so the SM acts on this candidate next step.
    const snap = this.systems.snap ?? null;
    const heldId = manipulation?.heldId ?? null;
    const snapCandidate =
      snap === null
        ? null
        : snap.update({
            heldId,
            heldPose: heldId === null ? null : this.systems.manipulation?.currentPose ?? null
          });

    // Machine graph (ARCH §14 step 7): dirty-driven, never per-frame work.
    const machine = this.systems.graph?.recomputeIfDirty() ?? null;

    // Puzzle validation (ARCH §14 step 8, §25): each puzzle is evaluated when the
    // graph changed, when the staged action log moved (ADR-018 — a staged action
    // changes requirement outcomes with no structural change), or while its
    // stable-frame window is open — never as unconditional per-frame work. Every
    // puzzle reads the same authoritative graph plus the staged-input delta.
    const stagedVersion = this.systems.stagedVersion?.() ?? 0;
    const stagedChanged = stagedVersion !== this.stagedVersion;
    this.stagedVersion = stagedVersion;
    const puzzles = (this.systems.puzzles ?? []).map((puzzle) => puzzle.update(machine !== null || stagedChanged));

    // Feedback (ARCH §32.1): the L2 model decides *what* is warranted from this
    // step's edges. Its intents leave in the step result; the L4 composer (a
    // consumer outside this file) decides how they look.
    const feedback = this.systems.feedback?.step({ manipulation, machine, puzzles }) ?? null;

    this.syncAttachments();

    return {
      actions,
      player,
      camera,
      cameraYaw: this.systems.camera.currentYaw,
      focus,
      manipulation,
      snap: snapCandidate,
      machine,
      puzzles,
      feedback
    };
  }

  /**
   * Keep the interaction layer's description of every carryable in step with the
   * graph (ARCH §18: kind and verb are authored *data*, but attachment is LMG
   * truth, so the derived description is composed here, in the world).
   *
   * M4 could only *disable* a docked component, because the detach path did not
   * exist yet. M6 flips it to the `attached` kind instead: it stays focusable, and
   * focusing it is exactly how the `DetachPrompt` row of §19 is reached.
   */
  private syncAttachments(): void {
    const snap = this.systems.snap;
    const interaction = this.systems.interaction;
    const manipulation = this.systems.manipulation;
    if (!snap || !interaction || !manipulation) return;

    for (const id of manipulation.carryableIds) {
      const attached = snap.attachedPose(id) !== null;
      if (attached === this.attachedState.get(id)) continue;
      this.attachedState.set(id, attached);
      interaction.setKind(id, attached ? 'attached' : 'loose', attached ? 'Remove' : 'Grab');
      // The focused target just changed meaning: drop focus so the next step
      // re-acquires it with the new kind and verb, never a stale prompt.
      interaction.reset();
    }

    // An occupied socket is no longer an insertion target. §18 ranks socket previews
    // above attached components precisely so a free socket can win a ray; leaving an
    // occupied one focusable would let its stale "Insert" prompt out-rank the part
    // sitting in it and hide the §19 detach affordance.
    for (const socketId of snap.socketIds) {
      const free = !snap.isSocketOccupied(socketId);
      if (free === this.socketFreeState.get(socketId)) continue;
      this.socketFreeState.set(socketId, free);
      interaction.setEnabled(socketId, free);
      interaction.reset();
    }
  }

  /**
   * Direct input-state clear (blur / visibility loss). The manipulation layer is
   * suspended too: a held object is released at its last valid pose and play
   * resumes in Exploration (EC-BRN-05), never mid-hold with stale latches.
   */
  clearInput(): void {
    this.systems.manipulation?.suspend();
    this.manipulationContextActive = false;
    // Both the input and interaction contexts return to Exploration: play resumes
    // in the base context with no held object and no stale one-shot latches.
    this.systems.interaction?.setContext('Exploration');
    this.systems.input.setContext('Exploration');
    this.systems.input.clearSnapshot();
  }
}
