const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api';
const TOKEN_KEY = 'sbv_erp_auth_token';

export function getAuthToken() {
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setAuthToken(token) {
  if (token) {
    window.localStorage.setItem(TOKEN_KEY, token);
  } else {
    window.localStorage.removeItem(TOKEN_KEY);
  }
}

async function request(path, options = {}) {
  const token = getAuthToken();
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
    ...options,
  });

  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json')
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    const message = data?.detail || data?.message || 'Something went wrong.';
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }

  return data;
}

export const api = {
  apiUrl: (path) => `${API_BASE_URL}${path}`,
  login: (payload) => request('/auth/login', {
    method: 'POST',
    body: JSON.stringify(payload),
  }),
  logout: () => request('/auth/logout', { method: 'POST' }),
  me: () => request('/auth/me'),
  getModules: () => request('/modules'),
  getDashboard: () => request('/dashboard'),
  getImportModules: () => request('/import/modules'),
  getImportHistory: (moduleKey = '') => request(`/import/history${moduleKey ? `?moduleKey=${moduleKey}` : ''}`),
  previewImport: (moduleKey, payload) => request(`/import/${moduleKey}/preview`, {
    method: 'POST',
    body: JSON.stringify(payload),
  }),
  runImport: (moduleKey, payload) => request(`/import/${moduleKey}/run`, {
    method: 'POST',
    body: JSON.stringify(payload),
  }),
  downloadErrorReport: async (errors) => {
    const token = getAuthToken();
    const response = await fetch(`${API_BASE_URL}/import/error-report`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ errors }),
    });
    if (!response.ok) throw new Error('Unable to download error report.');
    return response.blob();
  },
  downloadImportTemplate: async (moduleKey) => {
    const token = getAuthToken();
    const response = await fetch(`${API_BASE_URL}/import/${moduleKey}/template`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!response.ok) throw new Error('Unable to download sample template.');
    return response.blob();
  },
  list: (moduleKey) => request(`/${moduleKey}`),
  get: (moduleKey, id) => request(`/${moduleKey}/${id}`),
  create: (moduleKey, payload) => request(`/${moduleKey}`, {
    method: 'POST',
    body: JSON.stringify(payload),
  }),
  update: (moduleKey, id, payload) => request(`/${moduleKey}/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  }),
  remove: (moduleKey, id) => request(`/${moduleKey}/${id}`, {
    method: 'DELETE',
  }),
  lookup: (moduleKey) => request(`/${moduleKey}/lookup`),
};
