const AUTH_CONFIG = {
  clientId: "7n5l9sftssnec5qlaev7sh96h6",
  domain: "https://storageretschwil-dashboard-024113141954.auth.eu-central-1.amazoncognito.com",
  redirectUri: "https://storageretschwil.ortus.one/",
  scopes: ["openid", "email", "profile"]
};

const AUTH_STORAGE_KEY = "storageRetschwilAuth";
const AUTH_PKCE_KEY = "storageRetschwilPkce";

function base64UrlEncode(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomString(length = 64) {
  const values = new Uint8Array(length);
  crypto.getRandomValues(values);
  return Array.from(values, value => ("0" + value.toString(16)).slice(-2)).join("");
}

async function createCodeChallenge(verifier) {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return base64UrlEncode(digest);
}

function readSession() {
  try {
    const value = JSON.parse(sessionStorage.getItem(AUTH_STORAGE_KEY) || "null");
    if (!value || !value.accessToken || !value.expiresAt) return null;
    if (Date.now() > value.expiresAt - 60_000) return null;
    return value;
  } catch {
    return null;
  }
}

function writeSession(tokenResponse) {
  const expiresIn = Number(tokenResponse.expires_in || 3600);
  const session = {
    accessToken: tokenResponse.access_token,
    idToken: tokenResponse.id_token,
    expiresAt: Date.now() + expiresIn * 1000
  };

  sessionStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
  return session;
}

function clearSession() {
  sessionStorage.removeItem(AUTH_STORAGE_KEY);
  sessionStorage.removeItem(AUTH_PKCE_KEY);
}

async function startLogin() {
  const verifier = randomString(64);
  const state = randomString(24);
  const challenge = await createCodeChallenge(verifier);

  sessionStorage.setItem(AUTH_PKCE_KEY, JSON.stringify({ verifier, state }));

  const params = new URLSearchParams({
    client_id: AUTH_CONFIG.clientId,
    response_type: "code",
    scope: AUTH_CONFIG.scopes.join(" "),
    redirect_uri: AUTH_CONFIG.redirectUri,
    code_challenge_method: "S256",
    code_challenge: challenge,
    state
  });

  window.location.assign(`${AUTH_CONFIG.domain}/oauth2/authorize?${params.toString()}`);
}

async function exchangeCode(code, state) {
  const pkce = JSON.parse(sessionStorage.getItem(AUTH_PKCE_KEY) || "null");
  if (!pkce || pkce.state !== state) throw new Error("Login state validation failed.");

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: AUTH_CONFIG.clientId,
    code,
    redirect_uri: AUTH_CONFIG.redirectUri,
    code_verifier: pkce.verifier
  });

  const response = await fetch(`${AUTH_CONFIG.domain}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });

  if (!response.ok) throw new Error(`Token exchange failed with HTTP ${response.status}.`);

  sessionStorage.removeItem(AUTH_PKCE_KEY);
  return writeSession(await response.json());
}

function showLogin(errorMessage = "") {
  document.body.classList.add("auth-required");
  document.body.insertAdjacentHTML("afterbegin", `
    <main class="auth-shell">
      <section class="auth-panel">
        <div class="eyebrow">Storage Monitoring</div>
        <h1>Storage Retschwil</h1>
        <p class="auth-copy">Bitte melde dich an, um Messwerte, Videoereignisse und Schwellwerte zu verwalten.</p>
        ${errorMessage ? `<div class="error auth-error">${errorMessage}</div>` : ""}
        <button id="authLoginButton" class="auth-primary" type="button">Mit AWS anmelden</button>
      </section>
    </main>
  `);

  document.getElementById("authLoginButton").addEventListener("click", startLogin);
}

function attachFetchToken(session) {
  const originalFetch = window.fetch.bind(window);

  window.fetch = (input, init = {}) => {
    const url = typeof input === "string" ? input : input.url;
    if (!url || !url.startsWith("https://onbcgvleu4.execute-api.eu-central-1.amazonaws.com")) {
      return originalFetch(input, init);
    }

    const headers = new Headers(init.headers || {});
    headers.set("Authorization", `Bearer ${session.accessToken}`);
    return originalFetch(input, { ...init, headers });
  };
}

function configureSignOut() {
  const button = document.getElementById("signOutButton");
  if (!button) return;

  button.addEventListener("click", () => {
    clearSession();
    const params = new URLSearchParams({
      client_id: AUTH_CONFIG.clientId,
      logout_uri: AUTH_CONFIG.redirectUri
    });
    window.location.assign(`${AUTH_CONFIG.domain}/logout?${params.toString()}`);
  });
}

window.StorageRetschwilAuth = {
  async bootstrap(startDashboard) {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const state = params.get("state");

    try {
      let session = readSession();

      if (!session && code) {
        session = await exchangeCode(code, state);
        history.replaceState({}, document.title, window.location.pathname);
      }

      if (!session) {
        showLogin();
        return;
      }

      attachFetchToken(session);
      configureSignOut();
      startDashboard();
    } catch (error) {
      console.error(error);
      clearSession();
      showLogin(error.message);
    }
  }
};
