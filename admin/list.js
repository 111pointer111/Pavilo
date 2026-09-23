(function (root, factory) {
  if (typeof module === 'object' && module && module.exports) module.exports = factory();
  else root.PaviloAdminList = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function cellValue(value) {
    if (value == null || value === false) return '';
    return value;
  }

  function fillCell(cell, value) {
    const content = cellValue(value);
    if (typeof Node === 'function' && content instanceof Node) cell.append(content);
    else cell.textContent = String(content);
  }

  // columns: { id, label, className?, align?: 'end' }
  // rows: { cells, muted? }
  // actions(row, tr) returns a node placed in the last column, or null.
  function createRecordList({ columns, rows, empty, actions, actionsLabel }) {
    const list = document.createElement('div');
    list.className = 'record-list';
    if (!rows || !rows.length) {
      const note = document.createElement('p');
      note.className = 'record-empty';
      note.textContent = empty || '';
      list.append(note);
      return list;
    }
    const table = document.createElement('table');
    const thead = document.createElement('thead');
    const head = document.createElement('tr');
    for (const column of columns) {
      const th = document.createElement('th');
      th.scope = 'col';
      th.className = column.className || '';
      if (column.align === 'end') th.classList.add('num');
      th.textContent = column.label || '';
      head.append(th);
    }
    if (actions) {
      const th = document.createElement('th');
      th.scope = 'col';
      th.className = 'record-actions';
      th.textContent = actionsLabel || '';
      head.append(th);
    }
    thead.append(head);
    const tbody = document.createElement('tbody');
    for (const row of rows) {
      const tr = document.createElement('tr');
      if (row.muted) tr.classList.add('is-muted');
      for (const column of columns) {
        const td = document.createElement('td');
        td.className = column.className || '';
        td.dataset.cell = column.id;
        if (column.align === 'end') td.classList.add('num');
        fillCell(td, row.cells ? row.cells[column.id] : '');
        tr.append(td);
      }
      if (actions) {
        const td = document.createElement('td');
        td.className = 'record-actions';
        const control = actions(row, tr);
        if (control) td.append(control);
        tr.append(td);
      }
      tbody.append(tr);
    }
    table.append(thead, tbody);
    list.append(table);
    return list;
  }

  return { createRecordList };
});
