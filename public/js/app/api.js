// Every request this page makes, and the one question it asks about the answer.
//
// Accounts replace the shared editor token. The session lives in an httpOnly
// cookie the script cannot read, so there is nothing here to store or leak —
// credentials: "same-origin" is what attaches it.
//
// The CSRF token is the one piece the page does hold, because the whole point
// of a double-submit token is that script has to echo it back and cross-origin
// script cannot.

(function (global) {
  const { state } = global.AppState;

  const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

  /* What a request finds out about the session that this module does not own.
   *
   * A 401 means the session is gone; a 403 with that code means the server will
   * refuse everything until the password is changed. What to do about either —
   * which state to clear, which dialog to open — belongs to the part of the app
   * that owns those. It says so here, once, instead of being reached for by name
   * from inside a fetch.
   */
  const sessionSignals = {
    ended() {},
    passwordChangeRequired() {}
  };

  function onSessionSignal(handlers) {
    Object.assign(sessionSignals, handlers);
  }

  async function requestJson(url, options = {}) {
    const requestOptions = { ...options, credentials: "same-origin" };
    const method = String(options.method || "GET").toUpperCase();
    const headers = { ...(options.headers || {}) };

    // express.json() only parses a body that says it is JSON, and silently leaves
    // req.body empty otherwise — so a caller that forgot this header got a
    // confusing "that field is missing" from the server rather than an error.
    // Every caller used to set it by hand, and every new one was one omission
    // away from the same bug. A string body from here is always JSON.
    if (typeof options.body === "string" && !Object.keys(headers).some((name) => name.toLowerCase() === "content-type")) {
      headers["Content-Type"] = "application/json";
    }

    if (UNSAFE_METHODS.has(method) && state.csrfToken) {
      headers["X-CSRF-Token"] = state.csrfToken;
    }

    if (Object.keys(headers).length > 0) {
      requestOptions.headers = headers;
    }

    const response = await fetch(url, requestOptions);
    let payload = null;

    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (response.status === 401) {
      // The session expired, was revoked, or never existed.
      sessionSignals.ended();
      throw new Error(payload?.error || "Your session has ended. Sign in again.");
    }

    if (response.status === 403 && payload?.code === "password_change_required") {
      sessionSignals.passwordChangeRequired();
      throw new Error(payload.error);
    }

    if (!response.ok) {
      throw new Error(payload?.error || `Request failed (${response.status})`);
    }

    return payload;
  }

  function can(permission) {
    return state.permissions.includes(permission);
  }

  global.AppApi = {
    requestJson,
    can,
    onSessionSignal
  };
})(typeof window === "undefined" ? globalThis : window);
