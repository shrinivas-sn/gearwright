/**
 * L4 — pause overlay (DOM). Shown while the lifecycle is paused so a paused game never looks
 * frozen; a click resumes. The overlay only reports the intent — the composition root owns
 * the lifecycle and the pointer capture (a click is a valid user gesture for both).
 */

export type PauseCause = 'user' | 'focus-loss' | 'pointer';

const CAUSE_TEXT: Readonly<Record<PauseCause, string>> = {
  user: 'Game paused.',
  'focus-loss': 'Paused because the window lost focus.',
  pointer: 'Paused because the mouse was released.'
};

/** Static skeleton: zero interpolation, every dynamic value goes through textContent. */
const PAUSE_MARKUP = `
<div class="gw-pause-panel" role="dialog" aria-modal="true" aria-labelledby="gw-pause-title">
  <h2 class="gw-pause-title" id="gw-pause-title">Paused</h2>
  <p class="gw-pause-detail"></p>
  <button type="button" class="gw-pause-resume">Resume</button>
  <p class="gw-pause-keys">Click anywhere to resume · Esc also resumes</p>
  <div class="gw-pause-extra"></div>
</div>
`;

export class PauseOverlay {
  private readonly element: HTMLDivElement;
  private readonly detail: HTMLElement;
  private readonly extra: HTMLElement;
  private resumeHandler: (() => void) | null = null;

  constructor(root: HTMLElement) {
    const doc = root.ownerDocument;
    this.element = doc.createElement('div');
    this.element.className = 'gw-pause gw-pause--hidden';
    this.element.innerHTML = PAUSE_MARKUP;
    root.appendChild(this.element);
    const detail = this.element.querySelector<HTMLElement>('.gw-pause-detail');
    const extra = this.element.querySelector<HTMLElement>('.gw-pause-extra');
    if (detail === null || extra === null) throw new Error('ERR-PAUSE-01: pause skeleton incomplete');
    this.detail = detail;
    this.extra = extra;
    // Any click resumes, except on controls that live inside the panel (settings, buttons
    // marked no-resume) — a slider drag must never unpause the game.
    this.element.addEventListener('click', (event) => {
      const target = event.target as Element | null;
      if (target !== null && target.closest('input, select, label, .gw-pause-noresume') !== null) return;
      this.resumeHandler?.();
    });
  }

  onResume(handler: () => void): void {
    this.resumeHandler = handler;
  }

  show(cause: PauseCause): void {
    this.detail.textContent = CAUSE_TEXT[cause];
    this.element.classList.remove('gw-pause--hidden');
  }

  hide(): void {
    this.element.classList.add('gw-pause--hidden');
  }

  get visible(): boolean {
    return !this.element.classList.contains('gw-pause--hidden');
  }

  /** Extra panel content (controls table, settings) mounted by the composition root. */
  mountExtra(content: HTMLElement): void {
    this.extra.appendChild(content);
  }

  dispose(): void {
    this.element.remove();
  }
}
