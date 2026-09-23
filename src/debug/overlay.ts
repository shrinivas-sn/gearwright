/**
 * L4 DEBUG TOOL — performance overlay (ARCH §37, budget display per §36).
 *
 * Read-only by design (ADR-017): it consumes public snapshots and never reaches
 * into system internals. DOM writes are throttled so the overlay cannot itself
 * distort the frame times it reports.
 */

import type { LifecycleState } from '../core/lifecycle.ts';
import type { LoopStats } from '../core/loop.ts';
import type { BudgetStatus, PerfSnapshot } from '../core/perf.ts';

export interface OverlayData {
  readonly perf: PerfSnapshot;
  readonly loop: LoopStats;
  readonly lifecycle: LifecycleState;
  readonly drawCalls: number;
  readonly triangles: number;
  readonly lights: number;
}

export interface PerfOverlayOptions {
  /** Initial visibility. */
  readonly visible?: boolean;
  /** Key used to toggle (KeyboardEvent.key). */
  readonly toggleKey?: string;
  /** Minimum ms between DOM writes (anti layout-thrash, ARCH §33.2). */
  readonly updateIntervalMs?: number;
}

export class PerfOverlay {
  private readonly root: HTMLElement;
  private readonly panel: HTMLDivElement;
  private readonly toggleKey: string;
  private readonly updateIntervalMs: number;

  private isVisible: boolean;
  private lastWriteMs = Number.NEGATIVE_INFINITY;
  private lastText = '';

  constructor(root: HTMLElement, options: PerfOverlayOptions = {}) {
    this.root = root;
    this.toggleKey = options.toggleKey ?? 'F3';
    this.updateIntervalMs = options.updateIntervalMs ?? 250;
    this.isVisible = options.visible ?? true;

    this.panel = root.ownerDocument.createElement('div');
    this.panel.className = 'gw-debug-panel';
    this.panel.setAttribute('role', 'status');
    this.panel.style.display = this.isVisible ? 'block' : 'none';
    root.appendChild(this.panel);

    root.ownerDocument.defaultView?.addEventListener('keydown', this.handleKeyDown);
    this.panel.textContent = 'gearwright · diagnostics\n(waiting for first frame)';
  }

  get visible(): boolean {
    return this.isVisible;
  }

  toggle(): boolean {
    this.isVisible = !this.isVisible;
    this.panel.style.display = this.isVisible ? 'block' : 'none';
    if (this.isVisible) {
      this.lastWriteMs = Number.NEGATIVE_INFINITY;
    }
    return this.isVisible;
  }

  update(data: OverlayData, nowMs: number): void {
    if (!this.isVisible) return;
    if (nowMs - this.lastWriteMs < this.updateIntervalMs) return;
    this.lastWriteMs = nowMs;

    const text = this.format(data);
    if (text === this.lastText) return; // change-only writes
    this.lastText = text;
    this.panel.innerHTML = text;
  }

  dispose(): void {
    this.root.ownerDocument.defaultView?.removeEventListener('keydown', this.handleKeyDown);
    this.panel.remove();
  }

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (event.key === this.toggleKey) {
      this.toggle();
    }
  };

  private format(data: OverlayData): string {
    const { perf, loop, lifecycle, drawCalls, triangles, lights } = data;
    const fps = perf.fps.toFixed(1);
    const avg = perf.avgFrameMs.toFixed(2);
    const p95 = perf.p95FrameMs.toFixed(2);

    return [
      `<strong>gearwright</strong>  ${lifecycle}`,
      `${budge(perf.frameStatus, `${fps} fps`)}  avg ${avg} ms  p95 ${p95} ms`,
      `steps/frame ${perf.avgSteps.toFixed(2)}  frames ${loop.frames}  steps ${loop.steps}`,
      `backlog drops ${loop.droppedBacklog}`,
      `${budge(perf.drawStatus, `draws ${drawCalls}`)}  ${budge(perf.triangleStatus, `tris ${formatCount(triangles)}`)}  ${budge(perf.lightStatus, `lights ${lights}`)}`,
      `<span class="gw-debug-ok">${this.toggleKey}</span> toggle`
    ].join('\n');
  }
}

function budge(status: BudgetStatus, label: string): string {
  const cls = status === 'ok' ? 'gw-debug-ok' : status === 'warn' ? 'gw-debug-warn' : 'gw-debug-bad';
  const marker = status === 'ok' ? 'ok' : status === 'warn' ? 'watch' : 'over';
  return `<span class="${cls}">${label} (${marker})</span>`;
}

function formatCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(Math.round(value));
}