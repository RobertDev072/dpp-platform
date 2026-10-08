// Binaire downloads (PDF/ZIP/XLSX) via POST: fetch → blob → tijdelijke link.
// Fouten van de API (JSON) worden als Error met de Nederlandse melding gegooid.

function filenameFrom(response, fallback) {
  const disposition = response.headers.get("content-disposition") || "";
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
  return match ? decodeURIComponent(match[1]) : fallback;
}

export async function fetchBlob(url, { method = "POST", body, fallbackName = "download" } = {}) {
  const response = await fetch(url, {
    method,
    credentials: "same-origin",
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  if (response.status === 401 && typeof window !== "undefined") {
    window.location.href = "/login";
    throw new Error("Niet ingelogd");
  }
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    const error = new Error(data?.error?.message || `Fout (${response.status})`);
    error.details = data?.error?.details;
    error.code = data?.error?.code;
    throw error;
  }
  return { blob: await response.blob(), filename: filenameFrom(response, fallbackName), headers: response.headers };
}

export function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export async function downloadPost(url, body, fallbackName) {
  const { blob, filename } = await fetchBlob(url, { body, fallbackName });
  saveBlob(blob, filename);
}
