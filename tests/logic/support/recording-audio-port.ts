import type {
  AudioBusId,
  AudioCueId,
  AudioCueRequest,
  AudioListener,
  AudioPort,
  AudioState
} from '../../../src/ports/audio-port.ts';

/**
 * Shared test double for the audio port (TEST §3): records what was asked of it and does
 * nothing. Used by the L4 composer suite (which asserts the §32.3 cue per intent, and
 * where it was placed) and by the P1 acceptance test, which asserts that feedback reaches
 * *both* presentation ports — VFX and SFX — from one intent stream.
 *
 * Requests are copied in, because the composer hands over objects it owns.
 */
export class RecordingAudioPort implements AudioPort {
  readonly kind = 'recording';
  /** Every cue in order, with a snapshot of its request. */
  readonly requests: AudioCueRequest[] = [];
  readonly listeners: AudioListener[] = [];
  readonly volumes: Array<{ readonly bus: AudioBusId; readonly volume: number }> = [];
  /** The state this double reports; tests set it instead of a real context. */
  state: AudioState = 'running';
  initCalls = 0;
  unlockCalls = 0;
  disposeCalls = 0;

  init(): boolean {
    this.initCalls += 1;
    return true;
  }

  unlock(): boolean {
    this.unlockCalls += 1;
    return true;
  }

  play(request: AudioCueRequest): void {
    this.requests.push({
      cue: request.cue,
      emitter: request.emitter === null ? null : { ...request.emitter },
      ...(request.gain === undefined ? {} : { gain: request.gain })
    });
  }

  setListener(listener: AudioListener): void {
    this.listeners.push({ eye: { ...listener.eye }, target: { ...listener.target } });
  }

  setBusVolume(bus: AudioBusId, volume: number): void {
    this.volumes.push({ bus, volume });
  }

  dispose(): void {
    this.disposeCalls += 1;
  }

  /** The cue ids played, in order — the shape most assertions want. */
  get cues(): AudioCueId[] {
    return this.requests.map((request) => request.cue);
  }

  /** The most recent request, or null. */
  get lastRequest(): AudioCueRequest | null {
    return this.requests.at(-1) ?? null;
  }
}
