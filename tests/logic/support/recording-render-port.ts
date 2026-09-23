import {
  EMPTY_RENDER_STATS,
  type CarryableRenderState,
  type FeedbackPulseState,
  type RenderPort,
  type RenderStats,
  type ScannerOverlayState
} from '../../../src/ports/render-port.ts';

/**
 * Shared test double for the render port (TEST §3): records what was presented and
 * ignores everything else. Used by the L4 composer suite, the L4 scanner suite and the
 * P1 acceptance test, which asserts that feedback actually reaches presentation.
 */
export class RecordingRenderPort implements RenderPort {
  readonly kind = 'recording';
  carryables: ReadonlyArray<CarryableRenderState> = [];
  readonly pulses: Array<FeedbackPulseState | null> = [];
  readonly scannerOverlays: Array<ScannerOverlayState | null> = [];

  init(): boolean {
    return true;
  }
  resize(): void {}
  render(): void {}
  setView(): void {}
  setLabWorld(): void {}
  syncPlayerMarker(): void {}
  setFocusMarker(): void {}
  setDebugRay(): void {}
  setCarryables(states: ReadonlyArray<CarryableRenderState>): void {
    // Snapshot the values: the composer reuses its buffer between steps.
    this.carryables = states.map((state) => ({
      ...state,
      center: { ...state.center },
      halfExtents: { ...state.halfExtents }
    }));
  }
  setSnapMarkers(): void {}
  setFeedbackPulse(state: FeedbackPulseState | null): void {
    this.pulses.push(state === null ? null : { ...state, point: { ...state.point } });
  }
  setScannerOverlay(state: ScannerOverlayState | null): void {
    // Snapshot the values: the presenter reuses its buffers between steps.
    this.scannerOverlays.push(
      state === null
        ? null
        : {
            strength: state.strength,
            route: state.route.map((point) => ({ ...point })),
            targets: state.targets.map((target) => ({
              ...target,
              center: { ...target.center },
              halfExtents: { ...target.halfExtents }
            }))
          }
    );
  }
  stats(): RenderStats {
    return EMPTY_RENDER_STATS;
  }
  dispose(): void {}

  /** The presented state of one component, or null when nothing was presented. */
  carryable(id: string): CarryableRenderState | null {
    return this.carryables.find((state) => state.id === id) ?? null;
  }

  /** The pulse currently on screen, or null. */
  get pulse(): FeedbackPulseState | null {
    return this.pulses.at(-1) ?? null;
  }

  /** The scanner reveal currently on screen, or null. */
  get scannerOverlay(): ScannerOverlayState | null {
    return this.scannerOverlays.at(-1) ?? null;
  }
}
