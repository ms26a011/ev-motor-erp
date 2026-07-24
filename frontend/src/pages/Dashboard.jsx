import React from 'react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ClipboardCheck,
  CreditCard,
  Factory,
  Package,
  ShoppingCart,
  Truck,
  Users,
  Warehouse,
} from 'lucide-react';
import { api } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';

const phaseTwoCards = [
  { key: 'pendingPurchaseRequisitions', label: 'Pending PRs', icon: ClipboardCheck, accent: '#0b5cab', route: '/purchaseRequisitions' },
  { key: 'openPurchaseOrders', label: 'Open POs', icon: ShoppingCart, accent: '#1d6fb8', route: '/purchaseOrders' },
  { key: 'pendingGrns', label: 'Pending GRNs', icon: Truck, accent: '#2a7fc5', route: '/grns' },
  { key: 'currentStockValue', label: 'Stock Value', icon: Warehouse, accent: '#0b5cab', currency: true, route: '/stockInwards' },
  { key: 'lowStockItems', label: 'Low Stock Items', icon: AlertTriangle, accent: '#084985', route: '/items' },
  { key: 'activeProductionOrders', label: 'Active Production', icon: Factory, accent: '#1d6fb8', route: '/productionOrders' },
  { key: 'pendingSalesOrders', label: 'Pending Sales', icon: ShoppingCart, accent: '#2a7fc5', route: '/salesOrders' },
  { key: 'stockTransactions', label: 'Stock Logs', icon: CreditCard, accent: '#084985', route: '/stockTransactions', countKey: 'stockTransactions' },
];

const masterCards = [
  { key: 'departments', label: 'Departments', icon: Users, route: '/departments' },
  { key: 'employees', label: 'Employees', icon: Users, route: '/employees' },
  { key: 'vendors', label: 'Vendors', icon: Truck, route: '/vendors' },
  { key: 'items', label: 'Items', icon: Package, route: '/items' },
  { key: 'customers', label: 'Customers', icon: Users, route: '/customers' },
];

function Dashboard() {
  const auth = useAuth();
  const [counts, setCounts] = useState({});
  const [error, setError] = useState('');

  useEffect(() => {
    api.getDashboard()
      .then(setCounts)
      .catch((err) => setError(err.message));
  }, []);

  const visiblePhaseCards = phaseTwoCards.filter((card) => auth.canAccessModule(card.route.slice(1)));
  const visibleMasterCards = masterCards.filter((card) => auth.canAccessModule(card.route.slice(1)));

  return (
    <section>
      <div className="page-title">
        <div>
          <h2>Phase 2 Dashboard</h2>
          <p>Operational view across procurement, inventory, production, sales, quality, and finance.</p>
        </div>
      </div>

      {error && <div className="message error">{error}</div>}

      <div className="metric-grid phase-two-metrics">
        {visiblePhaseCards.map((card) => (
          <DashboardCard card={card} counts={counts} key={card.key} />
        ))}
      </div>

      <div className="dashboard-details-grid">
        <article className="dashboard-panel">
          <div className="panel-heading">
            <h3>Transaction Queues</h3>
          </div>
          <div className="summary-list">
            {visiblePhaseCards.filter((card) => !card.currency).map((card) => (
              <Link className="summary-row" key={card.key} to={card.route}>
                {React.createElement(card.icon, { size: 18 })}
                <span>{card.label}</span>
                <b>{formatValue(counts[card.countKey || card.key], card.currency)}</b>
              </Link>
            ))}
          </div>
        </article>

        <article className="dashboard-panel">
          <div className="panel-heading">
            <h3>Master Data Foundation</h3>
          </div>
          <div className="summary-list">
            {visibleMasterCards.map((card) => (
              <Link className="summary-row" key={card.key} to={card.route}>
                {React.createElement(card.icon, { size: 18 })}
                <span>{card.label}</span>
                <b>{counts[card.key] ?? '-'}</b>
              </Link>
            ))}
          </div>
        </article>
      </div>
    </section>
  );
}

function DashboardCard({ card, counts }) {
  const Icon = card.icon;
  return (
    <Link className="metric-card dashboard-metric-card" style={{ '--card-accent': card.accent }} to={card.route}>
      <div className="metric-card-top">
        <span>{card.label}</span>
        <Icon size={22} strokeWidth={2.1} />
      </div>
      <strong>{formatValue(counts[card.key], card.currency)}</strong>
      <small>Open this queue</small>
    </Link>
  );
}

function formatValue(value, currency = false) {
  if (value === undefined || value === null) return '-';
  const number = Number(value);
  if (currency) {
    return number.toLocaleString(undefined, { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
  }
  return Number.isNaN(number) ? value : number.toLocaleString();
}

export default Dashboard;
