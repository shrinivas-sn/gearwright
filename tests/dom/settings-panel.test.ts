import { describe, expect, it, vi } from 'vitest';
import { buildSettingsPanel } from '../../src/presentation/settings-panel.ts';

describe('buildSettingsPanel — PLAN T6.4', () => {
  it('renders initial values and fires onChange on sensitivity input', () => {
    const onChange = vi.fn();
    const panel = buildSettingsPanel(
      document,
      { sensitivity: 1, invertY: false, volume: 0.8 },
      onChange
    );

    const inputs = panel.querySelectorAll('input');
    expect(inputs.length).toBe(3);

    const sensInput = inputs[0] as HTMLInputElement;
    expect(sensInput.type).toBe('range');
    expect(sensInput.value).toBe('1');

    sensInput.value = '1.75';
    sensInput.dispatchEvent(new Event('input', { bubbles: true }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({
      sensitivity: 1.75,
      invertY: false,
      volume: 0.8
    });
  });

  it('fires onChange on invert vertical look toggle', () => {
    const onChange = vi.fn();
    const panel = buildSettingsPanel(
      document,
      { sensitivity: 1.5, invertY: false, volume: 0.5 },
      onChange
    );

    const invertInput = panel.querySelectorAll('input')[1] as HTMLInputElement;
    expect(invertInput.type).toBe('checkbox');
    expect(invertInput.checked).toBe(false);

    invertInput.checked = true;
    invertInput.dispatchEvent(new Event('change', { bubbles: true }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({
      sensitivity: 1.5,
      invertY: true,
      volume: 0.5
    });
  });

  it('fires onChange on volume input', () => {
    const onChange = vi.fn();
    const panel = buildSettingsPanel(
      document,
      { sensitivity: 1, invertY: true, volume: 0.8 },
      onChange
    );

    const volInput = panel.querySelectorAll('input')[2] as HTMLInputElement;
    expect(volInput.type).toBe('range');
    expect(volInput.value).toBe('0.8');

    volInput.value = '0.2';
    volInput.dispatchEvent(new Event('input', { bubbles: true }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({
      sensitivity: 1,
      invertY: true,
      volume: 0.2
    });
  });
});
