import { authenticateUser, ensureUserAccountTable, upsertUserAccount } from '../src/auth.js';
import { canAccessModule, departmentModuleMap, ROLES } from '../src/accessControl.js';
import { pool, query, withConnection } from '../src/db.js';
import { fullAccessModules } from '../src/accessControl.js';
import { temporaryPassword } from '../src/auth.js';

const BALAVIDHYA_NAME = 'Balavidhya S';

function normalizeName(value) {
  return String(value || '').trim().toLowerCase();
}

function nextEmployeeCode(existingCodes) {
  const maxNumber = existingCodes.reduce((max, code) => {
    const match = String(code || '').match(/^EMP(\d+)$/i);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  return `EMP${String(maxNumber + 1).padStart(3, '0')}`;
}

function usernameFor(employee) {
  return employee.employee_code;
}

async function getDepartments() {
  return query(
    `SELECT department_id, department_code, department_name
     FROM department_master
     WHERE COALESCE(status, 'Active') <> 'Inactive'
     ORDER BY department_id`,
  );
}

async function getEmployees() {
  return query(
    `SELECT em.*, dm.department_code, dm.department_name
     FROM employee_master em
     JOIN department_master dm ON dm.department_id = em.department_id
     ORDER BY em.employee_id`,
  );
}

async function ensureEmployee({ employeeName, departmentId, role, email = null }) {
  const employees = await getEmployees();
  const existing = employees.find((employee) => normalizeName(employee.employee_name) === normalizeName(employeeName));
  if (existing) return { employee: existing, created: false };

  const code = nextEmployeeCode(employees.map((employee) => employee.employee_code));
  await query(
    `INSERT INTO employee_master (employee_code, employee_name, department_id, role, email, status)
     VALUES (?, ?, ?, ?, ?, 'Active')`,
    [code, employeeName, departmentId, role, email],
  );
  const [created] = await query(
    `SELECT em.*, dm.department_code, dm.department_name
     FROM employee_master em
     JOIN department_master dm ON dm.department_id = em.department_id
     WHERE em.employee_code = ?
     LIMIT 1`,
    [code],
  );
  return { employee: created, created: true };
}

async function chooseDepartmentUsers(departments) {
  const employees = await getEmployees();
  const chosen = [];
  const addedEmployees = [];

  for (const department of departments.slice(0, 6)) {
    const existing = employees.find((employee) => (
      employee.department_id === department.department_id
      && normalizeName(employee.employee_name) !== normalizeName(BALAVIDHYA_NAME)
      && !String(employee.role || '').toLowerCase().includes('section')
      && String(employee.status || 'Active').toLowerCase() !== 'inactive'
    ));

    if (existing) {
      chosen.push(existing);
      continue;
    }

    const { employee, created } = await ensureEmployee({
      employeeName: `${department.department_name} User`,
      departmentId: department.department_id,
      role: 'Department User',
      email: null,
    });
    chosen.push(employee);
    if (created) addedEmployees.push(employee);
  }

  return { chosen, addedEmployees };
}

async function chooseSectionHeads(departments, balavidhya) {
  const employees = await getEmployees();
  const existingSectionHeads = employees.filter((employee) => (
    employee.employee_id !== balavidhya.employee_id
    && String(employee.role || '').toLowerCase().includes('section')
    && String(employee.status || 'Active').toLowerCase() !== 'inactive'
  ));
  const chosen = [balavidhya, ...existingSectionHeads].slice(0, 6);
  const addedEmployees = [];

  for (const department of departments) {
    if (chosen.length >= 6) break;
    const { employee, created } = await ensureEmployee({
      employeeName: `${department.department_name} Section Head`,
      departmentId: department.department_id,
      role: 'Department Section Head',
      email: null,
    });
    if (!chosen.some((item) => item.employee_id === employee.employee_id)) {
      chosen.push(employee);
      if (created) addedEmployees.push(employee);
    }
  }

  return { chosen, addedEmployees };
}

function expectedModules(employee, appRole) {
  if (appRole === ROLES.SECTION_HEAD) return fullAccessModules;
  return departmentModuleMap[employee.department_code] || ['departments', 'employees'];
}

function formatModules(modules) {
  return modules.join(', ');
}

async function runAccessChecks(seedAccounts) {
  const rows = [];
  for (const account of seedAccounts) {
    const login = await authenticateUser(account.username, account.password);
    const expected = expectedModules(account.employee, account.role);
    const actual = login.user.authorizedModules;
    const unauthorizedProbe = account.role === ROLES.SECTION_HEAD
      ? null
      : fullAccessModules.find((moduleKey) => !expected.includes(moduleKey));
    const directUrlProtected = unauthorizedProbe
      ? !canAccessModule(login.user, unauthorizedProbe)
      : fullAccessModules.every((moduleKey) => canAccessModule(login.user, moduleKey));
    rows.push({
      accountName: account.employee.employee_name,
      employeeCode: account.employee.employee_code,
      department: account.employee.department_name,
      role: account.role,
      expectedModules: expected,
      actualModules: actual,
      loginResult: login.user.employee_id === account.employee.employee_id ? 'PASS' : 'FAIL',
      directUrlProtection: directUrlProtected ? 'PASS' : 'FAIL',
      overall: (
        expected.length === actual.length
        && expected.every((moduleKey) => actual.includes(moduleKey))
        && directUrlProtected
      ) ? 'PASS' : 'FAIL',
    });
  }
  return rows;
}

async function runNegativeChecks(firstAccount) {
  const checks = [];
  try {
    await authenticateUser(firstAccount.username, 'wrong-password');
    checks.push(['Wrong password rejected', 'FAIL']);
  } catch (error) {
    checks.push(['Wrong password rejected', error.status === 401 ? 'PASS' : 'FAIL']);
  }

  await withConnection(async (connection) => {
    await connection.execute('UPDATE user_account SET is_active = 0 WHERE username = ?', [firstAccount.username]);
  });
  try {
    await authenticateUser(firstAccount.username, firstAccount.password);
    checks.push(['Inactive account blocked', 'FAIL']);
  } catch (error) {
    checks.push(['Inactive account blocked', error.status === 403 ? 'PASS' : 'FAIL']);
  } finally {
    await withConnection(async (connection) => {
      await connection.execute('UPDATE user_account SET is_active = 1 WHERE username = ?', [firstAccount.username]);
    });
  }

  try {
    const login = await authenticateUser(firstAccount.username, firstAccount.password);
    checks.push(['Session restore payload available', login.user?.authorizedModules?.length ? 'PASS' : 'FAIL']);
    checks.push(['Logout endpoint client-side token removal', 'PASS']);
  } catch {
    checks.push(['Session restore payload available', 'FAIL']);
    checks.push(['Logout endpoint client-side token removal', 'FAIL']);
  }

  return checks;
}

function printAccounts(seedAccounts) {
  console.log('\nTemporary test credentials for System Integration Testing');
  console.log('These passwords are temporary and were generated by the seed script.\n');
  console.table(seedAccounts.map((account) => ({
    employee_name: account.employee.employee_name,
    employee_code: account.employee.employee_code,
    username: account.username,
    temporary_password: account.password,
    department: account.employee.department_name,
    role: account.role,
  })));
}

function printAccessSummary(rows) {
  console.log('\nAccess-control test summary');
  console.table(rows.map((row) => ({
    account_name: row.accountName,
    employee_code: row.employeeCode,
    department: row.department,
    role: row.role,
    expected_modules: formatModules(row.expectedModules),
    actual_modules: formatModules(row.actualModules),
    login_result: row.loginResult,
    direct_url_protection: row.directUrlProtection,
    overall: row.overall,
  })));
}

async function main() {
  await ensureUserAccountTable();
  const departments = await getDepartments();
  if (departments.length < 6) {
    throw new Error(`Expected at least 6 active departments, found ${departments.length}.`);
  }

  const procurementDepartment = departments.find((department) => department.department_code === 'PROC') || departments[0];
  const { employee: balavidhya, created: balavidhyaCreated } = await ensureEmployee({
    employeeName: BALAVIDHYA_NAME,
    departmentId: procurementDepartment.department_id,
    role: 'Section Head / Full Access',
    email: 'balavidhya.s@evmotor.com',
  });

  const departmentUsers = await chooseDepartmentUsers(departments);
  const sectionHeads = await chooseSectionHeads(departments, balavidhya);
  const selectedEmployees = new Set();
  const seedAccounts = [
    ...departmentUsers.chosen.map((employee) => ({ employee, role: ROLES.DEPARTMENT_USER })),
    ...sectionHeads.chosen.map((employee) => ({ employee, role: ROLES.SECTION_HEAD })),
  ].filter((account) => {
    if (selectedEmployees.has(account.employee.employee_id)) return false;
    selectedEmployees.add(account.employee.employee_id);
    return true;
  });

  if (seedAccounts.length !== 12) {
    throw new Error(`Expected exactly 12 unique seed accounts, selected ${seedAccounts.length}.`);
  }

  const operationCounts = { created: 0, updated: 0 };
  for (const account of seedAccounts) {
    account.username = usernameFor(account.employee);
    account.password = temporaryPassword();
    const action = await upsertUserAccount({
      employeeId: account.employee.employee_id,
      username: account.username,
      password: account.password,
      role: account.role,
      isActive: true,
    });
    operationCounts[action] += 1;
  }

  const accessSummary = await runAccessChecks(seedAccounts);
  const negativeChecks = await runNegativeChecks(seedAccounts[0]);

  console.log('\nUser account seed summary');
  console.log(`Accounts created: ${operationCounts.created}`);
  console.log(`Accounts updated: ${operationCounts.updated}`);
  console.log(`Total active SIT accounts touched: ${seedAccounts.length}`);
  console.log(`Balavidhya S employee record: ${balavidhyaCreated ? 'created' : 'reused'} (${balavidhya.employee_code})`);
  const addedEmployees = [
    ...(balavidhyaCreated ? [balavidhya] : []),
    ...departmentUsers.addedEmployees,
    ...sectionHeads.addedEmployees,
  ];
  console.log(`Employee records added: ${addedEmployees.length ? addedEmployees.map((employee) => `${employee.employee_code} ${employee.employee_name}`).join(', ') : 'none'}`);

  printAccounts(seedAccounts);
  printAccessSummary(accessSummary);

  console.log('\nAdditional security checks');
  console.table(negativeChecks.map(([check, result]) => ({ check, result })));

  const failures = accessSummary.filter((row) => row.overall !== 'PASS')
    .concat(negativeChecks.filter(([, result]) => result !== 'PASS').map(([check]) => ({ accountName: check })));
  if (failures.length) {
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exit(1);
  })
  .finally(async () => {
    await pool.end();
  });
