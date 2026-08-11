// The HTTP client the server-side suites drive the app with.
//
// A real cookie jar and a real CSRF token, because the session is an httpOnly
// cookie the page script cannot see: anything that talks to this server has to
// carry both the way a browser does, or every write comes back 403.
//
// Deliberately does NOT send an Origin header. The server compares Origin
// against its public base URL (https://md.azaken.com by default), so a test
// client on 127.0.0.1 that announces itself is refused as cross-origin before
// the token is ever checked. A browser on the real deployment sends a matching
// one; a test has nothing useful to claim.

const http = require("http");

function makeClient(origin) {
  const jar = new Map();
  let csrfToken = "";

  async function request(method, pathname, body, extraHeaders = {}) {
    const url = new URL(pathname, origin);
    const payload = body === undefined ? null : JSON.stringify(body);
    const cookieHeader = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");

    const headers = {
      ...(payload ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } : {}),
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      ...(csrfToken && !["GET", "HEAD"].includes(method) ? { "X-CSRF-Token": csrfToken } : {}),
      ...extraHeaders
    };

    return new Promise((resolve, reject) => {
      const req = http.request({
        host: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method,
        headers
      }, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          const setCookies = res.headers["set-cookie"] || [];
          for (const raw of setCookies) {
            const [pair] = raw.split(";");
            const index = pair.indexOf("=");
            const name = pair.slice(0, index).trim();
            const value = pair.slice(index + 1).trim();
            if (!value) {
              jar.delete(name);
            } else {
              jar.set(name, value);
            }
          }

          let parsed = null;
          try {
            parsed = JSON.parse(data);
          } catch {
            parsed = null;
          }

          if (parsed?.csrfToken !== undefined) {
            csrfToken = parsed.csrfToken || "";
          }

          resolve({ status: res.statusCode, body: parsed, raw: data, headers: res.headers, setCookies });
        });
      });

      req.on("error", reject);
      if (payload) {
        req.write(payload);
      }
      req.end();
    });
  }

  // Folder upload and image attachment are the multipart endpoints, so the
  // client needs to be able to build one. A file may name its own form field
  // and content type; both default to what the folder upload sends.
  async function postMultipart(pathname, files, fields = {}) {
    const boundary = `----azadocs${Math.random().toString(16).slice(2)}`;
    const chunks = [];

    for (const [name, value] of Object.entries(fields)) {
      chunks.push(Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`
      ));
    }

    for (const file of files) {
      chunks.push(Buffer.from(
        `--${boundary}\r\n`
        + `Content-Disposition: form-data; name="${file.field || "files"}"; filename="${file.name}"\r\n`
        + `Content-Type: ${file.type || "text/markdown"}\r\n\r\n`
      ));
      chunks.push(Buffer.from(file.content));
      chunks.push(Buffer.from("\r\n"));
    }

    chunks.push(Buffer.from(`--${boundary}--\r\n`));
    const body = Buffer.concat(chunks);

    const url = new URL(pathname, origin);
    const cookieHeader = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");

    return new Promise((resolve, reject) => {
      const req = http.request({
        host: url.hostname,
        port: url.port,
        path: url.pathname,
        method: "POST",
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "Content-Length": body.length,
          ...(cookieHeader ? { Cookie: cookieHeader } : {}),
          ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {})
        }
      }, (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          let parsed = null;
          try {
            parsed = JSON.parse(data);
          } catch {
            parsed = null;
          }
          resolve({ status: res.statusCode, body: parsed, raw: data });
        });
      });

      req.on("error", reject);
      req.write(body);
      req.end();
    });
  }

  // Images come back as bytes, not as text that survives a round trip through
  // a string, so this is the one read that keeps the buffer.
  async function getBytes(pathname) {
    const url = new URL(pathname, origin);
    const cookieHeader = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");

    return new Promise((resolve, reject) => {
      const req = http.request({
        host: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method: "GET",
        headers: cookieHeader ? { Cookie: cookieHeader } : {}
      }, (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => resolve({
          status: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks)
        }));
      });

      req.on("error", reject);
      req.end();
    });
  }

  return {
    postMultipart,
    getBytes,
    get: (p, h) => request("GET", p, undefined, h),
    post: (p, b, h) => request("POST", p, b === undefined ? {} : b, h),
    put: (p, b) => request("PUT", p, b),
    patch: (p, b) => request("PATCH", p, b),
    del: (p, b) => request("DELETE", p, b),
    jar,
    get csrf() {
      return csrfToken;
    },
    set csrf(value) {
      csrfToken = value;
    }
  };
}

module.exports = { makeClient };
