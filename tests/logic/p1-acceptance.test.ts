import { describe, expect, it } from 'vitest';

import { KinematicPhysics } from '../../src/adapters/kinematic-physics.ts';
import { vec3, type Vec3 } from '../../src/core/vec3.ts';
import { CameraRig, DEFAULT_CAMERA_TUNING } from '../../src/gameplay/camera-rig.ts';
import { InputSystem, neutralSample } from '../../src/gameplay/input-system.ts';
import { PhaseWorld, type WorldStepResult } from '../../src/gameplay/phase-world.ts';
import { PlayerController } from '../../src/gameplay/player-controller.ts';
import { InteractionSystem } from '../../src/gameplay/interaction-system.ts';
import { ManipulationSystem } from '../../src/gameplay/manipulation-system.ts';
import { SnapSystem, type ResolvedSocket } from '../../src/gameplay/snap-system.ts';
import { FeedbackModel } from '../../src/gameplay/feedback-model.ts';
import { MachineGraph } from '../../src/game-state/machine-graph.ts';
import { PuzzleSystem } from '../../src/game-state/puzzle-system.ts';
import type { Pose } from '../../src/game-state/component-model.ts';
import { FeedbackComposer, type FeedbackView } from '../../src/presentation/feedback-composer.ts';
import { MACHINE_DEFINITIONS } from '../../src/data/machines.ts';
import { P1_PUZZLE, PUZZLE_DEFINITIONS } from '../../src/data/puzzles/index.ts';
import { socketDefinitionOf } from '../../src/data/sockets.ts';
import {
  P1_CARRYABLES,
  P1_INITIAL_ATTACHMENTS,
  P1_INTERACTABLES,
  P1_SOCKETS,
  P1_WORLD,
  p1AnchorPose
} from '../../src/levels/branch-a.ts';
import { LAB_WORLD } from '../../src/levels/lab-world.ts';
import type { RawInputSample } from '../../src/ports/input-port.ts';
import { p1Content } from './support/p1-mesh.ts';
import { RecordingAudioPort } from './support/recording-audio-port.ts';
import { RecordingRenderPort } from './support/recording-render-port.ts';

/**
 * P1 ACCEPTANCE (ARCH §41 M6) — the whole chain, through the shipped content:
 * grab → carry → snap → validate → activate → feedback, plus the two things that
 * make it a *puzzle* rather than a switch: a part that fits but cannot bridge, and
 * a detach path that lets the player take it back out.
 *
 * The harness is assembled exactly the way `main.ts` assembles the game (content
 * from `data/`, placement from `levels/`, systems in the ARCH §14 order), and the
 * fixed step drives the L4 composer too, so "feedback" is asserted where the player
 * would see it — not only as an intent.
 */

const DT = 1 / 30;
const MESH_SOCKET_ID = 'socket-mesh';
const GEAR_HOME = p1AnchorPose('anchor/p1-gear').center;
const PLATE_HOME = p1AnchorPose('anchor/p1-plate').center;

interface Harness {
  readonly world: PhaseWorld;
  readonly interaction: InteractionSystem;
  readonly manipulation: ManipulationSystem;
  readonly snap: SnapSystem;
  readonly graph: MachineGraph;
  readonly puzzle: PuzzleSystem;
  readonly composer: FeedbackComposer;
  readonly render: RecordingRenderPort;
  readonly audio: RecordingAudioPort;
}

function buildP1World(): Harness {
  const physics = new KinematicPhysics();
  physics.setStaticColliders([...LAB_WORLD.colliders, ...P1_WORLD.colliders]);

  const content = p1Content();
  const graph = new MachineGraph();
  graph.configure(content);
  graph.reset([...P1_INITIAL_ATTACHMENTS]);
  graph.recomputeIfDirty();

  const resolvedSockets: ResolvedSocket[] = [];
  for (const instance of P1_SOCKETS) {
    const definition = socketDefinitionOf(instance.defId);
    if (definition) resolvedSockets.push({ instance, definition });
  }

  const interaction = new InteractionSystem(physics, P1_INTERACTABLES);
  const carryables = [...P1_CARRYABLES];
  const snap = new SnapSystem(
    physics,
    graph,
    carryables.map((binding) => ({ instanceId: binding.instanceId, definition: binding.definition })),
    resolvedSockets
  );
  const manipulation = new ManipulationSystem(physics, carryables, interaction, snap);
  const puzzle = new PuzzleSystem(P1_PUZZLE, graph, content);
  const feedback = new FeedbackModel();
  const render = new RecordingRenderPort();
  // Both presentation ports, exactly as `main.ts` composes them: one intent stream,
  // a pulse for the eye and a cue for the ear (§32.1).
  const audio = new RecordingAudioPort();
  const composer = new FeedbackComposer(render, {}, audio);

  const world = new PhaseWorld({
    input: new InputSystem(),
    player: new PlayerController(
      physics,
      vec3(LAB_WORLD.spawn.x, LAB_WORLD.spawn.y, LAB_WORLD.spawn.z)
    ),
    camera: new CameraRig(physics),
    interaction,
    manipulation,
    snap,
    graph,
    // M8: the world takes the level's puzzle set. This harness composes P1 alone,
    // which still exercises the plural path (`result.puzzles[0]`).
    puzzles: [puzzle],
    feedback
  });
  return { world, interaction, manipulation, snap, graph, puzzle, composer, render, audio };
}

/**
 * The read-only view the composer reads, built the way `main.ts` builds it (the
 * composition root is the only place that knows sockets, graph and snap together).
 */
function feedbackView(harness: Harness): FeedbackView {
  const socketMachines = new Map<string, string>();
  for (const instance of P1_SOCKETS) {
    const definition = socketDefinitionOf(instance.defId);
    if (definition) socketMachines.set(instance.id, definition.machineId);
  }
  const poseOf = (componentId: string): Pose | null =>
    harness.snap.attachedPose(componentId) ??
    harness.manipulation.snapshots().find((snapshot) => snapshot.id === componentId) ??
    null;

  const machineAnchorOf = (machineId: string): Vec3 | null => {
    const machine = MACHINE_DEFINITIONS.find((definition) => definition.id === machineId);
    const root = machine?.rootNodes[0];
    if (!root || root.kind !== 'component') return null;
    return poseOf(root.id)?.center ?? null;
  };

  return {
    carryables: () => harness.manipulation.snapshots(),
    poseOf,
    attachedPoseOf: (componentId) => harness.snap.attachedPose(componentId),
    machineOf: (componentId) => {
      const socketId = harness.graph.attachmentOf(componentId);
      return socketId === null ? null : socketMachines.get(socketId) ?? null;
    },
    machineStateOf: (machineId) => harness.graph.machineState(machineId),
    puzzleAnchorOf: (puzzleId) => {
      const puzzle = PUZZLE_DEFINITIONS.find((definition) => definition.id === puzzleId);
      const activation = puzzle?.activation;
      if (!activation || activation.kind !== 'machineRunning') return null;
      return machineAnchorOf(activation.machineId);
    },
    machineAnchorOf
  };
}

/** One fixed step the way `main.ts` drives it: world first, then L4 composition. */
function step(harness: Harness, sample: RawInputSample = neutralSample()): WorldStepResult {
  const result = harness.world.step(DT, sample);
  harness.composer.update(DT, result.feedback ?? [], feedbackView(harness));
  harness.composer.present();
  return result;
}

/** Feedback kinds produced by one step (the composer consumes the same array). */
function intentsOf(result: WorldStepResult): string[] {
  return (result.feedback ?? []).map((intent) => intent.kind);
}

function held(...keys: string[]): RawInputSample {
  return neutralSample({ held: new Set(keys) });
}

function wrapToPi(angle: number): number {
  const twoPi = Math.PI * 2;
  let wrapped = angle % twoPi;
  if (wrapped > Math.PI) wrapped -= twoPi;
  if (wrapped < -Math.PI) wrapped += twoPi;
  return wrapped;
}

/** Turn the rig to a yaw using the rig's own published sensitivity. */
function faceTowards(harness: Harness, targetYaw: number): void {
  const perPixel = DEFAULT_CAMERA_TUNING.yawSpeed * DT;
  for (let i = 0; i < 60; i += 1) {
    const error = wrapToPi(targetYaw - harness.world.camera.currentYaw);
    if (Math.abs(error) < 0.01) return;
    step(harness, neutralSample({ lookDeltaX: Math.max(-120, Math.min(120, -error / perPixel)) }));
  }
}

/** Walk to a floor position, turning toward it as we go. Throws if we stall. */
function walkTo(harness: Harness, target: { readonly x: number; readonly z: number }): void {
  const remaining = (): number => {
    const position = harness.world.player.snapshot().position;
    return Math.hypot(target.x - position.x, target.z - position.z);
  };
  if (remaining() < 0.25) return;

  const start = harness.world.player.snapshot().position;
  const dx = target.x - start.x;
  const dz = target.z - start.z;
  faceTowards(harness, Math.atan2(-dx, -dz));
  for (let i = 0; i < 220; i += 1) {
    step(harness, held('KeyW'));
    if (remaining() < 0.3) return;
  }
  throw new Error('walkTo did not arrive');
}

/**
 * Aim the rig's optical axis at a world point. Yaw is driven exactly (the tuning is
 * published); pitch has no published state, so the axis' vertical miss is measured at
 * the target's horizontal distance, converted to an angle, and applied through
 * `pitchSpeed` in one step. The miss is re-measured every step and the input sign is
 * calibrated on the first step, so the helper converges without assuming a sign
 * convention — and it fails loudly (no focus) when the target is under the rig's
 * pitch clamp, instead of silently aiming somewhere else.
 */
function aimAt(harness: Harness, point: { readonly x: number; readonly y: number; readonly z: number }): void {
  const anchor = harness.world.player.snapshot().position;
  faceTowards(harness, Math.atan2(-(point.x - anchor.x), -(point.z - anchor.z)));

  const miss = (): { angle: number; distance: number } => {
    const pose = harness.world.camera.snapshot();
    const horizontal = Math.hypot(pose.target.x - pose.eye.x, pose.target.z - pose.eye.z) || 1;
    const slope = (pose.target.y - pose.eye.y) / horizontal;
    const distance = Math.hypot(point.x - pose.eye.x, point.z - pose.eye.z);
    const axisY = pose.eye.y + slope * distance;
    return { angle: Math.atan2(point.y - axisY, distance), distance };
  };

  const perPixel = DEFAULT_CAMERA_TUNING.pitchSpeed * DT;
  let direction = 1;
  let current = miss();
  for (let i = 0; i < 30; i += 1) {
    if (Math.abs(current.angle) < 0.01) return;
    const pixels = Math.max(-120, Math.min(120, (direction * current.angle) / perPixel));
    step(harness, neutralSample({ lookDeltaY: pixels }));
    const next = miss();
    if (Math.abs(next.angle) > Math.abs(current.angle) + 1e-9) direction = -direction;
    current = next;
  }
}

/** Step until a component becomes the focused target. */
function focusOn(harness: Harness, id: string, maxSteps = 60): boolean {
  for (let i = 0; i < maxSteps; i += 1) {
    step(harness);
    if (harness.interaction.focus?.id === id) return true;
  }
  return false;
}

/** Where a carryable actually is right now (its live pose, not its spawn anchor). */
function livePose(
  harness: Harness,
  id: string
): { readonly x: number; readonly y: number; readonly z: number } | null {
  return harness.manipulation.snapshots().find((snapshot) => snapshot.id === id)?.center ?? null;
}

/** Stand off a part on a chosen side, aim at it and focus it. */
function focusPart(
  harness: Harness,
  id: string,
  fallback: { readonly x: number; readonly y: number; readonly z: number },
  standOff: number,
  approach: 'south' | 'east' = 'south'
): boolean {
  const pose = livePose(harness, id) ?? fallback;
  // Floor parts are approached from +Z; the machine's mounts are approached from +X,
  // which is the side the frame is open on.
  const stand =
    approach === 'south' ? { x: pose.x, z: pose.z + standOff } : { x: pose.x + standOff, z: pose.z };
  walkTo(harness, stand);
  // Aim, let the rig arrive, and check the focus *after* it has. `aimAt` converges the
  // angle against the live pose, but the eye keeps gliding toward its desired orbit
  // position, so a pose solved mid-glide can slide off a thin part before the key press
  // lands. Each retry re-aims against the arrived pose — exactly what a player does:
  // walk in, look, adjust, then press.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    aimAt(harness, livePose(harness, id) ?? pose);
    if (!focusOn(harness, id, 12)) continue;
    for (let i = 0; i < 12; i += 1) step(harness);
    if (harness.interaction.focus?.id === id) return true;
  }
  return focusOn(harness, id);
}

/**
 * Focus and pick up a loose part lying on the floor.
 *
 * The stand-off matters and cannot be arbitrary: the rig's optical axis always passes
 * through the player's torso, its default pose now sits ~1.3 m ABOVE that anchor (the
 * third-person framing), and its pitch is clamped (~63° down / ~31° up), so the ray
 * meets the floor a short way ahead of the eye. A part only a few centimetres thick is
 * therefore in the ray from a narrow band of distances — the search covers that band,
 * which is exactly what a player does by walking in and out while looking down.
 */
function fetchPart(
  harness: Harness,
  id: string,
  home: { readonly x: number; readonly y: number; readonly z: number }
): void {
  for (const standOff of [2.2, 2.0, 2.4, 1.9]) {
    if (!focusPart(harness, id, home, standOff)) continue;
    step(harness, neutralSample({ pressed: new Set(['KeyE']) }));
    step(harness);
    expect(harness.manipulation.heldId).toBe(id);
    return;
  }
  throw new Error(`could not focus ${id} from any stand-off`);
}

/** Stand in front of the machine and seat whatever is held in the mesh socket. */
function seatInMeshSocket(harness: Harness): WorldStepResult {
  walkTo(harness, { x: -6.5, z: 0 });
  faceTowards(harness, Math.PI / 2);

  for (let i = 0; i < 30; i += 1) {
    step(harness, held('KeyW'));
    if (harness.snap.candidate !== null) break;
  }
  // The SM consumes the candidate on the step *after* the snap layer publishes it
  // (ARCH §14 order: manipulation 5 runs before snap 6), so one more step lands the
  // player in `SnapPreview` before the confirm.
  step(harness);
  expect(harness.snap.candidate?.socketId).toBe(MESH_SOCKET_ID);
  expect(harness.manipulation.state).toBe('SnapPreview');
  return step(harness, neutralSample({ primaryPressed: true }));
}

/** Steps of idle time, collecting what the puzzle reported and what feedback fired. */
function settle(
  harness: Harness,
  steps: number
): { stages: string[]; kinds: string[]; sets: number } {
  const stages: string[] = [];
  const kinds: string[] = [];
  let sets = 0;
  for (let i = 0; i < steps; i += 1) {
    const result = step(harness);
    stages.push(result.puzzles[0]?.state ?? '-');
    kinds.push(...intentsOf(result));
    sets += (result.feedback ?? []).filter((intent) => intent.kind === 'puzzle-completed').length;
  }
  return { stages, kinds, sets };
}

/** The authored mesh-socket placement (one source: `levels/branch-a.ts`). */
function meshSocket(): { readonly pose: { readonly center: { x: number; y: number; z: number } } } {
  const socket = P1_SOCKETS.find((instance) => instance.id === MESH_SOCKET_ID);
  if (!socket) throw new Error('the P1 mesh socket is missing from the level');
  return socket;
}

describe('P1 acceptance — the shipped first puzzle, end to end (ARCH §41 M6)', () => {
  it('opens with both shafts mounted, the mesh empty and the puzzle in progress', () => {
    const harness = buildP1World();

    expect(harness.graph.attachments).toEqual(P1_INITIAL_ATTACHMENTS);
    expect(harness.graph.machineState('P1-mesh')?.state).not.toBe('running');
    expect(harness.puzzle.state).toBe('InProgress');

    // The opening objective: the world composes the puzzle on frame one, so the
    // failing requirements are published before the player touches anything.
    step(harness);
    expect(harness.puzzle.reasonCodes).toEqual(['p1/drive-through-gear', 'p1/output-turning']);
  });

  it('carries the gear in, runs the machine, completes once and shows the feedback', () => {
    const harness = buildP1World();

    // Route around the lab's step blocks to the loose gear, then pick it up.
    walkTo(harness, { x: -6.4, z: -2.8 });
    fetchPart(harness, 'gear-a', GEAR_HOME);

    // Seat it: the preview appears, and the confirm writes exactly one graph edge.
    const confirmed = seatInMeshSocket(harness);
    expect(harness.graph.attachmentOf('gear-a')).toBe(MESH_SOCKET_ID);
    expect(harness.manipulation.heldId).toBeNull();
    expect(intentsOf(confirmed)).toContain('attach-confirmed');

    // The socket pose is canonical (§21.3), so the player's hold pose is absorbed.
    expect(harness.manipulation.currentPose.center).toEqual(meshSocket().pose.center);

    // §32.3 layer 2 reaches audio too, positioned at the seated part (§32.2) — the same
    // intent that pulsed the socket.
    expect(harness.audio.cues).toContain('attach-click');
    expect(
      harness.audio.requests.find((request) => request.cue === 'attach-click')?.emitter
    ).toEqual(meshSocket().pose.center);

    // The machine really propagates — that is the puzzle's activation confirmation.
    expect(confirmed.machine?.machines[0]?.state).toBe('running');
    expect(intentsOf(confirmed)).toContain('machine-running');

    // The structure is satisfied but *not yet confirmed* on that first step: §25's
    // stable-frame window is what separates "it is built" from "it is running".
    expect(confirmed.puzzles[0]?.state).toBe('Assembled');
    expect(confirmed.puzzles[0]?.streak).toBe(1);

    // Feedback layer 4 (§32.3): the mounted gear turns because the machine runs.
    step(harness);
    const spinning = harness.render.carryable('gear-a');
    expect(spinning?.attached).toBe(true);
    expect(spinning?.spinAngle ?? 0).toBeGreaterThan(0);

    // The window closes: one completion, and the celebration reaches presentation.
    const settled = settle(harness, 6);
    expect(settled.stages).toContain('Complete');
    expect(settled.sets).toBe(1);
    expect(settled.kinds).toContain('puzzle-completed');
    expect(harness.puzzle.state).toBe('Complete');
    expect(harness.render.pulses.some((pulse) => pulse?.kind === 'complete')).toBe(true);
    // …and the completion recipe is the heaviest cue, at the machine's own anchor.
    expect(harness.audio.cues).toContain('completion');
    expect(
      harness.audio.requests.find((request) => request.cue === 'completion')?.emitter
    ).not.toBeNull();
  });

  it('lets a part that fits but cannot bridge fail — and lets the player swap it out', () => {
    const harness = buildP1World();

    walkTo(harness, { x: -6.4, z: -2.8 });
    fetchPart(harness, 'plate-a', PLATE_HOME);

    // The mesh socket *accepts* plates, so the attach succeeds — and the machine still
    // never runs: fitting is not conducting (§21.4, "snapping never decides completion").
    const confirmed = seatInMeshSocket(harness);
    expect(harness.graph.attachmentOf('plate-a')).toBe(MESH_SOCKET_ID);
    expect(intentsOf(confirmed)).toContain('attach-confirmed');
    expect(confirmed.machine?.machines[0]?.state).not.toBe('running');
    expect(confirmed.puzzles[0]?.state).toBe('InProgress');

    const settled = settle(harness, 6);
    expect(settled.stages).not.toContain('Complete');
    expect(settled.sets).toBe(0);
    expect(harness.puzzle.state).toBe('InProgress');
    expect(harness.puzzle.reasonCodes).toContain('p1/drive-through-gear');

    // The wrong part is removable: it is the `Remove` target now, and the detach key
    // takes it back out without touching anything else. (The mount is near torso height
    // and the eye now rides ~1.3 m above the anchor, so the stance is a *look-out* one;
    // the helper searches stand-offs because the useful band is rig geometry, not taste.)
    const reachable = [1.5, 2.4, 3.2, 4.0].some((standOff) =>
      focusPart(harness, 'plate-a', PLATE_HOME, standOff, 'east')
    );
    expect(reachable).toBe(true);
    expect(harness.interaction.focus?.kind).toBe('attached');
    step(harness, neutralSample({ primaryPressed: true }));
    const detached = step(harness, neutralSample({ pressed: new Set(['KeyR']) }));

    expect(intentsOf(detached)).toContain('detach-confirmed');
    expect(harness.graph.attachmentOf('plate-a')).toBeNull();
    expect(harness.graph.attachmentCount).toBe(P1_INITIAL_ATTACHMENTS.length);
    expect(harness.puzzle.state).toBe('InProgress');

    // The retry works: a wrong attempt poisons nothing, and the gear finishes it.
    walkTo(harness, { x: -6.4, z: -2.8 });
    fetchPart(harness, 'gear-a', GEAR_HOME);
    seatInMeshSocket(harness);
    const retry = settle(harness, 6);

    expect(retry.sets).toBe(1);
    expect(harness.puzzle.state).toBe('Complete');
  });
});
