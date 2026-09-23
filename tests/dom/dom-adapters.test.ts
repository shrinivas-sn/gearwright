import { describe, expect, it, vi } from 'vitest';

import {
  bindBrowserEvents,
  bindFirstGesture,
  detectWebGL2,
  requireElement
} from '../../src/adapters/browser-events.ts';
import { FixedStepLoop } from '../../src/core/loop.ts';
import { FrameStatsRecorder } from '../../src/core/perf.ts';
import { PerfOverlay } from '../../src/debug/overlay.ts';

/** Builds realistic overlay data from the real (headless) core modules. */
function buildOverlayData(drawCalls: number) {
  const recorder = new FrameStatsRecorder({}, 10);
  recorder.record({ frameMs: 16.7, steps: 2, drawCalls, triangles: 1_500, lights: 2 });
  const loop = new FixedStepLoop({ fixedStep: () => {}, render: () => {} });

  return {
    perf: recorder.snapshot(),
    loop: loop.stats,
    lifecycle: 'running' as const,
    drawCalls,
    triangles: 1_500,
    lights: 2
  };
}

describe('PerfOverlay — debug tooling (ARCH §37)', () => {
  it('renders a diagnostics panel inside the provided root', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);

    const overlay = new PerfOverlay(root, { visible: true, updateIntervalMs: 0 });
    overlay.update(buildOverlayData(40), 1000);

    const panel = root.querySelector('.gw-debug-panel');
    expect(panel).not.toBeNull();
    expect(panel?.innerHTML).toContain('gearwright');
    expect(panel?.innerHTML).toContain('draws 40');
    expect(panel?.innerHTML).toContain('running');

    overlay.dispose();
  });

  it('throttles DOM writes so the overlay cannot distort measurements', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);

    const overlay = new PerfOverlay(root, { visible: true, updateIntervalMs: 500 });
    overlay.update(buildOverlayData(40), 1000);
    overlay.update(buildOverlayData(999), 1100); // inside the throttle window

    expect(root.querySelector('.gw-debug-panel')?.innerHTML).toContain('draws 40');

    overlay.update(buildOverlayData(999), 1600); // past the window
    expect(root.querySelector('.gw-debug-panel')?.innerHTML).toContain('draws 999');

    overlay.dispose();
  });

  it('toggles with F3 and hides the panel', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);

    const overlay = new PerfOverlay(root, { visible: true, toggleKey: 'F3', updateIntervalMs: 0 });
    const panel = root.querySelector<HTMLElement>('.gw-debug-panel');
    expect(panel?.style.display).toBe('block');

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F3' }));

    expect(overlay.visible).toBe(false);
    expect(panel?.style.display).toBe('none');

    overlay.dispose();
  });

  it('stops writing and detaches listeners on dispose', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);

    const overlay = new PerfOverlay(root, { visible: true, updateIntervalMs: 0 });
    overlay.update(buildOverlayData(40), 0);
    overlay.dispose();

    expect(root.querySelector('.gw-debug-panel')).toBeNull();

    // Toggling after dispose must not throw (listener removed).
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F3' }));
  });
});

describe('bindBrowserEvents — platform plumbing (EC-BRN-01/03/05/07)', () => {
  function createHarness() {
    const canvas = document.createElement('canvas');
    document.body.appendChild(canvas);
    const handlers = {
      onResize: vi.fn(),
      onVisibilityChange: vi.fn(),
      onFocusChange: vi.fn(),
      onContextLost: vi.fn(),
      onContextRestored: vi.fn()
    };
    const unbind = bindBrowserEvents(window, canvas, handlers, { coalesceResize: false });
    return { canvas, handlers, unbind };
  }

  it('forwards resize with the current viewport and pixel ratio', () => {
    const harness = createHarness();

    window.dispatchEvent(new Event('resize'));

    expect(harness.handlers.onResize).toHaveBeenCalledTimes(1);
    const [width, height, pixelRatio] = harness.handlers.onResize.mock.calls[0] ?? [];
    expect(width).toBeGreaterThan(0);
    expect(height).toBeGreaterThan(0);
    expect(pixelRatio).toBeGreaterThan(0);

    harness.unbind();
  });

  it('maps visibility changes to a hidden flag', () => {
    const harness = createHarness();

    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));

    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));

    expect(harness.handlers.onVisibilityChange).toHaveBeenNthCalledWith(1, true);
    expect(harness.handlers.onVisibilityChange).toHaveBeenNthCalledWith(2, false);

    harness.unbind();
  });

  it('reports focus gained and lost (EC-BRN-05)', () => {
    const harness = createHarness();

    window.dispatchEvent(new Event('blur'));
    window.dispatchEvent(new Event('focus'));

    expect(harness.handlers.onFocusChange).toHaveBeenNthCalledWith(1, false);
    expect(harness.handlers.onFocusChange).toHaveBeenNthCalledWith(2, true);

    harness.unbind();
  });

  it('prevents default on context loss so the browser may restore it (EC-BRN-07)', () => {
    const harness = createHarness();

    const lost = new Event('webglcontextlost', { cancelable: true });
    harness.canvas.dispatchEvent(lost);
    harness.canvas.dispatchEvent(new Event('webglcontextrestored'));

    expect(harness.handlers.onContextLost).toHaveBeenCalledTimes(1);
    expect(lost.defaultPrevented).toBe(true);
    expect(harness.handlers.onContextRestored).toHaveBeenCalledTimes(1);

    harness.unbind();
  });

  it('detaches every listener when unbound, and unbinding is idempotent', () => {
    const harness = createHarness();
    harness.unbind();
    harness.unbind();

    window.dispatchEvent(new Event('resize'));
    window.dispatchEvent(new Event('blur'));
    harness.canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));

    expect(harness.handlers.onResize).not.toHaveBeenCalled();
    expect(harness.handlers.onFocusChange).not.toHaveBeenCalled();
    expect(harness.handlers.onContextLost).not.toHaveBeenCalled();
  });
});

describe('bindFirstGesture — EC-BRN-08 audio unlock (ADR-011)', () => {
  it('unlocks on the first gesture and then stops listening', () => {
    const unlock = vi.fn(() => true);
    const release = bindFirstGesture(window, unlock);

    window.dispatchEvent(new Event('pointerdown'));
    expect(unlock).toHaveBeenCalledTimes(1);

    // Once the callback reports success the binding is spent: no further calls, and the
    // keydown fallback is detached too.
    window.dispatchEvent(new Event('pointerdown'));
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
    expect(unlock).toHaveBeenCalledTimes(1);

    release();
    release(); // safe to call twice
    window.dispatchEvent(new Event('pointerdown'));
    expect(unlock).toHaveBeenCalledTimes(1);
  });

  it('keeps watching until the callback reports the unlock was delivered', () => {
    // A refused resume leaves the callback unsatisfied, so the honest retry is the next
    // real gesture — never a timer.
    let delivered = false;
    const unlock = vi.fn(() => delivered);
    const release = bindFirstGesture(window, unlock);

    window.dispatchEvent(new Event('pointerdown'));
    expect(unlock).toHaveBeenCalledTimes(1);

    delivered = true;
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
    expect(unlock).toHaveBeenCalledTimes(2);

    // Delivered: the binding is gone.
    window.dispatchEvent(new Event('pointerdown'));
    expect(unlock).toHaveBeenCalledTimes(2);

    release();
  });

  it('can be bound to a custom gesture set, and detaches it on release', () => {
    const unlock = vi.fn(() => false);
    const release = bindFirstGesture(window, unlock, ['touchstart']);

    window.dispatchEvent(new Event('pointerdown')); // not in this set
    expect(unlock).not.toHaveBeenCalled();

    window.dispatchEvent(new Event('touchstart'));
    expect(unlock).toHaveBeenCalledTimes(1);

    release();
    window.dispatchEvent(new Event('touchstart'));
    expect(unlock).toHaveBeenCalledTimes(1);
  });
});

describe('browser environment helpers', () => {
  it('detects WebGL2 capability without throwing when unavailable', () => {
    // jsdom has no WebGL2 implementation: the probe must report false, not crash.
    expect(typeof detectWebGL2(window)).toBe('boolean');
  });

  it('throws a typed error when a required element is missing', () => {
    expect(() => requireElement(document, '#does-not-exist')).toThrow(/ERR-ADAPTER-DOM-01/);
  });

  it('returns the element when present', () => {
    const element = document.createElement('div');
    element.id = 'present-for-test';
    document.body.appendChild(element);

    expect(requireElement(document, '#present-for-test')).toBe(element);
  });
});