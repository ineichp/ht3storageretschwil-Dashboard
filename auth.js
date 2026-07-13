const AUTH_CONFIG = {
  clientId: "7n5l9sftssnec5qlaev7sh96h6",
  cognitoEndpoint: "https://cognito-idp.eu-central-1.amazonaws.com/",
  apiBaseUrl: "https://onbcgvleu4.execute-api.eu-central-1.amazonaws.com"
};

const AUTH_STORAGE_KEY = "storageRetschwilAuth";
let pendingAuth = null;
let activeSession = null;

const AUTH_MODE_COPY = {
  login: {
    stage: "",
    title: "",
    copy: ""
  },
  "mfa-code": {
    stage: "",
    title: "",
    copy: ""
  },
  "mfa-setup": {
    stage: "Required MFA",
    title: "Setup MFA",
    copy: "Scan the QR code with your authenticator app, then enter the first 6-digit code."
  }
};

function readStoredSession() {
  try {
    const value = JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY) || "null");
    if (!value || !value.accessToken || !value.expiresAt) return null;
    return value;
  } catch {
    return null;
  }
}

function isSessionFresh(session) {
  return Boolean(session?.accessToken && session.expiresAt && Date.now() <= session.expiresAt - 60_000);
}

function writeSession(authenticationResult, existingSession = null) {
  const expiresIn = Number(authenticationResult.ExpiresIn || 3600);
  const session = {
    accessToken: authenticationResult.AccessToken,
    idToken: authenticationResult.IdToken,
    refreshToken: authenticationResult.RefreshToken || existingSession?.refreshToken || null,
    expiresAt: Date.now() + expiresIn * 1000
  };

  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
  activeSession = session;
  return session;
}

function clearSession() {
  localStorage.removeItem(AUTH_STORAGE_KEY);
  activeSession = null;
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

async function refreshLogin(session) {
  if (!session?.refreshToken) return null;

  const result = await cognitoRequest("InitiateAuth", {
    AuthFlow: "REFRESH_TOKEN_AUTH",
    ClientId: AUTH_CONFIG.clientId,
    AuthParameters: {
      REFRESH_TOKEN: session.refreshToken
    }
  });

  return result.AuthenticationResult ? writeSession(result.AuthenticationResult, session) : null;
}

async function getValidSession() {
  const session = readStoredSession();
  if (!session) return null;
  if (isSessionFresh(session)) {
    activeSession = session;
    return session;
  }

  try {
    return await refreshLogin(session);
  } catch (error) {
    console.warn("Could not refresh dashboard session:", error);
    clearSession();
    return null;
  }
}

async function respondToAuthChallenge(challengeName, session, challengeResponses) {
  return cognitoRequest("RespondToAuthChallenge", {
    ChallengeName: challengeName,
    ClientId: AUTH_CONFIG.clientId,
    Session: session,
    ChallengeResponses: challengeResponses
  });
}

async function associateSoftwareToken(session) {
  return cognitoRequest("AssociateSoftwareToken", { Session: session });
}

async function verifySoftwareToken(session, code) {
  return cognitoRequest("VerifySoftwareToken", {
    Session: session,
    UserCode: code,
    FriendlyDeviceName: "Storage Retschwil Authenticator"
  });
}

async function setTotpPreference(accessToken) {
  return cognitoRequest("SetUserMFAPreference", {
    AccessToken: accessToken,
    SoftwareTokenMfaSettings: {
      Enabled: true,
      PreferredMfa: true
    }
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

  const copyConfig = AUTH_MODE_COPY[mode] || AUTH_MODE_COPY.login;
  const stage = document.getElementById("authStepStage");
  const title = document.getElementById("authStepTitle");
  const copy = document.getElementById("authStepCopy");

  if (stage) {
    stage.textContent = copyConfig.stage || "";
    stage.hidden = !copyConfig.stage;
  }
  if (title) {
    title.textContent = copyConfig.title || "";
    title.hidden = !copyConfig.title;
  }
  if (copy) {
    copy.textContent = copyConfig.copy || "";
    copy.hidden = !copyConfig.copy;
  }

  authMessage("");
}

async function completeAuthentication(authenticationResult, setMfaPreference = false) {
  if (setMfaPreference && authenticationResult.AccessToken) {
    try {
      await setTotpPreference(authenticationResult.AccessToken);
    } catch (error) {
      console.warn("Could not set TOTP preference after MFA setup:", error);
    }
  }

  window.StorageRetschwilAuth.completeLogin(writeSession(authenticationResult));
}

function renderTotpQr(secretCode) {
  const node = document.getElementById("mfaQrCode");
  const issuer = "Storage Retschwil";
  const account = pendingAuth?.username || "dashboard";
  const otpauth = `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${encodeURIComponent(secretCode)}&issuer=${encodeURIComponent(issuer)}`;

  if (!node || !window.qrcode) {
    authMessage("QR code renderer could not be loaded. Use the secret key manually.", "error");
    return;
  }

  const qr = window.qrcode(0, "M");
  qr.addData(otpauth);
  qr.make();
  node.innerHTML = qr.createSvgTag(4, 1).replace("<svg", "<svg role=\"img\" aria-label=\"Authenticator setup QR code\"");
}

function showMfaCode(result, username) {
  pendingAuth = {
    challengeName: result.ChallengeName,
    session: result.Session,
    username: result.ChallengeParameters?.USER_ID_FOR_SRP || username
  };

  setMode("mfa-code");
  document.querySelector("[data-auth-mode='mfa-code'] input[name='code']")?.focus();
}

async function showMfaSetup(result, username) {
  pendingAuth = {
    challengeName: result.ChallengeName,
    session: result.Session,
    username: result.ChallengeParameters?.USER_ID_FOR_SRP || username
  };

  const setup = await associateSoftwareToken(result.Session);
  pendingAuth.session = setup.Session || pendingAuth.session;
  pendingAuth.secretCode = setup.SecretCode;

  setMode("mfa-setup");
  document.getElementById("mfaSecret").textContent = setup.SecretCode;
  renderTotpQr(setup.SecretCode);
  document.querySelector("[data-auth-mode='mfa-setup'] input[name='code']")?.focus();
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
      await completeAuthentication(result.AuthenticationResult);
      return;
    }

    if (result.ChallengeName === "SOFTWARE_TOKEN_MFA") {
      showMfaCode(result, username);
      return;
    }

    if (result.ChallengeName === "MFA_SETUP") {
      await showMfaSetup(result, username);
      return;
    }

    throw new Error(`Unsupported login challenge: ${result.ChallengeName || "unknown"}`);
  } catch (error) {
    authMessage(error.message || "Login fehlgeschlagen.");
  } finally {
    button.disabled = false;
  }
}

async function submitMfaCode(event) {
  event.preventDefault();
  authMessage("");

  const form = event.currentTarget;
  const button = form.querySelector("button[type='submit']");
  button.disabled = true;

  try {
    if (!pendingAuth?.session || !pendingAuth?.username) {
      throw new Error("MFA session expired. Please login again.");
    }

    const code = form.code.value.trim();
    const result = await respondToAuthChallenge("SOFTWARE_TOKEN_MFA", pendingAuth.session, {
      USERNAME: pendingAuth.username,
      SOFTWARE_TOKEN_MFA_CODE: code
    });

    if (!result.AuthenticationResult) {
      throw new Error(`Unsupported MFA challenge: ${result.ChallengeName || "unknown"}`);
    }

    await completeAuthentication(result.AuthenticationResult);
  } catch (error) {
    authMessage(error.message || "Authenticator code failed.");
  } finally {
    button.disabled = false;
  }
}

async function submitMfaSetup(event) {
  event.preventDefault();
  authMessage("");

  const form = event.currentTarget;
  const button = form.querySelector("button[type='submit']");
  button.disabled = true;

  try {
    if (!pendingAuth?.session || !pendingAuth?.username) {
      throw new Error("MFA setup session expired. Please login again.");
    }

    const code = form.code.value.trim();
    const verify = await verifySoftwareToken(pendingAuth.session, code);
    const result = await respondToAuthChallenge("MFA_SETUP", verify.Session || pendingAuth.session, {
      USERNAME: pendingAuth.username
    });

    if (!result.AuthenticationResult) {
      throw new Error(`Unsupported MFA setup challenge: ${result.ChallengeName || "unknown"}`);
    }

    await completeAuthentication(result.AuthenticationResult, true);
  } catch (error) {
    authMessage(error.message || "MFA setup failed.");
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
        <div id="authStepStage" class="auth-stage" hidden></div>
        <h2 id="authStepTitle" hidden></h2>
        <p id="authStepCopy" class="auth-copy" hidden></p>

        <div id="authMessage" class="auth-message">${errorMessage}</div>

        <form class="auth-form" data-auth-mode="login">
          <label>
            <span>Username</span>
            <input name="email" type="email" autocomplete="username" required>
          </label>
          <label>
            <span>Password</span>
            <input name="password" type="password" autocomplete="current-password" required>
          </label>
          <button class="auth-primary" type="submit">Login</button>
        </form>

        <form class="auth-form" data-auth-mode="mfa-code" hidden>
          <label>
            <span>Code</span>
            <input name="code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" required>
          </label>
          <button class="auth-primary" type="submit">Verify</button>
        </form>

        <form class="auth-form" data-auth-mode="mfa-setup" hidden>
          <div id="mfaQrCode" class="auth-qr" aria-label="Authenticator setup QR code"></div>
          <div class="auth-secret">
            <span id="mfaSecret">—</span>
          </div>
          <label>
            <span>First Code</span>
            <input name="code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" required>
          </label>
          <button class="auth-primary" type="submit">Enable MFA</button>
        </form>
      </section>
    </main>
  `);

  document.querySelector("[data-auth-mode='login']").addEventListener("submit", submitLogin);
  document.querySelector("[data-auth-mode='mfa-code']").addEventListener("submit", submitMfaCode);
  document.querySelector("[data-auth-mode='mfa-setup']").addEventListener("submit", submitMfaSetup);
}

function attachFetchToken(session) {
  activeSession = session;
  const originalFetch = window.fetch.bind(window);

  window.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input.url;
    if (!url || !url.startsWith(AUTH_CONFIG.apiBaseUrl)) {
      return originalFetch(input, init);
    }

    if (!isSessionFresh(activeSession)) {
      const refreshedSession = await refreshLogin(activeSession);
      if (!refreshedSession) {
        clearSession();
        showLogin();
        throw new Error("Dashboard session expired.");
      }
    }

    const headers = new Headers(init.headers || {});
    headers.set("Authorization", `Bearer ${activeSession.accessToken}`);
    return originalFetch(input, { ...init, headers });
  };
}

function configureSignOut() {
  const button = document.getElementById("signOutButton");
  if (!button) return;

  button.addEventListener("click", () => {
    pendingAuth = null;
    clearSession();
    window.location.assign("/");
  });
}

window.StorageRetschwilAuth = {
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
      const session = await getValidSession();
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
