import { erpModules } from './modules.js';

export const ROLES = {
  DEPARTMENT_USER: 'DEPARTMENT_USER',
  SECTION_HEAD: 'SECTION_HEAD',
};

export const fullAccessModules = Object.keys(erpModules);

export const departmentModuleMap = {
  PROC: [
    'departments',
    'employees',
    'vendors',
    'items',
    'purchaseRequisitions',
    'purchaseRequisitionItems',
    'purchaseOrders',
    'purchaseOrderItems',
    'grns',
    'grnItems',
  ],
  RMWH: [
    'departments',
    'employees',
    'vendors',
    'items',
    'purchaseOrders',
    'purchaseOrderItems',
    'grns',
    'grnItems',
    'stockInwards',
    'stockTransactions',
    'stockIssues',
    'stockIssueItems',
  ],
  STAT: [
    'departments',
    'employees',
    'items',
    'bomMaster',
    'stockInwards',
    'stockTransactions',
    'stockIssues',
    'stockIssueItems',
    'productionOrders',
    'productionOrderItems',
    'bomConsumptions',
    'finishedGoodsReceipts',
  ],
  ROTR: [
    'departments',
    'employees',
    'items',
    'bomMaster',
    'stockInwards',
    'stockTransactions',
    'stockIssues',
    'stockIssueItems',
    'productionOrders',
    'productionOrderItems',
    'bomConsumptions',
    'finishedGoodsReceipts',
  ],
  ASMB: [
    'departments',
    'employees',
    'items',
    'bomMaster',
    'stockInwards',
    'stockTransactions',
    'stockIssues',
    'stockIssueItems',
    'productionOrders',
    'productionOrderItems',
    'bomConsumptions',
    'finishedGoodsReceipts',
  ],
  FGWH: [
    'departments',
    'employees',
    'customers',
    'items',
    'stockInwards',
    'stockTransactions',
    'stockIssues',
    'stockIssueItems',
    'finishedGoodsReceipts',
    'salesOrders',
    'salesOrderItems',
    'dispatches',
    'dispatchItems',
  ],
};

export function normalizeRole(role) {
  return role === ROLES.SECTION_HEAD ? ROLES.SECTION_HEAD : ROLES.DEPARTMENT_USER;
}

export function authorizedModuleKeys(user) {
  if (!user) return [];
  if (normalizeRole(user.role) === ROLES.SECTION_HEAD) return fullAccessModules;
  const departmentCode = String(user.department_code || '').toUpperCase();
  return departmentModuleMap[departmentCode] || ['departments', 'employees'];
}

export function canAccessModule(user, moduleKey) {
  return authorizedModuleKeys(user).includes(moduleKey);
}

export function canUseDataImport(user, moduleKey = '') {
  if (!user || normalizeRole(user.role) !== ROLES.SECTION_HEAD) return false;
  return !moduleKey || fullAccessModules.includes(moduleKey);
}
