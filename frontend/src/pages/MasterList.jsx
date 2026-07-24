import React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client.js';
import { moduleFallbacks } from '../App.jsx';
import DataTable from '../components/DataTable.jsx';
import Message from '../components/Message.jsx';

function MasterList() {
  const { moduleKey } = useParams();
  const navigate = useNavigate();
  const [moduleInfo, setModuleInfo] = useState(null);
  const [rows, setRows] = useState([]);
  const [message, setMessage] = useState('');
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

    Promise.all([api.getModules(), api.list(moduleKey)])
      .then(([modules, data]) => {
        if (!active) return;
        const found = modules.find((module) => module.key === moduleKey);
        setModuleInfo(found);
        const primaryColumn = found?.columns?.find((column) => column.primary_key)?.name;
        setRows(data.map((row, index) => ({
          ...row,
          __rowKey: primaryColumn ? row[primaryColumn] : index,
        })));
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
  }, [moduleKey]);

  const title = moduleInfo?.title || fallback?.title || 'Master Data';
  const columns = moduleInfo?.columns || inferColumns(rows);
  const primaryColumn = columns.find((column) => column.primary_key)?.name || columns[0]?.name;

  async function handleDelete(row) {
    const id = row[primaryColumn];
    const confirmed = window.confirm('Delete this record?');
    if (!confirmed) return;

    try {
      await api.remove(moduleKey, id);
      setRows((current) => current.filter((item) => item[primaryColumn] !== id));
      setMessage('Record deleted successfully.');
      setError('');
    } catch (err) {
      setError(err.message);
      setMessage('');
    }
  }

  return (
    <section>
      <div className="page-title">
        <div>
          <h2>{title}</h2>
          <p>Manage records with add, edit, and delete actions.</p>
        </div>
        <Link className="btn primary" to={`/${moduleKey}/add`}>Add New</Link>
      </div>

      <Message>{message}</Message>
      <Message type="error">{error}</Message>

      {loading ? (
        <div className="empty-state">Loading records...</div>
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          onView={(row) => navigate(`/${moduleKey}/view/${row[primaryColumn]}`)}
          onEdit={(row) => navigate(`/${moduleKey}/edit/${row[primaryColumn]}`)}
          onDelete={handleDelete}
        />
      )}
    </section>
  );
}

function inferColumns(rows) {
  const firstRow = rows[0] || {};
  return Object.keys(firstRow)
    .filter((key) => key !== '__rowKey')
    .map((name, index) => ({ name, primary_key: index === 0 }));
}

export default MasterList;
