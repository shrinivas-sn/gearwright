import { describe, expect, it, vi } from 'vitest';

import { createApp } from '../../src/app.ts';
import type { PerfOverlay } from '../../src/debug/overlay.ts';
import {
  EMPTY_RENDER_STATS,
  type CarryableRenderState,
  type DebugRayState,
  type FeedbackPulseState,
  type FocusMarkerState,
  type RenderPort,
  type RenderStats,
  type ScannerOverlayState,
  type SnapMarkerState
} from '../../src/ports/render-port.ts';

/**
 * Phase 1's key architectural claim (ARCH §11 rule R4): the whole boot path runs
 * with a substituted render port and an injected clock, so no browser is needed.
 */
class FakeRenderPort implements RenderPort {
  readonly kind = 'fake';
  initCalls = 0;
  disposeCalls = 0;
  renderCalls = 0;
  readonly alphas: number[] = [];
  readonly resizes: Array<readonly [number, number, number]> = [];
  readonly views: number[] = [];
  readonly labWorlds: number[] = [];
  readonly markers: Array<{ x: number; y: number; z: number; yaw: number }> = [];
  readonly focusMarkers: Array<FocusMarkerState | null> = [];
  readonly debugRays: Array<DebugRayState | null> = [];
  failInit = false;
  statsValue: RenderStats = { ...EMPTY_RENDER_STATS, drawCalls: 40, triangles: 12_000, lights: 2 };

  init(): boolean {
    this.initCalls += 1;
    return !this.failInit;
  }

  resize(width: number, height: number, pixelRatio: number): void {
    this.resizes.push([width, height, pixelRatio]);
  }

  render(alpha: number): void {
    this.renderCalls += 1;
    this.alphas.push(alpha);
  }

  setView(pose: { eye: { x: number; y: number; z: number } }): void {
    this.views.push(pose.eye.y);
  }

  setLabWorld(meshes: ReadonlyArray<unknown>): void {
    this.labWorlds.push(meshes.length);
  }

  syncPlayerMarker(state: { position: { x: number; y: number; z: number }; facingYaw: number }): void {
    this.markers.push({ x: state.position.x, y: state.position.y, z: state.position.z, yaw: state.facingYaw });
  }

  setFocusMarker(state: FocusMarkerState | null): void {
    this.focusMarkers.push(state);
  }

  setDebugRay(state: DebugRayState | null): void {
    this.debugRays.push(state);
  }

  setCarryables(_states: ReadonlyArray<CarryableRenderState>): void {}

  setSnapMarkers(_states: ReadonlyArray<SnapMarkerState>): void {}

  setFeedbackPulse(_state: FeedbackPulseState | null): void {}

  setScannerOverlay(_state: ScannerOverlayState | null): void {}

  stats(): RenderStats {
    return this.statsValue;
  }

  dispose(): void {
    this.disposeCalls += 1;
  }
}

interface Harness {
  readonly app: ReturnType<typeof createApp>;
  readonly port: FakeRenderPort;
  setNow(ms: number): void;
}

function createHarness(): Harness {
  const port = new FakeRenderPort();
  let nowMs = 0;
  const app = createApp({
    canvas: {} as HTMLCanvasElement,
    renderPort: port,
    initialViewport: { width: 1280, height: 720, pixelRatio: 1 },
    clock: () => nowMs
  });

  return {
    app,
    port,
    setNow: (ms) => {
      nowMs = ms;
    }
  };
}

describe('app boot path', () => {
  it('initialises the render port, applies the viewport, and enters running', () => {
    const harness = createHarness();

    expect(harness.app.start()).toBe(true);
    expect(harness.port.initCalls).toBe(1);
    expect(harness.port.resizes).toEqual([[1280, 720, 1]]);
    expect(harness.app.lifecycle.state).toBe('running');
    expect(harness.app.snapshot().lifecycle).toBe('running');
  });

  it('fails boot cleanly when the render port cannot initialise (EC-BRN-10)', () => {
    const harness = createHarness();
    harness.port.failInit = true;

    expect(harness.app.start()).toBe(false);
    expect(harness.app.lifecycle.state).toBe('error');
    expect(harness.app.lifecycle.error).toBeInstanceOf(Error);
    expect(harness.port.renderCalls).toBe(0);
  });

  it('rejects a second start() and never double-initialises', () => {
    const harness = createHarness();
    harness.app.start();

    expect(harness.app.start()).toBe(false);
    expect(harness.port.initCalls).toBe(1);
  });

  it('does nothing on frame() before start()', () => {
    const harness = createHarness();
    harness.app.frame();

    expect(harness.port.renderCalls).toBe(0);
  });
});

describe('app frame loop', () => {
  it('advances the fixed step and renders with an interpolation alpha', () => {
    const harness = createHarness();
    harness.app.start();

    harness.setNow(1000);
    harness.app.frame();
    // Origin frame: timing is established, no render port work is performed.
    expect(harness.port.renderCalls).toBe(0);

    harness.setNow(1034);
    harness.app.frame();

    expect(harness.app.loop.stats.steps).toBe(1);
    expect(harness.port.renderCalls).toBe(1);
    for (const alpha of harness.port.alphas) {
      expect(alpha).toBeGreaterThanOrEqual(0);
      expect(alpha).toBeLessThan(1);
    }
  });

  it('records render statistics into the perf snapshot', () => {
    const harness = createHarness();
    harness.app.start();

    harness.setNow(0);
    harness.app.frame();
    harness.setNow(34);
    harness.app.frame();

    const { perf } = harness.app.snapshot();

    expect(perf.worstDrawCalls).toBe(40);
    expect(perf.worstTriangles).toBe(12_000);
    expect(perf.worstLights).toBe(2);
    expect(perf.drawStatus).toBe('ok');
  });

  it('stops advancing while paused', () => {
    const harness = createHarness();
    harness.app.start();
    harness.setNow(1000);
    harness.app.frame();

    expect(harness.app.requestPause('menu')).toBe(true);
    const rendersAtPause = harness.port.renderCalls;
    const stepsAtPause = harness.app.loop.stats.steps;

    harness.setNow(2000);
    harness.app.frame();

    expect(harness.port.renderCalls).toBe(rendersAtPause);
    expect(harness.app.loop.stats.steps).toBe(stepsAtPause);
  });
});

describe('app lifecycle integration (EC-BRN-03/05/07)', () => {
  it('suspends on tab hide and restores without replaying background time', () => {
    const harness = createHarness();
    harness.app.start();
    harness.setNow(1000);
    harness.app.frame();

    harness.app.handleVisibilityChange(true);
    expect(harness.app.lifecycle.state).toBe('suspended');

    // Time passes while hidden; frames are ignored.
    harness.setNow(60_000);
    harness.app.frame();
    expect(harness.app.loop.stats.steps).toBe(0);

    harness.app.handleVisibilityChange(false);
    expect(harness.app.lifecycle.state).toBe('running');

    // First frame after restore re-establishes the time origin: no catch-up burst.
    harness.app.frame();
    expect(harness.app.loop.stats.steps).toBe(0);
  });

  it('pauses on focus loss and does not auto-resume on focus regain', () => {
    const harness = createHarness();
    harness.app.start();

    harness.app.handleFocusChange(false);
    expect(harness.app.lifecycle.state).toBe('paused');

    harness.app.handleFocusChange(true);
    expect(harness.app.lifecycle.state).toBe('paused');
  });

  it('recovers from WebGL context loss back to the prior state', () => {
    const harness = createHarness();
    harness.app.start();

    harness.app.handleContextLost();
    expect(harness.app.lifecycle.state).toBe('error');

    harness.app.handleContextRestored();
    expect(harness.app.lifecycle.state).toBe('running');
    expect(harness.app.lifecycle.error).toBeNull();
  });

  it('clamps resize input to sane values', () => {
    const harness = createHarness();
    harness.app.start();
    harness.port.resizes.length = 0;

    harness.app.resize({ width: 0, height: -10, pixelRatio: Number.NaN });

    expect(harness.port.resizes).toEqual([[1, 1, 1]]);
  });
});

describe('app disposal', () => {
  it('disposes resources exactly once and unloads the lifecycle', () => {
    const harness = createHarness();
    harness.app.start();

    harness.app.dispose();
    expect(harness.port.disposeCalls).toBe(1);
    expect(harness.app.lifecycle.state).toBe('unloaded');

    harness.app.dispose();
    expect(harness.port.disposeCalls).toBe(1);
  });

  it('ignores frames and resizes after disposal', () => {
    const harness = createHarness();
    harness.app.start();
    harness.app.dispose();

    harness.setNow(5000);
    harness.app.frame();
    harness.app.resize({ width: 800, height: 600, pixelRatio: 1 });

    expect(harness.port.renderCalls).toBe(0);
  });

  it('notifies the debug overlay once per frame and disposes it', () => {
    const port = new FakeRenderPort();
    let nowMs = 0;
    const updateSpy = vi.fn();
    const disposeSpy = vi.fn();
    const overlay = { update: updateSpy, dispose: disposeSpy } as unknown as PerfOverlay;

    const app = createApp({
      canvas: {} as HTMLCanvasElement,
      renderPort: port,
      initialViewport: { width: 800, height: 600, pixelRatio: 1 },
      clock: () => nowMs,
      overlay
    });

    app.start();
    app.frame();
    nowMs += 34;
    app.frame();

    expect(updateSpy).toHaveBeenCalledTimes(2);
    const firstPayload = updateSpy.mock.calls[0]?.[0] as { lifecycle: string } | undefined;
    expect(firstPayload?.lifecycle).toBe('running');

    app.dispose();
    expect(disposeSpy).toHaveBeenCalledTimes(1);
  });

  it('reports lifecycle transitions to the injected observer', () => {
    const port = new FakeRenderPort();
    const transitions: string[] = [];

    const app = createApp({
      canvas: {} as HTMLCanvasElement,
      renderPort: port,
      initialViewport: { width: 800, height: 600, pixelRatio: 1 },
      onLifecycleTransition: (transition) => transitions.push(`${transition.from}->${transition.to}`)
    });

    app.start();
    app.requestPause('menu');

    expect(transitions).toEqual(['booting->running', 'running->paused']);
  });
});