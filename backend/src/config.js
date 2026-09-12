import dotenv from 'dotenv';
import crypto from 'crypto';
import path from 'path';

dotenv.config();

const runtimeJwtSecret = process.env.JWT_SECRET || process.env.AUTH_SECRET || crypto.randomBytes(32).toString('hex');

export const config = {
  port: Number(process.env.PORT || 8000),
  host: process.env.HOST || '0.0.0.0',
  corsOrigins: (process.env.CORS_ORIGINS || process.env.FRONTEND_URL || 'http://localhost:5173,http://127.0.0.1:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  serveFrontend: process.env.SERVE_FRONTEND === 'true',
  frontendDistDir: process.env.FRONTEND_DIST_DIR || path.resolve(process.cwd(), '../frontend/dist'),
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
