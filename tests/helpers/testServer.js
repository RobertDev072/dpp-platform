const http = require("http");
const app = require("../../src/app");

function startTestServer() {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

function stopTestServer(server) {
  return new Promise((resolve) => server.close(resolve));
}

function extractCookie(response) {
  const setCookie = response.headers.get("set-cookie");
  if (!setCookie) return null;
  return setCookie.split(";")[0];
}

async function request(baseUrl, method, path, { body, cookie, redirect } = {}) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (cookie) headers["Cookie"] = cookie;

  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    // Standaard "follow" (fetch-default): voor routes die doorverwijzen naar een
    // kortlevende SAS-link of externe URL wil je soms juist de 30x zelf zien i.p.v. de
    // redirect te volgen - geef dan redirect: "manual" mee.
    redirect
  });

  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  return {
    status: response.status,
    data,
    cookie: extractCookie(response),
    location: response.headers.get("location")
  };
}

// Bootst de browserflow van lib/api.js na: upload-URL aanvragen, het bestand
// rechtstreeks naar Supabase Storage sturen, upload afronden.
async function directUpload(baseUrl, { cookie, requestPath, completePath, buffer, mimeType, fields = {} }) {
  const target = await request(baseUrl, "POST", requestPath, {
    cookie,
    body: { mimeType, size: buffer.length }
  });
  if (target.status !== 201) return target;

  const put = await fetch(target.data.uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": mimeType, "x-upsert": "false" },
    body: buffer
  });
  if (!put.ok) {
    return { status: put.status, data: await put.text(), stage: "storage" };
  }

  return request(baseUrl, "POST", completePath, { cookie, body: { path: target.data.path, ...fields } });
}

module.exports = { startTestServer, stopTestServer, request, directUpload };
