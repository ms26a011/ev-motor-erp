import dotenv from 'dotenv';
import crypto from 'crypto';

dotenv.config();

const runtimeJwtSecret = process.env.JWT_SECRET || process.env.AUTH_SECRET || crypto.randomBytes(32).toString('hex');

export const config = {
  port: Number(process.env.PORT || 8000),
  database: {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'your_password_here',
    database: process.env.DB_NAME || 'ev_motor_erp',
    port: Number(process.env.DB_PORT || 3306),
    charset: 'utf8mb4',
    waitForConnections: true,
    connectionLimit: 10,
  },
  auth: {
    jwtSecret: runtimeJwtSecret,
    tokenTtlSeconds: Number(process.env.JWT_EXPIRES_SECONDS || 8 * 60 * 60),
  },
};
