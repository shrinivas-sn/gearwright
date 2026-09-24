/**
 * L4 — presentation settings panel (PLAN T6.4).
 * Pure presentation; structural typing to avoid adapter dependency.
 */

export interface SettingsViewData {
  readonly sensitivity: number;
  readonly invertY: boolean;
  readonly volume: number;
}

export function buildSettingsPanel(
  doc: Document,
  initial: SettingsViewData,
  onChange: (next: SettingsViewData) => void
): HTMLElement {
  const panel = doc.createElement('div');
  panel.className = 'gw-settings';

  const current = {
    sensitivity: initial.sensitivity,
    invertY: initial.invertY,
    volume: initial.volume
  };

  const emit = (): void => {
    onChange({
      sensitivity: current.sensitivity,
      invertY: current.invertY,
      volume: current.volume
    });
  };

  // Row 1: Mouse sensitivity
  const sensRow = doc.createElement('label');
  sensRow.className = 'gw-settings-row';
  const sensLabel = doc.createElement('span');
  sensLabel.textContent = 'Mouse sensitivity';
  const sensInput = doc.createElement('input');
  sensInput.type = 'range';
  sensInput.min = '0.25';
  sensInput.max = '3';
  sensInput.step = '0.05';
  sensInput.value = String(initial.sensitivity);
  sensInput.addEventListener('input', () => {
    const val = Number(sensInput.value);
    if (Number.isFinite(val)) {
      current.sensitivity = val;
      emit();
    }
  });
  sensRow.append(sensLabel, sensInput);

  // Row 2: Invert vertical look
  const invertRow = doc.createElement('label');
  invertRow.className = 'gw-settings-row';
  const invertLabel = doc.createElement('span');
  invertLabel.textContent = 'Invert vertical look';
  const invertInput = doc.createElement('input');
  invertInput.type = 'checkbox';
  invertInput.checked = initial.invertY;
  invertInput.addEventListener('change', () => {
    current.invertY = invertInput.checked;
    emit();
  });
  invertRow.append(invertLabel, invertInput);

  // Row 3: Volume
  const volRow = doc.createElement('label');
  volRow.className = 'gw-settings-row';
  const volLabel = doc.createElement('span');
  volLabel.textContent = 'Volume';
  const volInput = doc.createElement('input');
  volInput.type = 'range';
  volInput.min = '0';
  volInput.max = '1';
  volInput.step = '0.05';
  volInput.value = String(initial.volume);
  volInput.addEventListener('input', () => {
    const val = Number(volInput.value);
    if (Number.isFinite(val)) {
      current.volume = val;
      emit();
    }
  });
  volRow.append(volLabel, volInput);

  panel.append(sensRow, invertRow, volRow);
  return panel;
}
