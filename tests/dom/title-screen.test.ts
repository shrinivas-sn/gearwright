import { describe, expect, it, vi } from 'vitest';
import { TitleScreen } from '../../src/presentation/title-screen.ts';

describe('TitleScreen — PLAN T6.2', () => {
  it('renders Start button and hides New Game button when hasSave is false', () => {
    const table = document.createElement('table');
    const screen = new TitleScreen(document.body, { hasSave: false, controlsTable: table });

    const startBtn = document.querySelector<HTMLButtonElement>('.gw-title-start');
    const newBtn = document.querySelector<HTMLButtonElement>('.gw-title-new');

    expect(startBtn).not.toBeNull();
    expect(startBtn!.textContent).toBe('Start');
    expect(newBtn).not.toBeNull();
    expect(newBtn!.hidden).toBe(true);

    screen.dispose();
  });

  it('renders Continue button and shows New Game button when hasSave is true', () => {
    const table = document.createElement('table');
    const screen = new TitleScreen(document.body, { hasSave: true, controlsTable: table });

    const startBtn = document.querySelector<HTMLButtonElement>('.gw-title-start');
    const newBtn = document.querySelector<HTMLButtonElement>('.gw-title-new');

    expect(startBtn!.textContent).toBe('Continue');
    expect(newBtn!.hidden).toBe(false);
    expect(newBtn!.textContent).toBe('New game');

    screen.dispose();
  });

  it('calls onStart handler when start button is clicked', () => {
    const table = document.createElement('table');
    const screen = new TitleScreen(document.body, { hasSave: false, controlsTable: table });
    const onStart = vi.fn();
    screen.onStart(onStart);

    const startBtn = document.querySelector<HTMLButtonElement>('.gw-title-start')!;
    startBtn.click();

    expect(onStart).toHaveBeenCalledTimes(1);
    screen.dispose();
  });

  it('arms New Game on first click and fires onNewGame only on second click within window', () => {
    const table = document.createElement('table');
    const screen = new TitleScreen(document.body, { hasSave: true, controlsTable: table });
    const onNewGame = vi.fn();
    screen.onNewGame(onNewGame);

    const newBtn = document.querySelector<HTMLButtonElement>('.gw-title-new')!;
    newBtn.click();

    expect(newBtn.textContent).toBe('Click again to erase progress');
    expect(onNewGame).not.toHaveBeenCalled();

    newBtn.click();
    expect(onNewGame).toHaveBeenCalledTimes(1);

    screen.dispose();
  });

  it('toggles controls visibility when controls toggle button is clicked', () => {
    const table = document.createElement('table');
    const screen = new TitleScreen(document.body, { hasSave: false, controlsTable: table });

    const toggle = document.querySelector<HTMLButtonElement>('.gw-title-controls-toggle')!;
    const controls = document.querySelector<HTMLElement>('.gw-title-controls')!;

    expect(controls.classList.contains('gw-title--hidden')).toBe(true);
    toggle.click();
    expect(controls.classList.contains('gw-title--hidden')).toBe(false);
    toggle.click();
    expect(controls.classList.contains('gw-title--hidden')).toBe(true);

    screen.dispose();
  });

  it('tracks visible state and cleans up on dispose', () => {
    const table = document.createElement('table');
    const screen = new TitleScreen(document.body, { hasSave: false, controlsTable: table });

    expect(screen.visible).toBe(true);
    screen.hide();
    expect(screen.visible).toBe(false);

    expect(document.querySelector('.gw-title')).not.toBeNull();
    screen.dispose();
    expect(document.querySelector('.gw-title')).toBeNull();
  });
});
