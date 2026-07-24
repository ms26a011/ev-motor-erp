import React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AlertCircle, Download, FileSpreadsheet, Upload } from 'lucide-react';
import { api } from '../api/client.js';
import Message from '../components/Message.jsx';

function DataImport() {
  const { moduleKey } = useParams();
  const [modules, setModules] = useState([]);
  const [history, setHistory] = useState([]);
  const [filePayload, setFilePayload] = useState(null);
  const [preview, setPreview] = useState(null);
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const selectedModule = useMemo(
    () => modules.find((module) => module.key === moduleKey),
    [modules, moduleKey],
  );

  useEffect(() => {
    api.getImportModules()
      .then(setModules)
      .catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    api.getImportHistory(moduleKey || '')
      .then(setHistory)
      .catch(() => setHistory([]));
  }, [moduleKey]);

  async function handleFile(event) {
    const file = event.target.files?.[0];
    setPreview(null);
    setSummary(null);
    setError('');
    if (!file) return;
    if (!/\.(csv|xlsx)$/i.test(file.name)) {
      setError('Please upload a CSV or Excel .xlsx file.');
      return;
    }
    const contentBase64 = await readFileBase64(file);
    setFilePayload({ fileName: file.name, contentBase64 });
  }

  async function handleValidate() {
    if (!selectedModule || !filePayload) {
      setError('Choose an import table and upload a file first.');
      return;
    }
    try {
      setLoading(true);
      setError('');
      setPreview(await api.previewImport(selectedModule.key, filePayload));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleImport() {
    if (!selectedModule || !filePayload) return;
    try {
      setLoading(true);
      setError('');
      const result = await api.runImport(selectedModule.key, filePayload);
      setSummary(result);
      setHistory(await api.getImportHistory(selectedModule.key));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function downloadErrors() {
    const errors = summary?.errors?.length ? summary.errors : preview?.rows?.filter((row) => !row.valid && !row.skipped).map((row) => ({
      rowNumber: row.rowNumber,
      error: row.errors.join('; '),
      row: row.row,
    })) || [];
    const blob = await api.downloadErrorReport(errors);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'import_errors.csv';
    link.click();
    URL.revokeObjectURL(url);
  }

  async function downloadTemplate() {
    try {
      const blob = await api.downloadImportTemplate(moduleKey);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${moduleKey}_template.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message);
    }
  }

  if (!moduleKey) {
    return (
      <section>
        <div className="page-title">
          <div>
            <h2>Data Import</h2>
            <p>Import master and transaction data from CSV or Excel files.</p>
          </div>
        </div>
        <ImportSequence modules={modules} />
        <div className="import-module-grid">
          {modules.map((module) => (
            <Link className={`import-module-card ${module.available ? '' : 'disabled'}`} key={module.key} to={module.available ? `/import/${module.key}` : '/import'}>
              <FileSpreadsheet size={22} />
              <span>{module.title}</span>
              <small>{module.available ? module.table : 'Table missing'}</small>
            </Link>
          ))}
        </div>
      </section>
    );
  }

  return (
    <section>
      <div className="page-title">
        <div>
          <h2>{selectedModule?.title || 'Data Import'}</h2>
          <p>Upload a CSV or Excel file, validate it, then import valid rows.</p>
        </div>
        <Link className="btn secondary" to="/import">All Imports</Link>
      </div>

      <Message type="error">{error}</Message>

      <div className="import-workspace">
        <div className="import-actions-panel">
          <button className="btn secondary" onClick={downloadTemplate} type="button">
            <Download size={16} />
            Download Sample Template
          </button>
          <label className="file-upload-button">
            <Upload size={16} />
            <span>{filePayload?.fileName || 'Upload CSV / XLSX'}</span>
            <input accept=".csv,.xlsx" type="file" onChange={handleFile} />
          </label>
          <button className="btn secondary" disabled={loading || !filePayload} onClick={handleValidate} type="button">Validate</button>
          <button className="btn primary" disabled={loading || !preview?.validRows} onClick={handleImport} type="button">Import Valid Rows</button>
        </div>

        {preview && (
          <SummaryPanel
            title="Validation Summary"
            values={[
              ['Total Rows', preview.totalRows],
              ['Valid', preview.validRows],
              ['Skipped', preview.skippedRows],
              ['Failed', preview.failedRows],
            ]}
          />
        )}

        {summary && (
          <SummaryPanel
            title="Import Summary"
            values={[
              ['Imported', summary.imported],
              ['Skipped', summary.skipped],
              ['Failed', summary.failed],
            ]}
          />
        )}
      </div>

      {(preview?.failedRows > 0 || summary?.failed > 0) && (
        <button className="btn danger import-error-download" onClick={downloadErrors} type="button">
          <AlertCircle size={16} />
          Download Error Report
        </button>
      )}

      {preview && <PreviewGrid rows={preview.rows} />}
      <ImportHistory rows={history} />
    </section>
  );
}

function ImportSequence({ modules }) {
  return (
    <div className="import-sequence">
      <strong>Recommended import order</strong>
      <div>
        {modules.map((module, index) => (
          <span key={module.key}>{index + 1}. {module.title}</span>
        ))}
      </div>
    </div>
  );
}

function SummaryPanel({ title, values }) {
  return (
    <div className="import-summary-panel">
      <strong>{title}</strong>
      <div>
        {values.map(([label, value]) => (
          <span key={label}>{label}: <b>{value ?? 0}</b></span>
        ))}
      </div>
    </div>
  );
}

function PreviewGrid({ rows }) {
  const columns = Object.keys(rows[0]?.row || {}).slice(0, 8);
  return (
    <div className="table-wrap import-preview-table">
      <table>
        <thead>
          <tr>
            <th>Row</th>
            <th>Status</th>
            <th>Message</th>
            {columns.map((column) => <th key={column}>{column.replaceAll('_', ' ')}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.rowNumber}>
              <td>{row.rowNumber}</td>
              <td>{row.valid ? 'Valid' : row.skipped ? 'Skipped' : 'Failed'}</td>
              <td>{row.errors?.join('; ') || row.messages?.join('; ') || '-'}</td>
              {columns.map((column) => <td key={column}>{row.row[column] || '-'}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ImportHistory({ rows }) {
  return (
    <div className="dashboard-panel import-history-panel">
      <div className="panel-heading">
        <h3>Import History</h3>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>User</th>
              <th>File</th>
              <th>Table</th>
              <th>Imported</th>
              <th>Skipped</th>
              <th>Failed</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? rows.map((row) => (
              <tr key={row.import_id}>
                <td>{formatDate(row.import_date)}</td>
                <td>{row.imported_by || '-'}</td>
                <td>{row.file_name}</td>
                <td>{row.table_name}</td>
                <td>{row.records_imported}</td>
                <td>{row.records_skipped}</td>
                <td>{row.records_failed}</td>
                <td>{row.status}</td>
              </tr>
            )) : (
              <tr><td colSpan="8">No imports yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function formatDate(value) {
  if (!value) return '-';
  return String(value).replace('T', ' ').slice(0, 19);
}

function readFileBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(new Error('Unable to read the selected file.'));
    reader.readAsDataURL(file);
  });
}

export default DataImport;
