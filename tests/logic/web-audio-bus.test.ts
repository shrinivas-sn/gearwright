import { describe, expect, it, vi } from 'vitest';

import {
  AUDIO_CUE_RECIPES,
  MAX_VOICES_PER_BUS,
  SilentAudioBus,
  STEAL_FADE_SECONDS,
  WebAudioBus
} from '../../src/adapters/web-audio-bus.ts';

/**
 * TEST §16.8 / §9 — the L4 Web Audio bus (ADR-011, ARCH §32.2). The adapter's engine
 * surface is injected, so its whole contract is testable headlessly: what it builds, what
 * it refuses, and that a failure is silence rather than an exception (EC-BRN-08).
 *
 * The fake below is deliberately *hostile-capable* (its factory can throw, its resume can
 * reject) because the interesting half of this adapter is what it does when the engine
 * says no.
 */

type ParamEvent = {
  readonly kind: 'set' | 'linear' | 'exponential' | 'cancel';
  readonly value: number;
  readonly time: number;
};

/**
 * A stand-in `AudioParam`. Ramps record the value they ramp *to* and pretend the param
 * arrives there immediately — enough to assert what was scheduled, and deliberately not a
 * curve evaluator (the adapter's scheduling is what is under test, not Web Audio's).
 */
class FakeParam {
  value = 0;
  readonly events: ParamEvent[] = [];

  setValueAtTime(value: number, time: number): FakeParam {
    this.value = value;
    this.events.push({ kind: 'set', value, time });
    return this;
  }

  linearRampToValueAtTime(value: number, time: number): FakeParam {
    this.value = value;
    this.events.push({ kind: 'linear', value, time });
    return this;
  }

  exponentialRampToValueAtTime(value: number, time: number): FakeParam {
    this.value = value;
    this.events.push({ kind: 'exponential', value, time });
    return this;
  }

  cancelScheduledValues(time: number): FakeParam {
    this.events.push({ kind: 'cancel', value: 0, time });
    return this;
  }
}

class FakeNode {
  /** Outgoing connections, so the graph's shape can be asserted from the source side. */
  readonly connects: FakeNode[] = [];

  connect(destination: FakeNode): FakeNode {
    this.connects.push(destination);
    return destination;
  }

  disconnect(): void {}
}

class FakeGain extends FakeNode {
  readonly gain = new FakeParam();
}

class FakeOscillator extends FakeNode {
  type = 'sine';
  readonly frequency = new FakeParam();
  startCalls = 0;
  stopCalls = 0;

  start(): void {
    this.startCalls += 1;
  }

  stop(): void {
    this.stopCalls += 1;
  }
}

class FakePanner extends FakeNode {
  panningModel = 'equalpower';
  distanceModel = 'inverse';
  refDistance = 1;
  maxDistance = 10000;
  rolloffFactor = 1;
  readonly positionX = new FakeParam();
  readonly positionY = new FakeParam();
  readonly positionZ = new FakeParam();
}

interface ContextOptions {
  readonly state?: string;
  readonly resume?: 'resolve' | 'reject';
  readonly gainThrows?: boolean;
}

class FakeAudioContext {
  currentTime = 0;
  state: string;
  readonly destination = new FakeNode();
  readonly listener: {
    readonly positionX: FakeParam;
    readonly positionY: FakeParam;
    readonly positionZ: FakeParam;
    readonly forwardX: FakeParam;
    readonly forwardY: FakeParam;
    readonly forwardZ: FakeParam;
  };
  readonly listenerParams: FakeParam[];
  readonly gains: FakeGain[] = [];
  readonly oscillators: FakeOscillator[] = [];
  readonly panners: FakePanner[] = [];
  resumeCalls = 0;
  closeCalls = 0;
  private readonly options: ContextOptions;

  constructor(options: ContextOptions = {}) {
    this.options = options;
    this.state = options.state ?? 'suspended';
    const positionX = new FakeParam();
    const positionY = new FakeParam();
    const positionZ = new FakeParam();
    const forwardX = new FakeParam();
    const forwardY = new FakeParam();
    const forwardZ = new FakeParam();
    this.listener = { positionX, positionY, positionZ, forwardX, forwardY, forwardZ };
    this.listenerParams = [positionX, positionY, positionZ, forwardX, forwardY, forwardZ];
  }

  createGain(): FakeGain {
    if (this.options.gainThrows === true) throw new Error('no gain for you');
    const gain = new FakeGain();
    this.gains.push(gain);
    return gain;
  }

  createOscillator(): FakeOscillator {
    const oscillator = new FakeOscillator();
    this.oscillators.push(oscillator);
    return oscillator;
  }

  createPanner(): FakePanner {
    const panner = new FakePanner();
    this.panners.push(panner);
    return panner;
  }

  resume(): Promise<void> {
    this.resumeCalls += 1;
    if (this.options.resume === 'reject') return Promise.reject(new Error('NotAllowedError'));
    return Promise.resolve();
  }

  close(): Promise<void> {
    this.closeCalls += 1;
    this.state = 'closed';
    return Promise.resolve();
  }
}

function busOver(context: FakeAudioContext): WebAudioBus {
  return new WebAudioBus({ contextFactory: () => context });
}

function gainAt(context: FakeAudioContext, index: number): FakeGain {
  const gain = context.gains[index];
  if (gain === undefined) throw new Error(`no gain node ${index}`);
  return gain;
}

function lastPanner(context: FakeAudioContext): FakePanner {
  const panner = context.panners.at(-1);
  if (panner === undefined) throw new Error('no panner was created');
  return panner;
}

/** Automation events scheduled across every listener param. */
function listenerWrites(context: FakeAudioContext): number {
  return context.listenerParams.reduce((total, param) => total + param.events.length, 0);
}

/** Gains that were faded to zero over exactly the steal fade — i.e. a voice was stolen. */
function stealFades(context: FakeAudioContext): number {
  return context.gains.filter((gain) =>
    gain.gain.events.some(
      (event) => event.kind === 'linear' && event.value === 0 && event.time === STEAL_FADE_SECONDS
    )
  ).length;
}

describe('WebAudioBus — the §32.2 graph', () => {
  it('builds every authored bus into master into the destination, once', () => {
    const context = new FakeAudioContext();
    const bus = busOver(context);

    expect(bus.kind).toBe('web-audio');
    expect(bus.state).toBe('unavailable'); // no context until init (lazy by construction)
    expect(bus.init()).toBe(true);

    // Five buses (§32.2's table) — master plus the four submixes.
    expect(context.gains.length).toBe(5);
    expect(gainAt(context, 0).connects).toEqual([context.destination]);
    for (const index of [1, 2, 3, 4]) {
      expect(gainAt(context, index).connects).toEqual([gainAt(context, 0)]);
    }

    // Idempotent: a second boot neither rebuilds the graph nor leaks nodes.
    expect(bus.init()).toBe(true);
    expect(context.gains.length).toBe(5);
  });

  it('clamps bus volumes and keeps the current level for a non-finite request', () => {
    const context = new FakeAudioContext();
    const bus = busOver(context);
    bus.init();

    bus.setBusVolume('sfx', 2);
    expect(gainAt(context, 2).gain.value).toBe(1); // sfx is the third bus built (master, music, sfx)
    bus.setBusVolume('sfx', -3);
    expect(gainAt(context, 2).gain.value).toBe(0);
    bus.setBusVolume('sfx', Number.NaN);
    expect(gainAt(context, 2).gain.value).toBe(0); // unchanged, not muted to something new
    bus.setBusVolume('master', 0.25);
    expect(gainAt(context, 0).gain.value).toBe(0.25);

    // Before init nothing has a graph to write to; that must not throw.
    const cold = busOver(new FakeAudioContext());
    expect(() => cold.setBusVolume('ui', 0.5)).not.toThrow();
  });

  it('creates no voices until a cue plays, then reuses them forever (§32.2 pooling)', () => {
    const context = new FakeAudioContext();
    const bus = busOver(context);
    bus.init();
    expect(context.oscillators.length).toBe(0); // a bus that never plays allocates nothing

    bus.play({ cue: 'attach-click', emitter: null });
    expect(context.oscillators.length).toBe(2); // the recipe's click + body
    expect(context.oscillators.every((oscillator) => oscillator.startCalls === 1)).toBe(true);
    expect(bus.lastCue).toBe('attach-click');

    // Past the envelope the voices are free again, so the same cue allocates nothing new.
    context.currentTime = 1;
    bus.play({ cue: 'attach-click', emitter: null });
    expect(context.oscillators.length).toBe(2);
    expect(context.oscillators.every((oscillator) => oscillator.startCalls === 1)).toBe(true);
  });

  it('caps a bus and steals its longest-idle voice with a fade, never unbounded', () => {
    const context = new FakeAudioContext();
    const bus = busOver(context);
    bus.init();

    // Each play of the two-tone click wants two voices; four plays at the same instant
    // exhaust the cap, so the pool stops growing and starts stealing.
    for (let play = 0; play < 4; play += 1) bus.play({ cue: 'attach-click', emitter: null });

    expect(context.oscillators.length).toBe(MAX_VOICES_PER_BUS);
    expect(context.oscillators.every((oscillator) => oscillator.startCalls === 1)).toBe(true);
    expect(stealFades(context)).toBeGreaterThan(0);
  });

  it('exponential-ramps a glide so a servo slides rather than steps', () => {
    const context = new FakeAudioContext();
    const bus = busOver(context);
    bus.init();
    bus.play({ cue: 'machine-start', emitter: null });

    const gliding = context.oscillators.filter((oscillator) =>
      oscillator.frequency.events.some((event) => event.kind === 'exponential')
    );
    expect(gliding.length).toBe(1); // only the authored slide, not the steady confirm tone
    for (const oscillator of gliding) {
      for (const event of oscillator.frequency.events) {
        const value = event.kind === 'cancel' ? 1 : event.value;
        expect(value).toBeGreaterThan(0); // exponential ramps require a positive target
      }
    }
  });
});

describe('WebAudioBus — placement (§32.2 positional emitters)', () => {
  it('tracks the listener from the camera pose and only writes when it moves', () => {
    const context = new FakeAudioContext();
    const bus = busOver(context);
    bus.init();

    bus.setListener({ eye: { x: 10, y: 2, z: 3 }, target: { x: 10, y: 2, z: 2 } });
    expect(context.listener.positionX.value).toBe(10);
    expect(context.listener.positionZ.value).toBe(3);
    expect(context.listener.forwardZ.value).toBeCloseTo(-1, 6);
    expect(context.listener.forwardY.value).toBeCloseTo(0, 6);

    const writes = listenerWrites(context);
    expect(writes).toBeGreaterThan(0);
    bus.setListener({ eye: { x: 10, y: 2, z: 3 }, target: { x: 10, y: 2, z: 2 } });
    expect(listenerWrites(context)).toBe(writes); // a steady camera writes nothing

    bus.setListener({ eye: { x: 11, y: 2, z: 3 }, target: { x: 11, y: 2, z: 3.5 } });
    expect(context.listener.positionX.value).toBe(11);
    expect(context.listener.forwardZ.value).toBeCloseTo(1, 6);

    // Before init there is no listener to move; that must not throw.
    const cold = busOver(new FakeAudioContext());
    expect(() =>
      cold.setListener({ eye: { x: 0, y: 0, z: 0 }, target: { x: 0, y: 0, z: 1 } })
    ).not.toThrow();
  });

  it('places a positional cue at its emitter and a global cue at the listener', () => {
    const context = new FakeAudioContext();
    const bus = busOver(context);
    bus.init();
    bus.setListener({ eye: { x: 11, y: 2, z: 3 }, target: { x: 11, y: 2, z: 2 } });

    bus.play({ cue: 'detach', emitter: { x: 1, y: 2, z: 3 } });
    const positional = lastPanner(context);
    expect(positional.positionX.value).toBe(1);
    expect(positional.positionZ.value).toBe(3);
    expect(positional.distanceModel).toBe('inverse'); // machinery falls off with distance
    expect(positional.refDistance).toBeGreaterThan(0);

    bus.play({ cue: 'attach-click', emitter: null });
    const global = lastPanner(context);
    expect(global.positionX.value).toBe(11); // global == at the listener, one code path
    expect(global.positionZ.value).toBe(3);
  });
});

describe('WebAudioBus — unlock and failure (EC-BRN-08)', () => {
  it('delivers the unlock on the first request, and reads the state live', () => {
    const context = new FakeAudioContext({ state: 'suspended' });
    const bus = busOver(context);
    bus.init();
    expect(bus.state).toBe('suspended');

    // Delivered on the first gesture — the caller must not need a second one just because
    // Chrome settles `state` on a later task (the first browser check caught exactly that).
    expect(bus.unlock()).toBe(true);
    expect(context.resumeCalls).toBe(1);
    expect(bus.state).toBe('suspended'); // the engine has not settled yet

    context.state = 'running';
    expect(bus.state).toBe('running'); // live read, not a cached guess
    expect(bus.unlock()).toBe(true);
    expect(context.resumeCalls).toBe(1); // already running: never a redundant resume
  });

  it('warns at most once when a resume is refused, so a retry cannot spam the console', async () => {
    const context = new FakeAudioContext({ resume: 'reject' });
    const bus = busOver(context);
    bus.init();

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      // The call is accepted (so the gesture is not wasted) and refused asynchronously: the
      // bus says so exactly once and then stays quiet — EC-BRN-08's silent mode, no flood.
      expect(bus.unlock()).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(bus.state).toBe('suspended');
      expect(bus.unlock()).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });

  it('degrades a hostile context to silence instead of throwing into boot', () => {
    const bus = busOver(new FakeAudioContext({ gainThrows: true }));
    expect(bus.init()).toBe(false);
    expect(bus.state).toBe('unavailable');
    expect(() => {
      bus.play({ cue: 'completion', emitter: null });
      bus.setListener({ eye: { x: 0, y: 0, z: 0 }, target: { x: 0, y: 0, z: 1 } });
      bus.setBusVolume('sfx', 1);
      bus.unlock();
      bus.dispose();
    }).not.toThrow();
    expect(bus.lastCue).toBeNull();
  });

  it('is a silent null object when the browser has no Web Audio at all', () => {
    const bus = new WebAudioBus({ contextFactory: () => null });
    expect(bus.init()).toBe(false);
    expect(bus.state).toBe('unavailable');
    expect(bus.unlock()).toBe(false);
    expect(() => {
      bus.play({ cue: 'attach-click', emitter: { x: 1, y: 2, z: 3 } });
      bus.setBusVolume('master', 0.5);
      bus.dispose();
    }).not.toThrow();
    expect(bus.lastCue).toBeNull();
  });

  it('closes the context on dispose, silences itself, and tolerates a second dispose', () => {
    const context = new FakeAudioContext();
    const bus = busOver(context);
    bus.init();
    context.state = 'running';

    bus.dispose();
    expect(context.closeCalls).toBe(1);
    expect(bus.state).toBe('unavailable');

    const oscillators = context.oscillators.length;
    bus.play({ cue: 'attach-click', emitter: null });
    expect(context.oscillators.length).toBe(oscillators); // disposed means silent

    bus.dispose();
    expect(context.closeCalls).toBe(1);
  });

  it('satisfies the port as the null object the composition can inject (EC-BRN-08)', () => {
    const silent = new SilentAudioBus();
    expect(silent.kind).toBe('silent');
    expect(silent.state).toBe('unavailable');
    expect(silent.init()).toBe(false);
    expect(silent.unlock()).toBe(false);
    expect(() => {
      silent.play({ cue: 'detach', emitter: null });
      silent.setListener({ eye: { x: 0, y: 0, z: 0 }, target: { x: 0, y: 0, z: 1 } });
      silent.setBusVolume('ui', 0.4);
      silent.dispose();
    }).not.toThrow();
  });
});

describe('WebAudioBus — the authored recipes (§32.3)', () => {
  it('keeps every cue inside the budget, with envelopes the pool accounting can trust', () => {
    const entries = Object.entries(AUDIO_CUE_RECIPES);
    expect(entries.length).toBeGreaterThan(0);

    for (const [id, recipe] of entries) {
      expect(recipe.tones.length, id).toBeGreaterThan(0);
      expect(recipe.seconds, id).toBeGreaterThan(0);
      // §32.3: completion feedback is ≤1.5 s and never blocks input; no cue may exceed it.
      expect(recipe.seconds, id).toBeLessThanOrEqual(1.5);
      // `master` is the user volume, never a cue's target.
      expect(recipe.bus, id).not.toBe('master');

      for (const tone of recipe.tones) {
        expect(Number.isFinite(tone.frequency), id).toBe(true);
        expect(tone.frequency, id).toBeGreaterThan(0);
        expect(tone.gain, id).toBeGreaterThan(0);
        expect(tone.gain, id).toBeLessThanOrEqual(1);
        if (tone.endFrequency !== undefined) expect(tone.endFrequency, id).toBeGreaterThan(0);
        // A tone must finish inside the cue's declared length: `seconds` is what the voice
        // pool books the voice for, so an overrun would let a voice be reused mid-sound.
        const ends =
          tone.startSeconds + tone.attackSeconds + tone.holdSeconds + tone.releaseSeconds;
        expect(ends, id).toBeLessThanOrEqual(recipe.seconds + 1e-9);
      }
    }
  });
});
