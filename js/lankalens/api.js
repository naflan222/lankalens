/* Small fetch wrapper for the Lanka Lens REST API. Cookies (httpOnly JWT)
   carry auth — no tokens are exposed to local storage. */
(function () {
  class ApiError extends Error {
    constructor(message, status) { super(message); this.status = status; }
  }

  async function request(method, url, { body, form, signal } = {}) {
    const opts = { method, credentials: 'same-origin', signal, headers: {} };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    if (form) { opts.body = form; }
    const res = await fetch('/api' + url, opts);
    let data = null;
    let parseError = null;
    try { data = await res.json(); } catch (e) { parseError = e; /* empty/non-json, or body stream aborted by navigation */ }
    if (!res.ok) {
      const msg = data?.error || `Request failed (${res.status})`;
      throw new ApiError(msg, res.status);
    }
    // a GET must return JSON; an unparseable 2xx body means the stream was
    // aborted mid-flight — throw so callers' .catch() fallbacks actually run
    if (method === 'GET' && parseError) throw new ApiError('Incomplete response', res.status);
    return data;
  }

  const api = {
    get: (u, signal) => request('GET', u, { signal }),
    post: (u, body, opts = {}) => request('POST', u, { body, ...opts }),
    patch: (u, body) => request('PATCH', u, { body }),
    put: (u, body) => request('PUT', u, { body }),
    del: (u) => request('DELETE', u),
    upload: async (u, formData) => {
      const res = await fetch('/api' + u, { method: 'POST', body: formData, credentials: 'same-origin' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new ApiError(data.error || 'Upload failed', res.status);
      return data;
    },
  };

  window.LL = window.LL || {};
  LL.api = api;
  LL.ApiError = ApiError;
})();
