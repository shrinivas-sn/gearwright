/**
 * L4 — title screen (PLAN T6.2). Shown at boot over the first rendered frame; the game is
 * paused with reason 'menu' behind it. It reports intents only; main.ts owns the lifecycle.
 */

const TITLE_MARKUP = `
<div class="gw-title-panel">
  <h1 class="gw-title-name">GEARWRIGHT</h1>
  <p class="gw-title-tagline">Restore the Crucible Hall. Enter the Pressure Gallery through the teal door and bring its machines back to life.</p>
  <div class="gw-title-actions">
    <button type="button" class="gw-title-start"></button>
    <button type="button" class="gw-title-new"></button>
    <button type="button" class="gw-title-controls-toggle">Controls</button>
  </div>
  <div class="gw-title-controls gw-title--hidden"></div>
</div>
`;

export class TitleScreen {
  private readonly element: HTMLDivElement;
  private readonly startButton: HTMLButtonElement;
  private readonly newButton: HTMLButtonElement;
  private readonly controls: HTMLElement;
  private startHandler: (() => void) | null = null;
  private newGameHandler: (() => void) | null = null;
  private newArmed = false;
  private disarmTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(root: HTMLElement, options: { readonly hasSave: boolean; readonly controlsTable: HTMLElement }) {
    const doc = root.ownerDocument;
    this.element = doc.createElement('div');
    this.element.className = 'gw-title';
    this.element.innerHTML = TITLE_MARKUP;
    root.appendChild(this.element);
    const start = this.element.querySelector<HTMLButtonElement>('.gw-title-start');
    const fresh = this.element.querySelector<HTMLButtonElement>('.gw-title-new');
    const toggle = this.element.querySelector<HTMLButtonElement>('.gw-title-controls-toggle');
    const controls = this.element.querySelector<HTMLElement>('.gw-title-controls');
    if (start === null || fresh === null || toggle === null || controls === null) {
      throw new Error('ERR-TITLE-01: title skeleton incomplete');
    }
    this.startButton = start;
    this.newButton = fresh;
    this.controls = controls;
    this.startButton.textContent = options.hasSave ? 'Continue' : 'Start';
    this.newButton.textContent = 'New game';
    this.newButton.hidden = !options.hasSave;
    this.controls.appendChild(options.controlsTable);
    this.startButton.addEventListener('click', () => this.startHandler?.());
    toggle.addEventListener('click', () => this.controls.classList.toggle('gw-title--hidden'));
    // Two-step confirm: New Game erases progress, so the first click only arms it for 4 s.
    this.newButton.addEventListener('click', () => {
      if (!this.newArmed) {
        this.newArmed = true;
        this.newButton.textContent = 'Click again to erase progress';
        this.disarmTimer = setTimeout(() => {
          this.newArmed = false;
          this.newButton.textContent = 'New game';
        }, 4000);
        return;
      }
      if (this.disarmTimer !== null) clearTimeout(this.disarmTimer);
      this.newGameHandler?.();
    });
  }

  onStart(handler: () => void): void {
    this.startHandler = handler;
  }

  onNewGame(handler: () => void): void {
    this.newGameHandler = handler;
  }

  get visible(): boolean {
    return !this.element.classList.contains('gw-title--hidden');
  }

  hide(): void {
    this.element.classList.add('gw-title--hidden');
  }

  dispose(): void {
    if (this.disarmTimer !== null) clearTimeout(this.disarmTimer);
    this.element.remove();
  }
}
