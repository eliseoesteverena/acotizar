// auth.js
// ─────────────────────────────────────────────────────────────────────────────
// Módulo de autenticación Auth0 — flujo Authorization Code + PKCE
// Agnóstico y autocontenido. No requiere Node.js ni build tools.
//
// Dependencia externa (cargar en <head> antes que este archivo):
//   <script src="https://cdn.auth0.com/js/auth0-spa-js/2.1/auth0-spa-js.production.js"></script>
//
// API pública:
//   await Auth.init(AUTH_CONFIG)
//   await Auth.login(params?)
//   Auth.logout(options?)
//   await Auth.isAuthenticated()   → boolean
//   await Auth.getUser()           → { sub, name, email, picture, ... } | null
//   await Auth.getToken(options?)  → JWT string
//   await Auth.requireAuth()       → user | null (redirige si no hay sesión)
// ─────────────────────────────────────────────────────────────────────────────

const Auth = (() => {
  let _client = null;

  // ── init ──────────────────────────────────────────────────────────────────
  // Inicializa el cliente Auth0 y procesa el callback si hay ?code= en la URL.
  // Debe llamarse antes que cualquier otro método.
  async function init(config) {
    if (!config?.domain || !config?.clientId) {
      throw new Error('[Auth] auth_config.js: domain y clientId son obligatorios.');
    }

    _client = await auth0.createAuth0Client({
      domain:        config.domain,
      clientId:      config.clientId,
      cacheLocation: config.cacheLocation ?? 'memory',
      useRefreshTokens: config.useRefreshTokens ?? false,
      authorizationParams: {
        redirect_uri: config.redirectUri ?? `${window.location.origin}/callback`,
        ...(config.audience ? { audience: config.audience } : {}),
      },
    });

    // Si hay un code de Auth0 en la URL, procesarlo (venimos del redirect)
    const params = new URLSearchParams(window.location.search);
    if (params.has('code') && params.has('state')) {
      try {
        await _client.handleRedirectCallback();
      } catch (e) {
        console.error('[Auth] Error procesando callback:', e);
      }
      // Limpiar los parámetros de la URL sin recargar la página
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }

  // ── login ─────────────────────────────────────────────────────────────────
  async function login(params = {}) {
    _assertInitialized();
    await _client.loginWithRedirect({
      authorizationParams: params,
    });
  }

  // ── logout ────────────────────────────────────────────────────────────────
  function logout(options = {}) {
    _assertInitialized();
    _client.logout({
      logoutParams: {
        returnTo: options.logoutUri ?? window.location.origin,
      },
    });
  }

  // ── isAuthenticated ───────────────────────────────────────────────────────
  async function isAuthenticated() {
    _assertInitialized();
    return await _client.isAuthenticated();
  }

  // ── getUser ───────────────────────────────────────────────────────────────
  async function getUser() {
    _assertInitialized();
    if (!(await _client.isAuthenticated())) return null;
    return await _client.getUser();
  }

  // ── getToken ──────────────────────────────────────────────────────────────
  // Devuelve el Access Token. Lo renueva silenciosamente si está expirado
  // (requiere useRefreshTokens: true en la config).
  async function getToken(options = {}) {
    _assertInitialized();
    return await _client.getTokenSilently(options);
  }

  // ── requireAuth ───────────────────────────────────────────────────────────
  // Guard para páginas protegidas.
  // Si no hay sesión, redirige al login y devuelve null.
  // Si hay sesión, devuelve el perfil del usuario.
  async function requireAuth() {
    _assertInitialized();
    if (!(await _client.isAuthenticated())) {
      await _client.loginWithRedirect({
        authorizationParams: {
          redirect_uri: window.location.origin + '/callback',
        },
      });
      return null;
    }
    return await _client.getUser();
  }

  // ── helpers internos ──────────────────────────────────────────────────────
  function _assertInitialized() {
    if (!_client) {
      throw new Error('[Auth] Llamar Auth.init(AUTH_CONFIG) antes de usar otros métodos.');
    }
  }

  return { init, login, logout, isAuthenticated, getUser, getToken, requireAuth };
})();
