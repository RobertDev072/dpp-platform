async function apiRequest(method, url, body) {
  const response = await fetch(url, {
    method,
    credentials: "same-origin",
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });

  if (response.status === 401 && !url.endsWith("/api/auth/login")) {
    window.location.href = "/login.html";
    throw new Error("Niet ingelogd");
  }

  if (response.status === 204) {
    return null;
  }

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const message = (data && data.error && data.error.message) || `Fout (${response.status})`;
    throw new Error(message);
  }

  return data;
}

const api = {
  get: (url) => apiRequest("GET", url),
  post: (url, body) => apiRequest("POST", url, body),
  patch: (url, body) => apiRequest("PATCH", url, body),
  delete: (url) => apiRequest("DELETE", url)
};
