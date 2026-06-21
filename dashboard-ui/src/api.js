// Cliente fetch mínimo: cookie de sesión vía credentials:include, JSON en
// ambos sentidos. Sin librería extra (axios, etc.) — fetch nativo basta.
async function request(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    credentials: 'include',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const error = new Error((data && data.error) || `Error ${res.status}`);
    error.status = res.status;
    error.data = data;
    throw error;
  }
  return data;
}

export const api = {
  get:  (path) => request(path),
  post: (path, body) => request(path, { method: 'POST', body }),
  put:  (path, body) => request(path, { method: 'PUT', body }),
  del:  (path, body) => request(path, { method: 'DELETE', body }),
};
