async function apiRequest(method, url, body) {
  const response = await fetch(url, {
    method,
    credentials: "same-origin",
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });

  if (response.status === 401 && !url.startsWith("/api/auth/login") && !url.startsWith("/api/invitations")) {
    window.location.href = "/login.html";
    throw new Error("Niet ingelogd");
  }

  if (response.status === 204) {
    return null;
  }

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const message = (data && data.error && data.error.message) || `Fout (${response.status})`;
    const error = new Error(message);
    error.status = response.status;
    error.code = data && data.error ? data.error.code : undefined;
    error.details = data && data.error ? data.error.details : undefined;
    throw error;
  }

  return data;
}

const api = {
  get: (url) => apiRequest("GET", url),
  post: (url, body) => apiRequest("POST", url, body),
  patch: (url, body) => apiRequest("PATCH", url, body),
  put: (url, body) => apiRequest("PUT", url, body),
  delete: (url) => apiRequest("DELETE", url)
};
