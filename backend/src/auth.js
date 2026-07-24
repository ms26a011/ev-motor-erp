import crypto from 'crypto';

import { authorizedModuleKeys } from './accessControl.js';
import { config } from './config.js';
import { query, withConnection } from './db.js';
import { hashPassword, signToken, verifyPassword, verifyToken } from './security.js';

export async function ensureUserAccountTable() {
  await query(
    `CREATE TABLE IF NOT EXISTS user_account (
      account_id INT AUTO_INCREMENT PRIMARY KEY,
      employee_id INT NOT NULL,
      username VARCHAR(50) NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      role ENUM('DEPARTMENT_USER', 'SECTION_HEAD') NOT NULL,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      last_login DATETIME NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_user_account_username (username),
      UNIQUE KEY uq_user_account_employee (employee_id),
      CONSTRAINT fk_user_account_employee
        FOREIGN KEY (employee_id) REFERENCES employee_master(employee_id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  );
}

export async function getAccountUserById(accountId) {
  const rows = await query(
    `SELECT
       ua.account_id,
       ua.employee_id,
       ua.username,
       ua.role,
       ua.is_active,
       ua.last_login,
       em.employee_code,
       em.employee_name,
       em.role AS employee_role,
       em.status AS employee_status,
       dm.department_id,
       dm.department_code,
       dm.department_name
     FROM user_account ua
     JOIN employee_master em ON em.employee_id = ua.employee_id
     LEFT JOIN department_master dm ON dm.department_id = em.department_id
     WHERE ua.account_id = ?
     LIMIT 1`,
    [accountId],
  );
  return rows[0] || null;
}

export async function authenticateUser(username, password) {
  const rows = await query(
    `SELECT
       ua.account_id,
       ua.employee_id,
       ua.username,
       ua.password_hash,
       ua.role,
       ua.is_active,
       em.employee_code,
       em.employee_name,
       em.role AS employee_role,
       em.status AS employee_status,
       dm.department_id,
       dm.department_code,
       dm.department_name
     FROM user_account ua
     JOIN employee_master em ON em.employee_id = ua.employee_id
     LEFT JOIN department_master dm ON dm.department_id = em.department_id
     WHERE ua.username = ?
     LIMIT 1`,
    [username],
  );
  const account = rows[0];
  if (!account || !verifyPassword(password, account.password_hash)) {
    const error = new Error('Invalid username or password.');
    error.status = 401;
    throw error;
  }
  if (!isActiveAccount(account)) {
    const error = new Error('This account is inactive.');
    error.status = 403;
    throw error;
  }

  await query('UPDATE user_account SET last_login = NOW() WHERE account_id = ?', [account.account_id]);
  const user = sanitizeUser(account);
  return {
    user,
    token: signToken({ account_id: user.account_id }, config.auth.jwtSecret, config.auth.tokenTtlSeconds),
    expiresIn: config.auth.tokenTtlSeconds,
  };
}

export function authenticateRequest(optional = false) {
  return async (req, res, next) => {
    const header = req.get('authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token && optional) {
      next();
      return;
    }
    const payload = verifyToken(token, config.auth.jwtSecret);
    if (!payload?.account_id) {
      res.status(401).json({ detail: 'Authentication is required.' });
      return;
    }

    try {
      const account = await getAccountUserById(payload.account_id);
      if (!account || !isActiveAccount(account)) {
        res.status(403).json({ detail: 'This account is inactive or unavailable.' });
        return;
      }
      req.user = sanitizeUser(account);
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function sanitizeUser(account) {
  const user = {
    account_id: account.account_id,
    employee_id: account.employee_id,
    employee_code: account.employee_code,
    employee_name: account.employee_name,
    employee_role: account.employee_role,
    employee_status: account.employee_status || 'Active',
    username: account.username,
    role: account.role,
    department_id: account.department_id,
    department_code: account.department_code,
    department_name: account.department_name,
    is_active: Boolean(account.is_active),
    last_login: account.last_login,
  };
  return {
    ...user,
    authorizedModules: authorizedModuleKeys(user),
  };
}

export function isActiveAccount(account) {
  return Boolean(account.is_active) && String(account.employee_status || 'Active').toLowerCase() !== 'inactive';
}

export function temporaryPassword() {
  return crypto.randomBytes(9).toString('base64url');
}

export async function setAccountPassword(connection, username, password) {
  const passwordHash = hashPassword(password);
  await connection.execute(
    'UPDATE user_account SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE username = ?',
    [passwordHash, username],
  );
}

export async function upsertUserAccount({ employeeId, username, password, role, isActive = true }) {
  const passwordHash = hashPassword(password);
  return withConnection(async (connection) => {
    const [existing] = await connection.execute(
      'SELECT account_id FROM user_account WHERE username = ? OR employee_id = ? LIMIT 1',
      [username, employeeId],
    );
    if (existing[0]) {
      await connection.execute(
        `UPDATE user_account
         SET employee_id = ?, username = ?, password_hash = ?, role = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
         WHERE account_id = ?`,
        [employeeId, username, passwordHash, role, isActive ? 1 : 0, existing[0].account_id],
      );
      return 'updated';
    }
    await connection.execute(
      `INSERT INTO user_account (employee_id, username, password_hash, role, is_active)
       VALUES (?, ?, ?, ?, ?)`,
      [employeeId, username, passwordHash, role, isActive ? 1 : 0],
    );
    return 'created';
  });
}
