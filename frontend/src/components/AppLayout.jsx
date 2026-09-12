import React from 'react';
import { useEffect, useState } from 'react';
import {
  Building2,
  ChevronRight,
  ChevronDown,
  Clock3,
  ClipboardCheck,
  CreditCard,
  Factory,
  LayoutDashboard,
  LineChart,
  Package,
  ShoppingCart,
  Truck,
  Upload,
  UserCheck,
  Users,
  Warehouse,
} from 'lucide-react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { moduleFallbacks } from '../App.jsx';

const navIcons = {
  departments: Building2,
  employees: Users,
  vendors: Truck,
  items: Package,
  bomMaster: Package,
  customers: UserCheck,
  purchaseRequisitions: ClipboardCheck,
  purchaseOrders: ShoppingCart,
  grns: Truck,
  stockInwards: Warehouse,
  inventoryAnalytics: LineChart,
  stockIssues: Warehouse,
  productionOrders: Factory,
  productionOrderItems: Factory,
  bomConsumptions: Package,
  finishedGoodsReceipts: Package,
  salesOrders: ShoppingCart,
  dispatches: Truck,
  qualityInspections: ClipboardCheck,
  chartOfAccounts: CreditCard,
  taxMaster: CreditCard,
  bankMaster: CreditCard,
  financialPeriods: CreditCard,
  vendorInvoices: CreditCard,
  vendorInvoiceItems: CreditCard,
  vendorPayments: CreditCard,
  customerInvoices: CreditCard,
  customerInvoiceItems: CreditCard,
  customerReceipts: CreditCard,
  journalEntries: CreditCard,
  journalEntryLines: CreditCard,
};

function AppLayout({ children }) {
  const auth = useAuth();
  const navigate = useNavigate();
  const [currentTime, setCurrentTime] = useState(() => new Date());
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const location = useLocation();
  const allowedModules = moduleFallbacks.filter((module) => auth.canAccessModule(module.key));
  const groupedModules = groupModules(allowedModules);
  const activeGroup = groupedModules.find(([, modules]) => (
    modules.some((module) => location.pathname.startsWith(`/${module.key}`))
  ))?.[0];
  const [openGroups, setOpenGroups] = useState(() => (
    groupedModules.reduce((acc, [group], index) => {
      acc[group] = index === 0;
      return acc;
    }, {})
  ));

  useEffect(() => {
    const timer = window.setInterval(() => setCurrentTime(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!activeGroup) return;
    setOpenGroups((current) => ({ ...current, [activeGroup]: true }));
  }, [activeGroup]);

  const formattedTime = currentTime.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const initials = (auth.user?.employee_name || auth.user?.username || 'U')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');

  async function handleLogout() {
    await auth.logout();
    navigate('/login', { replace: true });
  }

  return (
    <div className={`app-shell ${sidebarOpen ? '' : 'sidebar-collapsed'}`}>
      <aside className="sidebar" aria-label="Primary navigation">
        <div className="brand">
          <div className="brand-mark">EV</div>
          <div>
            <h1>EV Motor ERP</h1>
            <p>Manufacturing Operations</p>
            <div className="system-online">
              <span />
              System Online
            </div>
          </div>
        </div>
        <nav className="nav-list">
          <div className="nav-section-label">Main Modules</div>
          <NavLink className="nav-item" to="/" end>
            <LayoutDashboard size={16} />
            <span>Dashboard</span>
          </NavLink>
          {auth.isSectionHead && (
            <NavLink className="nav-item" to="/import">
              <Upload size={16} />
              <span>Data Import</span>
            </NavLink>
          )}
          {groupedModules.map(([group, modules]) => (
            <div className="nav-group" key={group}>
              <button
                className="nav-group-button"
                onClick={() => setOpenGroups((current) => ({ ...current, [group]: !current[group] }))}
                type="button"
              >
                <span>{group}</span>
                {openGroups[group] ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
              </button>
              {openGroups[group] && (
                <div className="nav-submenu">
                  {modules.map((module) => (
                    <NavLink className="nav-item nav-subitem" key={module.key} to={`/${module.key}`}>
                      {React.createElement(navIcons[module.key] || Package, { size: 16 })}
                      <span>{module.title}</span>
                    </NavLink>
                  ))}
                </div>
              )}
            </div>
          ))}
        </nav>
      </aside>
      <div className="main-panel">
        <header className="top-header">
          <div className="header-title-block">
            <button
              aria-label={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
              className="sidebar-toggle"
              onClick={() => setSidebarOpen((open) => !open)}
              type="button"
            >
              {sidebarOpen ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
            </button>
            <div>
              <span className="eyebrow">Phase 2</span>
              <h2>EV Motor Manufacturing ERP</h2>
            </div>
          </div>
          <div className="header-actions">
            <div className="status-pill">
              <span />
              MySQL Connected APIs
            </div>
            <div className="header-clock">
              <Clock3 size={16} />
              {formattedTime}
            </div>
            <div className="header-divider" />
            <div className="user-menu">
              <button
                aria-expanded={userMenuOpen}
                className="user-menu-button"
                onClick={() => setUserMenuOpen((open) => !open)}
                type="button"
              >
                <span className="user-avatar">{initials || 'U'}</span>
                <span className="user-menu-summary">
                  <strong>{auth.user?.employee_name}</strong>
                  <small>{auth.user?.role === 'SECTION_HEAD' ? 'Section Head' : 'Department User'}</small>
                </span>
                <ChevronDown size={15} />
              </button>
              {userMenuOpen && (
                <div className="user-dropdown">
                  <div className="user-profile">
                    <strong>{auth.user?.employee_code}</strong>
                    <span>{auth.user?.department_name}</span>
                  </div>
                  <button type="button" onClick={handleLogout}>Logout</button>
                </div>
              )}
            </div>
          </div>
        </header>
        <main className="content-area">{children}</main>
      </div>
    </div>
  );
}

function groupModules(modules) {
  const grouped = modules.reduce((acc, module) => {
    const group = module.group || 'Master Data';
    acc[group] = acc[group] || [];
    acc[group].push(module);
    return acc;
  }, {});
  return Object.entries(grouped);
}

export default AppLayout;
