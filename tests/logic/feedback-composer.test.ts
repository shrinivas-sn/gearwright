import { describe, expect, it } from 'vitest';

import { FeedbackComposer, type FeedbackView } from '../../src/presentation/feedback-composer.ts';
import type { CarryableSnapshot } from '../../src/gameplay/manipulation-system.ts';
import type { Pose, SpinDirection } from '../../src/game-state/component-model.ts';
import type { MachineDerivedState } from '../../src/game-state/machine-graph.ts';
import type { Vec3 } from '../../src/core/vec3.ts';
import type { CarryableRenderState } from '../../src/ports/render-port.ts';
import type { AudioCueId } from '../../src/ports/audio-port.ts';
import type { FeedbackIntent } from '../../src/gameplay/feedback-model.ts';
import { SilentAudioBus } from '../../src/adapters/web-audio-bus.ts';
import { RecordingAudioPort } from './support/recording-audio-port.ts';
import { RecordingRenderPort } from './support/recording-render-port.ts';

/**
 * TEST §9/§6 — the L4 feedback composer (ARCH §32.1). It is engine-free by design,
 * so its whole contract is testable headlessly: what pulses appear, where, and when
 * mounted parts are allowed to move (only while the machine propagates).
 */

const DT = 1 / 30;


interface FakeWorld {
  readonly snapshots: CarryableSnapshot[];
  readonly attached: Map<string, Pose>;
  readonly machineState: MachineDerivedState['state'];
  readonly spin: SpinDirection | null;
  readonly anchors: Map<string, Vec3>;
  readonly machineAnchors: Map<string, Vec3>;
}

function makeWorld(
  options: {
    machineState?: MachineDerivedState['state'];
    spin?: SpinDirection | null;
    attached?: boolean;
  } = {}
): FakeWorld {
  const attached = options.attached ?? true;
  return {
    snapshots: [
      {
        id: 'gear-a',
        center: { x: -6.2, y: 0.07, z: 1.5 },
        yaw: 0,
        halfExtents: { x: 0.3, y: 0.07, z: 0.3 },
        held: !attached,
        blocked: false
      }
    ],
    attached: attached ? new Map([['gear-a', { center: { x: -8, y: 1.2, z: 0 }, yaw: 0 }]]) : new Map(),
    machineState: options.machineState ?? 'running',
    spin: options.spin === undefined ? 'cw' : options.spin,
    anchors: new Map([['P1', { x: -8, y: 1.2, z: 0 }]]),
    machineAnchors: new Map([['P1-mesh', { x: -8, y: 1.2, z: 0 }]])
  };
}

function viewOf(world: FakeWorld): FeedbackView {
  return {
    carryables: () => world.snapshots,
    poseOf: (componentId) =>
      world.attached.get(componentId) ?? world.snapshots.find((s) => s.id === componentId) ?? null,
    attachedPoseOf: (componentId) => world.attached.get(componentId) ?? null,
    machineOf: (componentId) => (componentId === 'gear-a' ? 'P1-mesh' : null),
    machineStateOf: (machineId) => ({
      machineId,
      state: world.machineState,
      outputs: [{ nodeId: 'component:shaft-b', kind: 'rotation', value: 1, spin: world.spin }],
      nodeStates: [],
      warnings: []
    }),
    puzzleAnchorOf: (puzzleId) => world.anchors.get(puzzleId) ?? null,
    machineAnchorOf: (machineId) => world.machineAnchors.get(machineId) ?? null
  };
}

function stateOf(render: RecordingRenderPort, id: string): CarryableRenderState {
  const state = render.carryables.find((entry) => entry.id === id);
  if (!state) throw new Error(`no carryable presented for ${id}`);
  return state;
}

describe('FeedbackComposer — pulses (§32.3) and machine motion (§32.3 layer 4)', () => {
  it('pulses at the part when an attach is confirmed, then fades out', () => {
    const render = new RecordingRenderPort();
    const composer = new FeedbackComposer(render, { pulseSeconds: 1, spinRate: 4 });
    const view = viewOf(makeWorld());

    composer.update(DT, [{ kind: 'attach-confirmed', componentId: 'gear-a' }], view);
    composer.present();
    const first = render.pulses.at(-1);
    expect(first?.kind).toBe('attach');
    expect(first?.point).toEqual({ x: -8, y: 1.2, z: 0 });
    expect(first?.strength).toBeGreaterThan(0.9);

    composer.update(0.5, [], view);
    composer.present();
    const mid = render.pulses.at(-1);
    expect(mid?.strength).toBeGreaterThan(0);
    expect(mid?.strength).toBeLessThan(first?.strength ?? 0);

    composer.update(0.6, [], view);
    composer.present();
    expect(render.pulses.at(-1)).toBeNull();
  });

  it('pulses detach and completion where they belong, and skips an unknown anchor', () => {
    const render = new RecordingRenderPort();
    const composer = new FeedbackComposer(render, { pulseSeconds: 1 });

    composer.update(DT, [{ kind: 'detach-confirmed', componentId: 'gear-a' }], viewOf(makeWorld()));
    composer.present();
    expect(render.pulses.at(-1)).toMatchObject({ kind: 'detach' });

    composer.update(
      DT,
      [{ kind: 'puzzle-completed', puzzleId: 'P1', milestoneId: 'milestone/p1-first-mesh' }],
      viewOf(makeWorld())
    );
    composer.present();
    expect(render.pulses.at(-1)).toMatchObject({
      kind: 'complete',
      point: { x: -8, y: 1.2, z: 0 }
    });

    // A puzzle with no resolvable anchor produces no pulse at all — never a crash.
    const orphanRender = new RecordingRenderPort();
    const orphan = new FeedbackComposer(orphanRender, { pulseSeconds: 1 });
    orphan.update(
      DT,
      [{ kind: 'puzzle-completed', puzzleId: 'P9', milestoneId: 'milestone/unknown' }],
      viewOf(makeWorld())
    );
    orphan.present();
    expect(orphanRender.pulses.at(-1)).toBeNull();
  });

  it('presents an attached part at its canonical socket pose', () => {
    const render = new RecordingRenderPort();
    const composer = new FeedbackComposer(render);
    const view = viewOf(makeWorld());

    composer.update(DT, [], view);
    composer.present();

    const gear = stateOf(render, 'gear-a');
    expect(gear.center).toEqual({ x: -8, y: 1.2, z: 0 });
    expect(gear.halfExtents).toEqual({ x: 0.3, y: 0.07, z: 0.3 });
    expect(gear.attached).toBe(true);
    expect(gear.held).toBe(false);

    // A loose part is presented where the SM has it, with no spin at all.
    const loose = new FeedbackComposer(render);
    loose.update(DT, [], viewOf(makeWorld({ attached: false })));
    loose.present();
    const held = stateOf(render, 'gear-a');
    expect(held.center).toEqual({ x: -6.2, y: 0.07, z: 1.5 });
    expect(held.attached).toBe(false);
    expect(held.spinAngle).toBe(0);
  });

  it('advances mounted parts only while the machine actually propagates', () => {
    const render = new RecordingRenderPort();
    const composer = new FeedbackComposer(render, { spinRate: 4 });
    const running = makeWorld({ machineState: 'running' });

    composer.update(0.1, [], viewOf(running));
    composer.present();
    expect(stateOf(render, 'gear-a').spinAngle).toBeCloseTo(0.4, 6);

    composer.update(0.1, [], viewOf(running));
    composer.present();
    expect(stateOf(render, 'gear-a').spinAngle).toBeCloseTo(0.8, 6);

    // A reversed output turns the other way.
    composer.update(0.1, [], viewOf(makeWorld({ machineState: 'running', spin: 'ccw' })));
    composer.present();
    expect(stateOf(render, 'gear-a').spinAngle).toBeCloseTo(0.4, 6);

    // A machine that is not running does not move a mounted part at all…
    const idleRender = new RecordingRenderPort();
    const idle = new FeedbackComposer(idleRender, { spinRate: 4 });
    idle.update(0.1, [], viewOf(makeWorld({ machineState: 'powered' })));
    idle.present();
    expect(stateOf(idleRender, 'gear-a').spinAngle).toBe(0);

    // …and one that stops holds its phase instead of rewinding to zero.
    const frozenRender = new RecordingRenderPort();
    const frozen = new FeedbackComposer(frozenRender, { spinRate: 4 });
    frozen.update(0.1, [], viewOf(makeWorld({ machineState: 'running' })));
    frozen.update(0.1, [], viewOf(makeWorld({ machineState: 'idle' })));
    frozen.present();
    expect(stateOf(frozenRender, 'gear-a').spinAngle).toBeCloseTo(0.4, 6);
  });
});

describe('FeedbackComposer — §32.3 cues on the §32.2 buses', () => {
  /** The §32.3 recipe each intent warrants, and where the pulse and cue must land. */
  const CASES: ReadonlyArray<{
    readonly label: string;
    readonly intent: FeedbackIntent;
    readonly cue: AudioCueId;
    readonly emitter: Vec3;
  }> = [
    {
      label: 'attach-confirmed → click',
      intent: { kind: 'attach-confirmed', componentId: 'gear-a' },
      cue: 'attach-click',
      emitter: { x: -8, y: 1.2, z: 0 }
    },
    {
      label: 'attach-refused → refusal',
      intent: { kind: 'attach-refused', componentId: 'gear-a', reason: 'blocked' },
      cue: 'attach-refused',
      emitter: { x: -8, y: 1.2, z: 0 }
    },
    {
      label: 'detach-confirmed → detach',
      intent: { kind: 'detach-confirmed', componentId: 'gear-a' },
      cue: 'detach',
      emitter: { x: -8, y: 1.2, z: 0 }
    },
    {
      label: 'puzzle-completed → completion',
      intent: { kind: 'puzzle-completed', puzzleId: 'P1', milestoneId: 'milestone/p1-first-mesh' },
      cue: 'completion',
      emitter: { x: -8, y: 1.2, z: 0 }
    },
    {
      label: 'machine-running → spin-up',
      intent: { kind: 'machine-running', machineId: 'P1-mesh', spin: 'cw' },
      cue: 'machine-start',
      emitter: { x: -8, y: 1.2, z: 0 }
    },
    {
      label: 'machine-idle → spin-down',
      intent: { kind: 'machine-idle', machineId: 'P1-mesh' },
      cue: 'machine-stop',
      emitter: { x: -8, y: 1.2, z: 0 }
    }
  ];

  it('plays the cue an intent warrants, at the same point as its pulse', () => {
    for (const testCase of CASES) {
      const audio = new RecordingAudioPort();
      const composer = new FeedbackComposer(new RecordingRenderPort(), {}, audio);

      composer.update(DT, [testCase.intent], viewOf(makeWorld()));

      expect(audio.cues, testCase.label).toEqual([testCase.cue]);
      expect(audio.lastRequest?.emitter, testCase.label).toEqual(testCase.emitter);
      expect(composer.lastCue, testCase.label).toBe(testCase.cue);
    }
  });

  it('stays silent for state changes that are read, not staging', () => {
    // §32.3 stages the player's actions and the machine's own edges; a puzzle stage or a
    // changed failure reason is §33's objective line, so it must not beep at the player.
    const audio = new RecordingAudioPort();
    const composer = new FeedbackComposer(new RecordingRenderPort(), {}, audio);

    composer.update(
      DT,
      [
        { kind: 'puzzle-stage', puzzleId: 'P1', state: 'InProgress' },
        { kind: 'objective-changed', puzzleId: 'P1', reasonCode: 'p1/output-spin' }
      ],
      viewOf(makeWorld())
    );

    expect(audio.requests).toEqual([]);
    expect(composer.lastCue).toBeNull();
  });

  it('is audio-optional: the same intents still render with no port, or a silent one', () => {
    // EC-BRN-08's "fully playable silent": absent audio is not a branch at the call site.
    const render = new RecordingRenderPort();
    const without = new FeedbackComposer(render);
    without.update(DT, [{ kind: 'attach-confirmed', componentId: 'gear-a' }], viewOf(makeWorld()));
    without.present();
    expect(render.pulses.at(-1)).toMatchObject({ kind: 'attach' });
    expect(without.lastCue).toBeNull();

    // …and the null object satisfies the same contract without changing the caller.
    const silent = new SilentAudioBus();
    expect(silent.init()).toBe(false);
    expect(silent.state).toBe('unavailable');
    const nulled = new FeedbackComposer(new RecordingRenderPort(), {}, silent);
    nulled.update(
      DT,
      [{ kind: 'puzzle-completed', puzzleId: 'P1', milestoneId: 'milestone/p1-first-mesh' }],
      viewOf(makeWorld())
    );
    // The composer still *chose* the cue; the silent bus simply did nothing with it.
    expect(nulled.lastCue).toBe('completion');
  });

  it('suppresses a repeat of one cue inside the retrigger window (§32.1)', () => {
    const audio = new RecordingAudioPort();
    const composer = new FeedbackComposer(new RecordingRenderPort(), { retriggerSeconds: 0.5 }, audio);
    const view = viewOf(makeWorld());
    const attach: FeedbackIntent = { kind: 'attach-confirmed', componentId: 'gear-a' };

    // A flurry inside one step is one click, not two…
    composer.update(DT, [attach, attach], view);
    expect(audio.cues).toEqual(['attach-click']);

    // …while a *different* cue is unaffected by it (the guard is per cue)…
    composer.update(DT, [attach, { kind: 'detach-confirmed', componentId: 'gear-a' }], view);
    expect(audio.cues).toEqual(['attach-click', 'detach']);

    // …and it stays suppressed while the window is open, then plays again after it.
    composer.update(0.2, [attach], view);
    expect(audio.cues).toEqual(['attach-click', 'detach']);
    composer.update(0.4, [attach], view);
    expect(audio.cues).toEqual(['attach-click', 'detach', 'attach-click']);
  });

  it('degrades an unresolvable emitter to global rather than going unsounded', () => {
    const audio = new RecordingAudioPort();
    const composer = new FeedbackComposer(new RecordingRenderPort(), {}, audio);
    const base = viewOf(makeWorld());
    const orphan: FeedbackView = {
      ...base,
      poseOf: () => null,
      puzzleAnchorOf: () => null,
      machineAnchorOf: () => null
    };

    composer.update(
      DT,
      [
        { kind: 'attach-confirmed', componentId: 'gear-ghost' },
        { kind: 'machine-running', machineId: 'machine-ghost', spin: null },
        { kind: 'puzzle-completed', puzzleId: 'puzzle-ghost', milestoneId: 'milestone/ghost' }
      ],
      orphan
    );

    expect(audio.cues).toEqual(['attach-click', 'machine-start', 'completion']);
    for (const request of audio.requests) expect(request.emitter).toBeNull();
  });
});

describe('FeedbackComposer — interpolation (PLAN T2.2)', () => {
  it('blends between the last two steps and never smears a jump', () => {
    const render = new RecordingRenderPort();
    const composer = new FeedbackComposer(render);
    const world = makeWorld({ attached: false });
    const view = viewOf(world);
    const start = world.snapshots[0]!;
    composer.update(DT, [], view);
    world.snapshots[0] = { ...start, center: { x: start.center.x + 0.2, y: start.center.y, z: start.center.z } };
    composer.update(DT, [], view);
    composer.present(0.5);
    expect(stateOf(render, 'gear-a').center.x).toBeCloseTo(start.center.x + 0.1, 9);
    composer.present(1);
    expect(stateOf(render, 'gear-a').center.x).toBe(start.center.x + 0.2);
    world.snapshots[0] = { ...start, center: { x: start.center.x + 5, y: start.center.y, z: start.center.z } };
    composer.update(DT, [], view);
    composer.present(0.5);
    expect(stateOf(render, 'gear-a').center.x).toBe(start.center.x + 5);
  });
});

describe('FeedbackComposer — visual shapes (PLAN T5.2)', () => {
  it('reports the shape from the view, box by default', () => {
    const world = makeWorld();
    const render = new RecordingRenderPort();
    const composer = new FeedbackComposer(render);
    composer.update(DT, [], { ...viewOf(world), visualOf: () => 'gear' });
    composer.present();
    expect(stateOf(render, 'gear-a').visual).toBe('gear');
    const plainRender = new RecordingRenderPort();
    const plain = new FeedbackComposer(plainRender);
    plain.update(DT, [], viewOf(world));
    plain.present();
    expect(stateOf(plainRender, 'gear-a').visual).toBe('box');
  });
});
