import { describe, expect, it, vi } from 'vitest';

import { PauseOverlay } from '../../src/presentation/pause-overlay.ts';

describe('PauseOverlay (PLAN T1.2)', () => {
  it('starts hidden, shows the cause, hides again', () => {
    const root = document.createElement('div');
    const overlay = new PauseOverlay(root);
    expect(overlay.visible).toBe(false);
    overlay.show('focus-loss');
    expect(overlay.visible).toBe(true);
    expect(root.querySelector('.gw-pause-detail')?.textContent).toBe('Paused because the window lost focus.');
    overlay.hide();
    expect(overlay.visible).toBe(false);
  });

  it('resumes on a click anywhere, but not on panel controls', () => {
    const root = document.createElement('div');
    const overlay = new PauseOverlay(root);
    const onResume = vi.fn();
    overlay.onResume(onResume);
    overlay.show('user');
    (root.querySelector('.gw-pause-resume') as HTMLButtonElement).click();
    expect(onResume).toHaveBeenCalledTimes(1);
    const slider = document.createElement('input');
    overlay.mountExtra(slider);
    slider.click();
    expect(onResume).toHaveBeenCalledTimes(1);
    (root.querySelector('.gw-pause') as HTMLElement).click();
    expect(onResume).toHaveBeenCalledTimes(2);

    const noResumeBtn = document.createElement('button');
    noResumeBtn.className = 'gw-pause-resume gw-pause-noresume';
    overlay.mountExtra(noResumeBtn);
    noResumeBtn.click();
    expect(onResume).toHaveBeenCalledTimes(2);
  });
});
