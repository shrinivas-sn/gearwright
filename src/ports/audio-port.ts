/**
 * L3 PORT — audio (ARCH §8.6/§9, ADR-011, §40 `ports/audio-port.ts`).
 *
 * Interfaces only (ARCH §11 R4): the L4 feedback composer talks to *this*, never to
 * `AudioContext`, so the game stays **fully playable silent** (EC-BRN-08) and the
 * headless suites can assert the cue path with a recording double.
 *
 * Why the shape is what it is:
 *  - **Buses are vocabulary, not a volume knob** (§32.2). The five authored buses are
 *    the type, so a caller names the layer it is speaking on and cannot invent one.
 *  - **Cues, not files** (§32.4 rule 4, ADR-011's "~0 KB"). A cue is a *named recipe*
 *    the adapter synthesises: no asset pipeline, no loading state, no decode step.
 *  - **One-shot `play`, no return value.** Audio is never gameplay truth (§32.4 rule 1)
 *    and may never be the only signal for something mechanically important (§32.4
 *    rule 2), so nothing here reports back something a caller could branch on.
 *  - **An emitter *point*, not a node handle.** §32.2's "positional emitters for
 *    machinery near the player" needs a world point, and only the composition knows
 *    where things stand — the caller resolves the point, the adapter owns attenuation.
 *  - **The listener is the camera pose.** Rather than a bespoke orientation type, the
 *    listener is `{eye, target}` — structurally the same shape `RenderPort.setView`
 *    already receives (§17's camera contract), so the composition passes one thing it
 *    already has instead of computing a normalised forward vector itself.
 */

/** The §32.2 submix. `master` is the only bus a user volume would drive. */
export type AudioBusId = 'master' | 'music' | 'sfx' | 'ui' | 'ambience';

/**
 * What a caller may ask for, as a name rather than a file. The vocabulary is closed on
 * purpose: the L4 composer decides *which* cue an intent warrants, and adding one is a
 * deliberate edit here plus one recipe in the adapter (§32.1's "who decides what" split).
 */
export type AudioCueId =
  /** §32.3 layer 2: the dry mechanical click of a part seating in a socket. */
  | 'attach-click'
  /** A rejected placement: shorter and lower than the click, never a success sound. */
  | 'attach-refused'
  /** A part coming back out — the click's pitch from the other side. */
  | 'detach'
  /** §32.3 layer 5: the low confirm tone plus servo spin-up as a machine propagates. */
  | 'machine-start'
  /** The same voice stopping: a spin-down, not a rewind. */
  | 'machine-stop'
  /** §32.3: completion, weighted — the only cue with a music-bus tail. */
  | 'completion';

/**
 * What the bus reports about itself. `unavailable` is the honest silent state: no
 * context (never initialised, unsupported, disposed, or refused). A caller may log it;
 * nothing in gameplay may branch on it (EC-BRN-08's null-object fallback).
 */
export type AudioState = 'unavailable' | 'suspended' | 'running';

/** A world point. Structural, so `Vec3` and camera poses pass through unchanged. */
export interface AudioPoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** One thing to play. */
export interface AudioCueRequest {
  readonly cue: AudioCueId;
  /**
   * Where to play it from. `null` plays *globally* — at the listener, unattenuated and
   * unpanned — which is what §32.2 reserves for UI. A cue whose emitter cannot be
   * resolved degrades to this rather than going unsounded (an unresolved anchor is a
   * missing position, not a reason to be silent).
   */
  readonly emitter: AudioPoint | null;
  /** Relative gain, 1 = the cue's authored level. Clamped by the adapter. */
  readonly gain?: number;
}

/** Where the sound is heard from (the camera). Orientation is derived from the target. */
export interface AudioListener {
  readonly eye: AudioPoint;
  readonly target: AudioPoint;
}

export interface AudioPort {
  /** Stable identifier for diagnostics/debug panels (e.g. `web-audio`). */
  readonly kind: string;

  /**
   * Create the audio graph and return whether audio is usable. Called once at boot;
   * idempotent. **Never throws** — an unsupported browser, a refused context or a
   * hostile implementation reports `false` and the port stays a null object for its
   * whole life (EC-BRN-08: playable silently, no error spam).
   */
  init(): boolean;

  /** Live state, read from the underlying context (never cached optimistically). */
  readonly state: AudioState;

  /**
   * EC-BRN-08's gesture unlock: ask the context to resume. Returns true once the request
   * has been **delivered** (it was already running, or the resume was accepted), which is
   * the caller's signal to stop watching for gestures; false means there was nothing to
   * unlock. Whether the engine has *settled* into `running` is what `state` answers — a
   * resume commonly completes on a later task, so the two are deliberately separate.
   */
  unlock(): boolean;

  /** Play one cue. Fire-and-forget; a no-op while audio is unavailable. */
  play(request: AudioCueRequest): void;

  /** Move the listener (§32.2 positional emitters). Unchanged poses write nothing. */
  setListener(listener: AudioListener): void;

  /** Set one bus's level in [0,1] (§32.2's user volume seam). Values are clamped. */
  setBusVolume(bus: AudioBusId, volume: number): void;

  /** Release the graph. Idempotent; the port is unusable (and silent) afterwards. */
  dispose(): void;
}
