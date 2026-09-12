import React from 'react';
import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Boxes,
  CalendarClock,
  Gauge,
  PackageCheck,
  PackageX,
  ShieldAlert,
  ShoppingCart,
} from 'lucide-react';
import { api } from '../api/client.js';

const summaryCards = [
  { key: 'unavailableItems', label: 'Items Unavailable', icon: PackageX, accent: '#b42318' },
  { key: 'orderTodayItems', label: 'Order Today', icon: CalendarClock, accent: '#9a3412' },
  { key: 'stockoutRiskItems', label: 'Stockout Risk', icon: AlertTriangle, accent: '#7c3aed' },
  { key: 'productionShortages', countKey: 'productionShortageItems', label: 'Production Shortages', icon: ShieldAlert, accent: '#0b5cab' },
];

const criticalityCards = [
  { key: 'highlyCritical', label: 'Highly Critical', accent: '#b42318' },
  { key: 'semiCritical', label: 'Semi Critical', accent: '#9a3412' },
  { key: 'lowCritical', label: 'Low Critical', accent: '#067647' },
];

function InventoryAnalytics() {
  const [analytics, setAnalytics] = useState(null);
  const [activeView, setActiveView] = useState('orderTodayItems');
  const [error, setError] = useState('');

  useEffect(() => {
    api.getInventoryAnalytics()
      .then(setAnalytics)
      .catch((err) => setError(err.message));
  }, []);

  const rows = useMemo(() => analytics?.[activeView] || [], [analytics, activeView]);

  return (
    <section>
      <div className="page-title">
        <div>
          <h2>Inventory Analytics</h2>
          <p>Availability, reorder timing, criticality, stockout risk, and production coverage.</p>
        </div>
      </div>

      {error && <div className="message error">{error}</div>}

      <div className="metric-grid inventory-analytics-metrics">
        {summaryCards.map((card) => (
          <button
            className={`metric-card dashboard-metric-card analytics-card ${activeView === card.key ? 'active' : ''}`}
            key={card.key}
            onClick={() => setActiveView(card.key)}
            style={{ '--card-accent': card.accent }}
            type="button"
          >
            <div className="metric-card-top">
              <span>{card.label}</span>
              {React.createElement(card.icon, { size: 22, strokeWidth: 2.1 })}
            </div>
            <strong>{formatNumber(analytics?.summary?.[card.countKey || card.key])}</strong>
            <small>Open view</small>
          </button>
        ))}
      </div>

      <div className="dashboard-details-grid analytics-grid">
        <article className="dashboard-panel">
          <div className="panel-heading">
            <h3>Criticality View</h3>
          </div>
          <div className="criticality-grid">
            {criticalityCards.map((card) => (
              <button
                className="criticality-card"
                key={card.key}
                onClick={() => setActiveView('stockoutRiskItems')}
                style={{ '--criticality-accent': card.accent }}
                type="button"
              >
                <span>{card.label}</span>
                <strong>{formatNumber(analytics?.summary?.criticality?.[card.key])}</strong>
              </button>
            ))}
          </div>
        </article>

        <article className="dashboard-panel">
          <div className="panel-heading">
            <h3>Planning Signals</h3>
          </div>
          <div className="summary-list">
            <SignalRow icon={ShoppingCart} label="Open PO Coverage" value={analytics?.summary?.openPoCoverageItems} onClick={() => setActiveView('openPoCoverage')} />
            <SignalRow icon={Gauge} label="Slow Moving / Excess" value={analytics?.summary?.excessSlowMovingItems} onClick={() => setActiveView('excessSlowMovingItems')} />
            <SignalRow icon={Boxes} label="Total Active Items" value={analytics?.summary?.totalActiveItems} />
            <SignalRow icon={PackageCheck} label="Last Refreshed" value={formatDateTime(analytics?.generatedAt)} />
          </div>
        </article>
      </div>

      <article className="dashboard-panel analytics-table-panel">
        <div className="panel-heading">
          <h3>{viewTitle(activeView)}</h3>
        </div>
        <InventoryAnalyticsTable rows={rows} view={activeView} />
      </article>
    </section>
  );
}

function SignalRow({ icon: Icon, label, value, onClick }) {
  const content = (
    <>
      <Icon size={18} />
      <span>{label}</span>
      <b>{value ?? '-'}</b>
    </>
  );
  if (!onClick) return <div className="summary-row">{content}</div>;
  return (
    <button className="summary-row analytics-signal-button" onClick={onClick} type="button">
      {content}
    </button>
  );
}

function InventoryAnalyticsTable({ rows, view }) {
  if (!rows.length) {
    return (
      <div className="table-empty-state">
        <strong>No items in this view</strong>
        <span>The current data does not show an exception for this business case.</span>
      </div>
    );
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Item</th>
            <th>Criticality</th>
            <th>Available</th>
            <th>Requirement</th>
            <th>Open PO</th>
            <th>Suggested Order</th>
            <th>{view === 'stockoutRiskItems' ? 'Days Cover' : 'Required By'}</th>
            <th>Risk</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${view}-${row.item_id}`}>
              <td>
                <div className="analytics-item-cell">
                  <strong>{row.item_code}</strong>
                  <span>{row.item_name}</span>
                </div>
              </td>
              <td>{row.criticality}</td>
              <td>{formatQuantity(row.available_quantity, row.uom)}</td>
              <td>{formatQuantity(row.planning_requirement_quantity, row.uom)}</td>
              <td>{formatQuantity(row.open_po_quantity, row.uom)}</td>
              <td>{formatQuantity(row.suggested_order_quantity, row.uom)}</td>
              <td>{view === 'stockoutRiskItems' ? `${row.days_of_cover} days` : formatDate(row.required_by_date)}</td>
              <td><span className={`status-badge ${row.risk_level.toLowerCase()}`}>{row.risk_level}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function viewTitle(view) {
  const titles = {
    unavailableItems: 'Items Unavailable',
    orderTodayItems: 'Items To Be Ordered Today',
    stockoutRiskItems: 'Stockout Risk Forecast',
    productionShortages: 'Production Shortage View',
    openPoCoverage: 'Open PO Coverage',
    excessSlowMovingItems: 'Excess And Slow Moving Inventory',
  };
  return titles[view] || 'Inventory Analytics';
}

function formatNumber(value) {
  if (value === undefined || value === null) return '-';
  return Number(value).toLocaleString();
}

function formatQuantity(value, uom = '') {
  const number = Number(value || 0);
  return `${number.toLocaleString(undefined, { maximumFractionDigits: 2 })}${uom ? ` ${uom}` : ''}`;
}

function formatDate(value) {
  if (!value || String(value).startsWith('9999-12-31')) return '-';
  return new Date(value).toLocaleDateString();
}

function formatDateTime(value) {
  if (!value) return '-';
  return new Date(value).toLocaleString();
}

export default InventoryAnalytics;
