import React from 'react';
import { useEffect, useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Pencil,
  Search,
  Trash2,
  Eye,
} from 'lucide-react';

function DataTable({ columns, rows, onEdit, onDelete, onView }) {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [referenceDate, setReferenceDate] = useState('');
  const [dateColumnName, setDateColumnName] = useState('');
  const [sortState, setSortState] = useState({ column: '', direction: 'asc' });
  const visibleColumns = columns.filter((column) => !column.hidden);
  const statusColumn = visibleColumns.find((column) => isStatusColumn(column.name));
  const dateColumns = visibleColumns.filter((column) => isDateColumn(column.name));
  const preferredDateColumn = findPreferredDateColumn(dateColumns);
  const preferredDateColumnName = preferredDateColumn?.name || '';
  const selectedDateColumn = dateColumns.find((column) => column.name === dateColumnName) || preferredDateColumn;
  const primaryColumn = visibleColumns.find((column) => column.primary_key)?.name || visibleColumns[0]?.name;
  const sortableColumns = visibleColumns.filter((column) => isSortableColumn(column.name) || isDateColumn(column.name));
  const dateColumnKeys = dateColumns.map((column) => column.name).join('|');
  const statusOptions = useMemo(() => {
    if (!statusColumn) return [];
    return Array.from(new Set(rows.map((row) => formatValue(row[statusColumn.name])).filter((value) => value !== '-')));
  }, [rows, statusColumn]);

  useEffect(() => {
    setDateColumnName((current) => {
      if (!dateColumns.length) return '';
      if (current && dateColumns.some((column) => column.name === current)) return current;
      return preferredDateColumnName || dateColumns[0].name;
    });
  }, [dateColumnKeys, preferredDateColumnName]);

  const filteredRows = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();
    const filtered = rows.filter((row) => {
      const matchesSearch = !normalizedSearch
        || visibleColumns.some((column) => formatValue(row[column.name]).toLowerCase().includes(normalizedSearch));
      const matchesStatus = statusFilter === 'all'
        || !statusColumn
        || normalizeStatus(row[statusColumn.name]) === statusFilter;
      const rowReferenceDate = selectedDateColumn ? normalizeDate(row[selectedDateColumn.name]) : '';
      const matchesReferenceDate = !referenceDate || rowReferenceDate === referenceDate;
      return matchesSearch && matchesStatus && matchesReferenceDate;
    });

    if (!sortState.column) {
      return filtered;
    }

    return [...filtered].sort((first, second) => {
      const firstValue = comparableValue(first[sortState.column]);
      const secondValue = comparableValue(second[sortState.column]);
      if (firstValue < secondValue) return sortState.direction === 'asc' ? -1 : 1;
      if (firstValue > secondValue) return sortState.direction === 'asc' ? 1 : -1;
      return 0;
    });
  }, [rows, searchTerm, statusFilter, referenceDate, sortState, statusColumn, selectedDateColumn, visibleColumns]);

  function handleSort(columnName) {
    if (!isSortableColumn(columnName) && !isDateColumn(columnName)) {
      return;
    }
    setSortState((current) => ({
      column: columnName,
      direction: current.column === columnName && current.direction === 'asc' ? 'desc' : 'asc',
    }));
  }

  return (
    <>
      <div className="table-toolbar">
        <label className="table-search">
          <Search size={18} />
          <input
            type="search"
            placeholder="Search by document, item, vendor, customer..."
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
          />
        </label>
        {dateColumns.length > 0 && (
          <div className="date-filters">
            {dateColumns.length > 1 && (
              <select
                aria-label="Reference date field"
                className="date-column-filter"
                onChange={(event) => setDateColumnName(event.target.value)}
                value={selectedDateColumn?.name || ''}
              >
                {dateColumns.map((column) => (
                  <option key={column.name} value={column.name}>
                    {formatColumnLabel(column.name)}
                  </option>
                ))}
              </select>
            )}
            <input
              aria-label="Reference date"
              type="date"
              value={referenceDate}
              onChange={(event) => setReferenceDate(event.target.value)}
            />
          </div>
        )}
        {statusColumn && (
          <select
            className="status-filter"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
          >
            <option value="all">All Statuses</option>
            {statusOptions.map((status) => (
              <option key={status} value={normalizeStatus(status)}>{status}</option>
            ))}
          </select>
        )}
      </div>

      <div className="table-wrap master-table-wrap">
        {filteredRows.length ? (
          <table>
            <thead>
              <tr>
                {visibleColumns.map((column) => {
                  const sortable = sortableColumns.some((item) => item.name === column.name);
                  const activeSort = sortState.column === column.name;
                  return (
                    <th key={column.name}>
                      {sortable ? (
                        <button type="button" className="sort-button" onClick={() => handleSort(column.name)}>
                          <span>{column.name.replaceAll('_', ' ')}</span>
                          {activeSort && sortState.direction === 'desc' ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
                        </button>
                      ) : (
                        column.name.replaceAll('_', ' ')
                      )}
                    </th>
                  );
                })}
                <th className="actions-col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => (
                <tr key={row.__rowKey}>
                  {visibleColumns.map((column) => (
                    <td className={cellClassName(column.name, primaryColumn)} key={column.name}>
                      {renderCell(row[column.name], column.name)}
                    </td>
                  ))}
                  <td className="row-actions">
                    {onView && (
                      <button type="button" className="action-icon-button view-action" onClick={() => onView(row)} aria-label="View record">
                        <Eye size={16} />
                        <span>View</span>
                      </button>
                    )}
                    <button type="button" className="action-icon-button edit-action" onClick={() => onEdit(row)} aria-label="Edit record">
                      <Pencil size={16} />
                      <span>Edit</span>
                    </button>
                    <button type="button" className="action-icon-button delete-action" onClick={() => onDelete(row)} aria-label="Delete record">
                      <Trash2 size={16} />
                      <span>Delete</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="table-empty-state">
            <Search size={34} />
            <strong>No records found</strong>
            <span>Try a different search term</span>
          </div>
        )}
      </div>

      <div className="record-count-footer">
        Showing {filteredRows.length} of {rows.length} records
      </div>
    </>
  );
}

function formatValue(value) {
  if (value === null || value === undefined || value === '') return '-';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) return value.slice(0, 10);
  return String(value);
}

function renderCell(value, columnName) {
  const formatted = formatValue(value);
  if (isStatusColumn(columnName) || ['active', 'inactive', 'pending'].includes(normalizeStatus(value))) {
    return <span className={`status-badge ${normalizeStatus(value)}`}>{formatted}</span>;
  }
  return formatted;
}

function isStatusColumn(columnName) {
  const name = columnName.toLowerCase();
  return name === 'status' || name === 'record_status' || name === 'is_active' || name === 'active';
}

function normalizeStatus(value) {
  const text = formatValue(value).toLowerCase();
  if (['yes', 'true', '1', 'active'].includes(text)) return 'active';
  if (['no', 'false', '0', 'inactive'].includes(text)) return 'inactive';
  if (text === 'pending') return 'pending';
  return text;
}

function isSortableColumn(columnName) {
  const name = columnName.toLowerCase();
  return name.includes('name') || name.includes('code') || name.includes('number') || name.includes('quantity') || name.includes('amount');
}

function isDateColumn(columnName) {
  return columnName.toLowerCase().includes('date');
}

function findPreferredDateColumn(dateColumns) {
  if (!dateColumns.length) return null;
  const preferred = [...dateColumns].sort((first, second) => (
    dateColumnPriority(first.name) - dateColumnPriority(second.name)
  ));
  return preferred[0];
}

function dateColumnPriority(columnName) {
  const name = columnName.toLowerCase();
  const exactReferenceDates = [
    'pr_date',
    'requisition_date',
    'po_date',
    'purchase_order_date',
    'grn_date',
    'receipt_date',
    'issue_date',
    'move_order_date',
    'production_date',
    'order_date',
    'dispatch_date',
    'transaction_date',
    'created_date',
    'created_at',
  ];
  const exactIndex = exactReferenceDates.indexOf(name);
  if (exactIndex >= 0) return exactIndex;
  if (name.endsWith('_date') && !isPlanningOrDueDate(name)) return 50;
  if (name.includes('created')) return 60;
  if (isPlanningOrDueDate(name)) return 90;
  return 100;
}

function isPlanningOrDueDate(name) {
  return ['due', 'expected', 'required', 'delivery', 'planned', 'target', 'promise'].some((word) => name.includes(word));
}

function formatColumnLabel(columnName) {
  return columnName.replaceAll('_', ' ');
}

function normalizeDate(value) {
  const formatted = formatValue(value);
  return /^\d{4}-\d{2}-\d{2}/.test(formatted) ? formatted.slice(0, 10) : '';
}

function comparableValue(value) {
  const formatted = formatValue(value);
  const numeric = Number(formatted);
  return Number.isNaN(numeric) ? formatted.toLowerCase() : numeric;
}

function cellClassName(columnName, primaryColumn) {
  const name = columnName.toLowerCase();
  const classes = [];
  if (columnName === primaryColumn || name === 'id' || name.endsWith('_id')) {
    classes.push('id-cell');
  }
  if (name.includes('vendor') && name.includes('name')) {
    classes.push('strong-name-cell');
  }
  if (name.includes('employee') && name.includes('name')) {
    classes.push('strong-name-cell');
  }
  return classes.join(' ');
}

export default DataTable;
