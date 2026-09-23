/**
 * COMPOSITION ROOT (ARCH §40) — the one module allowed to know every layer.
 *
 * Exposed as `createApp(deps)` rather than doing browser work at import time, so
 * the entire boot path (init → start → frame → suspend/restore → dispose) can be
 * driven headlessly in tests with a fake `RenderPort` and a fake clock
 * (TEST_SUITE_PLAN §3: ports make boundaries testable without a browser).
 *
 * Phase 1 (M0) contains NO gameplay: the fixed step currently advances nothing.
 */

import { Lifecycle, type LifecycleReason, type LifecycleState, type LifecycleTransition } from './core/lifecycle.ts';
import { FixedStepLoop, type FixedStepConfig, type LoopStats } from './core/loop.ts';
import {
  FrameStatsRecorder,
  realClock,
  type Clock,
  type PerfBudget,
  type PerfSnapshot
} from './core/perf.ts';
import { emptyRawSample, type RawInputSample } from './ports/input-port.ts';
import type { RenderPort } from './ports/render-port.ts';
import type { PerfOverlay } from './debug/overlay.ts';

export interface ViewportSize {
  readonly width: number;
  readonly height: number;
  readonly pixelRatio: number;
}

export interface AppDeps {
  readonly canvas: HTMLCanvasElement;
  readonly renderPort: RenderPort;
  readonly initialViewport: ViewportSize;
  readonly clock?: Clock;
  readonly loopConfig?: Partial<FixedStepConfig>;
  readonly perfBudget?: Partial<PerfBudget>;
  readonly overlay?: PerfOverlay | null;
  // NB: `| undefined` is required by exactOptionalPropertyTypes (ADR-001): callers
  // may always pass the key explicitly with an undefined value.
  readonly onLifecycleTransition?: ((transition: LifecycleTransition) => void) | undefined;
  /**
   * Optional world-hook bundle. Present from Phase 2 onward; absent in Phase 1.
   * `sample` is consumed once per fixed step by the composition root, so the
   * loop keeps ownership of the step contract (ARCH §14).
   */
  readonly world?: WorldHooks | undefined;
}

export interface WorldHooks {
  readonly sample: (() => RawInputSample) | undefined;
  readonly step: (dt: number, raw: RawInputSample) => void;
  readonly present: (alpha: number) => void;
  readonly clearInput: () => void;
}

export interface AppSnapshot {
  readonly perf: PerfSnapshot;
  readonly loop: LoopStats;
  readonly lifecycle: LifecycleState;
  readonly viewport: ViewportSize;
}

export interface App {
  readonly lifecycle: Lifecycle;
  readonly loop: FixedStepLoop;
  readonly perf: FrameStatsRecorder;
  /** Initialise the render port and enter `running`. Returns false if boot failed. */
  start(): boolean;
  /** One rendered frame; main's rAF callback calls this. */
  frame(): void;
  resize(viewport: ViewportSize): void;
  requestPause(reason?: LifecycleReason): boolean;
  resume(reason?: LifecycleReason): boolean;
  handleVisibilityChange(hidden: boolean): void;
  handleFocusChange(focused: boolean): void;
  handleContextLost(): void;
  handleContextRestored(): void;
  snapshot(): AppSnapshot;
  dispose(): void;
}

export function createApp(deps: AppDeps): App {
  const clock = deps.clock ?? realClock;
  const lifecycle = new Lifecycle();
  const perf = new FrameStatsRecorder(deps.perfBudget ?? {});
  const overlay = deps.overlay ?? null;

  let viewport: ViewportSize = { ...deps.initialViewport };
  let disposed = false;
  let booted = false;

  const loop = new FixedStepLoop(
    {
      fixedStep: (dt) => {
        // Step the world through the composition root so the loop keeps
        // ownership of the step contract (ARCH §14). Phase 1 passes no world.
        deps.world?.step(dt, deps.world.sample?.() ?? EMPTY_RAW_SAMPLE);
      },
      render: (alpha) => {
        deps.world?.present(alpha);
        deps.renderPort.render(alpha);
      }
    },
    deps.loopConfig ?? {}
  );

  // Resuming always resets timing so no backgrounded time is replayed (EC-BRN-03).
  const unsubscribe = lifecycle.subscribe((transition) => {
    if (transition.to === 'running') {
      loop.reset();
    }
    deps.onLifecycleTransition?.(transition);
  });

  const app: App = {
    lifecycle,
    loop,
    perf,

    start(): boolean {
      if (disposed || booted) return false;
      booted = true;

      const initialised = deps.renderPort.init(deps.canvas);
      if (!initialised) {
        lifecycle.fail(new Error('ERR-WebGL2Unsupported: render port could not initialise'), 'boot');
        return false;
      }

      app.resize(viewport);
      return lifecycle.start();
    },
    frame(): void {
      if (disposed || !lifecycle.isSimulationActive) return;

      const nowMs = clock();
      const stepped = loop.advance(nowMs);

      const renderStats = deps.renderPort.stats();
      perf.record({
        frameMs: loop.stats.lastFrameDelta * 1000,
        steps: stepped.steps,
        drawCalls: renderStats.drawCalls,
        triangles: renderStats.triangles,
        lights: renderStats.lights
      });

      overlay?.update(
        {
          perf: perf.snapshot(),
          loop: loop.stats,
          lifecycle: lifecycle.state,
          drawCalls: renderStats.drawCalls,
          triangles: renderStats.triangles,
          lights: renderStats.lights
        },
        nowMs
      );
    },

    resize(next: ViewportSize): void {
      if (disposed) return;
      viewport = {
        width: Math.max(1, Math.floor(next.width)),
        height: Math.max(1, Math.floor(next.height)),
        pixelRatio: Number.isFinite(next.pixelRatio) && next.pixelRatio > 0 ? next.pixelRatio : 1
      };
      deps.renderPort.resize(viewport.width, viewport.height, viewport.pixelRatio);
    },

    requestPause(reason: LifecycleReason = 'user'): boolean {
      return lifecycle.requestPause(reason);
    },

    resume(reason: LifecycleReason = 'user'): boolean {
      return lifecycle.resume(reason);
    },

    handleVisibilityChange(hidden: boolean): void {
      if (hidden) {
        deps.world?.clearInput();
        lifecycle.suspend('visibility');
      } else {
        // restore() returns to the pre-suspension state: a deliberately paused game
        // does not silently start running when the tab becomes visible again.
        lifecycle.restore('visibility');
      }
    },

    handleFocusChange(focused: boolean): void {
      // Focus loss pauses rather than continuing with stale input state (EC-BRN-05).
      // Regaining focus never auto-resumes: the player resumes deliberately.
      if (!focused) {
        deps.world?.clearInput();
        lifecycle.requestPause('focus-loss');
      }
    },

    handleContextLost(): void {
      lifecycle.fail(new Error('ERR-WebGLContextLost'), 'context-loss');
    },

    handleContextRestored(): void {
      // Phase 1 holds no gameplay truth in GPU resources, so recovery is simply
      // resuming the loop. Later milestones rebuild scene resources from canonical
      // state here (EC-BRN-07) — progression is never at risk either way.
      lifecycle.recover('recover');
    },

    snapshot(): AppSnapshot {
      return {
        perf: perf.snapshot(),
        loop: loop.stats,
        lifecycle: lifecycle.state,
        viewport
      };
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      unsubscribe();
      overlay?.dispose();
      deps.renderPort.dispose();
      lifecycle.unload();
      perf.reset();
      loop.resetCounters();
    }
  };

  return app;
}

const EMPTY_RAW_SAMPLE = emptyRawSample();