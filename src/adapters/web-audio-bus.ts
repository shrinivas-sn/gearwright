/**
 * L4 ADAPTER — the Web Audio bus (ARCH §32.2/§8.6, ADR-011, §40
 * `adapters/web-audio-bus.ts`).
 *
 * ADR-011 chose "Web Audio API with a thin `AudioBus` wrapper" over a library because
 * precise mechanical timing and bus control are the point, and accepted the cost:
 * "must handle unlock/suspension ourselves". This file is that cost.
 *
 * Three decisions worth stating, because each one is a rule in §32 rather than taste:
 *
 *  1. **Cues are synthesised, not loaded.** §32.4 rule 4 wants recipes, not per-machine
 *     code, and ADR-011 budgets audio at ~0 KB: a cue is a handful of oscillators with
 *     authored envelopes, so there is no file to fetch, decode, or fail to load — and
 *     nothing here can put a loading state into the boot path. The recipes are data in
 *     one table below (the `AUDIO_CUE_RECIPES` map), and adding a cue is an edit to it.
 *  2. **Voices are pooled** (§32.2: "audio node pooling to avoid GC churn"). A voice is
 *     one oscillator started once at silence plus its own gain and panner, wired
 *     `osc → gain → panner → bus`, and playback is an *envelope on an existing node* —
 *     so a cue in a steady state allocates nothing. Voices are created per bus on first
 *     use, capped, and reused forever; a saturated bus steals its longest-idle voice
 *     with a few milliseconds of fade, so the steal cannot itself click.
 *  3. **Global is positional-at-the-listener.** §32.2 gives machinery positional
 *     emitters and UI none; rather than a bypass branch, a global cue is placed at the
 *     listener, so both cases run the same one code path and the panner's distance model
 *     is the only thing that differs.
 *
 * EC-BRN-08 governs every failure mode here: playable silently, unlock on gesture, no
 * error spam. So an unsupported browser, a refused context, a hostile `createGain` or a
 * disposed bus all end in silence and a `false`/no-op — never a throw, and each warning
 * is latched so a per-frame caller cannot turn it into a log flood.
 *
 * The state is *transient presentation*: nothing here is canonical, and nothing it
 * reports may be read back into logic (§32.4 rule 1).
 */

import type {
  AudioBusId,
  AudioCueId,
  AudioCueRequest,
  AudioListener,
  AudioPoint,
  AudioPort,
  AudioState
} from '../ports/audio-port.ts';

// --- the engine surface this adapter needs, structurally ------------------------
//
// Declared as the minimal shape used instead of the full DOM interfaces so a test can
// inject a fake context (TEST_SUITE_PLAN §3: ports and adapters are testable without a
// browser) and so the adapter cannot accidentally grow a dependency on a wider API.

interface AudioParamLike {
  /** Current value — read only by the steal fade, which needs where a ramp got to. */
  value: number;
  setValueAtTime(value: number, startTime: number): AudioParamLike;
  linearRampToValueAtTime(value: number, endTime: number): AudioParamLike;
  exponentialRampToValueAtTime(value: number, endTime: number): AudioParamLike;
  cancelScheduledValues(startTime: number): AudioParamLike;
}

interface AudioNodeLike {
  connect(destination: AudioNodeLike): AudioNodeLike;
  disconnect(): void;
}

interface GainNodeLike extends AudioNodeLike {
  readonly gain: AudioParamLike;
}

interface OscillatorNodeLike extends AudioNodeLike {
  type: string;
  readonly frequency: AudioParamLike;
  start(when?: number): void;
  stop(when?: number): void;
}

interface PannerNodeLike extends AudioNodeLike {
  panningModel: string;
  distanceModel: string;
  refDistance: number;
  maxDistance: number;
  rolloffFactor: number;
  readonly positionX: AudioParamLike;
  readonly positionY: AudioParamLike;
  readonly positionZ: AudioParamLike;
}

interface AudioListenerLike {
  readonly positionX: AudioParamLike;
  readonly positionY: AudioParamLike;
  readonly positionZ: AudioParamLike;
  readonly forwardX: AudioParamLike;
  readonly forwardY: AudioParamLike;
  readonly forwardZ: AudioParamLike;
}

interface AudioContextLike {
  readonly currentTime: number;
  readonly state: string;
  readonly destination: AudioNodeLike;
  readonly listener: AudioListenerLike;
  createGain(): GainNodeLike;
  createOscillator(): OscillatorNodeLike;
  createPanner(): PannerNodeLike;
  resume(): Promise<void>;
  close(): Promise<void>;
}

/** How a context is obtained. Injected by tests; the boot path uses the browser's. */
export type AudioContextFactory = () => AudioContextLike | null;

export interface WebAudioBusOptions {
  readonly contextFactory?: AudioContextFactory | undefined;
}

// --- authored data (§32.2 buses, §32.3 recipes) ----------------------------------

/** §32.2's five buses, in graph order. `master` is the only one a user volume drives. */
const AUDIO_BUSES: ReadonlyArray<AudioBusId> = ['master', 'music', 'sfx', 'ui', 'ambience'];

/**
 * Authored bus levels. `sfx` carries §32.3's core mechanical layer at unity; `ui` sits
 * under it (a prompt must never outrank the machine); `music`/`ambience` are authored
 * (§32.2's table) but have no cues in the MVP — §32.2 allows music to be "minimal or
 * none", and machine hum as a loop is not this slice.
 */
const AUDIO_BUS_LEVELS: Readonly<Record<AudioBusId, number>> = {
  master: 1,
  music: 0.7,
  sfx: 1,
  ui: 0.8,
  ambience: 0.6
};

/**
 * A voice's maximum count per bus: enough for a recipe's tones plus one in flight. The cap
 * is what makes the pool bounded, so it is exported like the scanner's tuning — the suite
 * pins it rather than restating it (TEST §9's "documented tuning" rule).
 */
export const MAX_VOICES_PER_BUS = 3;

/** Fade applied when a saturated bus steals a voice — shorter than any authored attack. */
export const STEAL_FADE_SECONDS = 0.008;

/** Positions closer than this are unattenuated; the lab is a few metres across. */
const PANNER_REF_DISTANCE = 3;
const PANNER_MAX_DISTANCE = 40;

/** Exponential ramps require a strictly positive target, so a glide is floored here. */
const MIN_FREQUENCY_HZ = 1;

type ToneWaveform = 'sine' | 'triangle' | 'square' | 'sawtooth';

/** One oscillator's worth of a recipe: a frequency envelope and a gain envelope. */
interface AudioTone {
  readonly waveform: ToneWaveform;
  readonly frequency: number;
  /** Glide target across the tone's whole length. Authored as a slide, never a jump. */
  readonly endFrequency?: number | undefined;
  /** Seconds after the cue starts before this tone begins. */
  readonly startSeconds: number;
  readonly attackSeconds: number;
  readonly holdSeconds: number;
  readonly releaseSeconds: number;
  readonly gain: number;
}

interface AudioCueRecipe {
  readonly bus: AudioBusId;
  readonly tones: ReadonlyArray<AudioTone>;
  /**
   * How long the cue occupies its voices. Also §32.3's budget check: the completion
   * recipe is the longest allowed (≤1.5 s) and nothing here may exceed it silently.
   */
  readonly seconds: number;
}

/**
 * §32.3's recipes as data. Every cue pairs a click/body pair rather than one bare tone,
 * because §32.4 rule 2 forbids audio being the only signal *and* expects it to read as a
 * mechanical event, not a beep. Envelopes are authored in seconds and envelope gains are
 * deliberately low: the master bus is the only amplifier, so nothing here can clip.
 */
export const AUDIO_CUE_RECIPES: Readonly<Record<AudioCueId, AudioCueRecipe>> = {
  /** §32.3 layer 2: dry mechanical click, 60–120 ms, with a small body under it. */
  'attach-click': {
    bus: 'sfx',
    seconds: 0.12,
    tones: [
      {
        waveform: 'square',
        frequency: 1900,
        endFrequency: 1100,
        startSeconds: 0,
        attackSeconds: 0.002,
        holdSeconds: 0.008,
        releaseSeconds: 0.06,
        gain: 0.14
      },
      {
        waveform: 'sine',
        frequency: 124,
        endFrequency: 82,
        startSeconds: 0.004,
        attackSeconds: 0.003,
        holdSeconds: 0.02,
        releaseSeconds: 0.08,
        gain: 0.16
      }
    ]
  },
  /** A refusal is two low buzzes: the same shape as a click, deliberately unsatisfying. */
  'attach-refused': {
    bus: 'sfx',
    seconds: 0.22,
    tones: [
      {
        waveform: 'square',
        frequency: 168,
        endFrequency: 150,
        startSeconds: 0,
        attackSeconds: 0.004,
        holdSeconds: 0.06,
        releaseSeconds: 0.02,
        gain: 0.12
      },
      {
        waveform: 'square',
        frequency: 150,
        endFrequency: 132,
        startSeconds: 0.11,
        attackSeconds: 0.004,
        holdSeconds: 0.06,
        releaseSeconds: 0.03,
        gain: 0.12
      }
    ]
  },
  /** The click heard from the other side: same grain, lower, ending on a short fall. */
  detach: {
    bus: 'sfx',
    seconds: 0.17,
    tones: [
      {
        waveform: 'triangle',
        frequency: 1200,
        endFrequency: 700,
        startSeconds: 0,
        attackSeconds: 0.002,
        holdSeconds: 0.006,
        releaseSeconds: 0.05,
        gain: 0.12
      },
      {
        waveform: 'sine',
        frequency: 300,
        endFrequency: 180,
        startSeconds: 0.005,
        attackSeconds: 0.004,
        holdSeconds: 0.02,
        releaseSeconds: 0.12,
        gain: 0.11
      }
    ]
  },
  /** §32.3 layer 5: a servo spinning up under a low confirm tone, only on a real edge. */
  'machine-start': {
    bus: 'sfx',
    seconds: 0.5,
    tones: [
      {
        waveform: 'sawtooth',
        frequency: 88,
        endFrequency: 208,
        startSeconds: 0,
        attackSeconds: 0.04,
        holdSeconds: 0.18,
        releaseSeconds: 0.22,
        gain: 0.06
      },
      {
        waveform: 'sine',
        frequency: 110,
        startSeconds: 0.01,
        attackSeconds: 0.01,
        holdSeconds: 0.14,
        releaseSeconds: 0.3,
        gain: 0.13
      }
    ]
  },
  /** The same voice stopping: pitch falls and the tone does not resolve upward. */
  'machine-stop': {
    bus: 'sfx',
    seconds: 0.44,
    tones: [
      {
        waveform: 'sawtooth',
        frequency: 210,
        endFrequency: 74,
        startSeconds: 0,
        attackSeconds: 0.01,
        holdSeconds: 0.08,
        releaseSeconds: 0.3,
        gain: 0.05
      },
      {
        waveform: 'sine',
        frequency: 104,
        endFrequency: 92,
        startSeconds: 0,
        attackSeconds: 0.01,
        holdSeconds: 0.1,
        releaseSeconds: 0.26,
        gain: 0.11
      }
    ]
  },
  /**
   * §32.3's completion: "the same layers with more weight" — a low bed plus two rising
   * notes, 1.05 s, inside the 1.5 s budget and never blocking input (§32.3).
   */
  completion: {
    bus: 'sfx',
    seconds: 1.05,
    tones: [
      {
        waveform: 'sine',
        frequency: 70,
        startSeconds: 0,
        attackSeconds: 0.02,
        holdSeconds: 0.5,
        releaseSeconds: 0.5,
        gain: 0.15
      },
      {
        waveform: 'triangle',
        frequency: 330,
        startSeconds: 0.02,
        attackSeconds: 0.01,
        holdSeconds: 0.12,
        releaseSeconds: 0.3,
        gain: 0.17
      },
      {
        waveform: 'triangle',
        frequency: 494,
        startSeconds: 0.2,
        attackSeconds: 0.01,
        holdSeconds: 0.16,
        releaseSeconds: 0.48,
        gain: 0.15
      }
    ]
  }
};

// --- the bus ---------------------------------------------------------------------

/** One pooled voice: an oscillator started once, plus its own gain and panner. */
interface BusVoice {
  readonly oscillator: OscillatorNodeLike;
  readonly gain: GainNodeLike;
  readonly panner: PannerNodeLike;
  /** Context time this voice is reusable; the steal victim is the smallest one. */
  freeAt: number;
}

interface BusChannel {
  readonly gain: GainNodeLike;
  /** The level last applied (authored default first, then whatever `setBusVolume` set). */
  level: number;
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(value, 0), 1);
}

/** The browser's constructor, or nothing. Never throws: absence is the silent path. */
function defaultContextFactory(): AudioContextLike | null {
  try {
    const Ctor = globalThis.AudioContext;
    if (typeof Ctor !== 'function') return null;
    return new Ctor();
  } catch {
    return null;
  }
}

export class WebAudioBus implements AudioPort {
  readonly kind = 'web-audio';

  private readonly factory: AudioContextFactory;
  private context: AudioContextLike | null = null;
  private master: GainNodeLike | null = null;
  private readonly channels = new Map<AudioBusId, BusChannel>();
  private readonly pools = new Map<AudioBusId, BusVoice[]>();
  private listenerEye: AudioPoint | null = null;
  private listenerTarget: AudioPoint | null = null;
  private lastPlayedCue: AudioCueId | null = null;
  private warned = false;

  constructor(options: WebAudioBusOptions = {}) {
    this.factory = options.contextFactory ?? defaultContextFactory;
  }

  get state(): AudioState {
    return this.readState();
  }

  /**
   * Always read from the context — never cached and never assumed. `AudioContext.state`
   * flips on its own schedule (`resume()` may settle on a later task), so a caller that
   * wants to know has to ask, which is why this is a read and not a stored field.
   */
  private readState(): AudioState {
    const context = this.context;
    if (context === null) return 'unavailable';
    try {
      const raw = context.state;
      if (raw === 'running') return 'running';
      if (raw === 'suspended') return 'suspended';
      return 'unavailable';
    } catch {
      return 'unavailable';
    }
  }

  /** The last cue that actually reached a voice — diagnostics only (§37). */
  get lastCue(): AudioCueId | null {
    return this.lastPlayedCue;
  }

  /**
   * Build the graph: every §32.2 bus as a gain into `master` into `destination`. Voices
   * are *not* created here — a bus that never plays allocates nothing (see `acquireVoice`).
   */
  init(): boolean {
    if (this.context !== null) return true;
    let context: AudioContextLike | null = null;
    try {
      context = this.factory();
    } catch {
      context = null;
    }
    if (context === null) return false;

    try {
      const master = context.createGain();
      master.gain.setValueAtTime(AUDIO_BUS_LEVELS.master, context.currentTime);
      master.connect(context.destination);
      this.master = master;
      this.channels.clear();
      // Every bus — `master` included — is one uniform channel record, so the volume
      // path has a single shape and a disposed graph clears in one place.
      this.channels.set('master', { gain: master, level: AUDIO_BUS_LEVELS.master });
      for (const bus of AUDIO_BUSES) {
        if (bus === 'master') continue;
        const gain = context.createGain();
        const level = AUDIO_BUS_LEVELS[bus];
        gain.gain.setValueAtTime(level, context.currentTime);
        gain.connect(master);
        this.channels.set(bus, { gain, level });
      }
    } catch {
      // A hostile or broken implementation must degrade to silence, not throw into boot
      // (EC-BRN-08). Nothing usable was built, so the port stays a null object.
      this.master = null;
      this.channels.clear();
      this.context = null;
      return false;
    }

    this.context = context;
    return true;
  }

  /**
   * EC-BRN-08: deliver the unlock request, once.
   *
   * `true` means the request was **delivered** — the context was already running, or
   * `resume()` accepted it — so the caller can stop watching for gestures after this one.
   * It deliberately does not promise the state has *settled*: Chrome flips `state` to
   * `running` on a later task, so a synchronous read here would report the old value and
   * make an unlocked context look unlocked-later (that is precisely what the first
   * browser check found). Read {@link state} for the engine's own answer.
   *
   * `false` means there was nothing to unlock: no context, or `resume()` refused
   * outright. A refusal is warned about once and then it is silence (EC-BRN-08's recovery
   * is "silent mode"); the caller may retry on the next gesture for free.
   */
  unlock(): boolean {
    const context = this.context;
    if (context === null) return false;
    if (this.readState() === 'running') return true;
    try {
      void Promise.resolve(context.resume()).catch(() =>
        this.warnOnce('[audio] resume refused — staying silent (EC-BRN-08)')
      );
    } catch {
      this.warnOnce('[audio] resume threw — staying silent (EC-BRN-08)');
      return false;
    }
    return true;
  }

  play(request: AudioCueRequest): void {
    const context = this.context;
    if (context === null || this.master === null) return;
    const recipe: AudioCueRecipe | undefined = AUDIO_CUE_RECIPES[request.cue];
    if (recipe === undefined) return; // unknown cue: skip, never throw

    const now = context.currentTime;
    const scale = clampUnit(request.gain ?? 1);
    // A global cue plays *at the listener* rather than on a bypass path (§32.2): one
    // code path, and an emitter that could not be resolved degrades to audible.
    const emitter = request.emitter ?? this.listenerEye ?? { x: 0, y: 0, z: 0 };
    for (const tone of recipe.tones) {
      this.playTone(recipe.bus, tone, emitter, now, scale);
    }
    this.lastPlayedCue = request.cue;
  }

  setListener(listener: AudioListener): void {
    const context = this.context;
    if (context === null) return;

    const eye = listener.eye;
    const target = listener.target;
    if (
      this.listenerEye !== null &&
      this.listenerTarget !== null &&
      this.listenerEye.x === eye.x &&
      this.listenerEye.y === eye.y &&
      this.listenerEye.z === eye.z &&
      this.listenerTarget.x === target.x &&
      this.listenerTarget.y === target.y &&
      this.listenerTarget.z === target.z
    ) {
      return; // a steady camera writes nothing (the change-only rule, §33.2 rule 5's spirit)
    }
    this.listenerEye = { x: eye.x, y: eye.y, z: eye.z };
    this.listenerTarget = { x: target.x, y: target.y, z: target.z };

    const now = context.currentTime;
    const dx = target.x - eye.x;
    const dy = target.y - eye.y;
    const dz = target.z - eye.z;
    const length = Math.hypot(dx, dy, dz) || 1;
    try {
      const audioListener = context.listener;
      audioListener.positionX.setValueAtTime(eye.x, now);
      audioListener.positionY.setValueAtTime(eye.y, now);
      audioListener.positionZ.setValueAtTime(eye.z, now);
      audioListener.forwardX.setValueAtTime(dx / length, now);
      audioListener.forwardY.setValueAtTime(dy / length, now);
      audioListener.forwardZ.setValueAtTime(dz / length, now);
    } catch {
      // An engine without the AudioListener param API keeps the default listener; cues
      // still play, just centred. Never a throw on the frame path.
    }
  }

  setBusVolume(bus: AudioBusId, volume: number): void {
    const context = this.context;
    if (context === null) return;
    const channel = this.channels.get(bus);
    if (channel === undefined) return;
    // A non-finite request keeps the current level instead of muting the bus: the
    // settings seam must not be able to silence the game through a NaN.
    const next = clampUnit(
      Number.isFinite(volume) ? volume : channel.level
    );
    channel.level = next;
    try {
      channel.gain.gain.setValueAtTime(next, context.currentTime);
    } catch {
      // A refused automation write is not worth an exception on a settings path.
    }
  }

  dispose(): void {
    const context = this.context;
    if (context === null) return;
    this.context = null;
    this.master = null;
    this.channels.clear();
    this.pools.clear();
    this.listenerEye = null;
    this.listenerTarget = null;
    try {
      void Promise.resolve(context.close()).catch(() => {});
    } catch {
      // Already closed (or never really open): nothing to release.
    }
  }

  // --- internals -----------------------------------------------------------------

  private playTone(
    bus: AudioBusId,
    tone: AudioTone,
    emitter: AudioPoint,
    now: number,
    scale: number
  ): void {
    const context = this.context;
    if (context === null) return;
    const voice = this.acquireVoice(bus, context, now);
    if (voice === null) return;

    const start = now + Math.max(tone.startSeconds, 0);
    const attackEnd = start + Math.max(tone.attackSeconds, 0);
    const holdEnd = attackEnd + Math.max(tone.holdSeconds, 0);
    const end = holdEnd + Math.max(tone.releaseSeconds, 0);

    // Keep the voice busy until *this* envelope ends, even when it was stolen from a
    // longer cue: the pool's bookkeeping stays conservative rather than optimistic.
    voice.freeAt = Math.max(voice.freeAt, end);

    try {
      voice.oscillator.type = tone.waveform;

      const frequency = voice.oscillator.frequency;
      frequency.cancelScheduledValues(start);
      frequency.setValueAtTime(Math.max(tone.frequency, MIN_FREQUENCY_HZ), start);
      if (tone.endFrequency !== undefined) {
        // A glide, so a servo slides rather than stepping (exponential reads as pitch).
        frequency.exponentialRampToValueAtTime(
          Math.max(tone.endFrequency, MIN_FREQUENCY_HZ),
          end
        );
      }

      const gain = voice.gain.gain;
      const peak = clampUnit(tone.gain * scale);
      gain.cancelScheduledValues(start);
      gain.setValueAtTime(0, start);
      gain.linearRampToValueAtTime(peak, attackEnd);
      gain.setValueAtTime(peak, holdEnd);
      gain.linearRampToValueAtTime(0, end);

      this.placePanner(voice.panner, emitter, start);
    } catch {
      // A hostile node degrades this cue to silence; the rest of the bus keeps working.
      voice.freeAt = now;
    }
  }

  /**
   * A free voice if one exists, else a new one up to the cap, else the longest-idle
   * voice stolen with a fade. Deterministic in every branch: the same input script
   * always picks the same voice (EC-MAN-12's determinism, applied to presentation).
   */
  private acquireVoice(
    bus: AudioBusId,
    context: AudioContextLike,
    now: number
  ): BusVoice | null {
    let pool = this.pools.get(bus);
    if (pool === undefined) {
      pool = [];
      this.pools.set(bus, pool);
    }

    for (const voice of pool) {
      if (voice.freeAt <= now) return voice;
    }

    if (pool.length < MAX_VOICES_PER_BUS) {
      const created = this.createVoice(bus, context);
      if (created === null) return null;
      pool.push(created);
      return created;
    }

    let victim = pool[0];
    if (victim === undefined) return null; // unreachable while the cap is positive
    for (const voice of pool) {
      if (voice.freeAt < victim.freeAt) victim = voice;
    }
    this.fadeOut(victim, now);
    return victim;
  }

  private createVoice(bus: AudioBusId, context: AudioContextLike): BusVoice | null {
    const channel = this.channels.get(bus);
    if (channel === undefined) return null;
    try {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const panner = context.createPanner();
      panner.panningModel = 'equalpower';
      panner.distanceModel = 'inverse';
      panner.refDistance = PANNER_REF_DISTANCE;
      panner.maxDistance = PANNER_MAX_DISTANCE;
      panner.rolloffFactor = 1;
      gain.gain.setValueAtTime(0, context.currentTime);
      oscillator.connect(gain);
      gain.connect(panner);
      panner.connect(channel.gain);
      // Started once, at silence: from here on the voice is only ever re-enveloped, which
      // is what makes a steady state allocation-free (§32.2 node pooling).
      oscillator.start(context.currentTime);
      return { oscillator, gain, panner, freeAt: 0 };
    } catch {
      return null;
    }
  }

  /** Fade a stolen voice to silence so the steal itself cannot produce a click. */
  private fadeOut(voice: BusVoice, now: number): void {
    try {
      const gain = voice.gain.gain;
      gain.cancelScheduledValues(now);
      gain.setValueAtTime(clampUnit(gain.value), now);
      gain.linearRampToValueAtTime(0, now + STEAL_FADE_SECONDS);
    } catch {
      // If even the fade fails the voice is simply reused; the envelope rewrite follows.
    }
  }

  private placePanner(panner: PannerNodeLike, point: AudioPoint, when: number): void {
    panner.positionX.setValueAtTime(point.x, when);
    panner.positionY.setValueAtTime(point.y, when);
    panner.positionZ.setValueAtTime(point.z, when);
  }

  /** One latched warning: EC-BRN-08's "no error spam" for a caller that retries. */
  private warnOnce(message: string): void {
    if (this.warned) return;
    this.warned = true;
    console.warn(message);
  }
}

/**
 * The null object EC-BRN-08 names. It reports `unavailable` and does nothing, which is
 * what makes audio genuinely optional: the composition can hand this to the feedback
 * composer when a browser has no Web Audio at all (or when a build wants silence), and
 * every caller stays identical — no branch at the call site, no error path to test.
 */
export class SilentAudioBus implements AudioPort {
  readonly kind = 'silent';

  get state(): AudioState {
    return 'unavailable';
  }

  init(): boolean {
    return false;
  }

  unlock(): boolean {
    return false;
  }

  play(_request: AudioCueRequest): void {}

  setListener(_listener: AudioListener): void {}

  setBusVolume(_bus: AudioBusId, _volume: number): void {}

  dispose(): void {}
}
