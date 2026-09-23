/**
 * L0 PLATFORM CORE — application lifecycle state machine (ARCH §13).
 *
 * Pure logic: no DOM listeners live here (rule R2). An L4 adapter
 * (`adapters/browser-events.ts`) translates window/document/WebGL events into
 * these explicit calls, which keeps the rules testable headlessly and makes the
 * pause/suspend/recover paths (EC-BRN-03/05/07) verifiable in unit tests.
 *
 * Invalid transitions are *rejected by return value*, never by throwing
 * (ARCH §38.2 rule 1).
 */

export type LifecycleState = 'booting' | 'running' | 'paused' | 'suspended' | 'error' | 'unloaded';

export type LifecycleReason =
  | 'start'
  | 'boot'
  | 'user'
  | 'menu'
  | 'focus-loss'
  | 'visibility'
  | 'context-loss'
  | 'storage'
  | 'recover'
  | 'shutdown';

export interface LifecycleTransition {
  readonly from: LifecycleState;
  readonly to: LifecycleState;
  readonly reason: LifecycleReason;
}

export type LifecycleListener = (transition: LifecycleTransition) => void;

/** States in which the simulation may advance. */
const SIMULATION_ACTIVE: ReadonlySet<LifecycleState> = new Set<LifecycleState>(['running']);

export class Lifecycle {
  private currentState: LifecycleState = 'booting';
  private stateBeforeInterruption: LifecycleState | null = null;
  private lastError: unknown = null;
  private readonly listeners = new Set<LifecycleListener>();

  get state(): LifecycleState {
    return this.currentState;
  }

  /** True only while the simulation should advance (drives the fixed-step loop). */
  get isSimulationActive(): boolean {
    return SIMULATION_ACTIVE.has(this.currentState);
  }

  get isInteractive(): boolean {
    return this.currentState === 'running' || this.currentState === 'paused';
  }

  get error(): unknown {
    return this.lastError;
  }

  /** booting -> running. */
  start(reason: LifecycleReason = 'start'): boolean {
    if (this.currentState !== 'booting') return false;
    return this.transition('running', reason);
  }

  /** running -> paused (explicit pause: menu, user, focus loss). */
  requestPause(reason: LifecycleReason = 'user'): boolean {
    if (this.currentState !== 'running') return false;
    return this.transition('paused', reason);
  }

  /** paused -> running. */
  resume(reason: LifecycleReason = 'user'): boolean {
    if (this.currentState !== 'paused') return false;
    return this.transition('running', reason);
  }

  /**
   * running|paused -> suspended (tab hidden, context lost, long stall).
   * Remembers the prior state so `restore()` returns there instead of
   * silently un-pausing a game the player had deliberately paused.
   */
  suspend(reason: LifecycleReason = 'visibility'): boolean {
    if (this.currentState !== 'running' && this.currentState !== 'paused') return false;
    this.stateBeforeInterruption = this.currentState;
    return this.transition('suspended', reason);
  }

  /** suspended -> the state that was active before suspension. */
  restore(reason: LifecycleReason = 'visibility'): boolean {
    if (this.currentState !== 'suspended' || this.stateBeforeInterruption === null) return false;
    const target = this.stateBeforeInterruption;
    this.stateBeforeInterruption = null;
    return this.transition(target, reason);
  }

  /** Any live state -> error (recoverable; see `recover`). */
  fail(error: unknown, reason: LifecycleReason = 'context-loss'): boolean {
    if (this.currentState === 'unloaded' || this.currentState === 'error') return false;
    this.stateBeforeInterruption = this.currentState;
    this.lastError = error;
    return this.transition('error', reason);
  }

  /** error -> the state that was active before the failure (EC-BRN-07 rebuild path). */
  recover(reason: LifecycleReason = 'recover'): boolean {
    if (this.currentState !== 'error' || this.stateBeforeInterruption === null) return false;
    const target = this.stateBeforeInterruption;
    this.stateBeforeInterruption = null;
    this.lastError = null;
    return this.transition(target, reason);
  }

  /** Terminal: releases resources; nothing may transition out of `unloaded`. */
  unload(reason: LifecycleReason = 'shutdown'): boolean {
    if (this.currentState === 'unloaded') return false;
    this.stateBeforeInterruption = null;
    return this.transition('unloaded', reason);
  }

  subscribe(listener: LifecycleListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private transition(to: LifecycleState, reason: LifecycleReason): boolean {
    const from = this.currentState;
    this.currentState = to;
    const event: LifecycleTransition = { from, to, reason };
    for (const listener of [...this.listeners]) {
      listener(event);
    }
    return true;
  }
}