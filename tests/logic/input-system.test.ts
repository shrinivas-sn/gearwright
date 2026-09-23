import { describe, expect, it } from 'vitest';

import {
  DEFAULT_BINDINGS,
  EMPTY_ACTIONS,
  InputSystem,
  neutralSample
} from '../../src/gameplay/input-system.ts';

describe('InputSystem — configuration', () => {
  it('starts in Exploration with the default bindings', () => {
    const input = new InputSystem();
    expect(input.activeContext).toBe('Exploration');
    expect(input.bindingSnapshot).toEqual(DEFAULT_BINDINGS);
    expect(input.actions).toEqual(EMPTY_ACTIONS);
  });

  it('merges partial binding overrides onto the defaults', () => {
    const input = new InputSystem({ bindings: { forward: 'ArrowUp', lookSensitivity: 100 } });
    expect(input.bindingSnapshot.forward).toBe('ArrowUp');
    expect(input.bindingSnapshot.lookSensitivity).toBe(100);
    expect(input.bindingSnapshot.back).toBe(DEFAULT_BINDINGS.back);
  });

  it('honours an explicit starting context', () => {
    expect(new InputSystem({ context: 'UIMenu' }).activeContext).toBe('UIMenu');
  });
});

describe('InputSystem — Exploration actions', () => {
  it('maps held movement keys to camera-relative intent axes', () => {
    const input = new InputSystem();

    expect(input.sample(neutralSample({ held: new Set(['KeyW']) })).moveZ).toBe(1);
    expect(input.sample(neutralSample({ held: new Set(['KeyS']) })).moveZ).toBe(-1);
    expect(input.sample(neutralSample({ held: new Set(['KeyD']) })).moveX).toBe(1);
    expect(input.sample(neutralSample({ held: new Set(['KeyA']) })).moveX).toBe(-1);
  });

  it('cancels opposing keys to zero', () => {
    const input = new InputSystem();
    const actions = input.sample(neutralSample({ held: new Set(['KeyW', 'KeyS', 'KeyA', 'KeyD']) }));
    expect(actions.moveX).toBe(0);
    expect(actions.moveZ).toBe(0);
  });

  it('maps diagonal movement to unit-range components', () => {
    const input = new InputSystem();
    const actions = input.sample(neutralSample({ held: new Set(['KeyW', 'KeyD']) }));
    expect(actions.moveX).toBe(1);
    expect(actions.moveZ).toBe(1);
  });

  it('reads the run modifier, look deltas, and one-shot edges', () => {
    const input = new InputSystem();
    const actions = input.sample(
      neutralSample({
        held: new Set(['ShiftLeft']),
        pressed: new Set(['KeyE', 'KeyR', 'Escape', DEFAULT_BINDINGS.hint]),
        lookDeltaX: 12,
        lookDeltaY: -8
      })
    );

    expect(actions.run).toBe(true);
    expect(actions.lookDeltaX).toBe(12);
    expect(actions.lookDeltaY).toBe(-8);
    expect(actions.primary).toBe(true);
    expect(actions.secondary).toBe(true);
    expect(actions.cancel).toBe(true);
    expect(actions.pause).toBe(true);
    // M10 (§29.2): the hint request is a one-shot Exploration edge like pause.
    expect(actions.hint).toBe(true);
  });

  it('accepts the primary mouse button as a primary action', () => {
    const input = new InputSystem();
    expect(input.sample(neutralSample({ primaryPressed: true })).primary).toBe(true);
    expect(input.sample(neutralSample({ primaryHeld: true })).primary).toBe(false);
  });

  it('does not synthesise edges from held state', () => {
    const input = new InputSystem();
    const actions = input.sample(
      neutralSample({ held: new Set(['KeyE', 'Escape', DEFAULT_BINDINGS.hint]) })
    );
    expect(actions.primary).toBe(false);
    expect(actions.cancel).toBe(false);
    expect(actions.pause).toBe(false);
    expect(actions.hint).toBe(false);
  });

  it('does not synthesise a hint edge from held state alone either', () => {
    const input = new InputSystem();
    const actions = input.sample(neutralSample({ held: new Set([DEFAULT_BINDINGS.hint]) }));
    expect(actions.hint).toBe(false);
  });
});

describe('InputSystem — look clamping (EC-BRN-06)', () => {
  it('clamps per-step look deltas to the configured cap', () => {
    const input = new InputSystem();
    const actions = input.sample(neutralSample({ lookDeltaX: 100_000, lookDeltaY: -100_000 }));
    expect(actions.lookDeltaX).toBe(DEFAULT_BINDINGS.maxLookDeltaPerStep);
    expect(actions.lookDeltaY).toBe(-DEFAULT_BINDINGS.maxLookDeltaPerStep);
  });

  it('sanitises non-finite look deltas to zero', () => {
    const input = new InputSystem();
    const actions = input.sample(
      neutralSample({ lookDeltaX: Number.NaN, lookDeltaY: Number.POSITIVE_INFINITY })
    );
    expect(actions.lookDeltaX).toBe(0);
    expect(actions.lookDeltaY).toBe(0);
  });

  it('respects a custom cap', () => {
    const input = new InputSystem({ bindings: { maxLookDeltaPerStep: 5 } });
    expect(input.sample(neutralSample({ lookDeltaX: 50 })).lookDeltaX).toBe(5);
  });
});

describe('InputSystem — context routing', () => {
  it('exposes only the pause affordance and look in Paused', () => {
    const input = new InputSystem({ context: 'Paused' });
    const actions = input.sample(
      neutralSample({ held: new Set(['KeyW']), pressed: new Set(['Escape']), lookDeltaX: 3 })
    );

    expect(actions.moveZ).toBe(0);
    expect(actions.pause).toBe(true);
    expect(actions.lookDeltaX).toBe(3);
    expect(actions.cancel).toBe(false);
  });

  it('treats UIMenu like Paused (no gameplay input)', () => {
    const input = new InputSystem({ context: 'UIMenu' });
    const actions = input.sample(neutralSample({ held: new Set(['KeyW', 'ShiftLeft']) }));

    expect(actions.moveZ).toBe(0);
    expect(actions.run).toBe(false);
    expect(actions.pause).toBe(false);
  });

  it('routes the manipulation action set (M3): slow strafe, rotate, drop, cancel', () => {
    const input = new InputSystem({ context: 'Manipulation' });
    const actions = input.sample(
      neutralSample({
        held: new Set(['KeyW', 'KeyE', 'ShiftLeft']),
        pressed: new Set(['Escape', 'KeyR']),
        lookDeltaY: 4,
        primaryPressed: true
      })
    );

    // Movement continues while carrying, but never as a run (ARCH §15).
    expect(actions.moveZ).toBe(1);
    expect(actions.run).toBe(false);
    expect(actions.lookDeltaY).toBe(4);
    // Q/E rotate the held object here: `E` is the grab key only in Exploration.
    expect(actions.rotate).toBe(1);
    expect(actions.primary).toBe(true); // mouse: rotation/attach confirm
    expect(actions.secondary).toBe(true); // drop
    expect(actions.cancel).toBe(true);
    // Esc is handled at the platform edge while holding, so it is not routed here.
    expect(actions.pause).toBe(false);
  });

  it('reports the rotate axis as −1 on Q and 0 when idle', () => {
    const input = new InputSystem({ context: 'Manipulation' });
    expect(input.sample(neutralSample()).rotate).toBe(0);
    expect(input.sample(neutralSample({ held: new Set(['KeyQ']) })).rotate).toBe(-1);
  });

  it('reports no rotate intent in Exploration (grab keeps the E binding)', () => {
    const input = new InputSystem();
    const actions = input.sample(neutralSample({ held: new Set(['KeyE']), pressed: new Set(['KeyE']) }));

    expect(actions.rotate).toBe(0);
    expect(actions.primary).toBe(true);
  });

  it('clears the snapshot when the context changes (no stale holds)', () => {
    const input = new InputSystem();
    input.sample(neutralSample({ held: new Set(['KeyW']) }));
    expect(input.actions.moveZ).toBe(1);

    input.setContext('Paused');
    expect(input.activeContext).toBe('Paused');
    expect(input.actions).toEqual(EMPTY_ACTIONS);
  });

  it('clears the snapshot explicitly (blur / visibility loss)', () => {
    const input = new InputSystem();
    input.sample(neutralSample({ held: new Set(['KeyW']), lookDeltaX: 10 }));

    input.clearSnapshot();
    expect(input.actions).toEqual(EMPTY_ACTIONS);
    expect(input.activeContext).toBe('Exploration');
  });
});

describe('InputSystem — neutralSample helper', () => {
  it('produces a fully neutral raw sample', () => {
    const sample = neutralSample();
    expect(sample.held.size).toBe(0);
    expect(sample.pressed.size).toBe(0);
    expect(sample.released.size).toBe(0);
    expect(sample.lookDeltaX).toBe(0);
    expect(sample.lookDeltaY).toBe(0);
    expect(sample.primaryHeld).toBe(false);
    expect(sample.primaryPressed).toBe(false);
    expect(sample.primaryReleased).toBe(false);
  });

  it('applies overrides without dropping the rest of the shape', () => {
    const sample = neutralSample({ held: new Set(['KeyW']), lookDeltaX: 7 });
    expect(sample.held.has('KeyW')).toBe(true);
    expect(sample.lookDeltaX).toBe(7);
    expect(sample.pressed.size).toBe(0);
  });
});
