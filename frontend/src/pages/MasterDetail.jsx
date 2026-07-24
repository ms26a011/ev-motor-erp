import React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client.js';
import { moduleFallbacks } from '../App.jsx';
import Message from '../components/Message.jsx';

function MasterDetail() {
  const { moduleKey, id } = useParams();
  const navigate = useNavigate();
  const [moduleInfo, setModuleInfo] = useState(null);
  const [record, setRecord] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const fallback = useMemo(
    () => moduleFallbacks.find((module) => module.key === moduleKey),
    [moduleKey],
  );

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');

    Promise.all([api.getModules(), api.get(moduleKey, id)])
      .then(([modules, data]) => {
        if (!active) return;
        setModuleInfo(modules.find((module) => module.key === moduleKey));
        setRecord(data);
      })
      .catch((err) => {
        if (active) setError(err.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [moduleKey, id]);

  const title = moduleInfo?.title || fallback?.title || 'Record';
  const columns = moduleInfo?.columns || inferColumns(record);
  const primaryColumn = columns.find((column) => column.primary_key)?.name || columns[0]?.name;

  return (
    <section>
      <div className="page-title">
        <div>
          <h2>{title} Details</h2>
          <p>Review the complete transaction record.</p>
        </div>
        <div className="detail-actions">
          <Link className="btn secondary" to={`/${moduleKey}`}>Back to List</Link>
          {record && <button className="btn primary" type="button" onClick={() => navigate(`/${moduleKey}/edit/${record[primaryColumn]}`)}>Edit</button>}
        </div>
      </div>

      <Message type="error">{error}</Message>

      {loading ? (
        <div className="empty-state">Loading details...</div>
      ) : record ? (
        <div className="detail-panel">
          {columns.map((column) => (
            <div className="detail-field" key={column.name}>
              <span>{column.name.replaceAll('_', ' ')}</span>
              <strong className={isStatusColumn(column.name) ? `status-badge ${normalizeStatus(record[column.name])}` : ''}>
                {formatValue(record[column.name])}
              </strong>
            </div>
          ))}
        </div>
      ) : (
        <div className="empty-state">Record not found.</div>
      )}
    </section>
  );
}

function inferColumns(record) {
  return Object.keys(record || {}).map((name, index) => ({ name, primary_key: index === 0 }));
}

function formatValue(value) {
  if (value === null || value === undefined || value === '') return '-';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) return value.slice(0, 10);
  return String(value);
}

function isStatusColumn(name) {
  return name.toLowerCase() === 'status';
}

function normalizeStatus(value) {
  return formatValue(value).toLowerCase().replaceAll(' ', '-');
}

export default MasterDetail;
