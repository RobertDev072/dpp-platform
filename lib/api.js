async function handleResponse(response, url) {
  if (response.status === 401 && !url.endsWith("/api/auth/login")) {
    if (typeof window !== "undefined") {
      window.location.href = "/login";
    }
    throw new Error("Niet ingelogd");
  }

  if (response.status === 204) {
    return null;
  }

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const message = (data && data.error && data.error.message) || `Fout (${response.status})`;
    const error = new Error(message);
    error.code = data && data.error && data.error.code;
    error.status = response.status;
    // Zod-details van de backend (errorHandler.js): per-veld fouten voor formulieren.
    error.fieldErrors = data?.error?.details?.fieldErrors ?? null;
    error.formErrors = data?.error?.details?.formErrors ?? [];
    throw error;
  }

  return data;
}

export async function apiRequest(method, url, body) {
  const response = await fetch(url, {
    method,
    credentials: "same-origin",
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });

  return handleResponse(response, url);
}

// Bestandsupload rechtstreeks naar Supabase Storage (een Vercel Function accepteert
// maximaal 4,5 MB per request, dus het bestand gaat niet via onze API):
//   1. upload-URL aanvragen (de server controleert rechten, type en grootte);
//   2. het bestand naar die eenmalige, kortlevende URL sturen;
//   3. de upload laten afronden (de server controleert het bestand en legt het vast).
export async function apiDirectUpload({ requestUrl, completeUrl, file, fields = {} }) {
  const target = await apiRequest("POST", requestUrl, { mimeType: file.type, size: file.size });

  let uploadResponse;
  try {
    uploadResponse = await fetch(target.uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": file.type, "x-upsert": "false" },
      body: file
    });
  } catch {
    throw new Error("Uploaden mislukt: geen verbinding met de bestandsopslag. Probeer het opnieuw.");
  }
  if (!uploadResponse.ok) {
    const error = new Error(
      uploadResponse.status === 413
        ? "Het bestand is te groot."
        : `Uploaden mislukt (${uploadResponse.status}). Probeer het opnieuw.`
    );
    error.status = uploadResponse.status;
    throw error;
  }

  return apiRequest("POST", completeUrl, { path: target.path, ...fields });
}

export const api = {
  get: (url) => apiRequest("GET", url),
  post: (url, body) => apiRequest("POST", url, body),
  patch: (url, body) => apiRequest("PATCH", url, body),
  put: (url, body) => apiRequest("PUT", url, body),
  delete: (url) => apiRequest("DELETE", url),
  directUpload: (options) => apiDirectUpload(options)
};
