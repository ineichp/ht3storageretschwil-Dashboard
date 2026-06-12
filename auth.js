const AUTH_CONFIG = {
  clientId: "7n5l9sftssnec5qlaev7sh96h6",
  cognitoEndpoint: "https://cognito-idp.eu-central-1.amazonaws.com/",
  apiBaseUrl: "https://onbcgvleu4.execute-api.eu-central-1.amazonaws.com"
};

const AUTH_STORAGE_KEY = "storageRetschwilAuth";

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

function writeSession(authenticationResult) {
  const expiresIn = Number(authenticationResult.ExpiresIn || 3600);
  const session = {
    accessToken: authenticationResult.AccessToken,
    idToken: authenticationResult.IdToken,
    refreshToken: authenticationResult.RefreshToken,
    expiresAt: Date.now() + expiresIn * 1000
  };

  sessionStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
  return session;
}

function clearSession() {
  sessionStorage.removeItem(AUTH_STORAGE_KEY);
}

async function cognitoRequest(target, body) {
  const response = await fetch(AUTH_CONFIG.cognitoEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-amz-json-1.1",
      "X-Amz-Target": `AWSCognitoIdentityProviderService.${target}`
    },
    body: JSON.stringify(body)
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload.message || payload.__type || `Cognito HTTP ${response.status}`;
    throw new Error(message.replace(/^.*?#/, ""));
  }

  return payload;
}

async function passwordLogin(username, password) {
  return cognitoRequest("InitiateAuth", {
    AuthFlow: "USER_PASSWORD_AUTH",
    ClientId: AUTH_CONFIG.clientId,
    AuthParameters: {
      USERNAME: username,
      PASSWORD: password
    }
  });
}

async function respondToChallenge(challengeName, session, challengeResponses) {
  return cognitoRequest("RespondToAuthChallenge", {
    ChallengeName: challengeName,
    ClientId: AUTH_CONFIG.clientId,
    Session: session,
    ChallengeResponses: challengeResponses
  });
}

function authMessage(text = "", type = "error") {
  const node = document.getElementById("authMessage");
  if (!node) return;
  node.textContent = text;
  node.className = text ? `auth-message ${type}` : "auth-message";
}

function setMode(mode) {
  document.querySelectorAll("[data-auth-mode]").forEach(panel => {
    panel.hidden = panel.dataset.authMode !== mode;
  });

  document.querySelectorAll("[data-auth-tab]").forEach(button => {
    button.classList.toggle("active", button.dataset.authTab === mode);
  });

  authMessage("");
}

async function submitLogin(event) {
  event.preventDefault();
  authMessage("");

  const form = event.currentTarget;
  const button = form.querySelector("button[type='submit']");
  button.disabled = true;

  try {
    const username = form.email.value.trim();
    const password = form.password.value;
    const result = await passwordLogin(username, password);

    if (result.AuthenticationResult) {
      window.StorageRetschwilAuth.completeLogin(writeSession(result.AuthenticationResult));
      return;
    }

    if (result.ChallengeName === "SOFTWARE_TOKEN_MFA") {
      window.StorageRetschwilAuth.pendingChallenge = {
        name: result.ChallengeName,
        session: result.Session,
        username
      };
      setMode("mfa");
      return;
    }

    if (result.ChallengeName === "NEW_PASSWORD_REQUIRED") {
      window.StorageRetschwilAuth.pendingChallenge = {
        name: result.ChallengeName,
        session: result.Session,
        username
      };
      setMode("new-password");
      return;
    }

    throw new Error(`Unsupported login challenge: ${result.ChallengeName || "unknown"}`);
  } catch (error) {
    authMessage(error.message || "Login fehlgeschlagen.");
  } finally {
    button.disabled = false;
  }
}

async function submitMfa(event) {
  event.preventDefault();
  authMessage("");

  const pending = window.StorageRetschwilAuth.pendingChallenge;
  if (!pending) {
    setMode("login");
    return;
  }

  const form = event.currentTarget;
  const button = form.querySelector("button[type='submit']");
  button.disabled = true;

  try {
    const result = await respondToChallenge("SOFTWARE_TOKEN_MFA", pending.session, {
      USERNAME: pending.username,
      SOFTWARE_TOKEN_MFA_CODE: form.code.value.trim()
    });

    if (!result.AuthenticationResult) throw new Error("Authenticator-Code konnte nicht validiert werden.");
    window.StorageRetschwilAuth.completeLogin(writeSession(result.AuthenticationResult));
  } catch (error) {
    authMessage(error.message || "Authenticator-Code fehlgeschlagen.");
  } finally {
    button.disabled = false;
  }
}

async function submitNewPassword(event) {
  event.preventDefault();
  authMessage("");

  const pending = window.StorageRetschwilAuth.pendingChallenge;
  if (!pending) {
    setMode("login");
    return;
  }

  const form = event.currentTarget;
  const button = form.querySelector("button[type='submit']");
  button.disabled = true;

  try {
    const result = await respondToChallenge("NEW_PASSWORD_REQUIRED", pending.session, {
      USERNAME: pending.username,
      NEW_PASSWORD: form.password.value
    });

    if (!result.AuthenticationResult) throw new Error("Neues Passwort konnte nicht gesetzt werden.");
    window.StorageRetschwilAuth.completeLogin(writeSession(result.AuthenticationResult));
  } catch (error) {
    authMessage(error.message || "Passwortwechsel fehlgeschlagen.");
  } finally {
    button.disabled = false;
  }
}

async function submitRegistration(event) {
  event.preventDefault();
  authMessage("");

  const form = event.currentTarget;
  const button = form.querySelector("button[type='submit']");
  button.disabled = true;

  try {
    const response = await fetch(`${AUTH_CONFIG.apiBaseUrl}/registration-requests`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: form.email.value.trim(),
        name: form.name.value.trim(),
        reason: form.reason.value.trim()
      })
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.message || `HTTP ${response.status}`);

    form.reset();
    authMessage("Anfrage gesendet. Die Freigabe laeuft ueber ip@skyit.ch.", "success");
  } catch (error) {
    authMessage(error.message || "Registrierungsanfrage fehlgeschlagen.");
  } finally {
    button.disabled = false;
  }
}

function showLogin(errorMessage = "") {
  document.body.classList.add("auth-required");
  document.body.insertAdjacentHTML("afterbegin", `
    <main class="auth-shell">
      <section class="auth-panel">
        <div class="eyebrow">Storage Monitoring</div>
        <h1>Storage Retschwil</h1>

        <div class="auth-tabs" role="tablist" aria-label="Authentication">
          <button class="active" type="button" data-auth-tab="login">Login</button>
          <button type="button" data-auth-tab="register">Registrieren</button>
        </div>

        <div id="authMessage" class="auth-message">${errorMessage}</div>

        <form class="auth-form" data-auth-mode="login">
          <label>
            <span>E-Mail</span>
            <input name="email" type="email" autocomplete="username" required>
          </label>
          <label>
            <span>Passwort</span>
            <input name="password" type="password" autocomplete="current-password" required>
          </label>
          <button class="auth-primary" type="submit">Anmelden</button>
          <div class="auth-footnote">Authenticator-App und Passkey sind optional in Cognito vorbereitet.</div>
        </form>

        <form class="auth-form" data-auth-mode="mfa" hidden>
          <label>
            <span>Authenticator-Code</span>
            <input name="code" inputmode="numeric" autocomplete="one-time-code" required>
          </label>
          <button class="auth-primary" type="submit">Code pruefen</button>
        </form>

        <form class="auth-form" data-auth-mode="new-password" hidden>
          <label>
            <span>Neues Passwort</span>
            <input name="password" type="password" autocomplete="new-password" minlength="12" required>
          </label>
          <button class="auth-primary" type="submit">Passwort setzen</button>
        </form>

        <form class="auth-form" data-auth-mode="register" hidden>
          <label>
            <span>E-Mail</span>
            <input name="email" type="email" autocomplete="email" required>
          </label>
          <label>
            <span>Name</span>
            <input name="name" type="text" autocomplete="name">
          </label>
          <label>
            <span>Grund</span>
            <textarea name="reason" rows="3" placeholder="Wofuer brauchst du Zugriff?"></textarea>
          </label>
          <button class="auth-primary" type="submit">Anfrage senden</button>
        </form>
      </section>
    </main>
  `);

  document.querySelectorAll("[data-auth-tab]").forEach(button => {
    button.addEventListener("click", () => setMode(button.dataset.authTab));
  });
  document.querySelector("[data-auth-mode='login']").addEventListener("submit", submitLogin);
  document.querySelector("[data-auth-mode='mfa']").addEventListener("submit", submitMfa);
  document.querySelector("[data-auth-mode='new-password']").addEventListener("submit", submitNewPassword);
  document.querySelector("[data-auth-mode='register']").addEventListener("submit", submitRegistration);
}

function attachFetchToken(session) {
  const originalFetch = window.fetch.bind(window);

  window.fetch = (input, init = {}) => {
    const url = typeof input === "string" ? input : input.url;
    if (!url || !url.startsWith(AUTH_CONFIG.apiBaseUrl)) {
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
    window.location.assign("/");
  });
}

window.StorageRetschwilAuth = {
  pendingChallenge: null,
  completeLogin(session) {
    document.body.classList.remove("auth-required");
    document.querySelector(".auth-shell")?.remove();
    attachFetchToken(session);
    configureSignOut();
    window.StorageRetschwilAuth.startDashboard();
  },
  async bootstrap(startDashboard) {
    window.StorageRetschwilAuth.startDashboard = startDashboard;

    try {
      const session = readSession();
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
