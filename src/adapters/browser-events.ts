/**
 * L4 ADAPTER — browser event bindings (ARCH §13, EC-BRN-01…07).
 *
 * Why this exists: `src/core/**` must contain zero DOM/window references
 * (ARCH §11 rule R2). All platform plumbing is therefore translated here into
 * explicit, typed calls — which also makes the pause/suspend/recover behaviour
 * unit-testable against the pure `Lifecycle` machine.
 */

export interface BrowserEventHandlers {
  /** Viewport changed. `pixelRatio` is the device value; the renderer caps it per tier. */
  onResize(width: number, height: number, pixelRatio: number): void;
  /** Tab hidden/shown (`visibilitychange`). */
  onVisibilityChange(hidden: boolean): void;
  /** Window focus gained/lost (`blur`/`focus`) — clears stuck input (EC-BRN-05). */
  onFocusChange(focused: boolean): void;
  /** WebGL context lost (EC-BRN-07). */
  onContextLost(): void;
  /** WebGL context restored (EC-BRN-07). */
  onContextRestored(): void;
}

export interface BindOptions {
  /** Coalesce resize work into a single animation frame. Default true. */
  readonly coalesceResize?: boolean;
}

/**
 * Bind platform listeners and return an unsubscribe function.
 * The returned disposer is always safe to call more than once.
 */
export function bindBrowserEvents(
  win: Window,
  canvas: HTMLCanvasElement,
  handlers: BrowserEventHandlers,
  options: BindOptions = {}
): () => void {
  const coalesceResize = options.coalesceResize ?? true;
  let pendingResizeFrame: number | null = null;

  const readSize = (): { width: number; height: number; pixelRatio: number } => ({
    width: win.innerWidth || canvas.clientWidth || 1,
    height: win.innerHeight || canvas.clientHeight || 1,
    pixelRatio: win.devicePixelRatio || 1
  });

  const applyResize = (): void => {
    pendingResizeFrame = null;
    const { width, height, pixelRatio } = readSize();
    handlers.onResize(width, height, pixelRatio);
  };

  const handleResize = (): void => {
    if (!coalesceResize) {
      applyResize();
      return;
    }
    if (pendingResizeFrame !== null) return;
    pendingResizeFrame = win.requestAnimationFrame(() => applyResize());
  };

  const handleVisibility = (): void => {
    handlers.onVisibilityChange(win.document.visibilityState === 'hidden');
  };

  const handleFocus = (): void => {
    handlers.onFocusChange(true);
  };

  const handleBlur = (): void => {
    handlers.onFocusChange(false);
  };

  const handleContextLost = (event: Event): void => {
    // Preventing default is required for the browser to attempt a restore.
    event.preventDefault();
    handlers.onContextLost();
  };

  const handleContextRestored = (): void => {
    handlers.onContextRestored();
  };

  win.addEventListener('resize', handleResize);
  win.addEventListener('orientationchange', handleResize);
  win.document.addEventListener('visibilitychange', handleVisibility);
  win.addEventListener('focus', handleFocus);
  win.addEventListener('blur', handleBlur);
  canvas.addEventListener('webglcontextlost', handleContextLost, false);
  canvas.addEventListener('webglcontextrestored', handleContextRestored, false);

  return () => {
    if (pendingResizeFrame !== null) {
      win.cancelAnimationFrame(pendingResizeFrame);
      pendingResizeFrame = null;
    }
    win.removeEventListener('resize', handleResize);
    win.removeEventListener('orientationchange', handleResize);
    win.document.removeEventListener('visibilitychange', handleVisibility);
    win.removeEventListener('focus', handleFocus);
    win.removeEventListener('blur', handleBlur);
    canvas.removeEventListener('webglcontextlost', handleContextLost, false);
    canvas.removeEventListener('webglcontextrestored', handleContextRestored, false);
  };
}

/** The gesture events an unlock may ride on: a real user activation, never a timer. */
export type GestureEventName = 'pointerdown' | 'keydown' | 'touchstart' | 'mousedown';

/**
 * EC-BRN-08's gesture unlock (ADR-011): an `AudioContext` is created suspended and only
 * a user gesture may resume it, so this binds the *first* real gesture to `onGesture`.
 *
 * The callback decides when the binding is done — `true` releases the listeners, `false`
 * keeps them watching — because a resume can be refused, and the honest retry is "the
 * next time the player actually interacts", not a timer or a loop. Returns a disposer
 * that is always safe to call more than once.
 */
export function bindFirstGesture(
  win: Window,
  onGesture: () => boolean,
  events: ReadonlyArray<GestureEventName> = ['pointerdown', 'keydown']
): () => void {
  let released = false;

  const release = (): void => {
    if (released) return;
    released = true;
    for (const event of events) win.removeEventListener(event, handle);
  };

  const handle = (): void => {
    if (released) return;
    if (onGesture()) release();
  };

  for (const event of events) win.addEventListener(event, handle, { passive: true });
  return release;
}

/** Environment capability probe used at boot (EC-BRN-10). */
export function detectWebGL2(win: Window): boolean {
  try {
    const probe = win.document.createElement('canvas');
    // `in`-narrowing avoids touching the constructor directly, which lib.dom
    // types declare on `Window` only conditionally.
    return 'WebGL2RenderingContext' in win && probe.getContext('webgl2') !== null;
  } catch {
    return false;
  }
}

/** Resolve the required DOM roots from the page shell, failing loudly if absent. */
export function requireElement<T extends Element>(doc: Document, selector: string): T {
  const element = doc.querySelector<T>(selector);
  if (!element) {
    throw new Error(`ERR-ADAPTER-DOM-01: required element "${selector}" is missing from the page shell`);
  }
  return element;
}