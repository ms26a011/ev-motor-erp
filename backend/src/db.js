import mysql from 'mysql2/promise';

import { config } from './config.js';

export const pool = mysql.createPool(config.database);

export async function query(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

export async function withConnection(callback) {
  const connection = await pool.getConnection();
  try {
    return await callback(connection);
  } finally {
    connection.release();
  }
}
