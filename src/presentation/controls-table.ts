/** L4 — the controls list shown on the title screen and in the pause panel (PLAN T6.1). */

export type ControlRow = readonly [action: string, keys: string];

/** Build a two-column table; every value goes through textContent. */
export function buildControlsTable(doc: Document, rows: ReadonlyArray<ControlRow>): HTMLTableElement {
  const table = doc.createElement('table');
  table.className = 'gw-controls';
  const body = doc.createElement('tbody');
  for (const [action, keys] of rows) {
    const row = doc.createElement('tr');
    const actionCell = doc.createElement('td');
    actionCell.textContent = action;
    const keyCell = doc.createElement('td');
    keyCell.className = 'gw-controls-keys';
    keyCell.textContent = keys;
    row.append(actionCell, keyCell);
    body.append(row);
  }
  table.append(body);
  return table;
}
