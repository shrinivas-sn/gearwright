import { describe, expect, it, vi } from 'vitest';

import { Lifecycle, type LifecycleTransition } from '../../src/core/lifecycle.ts';

describe('Lifecycle — valid transitions', () => {
  it('starts in `booting` with simulation inactive', () => {
    const lifecycle = new Lifecycle();

    expect(lifecycle.state).toBe('booting');
    expect(lifecycle.isSimulationActive).toBe(false);
    expect(lifecycle.isInteractive).toBe(false);
  });

  it('start() moves booting -> running and activates simulation', () => {
    const lifecycle = new Lifecycle();

    expect(lifecycle.start()).toBe(true);
    expect(lifecycle.state).toBe('running');
    expect(lifecycle.isSimulationActive).toBe(true);
    expect(lifecycle.isInteractive).toBe(true);
  });

  it('pause/resume toggles between running and paused', () => {
    const lifecycle = new Lifecycle();
    lifecycle.start();

    expect(lifecycle.requestPause('menu')).toBe(true);
    expect(lifecycle.state).toBe('paused');
    expect(lifecycle.isSimulationActive).toBe(false);

    expect(lifecycle.resume()).toBe(true);
    expect(lifecycle.state).toBe('running');
    expect(lifecycle.isSimulationActive).toBe(true);
  });

  it('suspend from running restores back to running', () => {
    const lifecycle = new Lifecycle();
    lifecycle.start();

    expect(lifecycle.suspend('visibility')).toBe(true);
    expect(lifecycle.state).toBe('suspended');
    expect(lifecycle.isSimulationActive).toBe(false);

    expect(lifecycle.restore('visibility')).toBe(true);
    expect(lifecycle.state).toBe('running');
  });

  it('suspend from paused restores back to paused (no silent un-pause)', () => {
    const lifecycle = new Lifecycle();
    lifecycle.start();
    lifecycle.requestPause('user');

    lifecycle.suspend('visibility');
    lifecycle.restore('visibility');

    expect(lifecycle.state).toBe('paused');
    expect(lifecycle.isSimulationActive).toBe(false);
  });

  it('fail() records the error and recover() returns to the prior state', () => {
    const lifecycle = new Lifecycle();
    lifecycle.start();
    const failure = new Error('ERR-WebGLContextLost');

    expect(lifecycle.fail(failure, 'context-loss')).toBe(true);
    expect(lifecycle.state).toBe('error');
    expect(lifecycle.error).toBe(failure);
    expect(lifecycle.isSimulationActive).toBe(false);

    expect(lifecycle.recover()).toBe(true);
    expect(lifecycle.state).toBe('running');
    expect(lifecycle.error).toBeNull();
  });

  it('unload() is terminal', () => {
    const lifecycle = new Lifecycle();
    lifecycle.start();

    expect(lifecycle.unload()).toBe(true);
    expect(lifecycle.state).toBe('unloaded');

    expect(lifecycle.start()).toBe(false);
    expect(lifecycle.requestPause()).toBe(false);
    expect(lifecycle.suspend()).toBe(false);
    expect(lifecycle.fail(new Error('late'))).toBe(false);
    expect(lifecycle.unload()).toBe(false);
    expect(lifecycle.state).toBe('unloaded');
  });
});

describe('Lifecycle — invalid transitions are rejected by value, not thrown (ARCH §38)', () => {
  it('rejects out-of-order calls without changing state', () => {
    const lifecycle = new Lifecycle();

    expect(lifecycle.resume()).toBe(false); // cannot resume before start
    expect(lifecycle.requestPause()).toBe(false); // cannot pause while booting
    expect(lifecycle.restore()).toBe(false); // nothing suspended
    expect(lifecycle.recover()).toBe(false); // no error to recover from
    expect(lifecycle.state).toBe('booting');
  });

  it('rejects restoring twice and recovering twice', () => {
    const lifecycle = new Lifecycle();
    lifecycle.start();
    lifecycle.suspend();
    expect(lifecycle.restore()).toBe(true);
    expect(lifecycle.restore()).toBe(false);

    lifecycle.fail(new Error('x'));
    expect(lifecycle.recover()).toBe(true);
    expect(lifecycle.recover()).toBe(false);
  });

  it('rejects a second fail() while already in error state', () => {
    const lifecycle = new Lifecycle();
    lifecycle.start();

    expect(lifecycle.fail(new Error('first'))).toBe(true);
    expect(lifecycle.fail(new Error('second'))).toBe(false);
    expect((lifecycle.error as Error).message).toBe('first');
  });
});

describe('Lifecycle — subscribers', () => {
  it('notifies subscribers with from/to/reason and stops after unsubscribe', () => {
    const lifecycle = new Lifecycle();
    const listener = vi.fn<(transition: LifecycleTransition) => void>();
    const unsubscribe = lifecycle.subscribe(listener);

    lifecycle.start();
    lifecycle.requestPause('focus-loss');

    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenNthCalledWith(1, { from: 'booting', to: 'running', reason: 'start' });
    expect(listener).toHaveBeenNthCalledWith(2, { from: 'running', to: 'paused', reason: 'focus-loss' });

    unsubscribe();
    lifecycle.resume();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('emits nothing for rejected transitions', () => {
    const lifecycle = new Lifecycle();
    const listener = vi.fn<(transition: LifecycleTransition) => void>();
    lifecycle.subscribe(listener);

    lifecycle.resume();
    lifecycle.restore();
    lifecycle.recover();

    expect(listener).not.toHaveBeenCalled();
  });

  it('supports multiple independent subscribers', () => {
    const lifecycle = new Lifecycle();
    const first = vi.fn<(transition: LifecycleTransition) => void>();
    const second = vi.fn<(transition: LifecycleTransition) => void>();
    lifecycle.subscribe(first);
    lifecycle.subscribe(second);

    lifecycle.start();

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });
});