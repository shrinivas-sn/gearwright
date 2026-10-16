import { describe, expect, it, vi } from 'vitest';

import { DomInputSource } from '../../src/adapters/dom-input-source.ts';

/**
 * `DomInputSource` — the L4 pointer-keyboard adapter (ARCH §15, EC-BRN-05/06).
 *
 * The adapter owns two things the unit suites cannot see through `InputSystem`:
 * device listeners (edges, deltas) and the *pointer-lock handshake* — which jsdom
 * does not implement, so the two APIs the browser provides
 * (`requestPointerLock`, `document.pointerLockElement`) are stubbed here exactly
 * as a browser would answer: a promise for the request, an event for the state.
 *
 * What Bug 21 taught: a third-person game whose look is fed by a free cursor
 * sticks to a screen edge and stops answering, and a page whose surface never
 * takes keyboard focus leaves every key silently dead. The capture is therefore
 * an explicit, reported handshake — never an assumption — with raw deltas as the
 * fallback the player can always fall back on.
 */

function makeCanvas(): { canvas: HTMLCanvasElement; request: ReturnType<typeof vi.fn> } {
  const canvas = document.createElement('canvas');
  document.body.appendChild(canvas);
  const request = vi.fn(() => undefined);
  Object.defineProperty(canvas, 'requestPointerLock', { value: request, configurable: true });
  return { canvas, request };
}

/** jsdom leaves `pointerLockElement` unset; the browser sets it before the event fires. */
function setPointerLockElement(element: Element | null): void {
  Object.defineProperty(document, 'pointerLockElement', { value: element, configurable: true });
}

describe('DomInputSource — pointer-lock handshake', () => {
  it('requests capture through its lock target and reports the state the document reports', async () => {
    const { canvas, request } = makeCanvas();
    const changes: boolean[] = [];
    const source = new DomInputSource({
      keyTarget: window,
      mouseTarget: canvas,
      lockTarget: canvas,
      onPointerLockChange: (locked) => changes.push(locked)
    });
    expect(source.isPointerLocked).toBe(false);

    await source.requestPointerLock();
    expect(request).toHaveBeenCalledTimes(1);

    // The grant arrives as a document event, never as the request's return value.
    setPointerLockElement(canvas);
    document.dispatchEvent(new Event('pointerlockchange'));
    expect(source.isPointerLocked).toBe(true);

    // Esc releases the capture natively: the adapter must notice and report it.
    setPointerLockElement(null);
    document.dispatchEvent(new Event('pointerlockchange'));
    expect(source.isPointerLocked).toBe(false);
    expect(changes).toEqual([true, false]);

    source.dispose();
    canvas.remove();
  });

  it('reports a refused request and keeps raw look deltas flowing', async () => {
    const { canvas, request } = makeCanvas();
    request.mockImplementation(() => Promise.reject(new Error('NotAllowedError: denied')));
    const refusals: string[] = [];
    const source = new DomInputSource({
      keyTarget: window,
      mouseTarget: canvas,
      lockTarget: canvas,
      onPointerLockError: (reason) => refusals.push(reason)
    });

    await source.requestPointerLock();
    expect(refusals).toHaveLength(1);
    expect(refusals[0]).toContain('NotAllowedError');

    // The fallback is the point: a free cursor still looks, so the game stays playable.
    const move = new MouseEvent('mousemove');
    Object.defineProperty(move, 'movementX', { value: 12 });
    Object.defineProperty(move, 'movementY', { value: -4 });
    canvas.dispatchEvent(move);
    const sample = source.sample();
    expect(sample.lookDeltaX).toBe(12);
    expect(sample.lookDeltaY).toBe(-4);

    source.dispose();
    canvas.remove();
  });

  it('reports a pointerlockerror event once, and forgets the refusal on the next request', async () => {
    const { canvas } = makeCanvas();
    const refusals: string[] = [];
    const source = new DomInputSource({
      keyTarget: window,
      mouseTarget: canvas,
      lockTarget: canvas,
      onPointerLockError: (reason) => refusals.push(reason)
    });

    document.dispatchEvent(new Event('pointerlockerror'));
    document.dispatchEvent(new Event('pointerlockerror'));
    expect(refusals).toHaveLength(1);

    // A new request is a new handshake: one more report is honest, not noise.
    await source.requestPointerLock();
    document.dispatchEvent(new Event('pointerlockerror'));
    expect(refusals).toHaveLength(2);

    source.dispose();
    canvas.remove();
  });

  it('detaches its document listeners on dispose', () => {
    const { canvas } = makeCanvas();
    const refusals: string[] = [];
    const source = new DomInputSource({
      keyTarget: window,
      mouseTarget: canvas,
      lockTarget: canvas,
      onPointerLockError: (reason) => refusals.push(reason)
    });
    source.dispose();

    document.dispatchEvent(new Event('pointerlockerror'));
    expect(refusals).toEqual([]);
    canvas.remove();
  });

  it('is a safe no-op without a lock target (headless tooling, non-DOM wiring)', async () => {
    const { canvas } = makeCanvas();
    const source = new DomInputSource({ keyTarget: window, mouseTarget: canvas });

    await expect(source.requestPointerLock()).resolves.toBeUndefined();
    source.releasePointerLock();
    expect(source.isPointerLocked).toBe(false);

    source.dispose();
    canvas.remove();
  });

  it('releases the capture without inventing one', () => {
    const { canvas } = makeCanvas();
    const exit = vi.fn();
    Object.defineProperty(document, 'exitPointerLock', { value: exit, configurable: true });
    const source = new DomInputSource({ keyTarget: window, mouseTarget: canvas, lockTarget: canvas });

    // Nothing is captured: releasing must not disturb the document.
    source.releasePointerLock();
    expect(exit).not.toHaveBeenCalled();

    setPointerLockElement(canvas);
    source.releasePointerLock();
    expect(exit).toHaveBeenCalledTimes(1);

    setPointerLockElement(null);
    source.dispose();
    canvas.remove();
  });
});

/**
 * The two mouse buttons (weapons pass, 16/10/2026): button 0 is the trigger and button 2
 * aims down sights, so the adapter has to track the right button with the same edge
 * discipline as the left one — held / pressed-this-step / released-this-step — and jsdom
 * supplies the real `MouseEvent.button` values, which is exactly the part that could be
 * wrong.
 */
describe('DomInputSource — mouse buttons', () => {
  function press(source: DomInputSource, canvas: HTMLCanvasElement, button: number): void {
    canvas.dispatchEvent(new MouseEvent('mousedown', { button }));
    source.sample();
  }

  it('tracks the right button as held/edges without leaking into the left button', () => {
    const { canvas } = makeCanvas();
    const source = new DomInputSource({ keyTarget: window, mouseTarget: canvas });

    canvas.dispatchEvent(new MouseEvent('mousedown', { button: 2 }));
    const down = source.sample();
    expect(down.secondaryHeld).toBe(true);
    expect(down.secondaryPressed).toBe(true);
    expect(down.primaryHeld).toBe(false);
    expect(down.primaryPressed).toBe(false);

    // The edge is a one-shot: the next sample still reports the hold but no new press.
    const held = source.sample();
    expect(held.secondaryHeld).toBe(true);
    expect(held.secondaryPressed).toBe(false);

    // Mouse-up is bound on the key target (the window), exactly as the left button is.
    window.dispatchEvent(new MouseEvent('mouseup', { button: 2 }));
    const up = source.sample();
    expect(up.secondaryHeld).toBe(false);
    expect(up.secondaryReleased).toBe(true);

    source.dispose();
    canvas.remove();
  });

  it('releases the right button on clearAll (blur keeps no stale aim)', () => {
    const { canvas } = makeCanvas();
    const source = new DomInputSource({ keyTarget: window, mouseTarget: canvas });

    press(source, canvas, 2);
    source.clearAll();
    const cleared = source.sample();
    expect(cleared.secondaryHeld).toBe(false);
    expect(cleared.secondaryPressed).toBe(false);

    // Re-pressing after a clear is a real press again (no latch left behind).
    canvas.dispatchEvent(new MouseEvent('mousedown', { button: 2 }));
    expect(source.sample().secondaryPressed).toBe(true);

    source.dispose();
    canvas.remove();
  });

  it('ignores buttons the game does not use', () => {
    const { canvas } = makeCanvas();
    const source = new DomInputSource({ keyTarget: window, mouseTarget: canvas });

    canvas.dispatchEvent(new MouseEvent('mousedown', { button: 1 }));
    const middle = source.sample();
    expect(middle.primaryHeld).toBe(false);
    expect(middle.secondaryHeld).toBe(false);

    source.dispose();
    canvas.remove();
  });
});
