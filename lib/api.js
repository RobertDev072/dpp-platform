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

// Voor multipart file-uploads: geen Content-Type header zetten, de browser voegt zelf de
// juiste multipart boundary toe op basis van de FormData.
export async function apiUpload(url, formData) {
  const response = await fetch(url, {
    method: "POST",
    credentials: "same-origin",
    body: formData
  });

  return handleResponse(response, url);
}

// Directe upload naar de bestandsopslag (S3-compatibel), buiten onze API om: grote
// bestanden lopen zo niet door de applicatieserver. Drie stappen:
// 1. `${baseUrl}/upload-url` controleert rechten/type/grootte en geeft een presigned
//    PUT voor precies één object (de opslag dwingt sleutel, type en grootte af);
// 2. de browser stuurt het bestand rechtstreeks naar de opslag;
// 3. `${baseUrl}/complete` controleert het object en koppelt het aan het product.
export async function apiUploadDirect(baseUrl, file, fields = {}) {
  const { uploadUrl, objectName, headers } = await apiRequest("POST", `${baseUrl}/upload-url`, {
    ...fields,
    mimeType: file.type,
    size: file.size
  });

  // Content-Type moet exact gelijk zijn aan wat ondertekend is; Content-Length zet de
  // browser zelf (de bestandsgrootte die bij stap 1 is aangemeld).
  const response = await fetch(uploadUrl, { method: "PUT", headers: headers || {}, body: file });
  if (!response.ok) {
    throw new Error(`Uploaden mislukt (${response.status}). Probeer het opnieuw.`);
  }

  return apiRequest("POST", `${baseUrl}/complete`, { ...fields, objectName });
}

export const api = {
  get: (url) => apiRequest("GET", url),
  post: (url, body) => apiRequest("POST", url, body),
  patch: (url, body) => apiRequest("PATCH", url, body),
  put: (url, body) => apiRequest("PUT", url, body),
  delete: (url) => apiRequest("DELETE", url),
  upload: (url, formData) => apiUpload(url, formData),
  uploadDirect: (baseUrl, file, fields) => apiUploadDirect(baseUrl, file, fields)
};
