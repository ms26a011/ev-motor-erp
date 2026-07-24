import crypto from 'crypto';

const HASH_ALGORITHM = 'scrypt';
const KEY_LENGTH = 64;
const SCRYPT_OPTIONS = {
  N: 16384,
  r: 8,
  p: 1,
  maxmem: 64 * 1024 * 1024,
};

function base64Url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}

function fromBase64Url(input) {
  const normalized = String(input || '').replaceAll('-', '+').replaceAll('_', '/');
  return Buffer.from(normalized, 'base64');
}

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const key = crypto.scryptSync(String(password), salt, KEY_LENGTH, SCRYPT_OPTIONS).toString('hex');
  return `${HASH_ALGORITHM}$${SCRYPT_OPTIONS.N}$${SCRYPT_OPTIONS.r}$${SCRYPT_OPTIONS.p}$${salt}$${key}`;
}

export function verifyPassword(password, storedHash) {
  const [algorithm, n, r, p, salt, storedKey] = String(storedHash || '').split('$');
  if (algorithm !== HASH_ALGORITHM || !salt || !storedKey) return false;

  const key = crypto.scryptSync(String(password), salt, Buffer.from(storedKey, 'hex').length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: 64 * 1024 * 1024,
  });
  const stored = Buffer.from(storedKey, 'hex');
  return stored.length === key.length && crypto.timingSafeEqual(stored, key);
}

export function signToken(payload, secret, expiresInSeconds) {
  const now = Math.floor(Date.now() / 1000);
  const tokenPayload = {
    ...payload,
    iat: now,
    exp: now + expiresInSeconds,
  };
  const header = base64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64Url(JSON.stringify(tokenPayload));
  const signature = base64Url(crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest());
  return `${header}.${body}.${signature}`;
}

export function verifyToken(token, secret) {
  const [header, body, signature] = String(token || '').split('.');
  if (!header || !body || !signature) return null;

  const expected = base64Url(crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest());
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (signatureBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) {
    return null;
  }

  try {
    const payload = JSON.parse(fromBase64Url(body).toString('utf8'));
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}
