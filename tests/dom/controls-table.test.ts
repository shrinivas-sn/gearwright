import { describe, expect, it } from 'vitest';
import { buildControlsTable } from '../../src/presentation/controls-table.ts';

describe('buildControlsTable — PLAN T6.1', () => {
  it('builds a table from rows, escape HTML via textContent', () => {
    const table = buildControlsTable(document, [
      ['Move', 'W A S D'],
      ['Action', '<b>x</b>']
    ]);

    expect(table.tagName).toBe('TABLE');
    expect(table.className).toBe('gw-controls');
    const rows = table.querySelectorAll('tr');
    expect(rows.length).toBe(2);

    const cells0 = rows[0]!.querySelectorAll('td');
    expect(cells0[0]!.textContent).toBe('Move');
    expect(cells0[1]!.textContent).toBe('W A S D');
    expect(cells0[1]!.className).toBe('gw-controls-keys');

    const cells1 = rows[1]!.querySelectorAll('td');
    expect(cells1[0]!.textContent).toBe('Action');
    expect(cells1[1]!.textContent).toBe('<b>x</b>');
    expect(cells1[1]!.querySelector('b')).toBeNull();
  });
});
