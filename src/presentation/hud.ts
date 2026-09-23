/**
 * L4 — HUD (ARCH §33.1 surfaces, ADR-010: DOM overlay + CSS, no framework).
 *
 * The HUD is a *read-model consumer*: `render()` is handed a snapshot, `toast()`
 * is handed an event's text, and the only thing that ever leaves the HUD is an
 * intent (`onHintRequest` / `onScannerRequest`). It owns no game state and cannot
 * reach back into the world (§33.2 rule 2) — the composition root wires the
 * intents to the systems that own them, and they validate.
 *
 * Two production constraints shaped this file:
 *
 *   1. **Cheap per frame** (§33.2 rule 5, HUD < 0.5 ms/frame at p95). `render()`
 *      is safe to call every frame: every write goes through `setText` /
 *      `setClass` / `setAttr`, which no-op when the value is unchanged, and list
 *      rows (materials, blueprints, toasts) are *pooled* — a steady-state frame
 *      allocates no DOM structure and mutates no text.
 *   2. **No injected markup.** The static skeleton is built once from a literal
 *      template with **zero interpolation**; every data-derived value — names,
 *      key labels, requirement text, hint text, notices — travels through
 *      `textContent`, so a hostile string such as `<img src=x onerror=1>` can
 *      only ever be read as text, never parsed as markup.
 *
 * Wireframe of the surfaces (§33.1, MVP):
 *
 *   ┌ objective ───────────────┐              ┌ toasts (aria-live) ─┐
 *   │ title · state            │              └─────────────────────┘
 *   │ ⚠ failed requirement     │      ⦿ reticle
 *   │                          │   target · VERB · [key] · ✓ compatible
 *   │                          │
 *   │                          │   held name · socket ▣ occupied (while carrying)
 *   │                          │   [Q][F] rotate   [E] confirm   [R] drop   [Esc] cancel
 *   │                          │
 *   │ log ─────────────────────┤              save note
 *   │ FIELD LOG — 1 entry      │
 *   │ ▏Clue title              │
 *   │ ▏“the plate's words…”    │
 *   └                          ┘
 *   resources ───────────────┐
 *   parts / materials / bp   │   hint ───────────────────────────┐
 *   └─────────────────────────┘    L1 · Environmental cue  [H] Hint │
 *                                  hint text…                       │
 *                                  scan: <failed requirement>        │
 *                                  [ Scanner ready / recharging ]    │
 */

/**
 * Visible heading of the log surface. The count is appended by `renderLog` from the
 * entries themselves, so the label and the list can never disagree (§33.2 rule 1).
 */
const LOG_HEADING = 'Field log';

/** Socket validity vocabulary of the manipulation strip (§33.1). */
export type HudSocketState = 'none' | 'preview' | 'occupied' | 'invalid' | 'blocked';

/**
 * Scanner affordance vocabulary (M10): locked without the blueprint, then the reveal's
 * own three states. One union, so the button's words, class and disabled flag all come
 * from one place (§33.2 rule 1).
 */
export type HudScannerState = 'locked' | 'ready' | 'scanning' | 'cooling';

/** Toast severity; each kind is also spelled out as text, never colour alone. */
export type HudToastKind = 'info' | 'warn' | 'error';

/** Focus/reticle line: what the player is looking at, and whether it would work. */
export interface HudFocusView {
  readonly targetName: string | null;
  /** Prompt verb from `InteractionSystem` ('Grab' | 'Remove' | 'Read' | …). */
  readonly verb: string | null;
  /** Key label from the binding map — a key name is never authored in markup (§33.2 rule 1). */
  readonly keyLabel: string | null;
  /** `null` = no candidate to judge (nothing focused, or nothing carryable in range). */
  readonly valid: boolean | null;
}

/** Manipulation strip: what is held, how to act on it, and how the socket reads. */
export interface HudManipulationView {
  readonly heldName: string | null;
  readonly rotateKey: string;
  /** Second rotate key (the other direction). Absent hides its chip. */
  readonly rotateRightKey?: string | undefined;
  /** Drop key. Absent hides the drop chip. */
  readonly dropKey?: string | undefined;
  readonly confirmKey: string;
  readonly cancelKey: string;
  readonly socketState: HudSocketState;
}

/** Objective line: which puzzle, where it stands, and the outstanding requirement. */
export interface HudObjectiveView {
  readonly puzzleTitle: string | null;
  /** 'InProgress' | 'Assembled' | 'Validated' | 'Complete' | … (owner's vocabulary). */
  readonly state: string | null;
  /** Plain language, authored per requirement id in the puzzle data (never re-worded here). */
  readonly failedText: string | null;
}

/** Resource panel (§27.3: compact, no grid inventory in the MVP). */
export interface HudResourceView {
  readonly partsHeld: number;
  readonly partsRequired: number;
  readonly materials: ReadonlyArray<{ readonly kind: string; readonly count: number }>;
  readonly blueprints: ReadonlyArray<string>;
}

/** Hint affordance + the one MVP scanner blueprint (§29, §27.3). */
export interface HudHintView {
  /** Escalation ladder level, 0…4 (§29.1). */
  readonly level: number;
  readonly levelName: string;
  /** Hint text for that level, or null at L0 — the HUD never invents an escalation. */
  readonly text: string | null;
  /** Hint key from the binding map. The API carries one key, so the scanner is pointer-only. */
  readonly keyLabel: string;
  /**
   * §27.3/§29.3: the scanner unlock is the single MVP blueprint, so `locked` until it is
   * owned; afterwards the state is the reveal's own (ready → scanning → cooling), which
   * is what makes the cooldown visible instead of a button that sometimes does nothing.
   */
  readonly scannerState: HudScannerState;
  /** While a reveal is on screen: the failed requirement in plain language (§33.1). */
  readonly scannerText: string | null;
}

/**
 * One discovered log entry (§12.2 "Discovered clues / log entries", consumers
 * "Story UI, HUD"). The text is authored content, so it arrives already resolved:
 * the HUD speaks data's words and never looks content up itself (§33.2 rule 1).
 */
export interface HudLogEntryView {
  readonly id: string;
  readonly title: string;
  /** The plate/record's own words. Empty = resolve to the title line alone. */
  readonly text: string;
}

/** One-shot platform guidance line: what the pointer/keyboard surface needs *right now*. */
export interface HudCaptureView {
  /**
   * When true the mouse is captured and the cursor hidden: look with the mouse,
   * click to interact, Esc to release.
   */
  readonly pointerLocked: boolean;
  /** When true the browser refused mouse capture but raw look still works. */
  readonly pointerLockUnavailable: boolean;
}

/** Static entry line of the HUD: how to pick up the mouse and keyboard (§33.1). */

/**
 * The field log: what the player has actually discovered, in the order the owner
 * reports it. Empty means nothing has been found, and the surface hides — an empty
 * box would read as "there is nothing to find", which is the opposite of the truth.
 */
export interface HudLogView {
  readonly entries: ReadonlyArray<HudLogEntryView>;
}

/**
 * One frame's worth of HUD state. Read-only by construction: the HUD stores the
 * reference it was handed, so producers must treat it as immutable.
 */
export interface HudSnapshot {
  readonly focus: HudFocusView;
  readonly manipulation: HudManipulationView;
  readonly objective: HudObjectiveView;
  readonly resources: HudResourceView;
  /** §12.2's canonical seen-id set, resolved to words by the composition root. */
  readonly log: HudLogView;
  readonly hint: HudHintView;
  /** Recovery/save notice (§31.6) — null while the last load was clean. */
  readonly saveNote: string | null;
  /** Pointer/keyboard entry guidance (§33.1) — null once the capture is settled. */
  readonly entry: HudCaptureView | null;
}


/**
 * Toast lifetimes in seconds. Exported so the composition root and the tests read
 * the same number: a `warn`/`error` notice is worth more reading time than an
 * `info` one, and that policy must not be duplicated as a magic number elsewhere.
 */
export const HUD_TOAST_LIFETIME_SECONDS: Readonly<Record<HudToastKind, number>> = {
  info: 4,
  warn: 6,
  error: 6
};

/** Bounded toast buffer: notices are transient, so losing the oldest is correct. */
const MAX_VISIBLE_TOASTS = 4;

/** Socket vocabulary in render order — also the CSS class suffixes of the strip. */
const SOCKET_STATES: ReadonlyArray<HudSocketState> = [
  'none',
  'preview',
  'occupied',
  'invalid',
  'blocked'
];

/** Icon + written label per socket state, so validity never rides on colour alone. */
const SOCKET_STATE_ICON: Readonly<Record<HudSocketState, string>> = {
  none: '—',
  preview: '◇',
  occupied: '▣',
  invalid: '✕',
  blocked: '▨'
};

const SOCKET_STATE_TEXT: Readonly<Record<HudSocketState, string>> = {
  none: 'No socket in range',
  preview: 'Socket compatible — confirm to dock',
  occupied: 'Socket occupied',
  invalid: 'Socket incompatible with the held part',
  blocked: 'Socket blocked by geometry'
};

/** Scanner states in render order — also the CSS class suffixes of the button. */
const SCANNER_STATES: ReadonlyArray<HudScannerState> = ['locked', 'ready', 'scanning', 'cooling'];

/**
 * Scanner button words per state. One table for the visible label *and* the aria-label:
 * a locked scanner names its missing blueprint (§27.3), and a recharging one says so,
 * so a refusal is never silent (§29.2's "always responds immediately").
 */
const SCANNER_STATE_TEXT: Readonly<Record<HudScannerState, string>> = {
  locked: 'Scanner locked — blueprint required',
  ready: 'Scanner ready',
  scanning: 'Scanning…',
  cooling: 'Scanner recharging'
};

const TOAST_KIND_ICON: Readonly<Record<HudToastKind, string>> = {
  info: 'i',
  warn: '!',
  error: '×'
};

const TOAST_KIND_LABEL: Readonly<Record<HudToastKind, string>> = {
  info: 'Info',
  warn: 'Warning',
  error: 'Error'
};

/**
 * Static skeleton — built once at construction and never rebuilt, so it contains
 * no data and needs no sanitising. Everything variable is written later through
 * `textContent` (see the file header).
 */
const HUD_MARKUP = `
<div class="gw-hud-reticle" aria-hidden="true"></div>
<div class="gw-hud-entry" role="status"></div>
<div class="gw-hud-surface gw-hud-focus">
  <span class="gw-hud-focus-line">
    <span class="gw-hud-focus-name"></span>
    <span class="gw-hud-focus-verb"></span>
    <kbd class="gw-hud-key gw-hud-focus-key"></kbd>
    <span class="gw-hud-focus-validity"></span>
  </span>
</div>
<div class="gw-hud-left">
  <div class="gw-hud-surface gw-hud-objective">
    <span class="gw-hud-objective-title"></span>
    <span class="gw-hud-objective-state"></span>
    <span class="gw-hud-objective-failure">
      <span class="gw-hud-objective-failure-tag" aria-hidden="true">⚠</span>
      <span class="gw-hud-objective-failure-text"></span>
    </span>
  </div>
  <div class="gw-hud-surface gw-hud-log">
    <span class="gw-hud-log-heading"></span>
    <ul class="gw-hud-log-list"></ul>
  </div>
</div>
<div class="gw-hud-surface gw-hud-resources">
  <span class="gw-hud-parts"></span>
  <span class="gw-hud-resources-label">Materials</span>
  <ul class="gw-hud-materials"></ul>
  <span class="gw-hud-resources-label">Blueprints</span>
  <ul class="gw-hud-blueprints"></ul>
</div>
<div class="gw-hud-surface gw-hud-manipulation">
  <span class="gw-hud-held"></span>
  <span class="gw-hud-socket">
    <span class="gw-hud-socket-icon" aria-hidden="true"></span>
    <span class="gw-hud-socket-text"></span>
  </span>
  <span class="gw-hud-bindings">
    <span class="gw-hud-binding"><kbd class="gw-hud-key gw-hud-rotate-key"></kbd><kbd class="gw-hud-key gw-hud-rotate-right-key"></kbd> rotate</span>
    <span class="gw-hud-binding"><kbd class="gw-hud-key gw-hud-confirm-key"></kbd> confirm</span>
    <span class="gw-hud-binding gw-hud-drop-binding"><kbd class="gw-hud-key gw-hud-drop-key"></kbd> drop</span>
    <span class="gw-hud-binding"><kbd class="gw-hud-key gw-hud-cancel-key"></kbd> cancel</span>
  </span>
</div>
<div class="gw-hud-surface gw-hud-hint">
  <span class="gw-hud-hint-level"></span>
  <button type="button" class="gw-hud-hint-button">
    <kbd class="gw-hud-key gw-hud-hint-key"></kbd><span class="gw-hud-hint-button-label">Hint</span>
  </button>
  <button type="button" class="gw-hud-scanner-button">
    <span class="gw-hud-scanner-label">Scanner</span>
  </button>
  <p class="gw-hud-hint-text"></p>
  <p class="gw-hud-scanner-text"></p>
</div>
<div class="gw-hud-toasts" aria-live="polite" aria-relevant="additions">
  <ul class="gw-hud-toast-list"></ul>
</div>
<p class="gw-hud-save-note" role="status"></p>
`;
/**
 * Change-only text write (§33.2 rule 5). `textContent` is *not* a layout-flushing
 * property, so the read is cheap; the write is what must be avoided.
 */
function setText(element: Element, value: string): void {
  if (element.textContent !== value) element.textContent = value;
}

function setClass(element: Element, className: string, on: boolean): void {
  if (element.classList.contains(className) !== on) element.classList.toggle(className, on);
}

function setHidden(element: Element, hidden: boolean): void {
  setClass(element, 'gw-hud-hidden', hidden);
}

function setAttr(element: Element, name: string, value: string): void {
  if (element.getAttribute(name) !== value) element.setAttribute(name, value);
}

/** The skeleton is authored here, so a missing node is a bug in this file — fail loudly. */
function requireChild<T extends Element>(host: HTMLElement, selector: string): T {
  const found = host.querySelector<T>(selector);
  if (found === null) throw new Error(`ERR-HUD-01: HUD skeleton is missing "${selector}"`);
  return found;
}

/** One live toast: its element plus the seconds it still has to live. */
interface ToastEntry {
  readonly element: HTMLLIElement;
  remaining: number;
}

/** Pooled material row, reused across renders instead of rebuilt (§33.2 rule 5). */
interface MaterialRow {
  readonly element: HTMLLIElement;
  readonly kind: HTMLElement;
  readonly count: HTMLElement;
}

/** Pooled blueprint row. */
interface BlueprintRow {
  readonly element: HTMLLIElement;
}

/** Pooled field-log row: one discovered entry's title + words. */
interface LogRow {
  readonly element: HTMLLIElement;
  readonly title: HTMLElement;
  readonly text: HTMLElement;
}

/**
 * §33.1 HUD — renders snapshots, emits intents, mutates nothing else.
 *
 * The caller constructs it once with the `#hud-root` element and then:
 *
 * ```ts
 * hud.render(snapshot);   // every frame, or on change — both are cheap
 * hud.update(dt);         // once per rendered frame, seconds
 * hud.toast('Blueprint unlocked: scanner');
 * ```
 */
export class Hud {
  private readonly root: HTMLElement;
  private readonly host: HTMLDivElement;

  // Focus line
  private readonly focusLine: HTMLElement;
  private readonly focusName: HTMLElement;
  private readonly focusVerb: HTMLElement;
  private readonly focusKey: HTMLElement;
  private readonly focusValidity: HTMLElement;

  // Objective line
  private readonly objectiveTitle: HTMLElement;
  private readonly objectiveState: HTMLElement;
  private readonly objectiveFailureRow: HTMLElement;
  private readonly objectiveFailure: HTMLElement;

  // Resources
  private readonly parts: HTMLElement;
  private readonly materialsList: HTMLUListElement;
  private readonly blueprintsList: HTMLUListElement;
  private readonly materialRows: MaterialRow[] = [];
  private readonly blueprintRows: BlueprintRow[] = [];
  /** Last reconciled list contents: equal signature ⇒ the DOM is already correct. */
  private materialSignature = '\u0000';
  private blueprintSignature = '\u0000';

  // Field log (§12.2 log entries)
  private readonly logSurface: HTMLElement;
  private readonly logHeading: HTMLElement;
  private readonly logList: HTMLUListElement;
  private readonly logRows: LogRow[] = [];
  private logSignature = '\u0000';

  // Manipulation strip
  private readonly held: HTMLElement;
  private readonly bindings: HTMLElement;
  private readonly socket: HTMLElement;
  private readonly socketIcon: HTMLElement;
  private readonly socketText: HTMLElement;
  private readonly rotateKey: HTMLElement;
  private readonly rotateRightKey: HTMLElement;
  private readonly dropBinding: HTMLElement;
  private readonly dropKey: HTMLElement;
  private readonly confirmKey: HTMLElement;
  private readonly cancelKey: HTMLElement;

  // Hint + scanner
  private readonly hintLevel: HTMLElement;
  private readonly hintText: HTMLElement;
  private readonly hintKey: HTMLElement;
  private readonly hintButton: HTMLButtonElement;
  private readonly scannerButton: HTMLButtonElement;
  private readonly scannerLabel: HTMLElement;
  private readonly scannerText: HTMLElement;

  // Notices
  private readonly entryLine: HTMLElement;
  private readonly saveNote: HTMLElement;
  private readonly toastList: HTMLUListElement;
  private readonly toasts: ToastEntry[] = [];

  private hintHandler: (() => void) | null = null;
  private scannerHandler: (() => void) | null = null;
  private lastRendered: HudSnapshot | null = null;

  constructor(root: HTMLElement) {
    this.root = root;
    const doc = root.ownerDocument;

    this.host = doc.createElement('div');
    this.host.className = 'gw-hud';
    // Static markup, zero interpolation: nothing data-derived is ever parsed as
    // HTML, so `textContent` is the only writer of dynamic values (see header).
    this.host.innerHTML = HUD_MARKUP;
    root.appendChild(this.host);

    this.focusLine = requireChild(this.host, '.gw-hud-focus-line');
    this.focusName = requireChild(this.host, '.gw-hud-focus-name');
    this.focusVerb = requireChild(this.host, '.gw-hud-focus-verb');
    this.focusKey = requireChild(this.host, '.gw-hud-focus-key');
    this.focusValidity = requireChild(this.host, '.gw-hud-focus-validity');

    this.objectiveTitle = requireChild(this.host, '.gw-hud-objective-title');
    this.objectiveState = requireChild(this.host, '.gw-hud-objective-state');
    this.objectiveFailureRow = requireChild(this.host, '.gw-hud-objective-failure');
    this.objectiveFailure = requireChild(this.host, '.gw-hud-objective-failure-text');

    this.parts = requireChild(this.host, '.gw-hud-parts');
    this.materialsList = requireChild<HTMLUListElement>(this.host, '.gw-hud-materials');
    this.blueprintsList = requireChild<HTMLUListElement>(this.host, '.gw-hud-blueprints');

    this.held = requireChild(this.host, '.gw-hud-held');
    this.bindings = requireChild(this.host, '.gw-hud-bindings');
    this.socket = requireChild(this.host, '.gw-hud-socket');
    this.socketIcon = requireChild(this.host, '.gw-hud-socket-icon');
    this.socketText = requireChild(this.host, '.gw-hud-socket-text');
    this.rotateKey = requireChild(this.host, '.gw-hud-rotate-key');
    this.rotateRightKey = requireChild(this.host, '.gw-hud-rotate-right-key');
    this.dropBinding = requireChild(this.host, '.gw-hud-drop-binding');
    this.dropKey = requireChild(this.host, '.gw-hud-drop-key');
    this.confirmKey = requireChild(this.host, '.gw-hud-confirm-key');
    this.cancelKey = requireChild(this.host, '.gw-hud-cancel-key');

    this.hintLevel = requireChild(this.host, '.gw-hud-hint-level');
    this.hintText = requireChild(this.host, '.gw-hud-hint-text');
    this.hintKey = requireChild(this.host, '.gw-hud-hint-key');
    this.hintButton = requireChild<HTMLButtonElement>(this.host, '.gw-hud-hint-button');
    this.scannerButton = requireChild<HTMLButtonElement>(this.host, '.gw-hud-scanner-button');
    this.scannerLabel = requireChild(this.host, '.gw-hud-scanner-label');
    this.scannerText = requireChild(this.host, '.gw-hud-scanner-text');

    this.logSurface = requireChild(this.host, '.gw-hud-log');
    this.logHeading = requireChild(this.host, '.gw-hud-log-heading');
    this.logList = requireChild<HTMLUListElement>(this.host, '.gw-hud-log-list');

    this.saveNote = requireChild(this.host, '.gw-hud-save-note');
    this.toastList = requireChild<HTMLUListElement>(this.host, '.gw-hud-toast-list');
    this.entryLine = requireChild(this.host, '.gw-hud-entry');

    // Buttons are real <button>s: the HUD only *reports* the intent — the owning
    // system decides whether the ladder escalates or the scanner may run (§29).
    this.hintButton.addEventListener('click', () => this.hintHandler?.());
    this.scannerButton.addEventListener('click', () => this.scannerHandler?.());

    // Nothing is known yet: conditional lines start hidden so an empty box can
    // never read as "no requirement outstanding".
    setHidden(this.focusLine, true);
    setHidden(this.objectiveFailureRow, true);
    // Nothing has been discovered yet, so the log starts hidden: an empty log would
    // claim the world holds nothing, which is not the same as "you have found nothing"
    // — and only the second is true at boot.
    setHidden(this.logSurface, true);
    setHidden(this.hintText, true);
    setHidden(this.scannerText, true);
    setHidden(this.saveNote, true);
  }

  /**
   * Batched render. Safe to call every frame; text is written only when the value
   * actually changed, so a steady state costs a handful of string comparisons.
   */
  render(snapshot: HudSnapshot): void {
    this.lastRendered = snapshot;
    this.renderFocus(snapshot.focus);
    this.renderManipulation(snapshot.manipulation);
    this.renderObjective(snapshot.objective);
    this.renderResources(snapshot.resources);
    this.renderLog(snapshot.log);
    this.renderHint(snapshot.hint);
    this.renderSaveNote(snapshot.saveNote);
    this.renderEntry(snapshot.entry);
  }

  /** Test/debug visibility of the last rendered snapshot (the caller's own object). */
  get lastSnapshot(): HudSnapshot | null {
    return this.lastRendered;
  }

  private renderFocus(view: HudFocusView): void {
    const hasTarget = view.targetName !== null;

    // The reticle always stays (it is the aim point, not a prompt); only the
    // prompt line hides, so an empty `<span>` never reads as "focusing nothing".
    setHidden(this.focusLine, !hasTarget);
    setText(this.focusName, view.targetName ?? '');

    // Verb and key are one label each (§33.2 rule 1): a verb with no binding, or a
    // binding with no verb, must not produce an orphan chip.
    setHidden(this.focusVerb, view.verb === null);
    setText(this.focusVerb, view.verb ?? '');
    setHidden(this.focusKey, view.keyLabel === null);
    setText(this.focusKey, view.keyLabel ?? '');

    setHidden(this.focusValidity, view.valid === null);
    const validityText =
      view.valid === null ? '' : view.valid ? '✓ compatible' : '✕ not compatible';
    setText(this.focusValidity, validityText);
    setClass(this.focusValidity, 'gw-hud-focus-validity--valid', view.valid === true);
    setClass(this.focusValidity, 'gw-hud-focus-validity--invalid', view.valid === false);
  }

  private renderManipulation(view: HudManipulationView): void {
    setText(this.held, view.heldName ?? 'Empty-handed');
    setClass(this.held, 'gw-hud-held--empty', view.heldName === null);

    // Keys always come from the caller's binding map — never authored here.
    setText(this.rotateKey, view.rotateKey);
    setText(this.confirmKey, view.confirmKey);
    setText(this.cancelKey, view.cancelKey);
    setText(this.rotateRightKey, view.rotateRightKey ?? '');
    setHidden(this.rotateRightKey, view.rotateRightKey === undefined);
    setText(this.dropKey, view.dropKey ?? '');
    setHidden(this.dropBinding, view.dropKey === undefined);

    // Icon + text + colour: any one of the five states reads without colour (§33.2 rule 4).
    setText(this.socketIcon, SOCKET_STATE_ICON[view.socketState]);
    setText(this.socketText, SOCKET_STATE_TEXT[view.socketState]);
    for (const state of SOCKET_STATES) {
      setClass(this.socket, `gw-hud-socket--${state}`, state === view.socketState);
    }

    // An empty hand is a real state, but rotate/confirm/cancel and "socket in range"
    // are not: while nothing is held those keys belong to the *focus* line (grab),
    // so leaving them here told the player that E both grabs and confirms, and
    // advertised a socket verdict for a part that does not exist. The strip keeps
    // the status line and shows the rest only while something is actually carried.
    const carrying = view.heldName !== null;
    setHidden(this.bindings, !carrying);
    setHidden(this.socket, !carrying);
  }

  private renderObjective(view: HudObjectiveView): void {
    setText(this.objectiveTitle, view.puzzleTitle ?? 'No active puzzle');
    setClass(this.objectiveTitle, 'gw-hud-objective-title--none', view.puzzleTitle === null);

    setHidden(this.objectiveState, view.state === null);
    setText(this.objectiveState, view.state ?? '');

    // The failure line is the whole point of the surface (§33.1 row 3): text comes
    // from the validator's reason, authored in the puzzle data — never re-worded here.
    setHidden(this.objectiveFailureRow, view.failedText === null);
    setText(this.objectiveFailure, view.failedText ?? '');
  }

  private renderResources(view: HudResourceView): void {
    setText(this.parts, `Parts ${view.partsHeld} / ${view.partsRequired}`);

    // Signature gate: when the lists are unchanged the rows are not even visited,
    // which is what keeps a per-frame render allocation- and write-free (§33.2 rule 5).
    const materialSignature = view.materials.map((entry) => `${entry.kind}:${entry.count}`).join('|');
    if (materialSignature !== this.materialSignature) {
      this.materialSignature = materialSignature;
      this.syncMaterials(view.materials);
    }

    const blueprintSignature = view.blueprints.join('|');
    if (blueprintSignature !== this.blueprintSignature) {
      this.blueprintSignature = blueprintSignature;
      this.syncBlueprints(view.blueprints);
    }
  }

  /**
   * Reconciles material rows against their pool: existing rows are reused, extra
   * rows are hidden (not removed), so nothing is allocated for a returning entry.
   */
  private syncMaterials(
    materials: ReadonlyArray<{ readonly kind: string; readonly count: number }>
  ): void {
    for (let index = 0; index < materials.length; index += 1) {
      const entry = materials[index];
      if (entry === undefined) continue;

      let row = this.materialRows[index];
      if (row === undefined) {
        row = this.createMaterialRow();
        this.materialRows[index] = row;
        this.materialsList.appendChild(row.element);
      }
      setText(row.kind, entry.kind);
      setText(row.count, String(entry.count));
      setHidden(row.element, false);
    }

    for (let index = materials.length; index < this.materialRows.length; index += 1) {
      const row = this.materialRows[index];
      if (row !== undefined) setHidden(row.element, true);
    }
  }

  private createMaterialRow(): MaterialRow {
    const doc = this.root.ownerDocument;
    const element = doc.createElement('li');
    element.className = 'gw-hud-material';
    const kind = doc.createElement('span');
    kind.className = 'gw-hud-material-kind';
    const count = doc.createElement('span');
    count.className = 'gw-hud-material-count';
    element.append(kind, count);
    return { element, kind, count };
  }

  private syncBlueprints(blueprints: ReadonlyArray<string>): void {
    for (let index = 0; index < blueprints.length; index += 1) {
      const blueprintId = blueprints[index];
      if (blueprintId === undefined) continue;

      let row = this.blueprintRows[index];
      if (row === undefined) {
        const element = this.root.ownerDocument.createElement('li');
        element.className = 'gw-hud-blueprint';
        row = { element };
        this.blueprintRows[index] = row;
        this.blueprintsList.appendChild(element);
      }
      setText(row.element, blueprintId);
      setHidden(row.element, false);
    }

    for (let index = blueprints.length; index < this.blueprintRows.length; index += 1) {
      const row = this.blueprintRows[index];
      if (row !== undefined) setHidden(row.element, true);
    }
  }

  /**
   * §12.2's log surface: the discovered set, resolved to words by the caller. Hidden
   * until something is discovered, and change-only below — the set only ever grows, so
   * ids are a sufficient signature (§33.2 rule 5).
   */
  private renderLog(view: HudLogView): void {
    const entries = view.entries;
    setHidden(this.logSurface, entries.length === 0);
    const count = entries.length;
    setText(this.logHeading, `${LOG_HEADING} — ${count} ${count === 1 ? 'entry' : 'entries'}`);

    const signature = entries.map((entry) => entry.id).join('|');
    if (signature === this.logSignature) return;
    this.logSignature = signature;
    this.syncLog(entries);
  }

  /** Reconciles log rows against their pool, exactly as the material rows do. */
  private syncLog(entries: ReadonlyArray<HudLogEntryView>): void {
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      if (entry === undefined) continue;

      let row = this.logRows[index];
      if (row === undefined) {
        row = this.createLogRow();
        this.logRows[index] = row;
        this.logList.appendChild(row.element);
      }
      setText(row.title, entry.title);
      // An entry whose content could not be resolved has no words: hide the line
      // rather than render an empty paragraph under the title.
      setHidden(row.text, entry.text === '');
      setText(row.text, entry.text);
      setHidden(row.element, false);
    }

    for (let index = entries.length; index < this.logRows.length; index += 1) {
      const row = this.logRows[index];
      if (row !== undefined) setHidden(row.element, true);
    }
  }

  private createLogRow(): LogRow {
    const doc = this.root.ownerDocument;
    const element = doc.createElement('li');
    element.className = 'gw-hud-log-entry';
    const title = doc.createElement('span');
    title.className = 'gw-hud-log-title';
    const text = doc.createElement('span');
    text.className = 'gw-hud-log-text';
    element.append(title, text);
    return { element, title, text };
  }

  private renderHint(view: HudHintView): void {
    // "L1 · Environmental cue" — the level is spelled out, never implied by colour,
    // and it is the ladder the player is on, not the puzzle's answer (§29.1).
    setText(this.hintLevel, `L${view.level} · ${view.levelName}`);

    setHidden(this.hintText, view.text === null);
    setText(this.hintText, view.text ?? '');

    setText(this.hintKey, view.keyLabel);
    setAttr(this.hintButton, 'aria-label', `Show a hint (${view.keyLabel})`);

    // §29.3 + §27.3: the scanner is the payoff of the one MVP blueprint, so until the
    // blueprint is known it reads as locked — dashed border, written reason and a truly
    // disabled button (a click could only be refused anyway). Afterwards the state is the
    // reveal's own, and all four readings come from one table (§33.2 rule 1).
    const scannerLabel = SCANNER_STATE_TEXT[view.scannerState];
    setText(this.scannerLabel, scannerLabel);
    setAttr(this.scannerButton, 'aria-label', scannerLabel);
    for (const state of SCANNER_STATES) {
      setClass(this.scannerButton, `gw-hud-scanner--${state}`, state === view.scannerState);
    }
    const locked = view.scannerState === 'locked';
    if (this.scannerButton.disabled !== locked) this.scannerButton.disabled = locked;

    // The reveal's own line: what the scanner is highlighting, in the objective line's
    // words (§33.1 row 3's "plain language"), never a second vocabulary.
    setHidden(this.scannerText, view.scannerText === null);
    setText(this.scannerText, view.scannerText ?? '');
  }

  private renderSaveNote(note: string | null): void {
    setHidden(this.saveNote, note === null);
    setText(this.saveNote, note ?? '');
  }

  /**
   * One-shot entry guidance (§33.1): static words only, so the markup carries the
   * sentence and the snapshot only chooses which one. A settled capture clears it —
   * a line that stays up after the mouse works is noise, and noise teaches the
   * player to ignore the HUD. Refusals keep a short fallback line instead.
   */
  private renderEntry(entry: HudCaptureView | null): void {
    if (entry === null || (entry.pointerLocked && !entry.pointerLockUnavailable)) {
      setHidden(this.entryLine, true);
      return;
    }
    setHidden(this.entryLine, false);
    setText(
      this.entryLine,
      entry.pointerLockUnavailable
        ? 'Click the game view to focus it — keys and mouse look work without mouse capture.'
        : 'Click the game view to focus it and capture the mouse — Esc releases the mouse, Esc again pauses.'
    );
  }

  /**
   * Non-modal, auto-expiring notice (§33.1 toasts, §31.6 recovery notices). Never
   * blocks the sim, never steals focus, and is safe to call before the first render.
   */
  toast(text: string, kind: HudToastKind = 'info'): void {
    const doc = this.root.ownerDocument;
    const element = doc.createElement('li');
    element.className = `gw-hud-toast gw-hud-toast--${kind}`;
    // The kind is also an attribute *and* written text below, so the severity is
    // readable without relying on colour (§33.2 rule 4).
    element.dataset['kind'] = kind;

    const icon = doc.createElement('span');
    icon.className = 'gw-hud-toast-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = TOAST_KIND_ICON[kind];

    const kindLabel = doc.createElement('span');
    kindLabel.className = 'gw-hud-toast-kind';
    kindLabel.textContent = TOAST_KIND_LABEL[kind];

    const body = doc.createElement('span');
    body.className = 'gw-hud-toast-text';
    // `textContent`, never `innerHTML`: notice text can carry author data.
    body.textContent = text;

    element.append(icon, kindLabel, body);
    this.toastList.appendChild(element);

    this.toasts.push({ element, remaining: HUD_TOAST_LIFETIME_SECONDS[kind] });

    // Bounded buffer: the oldest notice goes, so a burst can never grow the DOM
    // without limit (and can never throw).
    while (this.toasts.length > MAX_VISIBLE_TOASTS) {
      const oldest = this.toasts.shift();
      oldest?.element.remove();
    }
  }

  /**
   * Advances toast lifetimes. Call once per rendered frame with the frame's
   * seconds; a non-finite or negative delta must not extend or rewind a lifetime
   * (a bad frame delta is a platform problem, not a gameplay one).
   */
  update(dt: number): void {
    if (this.toasts.length === 0) return;
    const step = Number.isFinite(dt) && dt > 0 ? dt : 0;

    for (let index = this.toasts.length - 1; index >= 0; index -= 1) {
      const entry = this.toasts[index];
      if (entry === undefined) continue;
      entry.remaining -= step;
      if (entry.remaining <= 0) {
        entry.element.remove();
        this.toasts.splice(index, 1);
      }
    }
  }

  /** Intent out (§33.2 rule 2): the HUD reports the request and never applies it. */
  onHintRequest(handler: () => void): void {
    this.hintHandler = handler;
  }

  /** Intent out: the caller checks the blueprint and the scanner's cooldown (§29.3). */
  onScannerRequest(handler: () => void): void {
    this.scannerHandler = handler;
  }
}

