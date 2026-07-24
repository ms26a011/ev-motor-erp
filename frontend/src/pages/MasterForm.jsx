import React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { api } from '../api/client.js';
import { moduleFallbacks } from '../App.jsx';

const vendorTypeOptions = [
  'Raw Material Supplier',
  'Component Manufacturer',
  'Chemical Supplier',
  'Electrical Components Supplier',
  'Other',
];

const statusOptionsByModule = {
  purchaseRequisitions: ['Draft', 'Pending', 'Approved', 'Rejected', 'Converted to PO'],
  purchaseOrders: ['Draft', 'Issued', 'Partially Received', 'Fully Received', 'Cancelled', 'Closed'],
  grns: ['Draft', 'Received', 'Under Inspection', 'Accepted', 'Partially Accepted', 'Rejected', 'Closed'],
  stockIssues: ['Pending', 'Approved', 'Issued', 'Completed', 'Cancelled'],
  productionOrders: ['Planned', 'Released', 'In Progress', 'Completed', 'Partially Completed', 'Cancelled', 'On Hold'],
  productionOrderItems: ['Planned', 'In Progress', 'Completed', 'Partially Completed', 'Rejected', 'On Hold'],
  bomConsumptions: ['Planned', 'Issued', 'Consumed', 'Partially Consumed', 'Returned', 'Closed'],
  finishedGoodsReceipts: ['Pending Inspection', 'Accepted', 'Partially Accepted', 'Rejected'],
  salesOrders: ['Pending', 'Confirmed', 'Partially Dispatched', 'Dispatched', 'Closed', 'Cancelled'],
  dispatches: ['Pending', 'Packed', 'Dispatched', 'Completed', 'Cancelled'],
  qualityInspections: ['Pending', 'Passed', 'Partially Passed', 'Failed'],
  vendorInvoices: ['Draft', 'Approved', 'Partially Paid', 'Paid', 'Cancelled'],
  vendorPayments: ['Draft', 'Posted', 'Cancelled'],
  customerInvoices: ['Draft', 'Approved', 'Partially Received', 'Received', 'Cancelled'],
  customerReceipts: ['Draft', 'Posted', 'Cancelled'],
};

function MasterForm({ mode }) {
  const { moduleKey, id } = useParams();
  const navigate = useNavigate();
  const [moduleInfo, setModuleInfo] = useState(null);
  const [form, setForm] = useState({});
  const [lookups, setLookups] = useState({});
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState(null);

  const fallback = useMemo(
    () => moduleFallbacks.find((module) => module.key === moduleKey),
    [moduleKey],
  );

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');

    async function load() {
      const modules = await api.getModules();
      const found = modules.find((module) => module.key === moduleKey);
      const record = mode === 'edit' ? await api.get(moduleKey, id) : {};
      const dropdownColumns = found?.columns?.filter((column) => column.dropdown_module) || [];
      const dropdownData = {};

      await Promise.all(dropdownColumns.map(async (column) => {
        dropdownData[column.name] = await api.lookup(column.dropdown_module);
      }));

      if (!active) return;
      setModuleInfo(found);
      setForm(buildInitialForm(found?.columns || [], record));
      setLookups(dropdownData);
    }

    load()
      .catch((err) => {
        if (active) setError(err.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [moduleKey, id, mode]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(null), 3000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const columns = moduleInfo?.columns || [];
  const editableColumns = columns.filter((column) => !column.readonly);
  const title = moduleInfo?.title || fallback?.title || 'Master Data';

  function updateField(name, value) {
    setForm((current) => ({ ...current, [name]: value }));
  }

  function showToast(type, text) {
    setToast({ type, text });
  }

  function validate() {
    const missing = editableColumns
      .filter((column) => column.required && !form[column.name])
      .map((column) => column.name.replaceAll('_', ' '));

    if (missing.length) {
      const validationMessage = `Please fill required field(s): ${missing.join(', ')}.`;
      setError(validationMessage);
      showToast('error', validationMessage);
      return false;
    }
    return true;
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!validate()) return;

    try {
      setSubmitting(true);
      if (mode === 'edit') {
        await api.update(moduleKey, id, form);
        showToast('success', 'Record updated successfully');
      } else {
        const createdRecord = await api.create(moduleKey, form);
        const generatedNumber = findTransactionNumber(createdRecord);
        showToast('success', generatedNumber ? `Record created: ${generatedNumber}` : 'Record created successfully');
        setForm(buildInitialForm(columns, {}));
      }
      setError('');
      setTimeout(() => navigate(`/${moduleKey}`), 1200);
    } catch (err) {
      setError(err.message);
      showToast('error', err.message);
    } finally {
      setSubmitting(false);
    }
  }

  const sections = groupColumns(editableColumns);

  return (
    <section>
      <div className="page-title">
        <div>
          <h2>{mode === 'edit' ? `Edit ${title}` : `Add ${title}`}</h2>
          <p>Fields marked with * are required.</p>
        </div>
        <Link className="btn secondary" to={`/${moduleKey}`}>Back to List</Link>
      </div>

      {toast && (
        <div className={`form-toast ${toast.type}`} role="status">
          {toast.type === 'success' ? <CheckCircle2 size={20} /> : <XCircle size={20} />}
          <span>{toast.text}</span>
        </div>
      )}

      {loading ? (
        <div className="empty-state">Loading form...</div>
      ) : (
        <form className="form-panel" onSubmit={handleSubmit}>
          {sections.map((section) => (
            <div className="form-section" key={section.title}>
              <h3>{section.title}</h3>
              <div className="form-grid">
                {section.columns.map((column) => (
                  <FormField
                    column={column}
                    key={column.name}
                    lookups={lookups[column.name] || []}
                    moduleKey={moduleKey}
                    onChange={updateField}
                    value={form[column.name] ?? ''}
                  />
                ))}
              </div>
            </div>
          ))}
          <div className="form-actions upgraded-form-actions">
            <button type="submit" className="form-submit-button" disabled={submitting}>
              {submitting && <Loader2 className="spinner" size={17} />}
              {mode === 'edit' ? 'Update Record' : 'Create Record'}
            </button>
            <Link className="form-cancel-button" to={`/${moduleKey}`}>Cancel</Link>
          </div>
        </form>
      )}
    </section>
  );
}

function FormField({ column, lookups, moduleKey, onChange, value }) {
  const label = column.name.replaceAll('_', ' ');
  const commonProps = {
    id: column.name,
    name: column.name,
    required: column.required,
    value: formatInputValue(value, column.type),
    onChange: (event) => onChange(column.name, event.target.value),
  };

  return (
    <label className={`field upgraded-field ${isRatingField(column.name) ? 'rating-field' : ''}`} htmlFor={column.name}>
      <span>
        {label}
        {column.required && <b> *</b>}
      </span>
      {renderFieldControl(column, commonProps, lookups, moduleKey, onChange)}
    </label>
  );
}

function renderFieldControl(column, commonProps, lookups, moduleKey, onChange) {
  const label = column.name.replaceAll('_', ' ');

  if (isStatusField(column.name)) {
    const options = statusOptionsByModule[moduleKey] || ['Active', 'Inactive'];
    return (
      <select {...commonProps}>
        <option value="">Select status</option>
        {options.map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
    );
  }

  if (isVendorTypeField(column.name)) {
    return (
      <select {...commonProps}>
        <option value="">Select {label}</option>
        {vendorTypeOptions.map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
    );
  }

  if (column.dropdown_module) {
    return (
      <select {...commonProps}>
        <option value="">Select {label}</option>
        {lookups.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    );
  }

  if (isRatingField(column.name)) {
    const ratingValue = Number(commonProps.value || 0);
    return (
      <div className="star-rating" role="radiogroup" aria-label={label}>
        {[1, 2, 3, 4, 5].map((rating) => (
          <button
            aria-checked={ratingValue === rating}
            aria-label={`${rating} star${rating > 1 ? 's' : ''}`}
            className={rating <= ratingValue ? 'filled' : ''}
            key={rating}
            onClick={() => onChange(column.name, rating)}
            role="radio"
            type="button"
          >
            *
          </button>
        ))}
        <span>{ratingValue || '-'}/5</span>
      </div>
    );
  }

  return (
    <input
      {...commonProps}
      max={isLeadTimeField(column.name) ? 365 : undefined}
      min={isLeadTimeField(column.name) ? 1 : undefined}
      placeholder={`Enter ${label}`}
      type={isLeadTimeField(column.name) ? 'number' : inputType(column.type)}
    />
  );
}

function buildInitialForm(columns, record) {
  return columns.reduce((acc, column) => {
    if (!column.readonly) {
      acc[column.name] = record[column.name] ?? '';
    }
    return acc;
  }, {});
}

function formatInputValue(value, dbType = '') {
  if (value === null || value === undefined) return '';
  if (dbType.toLowerCase().includes('date') && typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
    return value.slice(0, 10);
  }
  return value;
}

function findTransactionNumber(record) {
  const numberField = Object.keys(record || {}).find((key) => {
    const field = key.toLowerCase();
    return field.endsWith('_number') || field === 'invoice_number' || field === 'payment_number';
  });
  return numberField ? record[numberField] : '';
}

function inputType(dbType = '') {
  const type = dbType.toLowerCase();
  if (type.includes('date') || type.includes('time')) return 'date';
  if (type.includes('int') || type.includes('decimal') || type.includes('float') || type.includes('double')) {
    return 'number';
  }
  if (type.includes('email')) return 'email';
  return 'text';
}

function isStatusField(name) {
  const field = name.toLowerCase();
  return field === 'status' || field === 'record_status' || field === 'active' || field === 'is_active';
}

function isVendorTypeField(name) {
  const field = name.toLowerCase();
  return field.includes('vendor_type') || field.includes('supplier_type') || field === 'type';
}

function isRatingField(name) {
  return name.toLowerCase().includes('rating');
}

function isLeadTimeField(name) {
  const field = name.toLowerCase();
  return field.includes('lead_time') || (field.includes('lead') && field.includes('days'));
}

function groupColumns(columns) {
  const groups = [
    { title: 'Basic Information', columns: [] },
    { title: 'Contact Details', columns: [] },
    { title: 'Commercial Terms', columns: [] },
  ];

  columns.forEach((column) => {
    if (isCommercialField(column.name)) {
      groups[2].columns.push(column);
    } else if (isContactField(column.name)) {
      groups[1].columns.push(column);
    } else {
      groups[0].columns.push(column);
    }
  });

  return groups.filter((group) => group.columns.length);
}

function isContactField(name) {
  const field = name.toLowerCase();
  return ['email', 'phone', 'mobile', 'address', 'contact', 'city', 'state', 'pincode', 'zip', 'location'].some((key) => field.includes(key));
}

function isCommercialField(name) {
  const field = name.toLowerCase();
  return ['gst', 'tax', 'payment', 'credit', 'rating', 'lead_time', 'lead', 'terms', 'price', 'cost', 'vendor_type', 'supplier_type'].some((key) => field.includes(key));
}

export default MasterForm;
