import React from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext.jsx';
import AppLayout from './components/AppLayout.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import Dashboard from './pages/Dashboard.jsx';
import DataImport from './pages/DataImport.jsx';
import MasterDetail from './pages/MasterDetail.jsx';
import MasterForm from './pages/MasterForm.jsx';
import MasterList from './pages/MasterList.jsx';
import Login from './pages/Login.jsx';

export const moduleFallbacks = [
  { key: 'departments', title: 'Department Master', group: 'Master Data' },
  { key: 'employees', title: 'Employee Master', group: 'Master Data' },
  { key: 'vendors', title: 'Vendor Master', group: 'Master Data' },
  { key: 'items', title: 'Item Master', group: 'Master Data' },
  { key: 'bomMaster', title: 'BOM Master', group: 'Master Data' },
  { key: 'customers', title: 'Customer Master', group: 'Master Data' },
  { key: 'purchaseRequisitions', title: 'Purchase Requisition', group: 'Procurement' },
  { key: 'purchaseRequisitionItems', title: 'PR Items', group: 'Procurement' },
  { key: 'purchaseOrders', title: 'Purchase Order', group: 'Procurement' },
  { key: 'purchaseOrderItems', title: 'PO Items', group: 'Procurement' },
  { key: 'grns', title: 'Goods Receipt Note / GRN', group: 'Procurement' },
  { key: 'grnItems', title: 'GRN Items', group: 'Procurement' },
  { key: 'stockInwards', title: 'Inventory Balance', group: 'Inventory' },
  { key: 'stockTransactions', title: 'Stock Transaction Log', group: 'Inventory' },
  { key: 'stockIssues', title: 'Move Order', group: 'Inventory' },
  { key: 'stockIssueItems', title: 'Stock Issue Items', group: 'Inventory' },
  { key: 'productionOrders', title: 'Production Order', group: 'Production' },
  { key: 'productionOrderItems', title: 'Production Order Items', group: 'Production' },
  { key: 'bomConsumptions', title: 'BOM Consumption', group: 'Production' },
  { key: 'finishedGoodsReceipts', title: 'Finished Goods Receipt', group: 'Production' },
  { key: 'salesOrders', title: 'Sales Order', group: 'Sales' },
  { key: 'salesOrderItems', title: 'Sales Order Items', group: 'Sales' },
  { key: 'dispatches', title: 'Dispatch', group: 'Sales' },
  { key: 'dispatchItems', title: 'Dispatch Items', group: 'Sales' },
  { key: 'chartOfAccounts', title: 'Chart of Accounts', group: 'Finance' },
  { key: 'taxMaster', title: 'Tax Master', group: 'Finance' },
  { key: 'bankMaster', title: 'Bank Master', group: 'Finance' },
  { key: 'financialPeriods', title: 'Financial Period', group: 'Finance' },
  { key: 'vendorInvoices', title: 'Vendor Invoice', group: 'Finance' },
  { key: 'vendorInvoiceItems', title: 'Vendor Invoice Items', group: 'Finance' },
  { key: 'vendorPayments', title: 'Vendor Payment', group: 'Finance' },
  { key: 'customerInvoices', title: 'Customer Invoice', group: 'Finance' },
  { key: 'customerInvoiceItems', title: 'Customer Invoice Items', group: 'Finance' },
  { key: 'customerReceipts', title: 'Customer Receipt', group: 'Finance' },
  { key: 'journalEntries', title: 'Journal Entry', group: 'Finance' },
  { key: 'journalEntryLines', title: 'Journal Entry Lines', group: 'Finance' },
];

function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/*" element={<AuthenticatedApp />} />
      </Routes>
    </AuthProvider>
  );
}

function AuthenticatedApp() {
  return (
    <ProtectedRoute>
      <AppLayout>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route
            path="/import"
            element={(
              <ProtectedRoute requireSectionHead>
                <DataImport />
              </ProtectedRoute>
            )}
          />
          <Route
            path="/import/:moduleKey"
            element={(
              <ProtectedRoute requireSectionHead>
                <DataImport />
              </ProtectedRoute>
            )}
          />
          <Route
            path="/:moduleKey"
            element={(
              <ProtectedRoute>
                <MasterList />
              </ProtectedRoute>
            )}
          />
          <Route
            path="/:moduleKey/add"
            element={(
              <ProtectedRoute>
                <MasterForm mode="add" />
              </ProtectedRoute>
            )}
          />
          <Route
            path="/:moduleKey/view/:id"
            element={(
              <ProtectedRoute>
                <MasterDetail />
              </ProtectedRoute>
            )}
          />
          <Route
            path="/:moduleKey/edit/:id"
            element={(
              <ProtectedRoute>
                <MasterForm mode="edit" />
              </ProtectedRoute>
            )}
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AppLayout>
    </ProtectedRoute>
  );
}

export default App;
