// auth_config.js
// ─────────────────────────────────────────────────────────────────────────────
// Completar con los valores del Auth0 Dashboard:
//   Applications → [tu app] → Settings → Domain y Client ID
//
// ⚠️  No subir a repositorios públicos con valores de producción.
//     domain y clientId son técnicamente públicos, pero es buena práctica.
// ─────────────────────────────────────────────────────────────────────────────

const AUTH_CONFIG = {
  domain:   'dev-0z2lkf1fu6a4t6wl.us.auth0.com',  // ← Reemplazar
  clientId: '04rWq8g2Kl0amFKONgFJvUkmwi9N93LE',          // ← Reemplazar

  // Opcionales — si se omiten, auth.js usa window.location.origin como base.
  // redirectUri: 'https://tudominio.com/callback',
  // logoutUri:   'https://tudominio.com/',
  // audience:    'https://api.tudominio.com',  // solo si tenés una API registrada en Auth0
  // cacheLocation: 'memory',                   // 'memory' (default, más seguro) | 'localstorage'
  // useRefreshTokens: true,                    // requiere Refresh Token Rotation en Auth0 Dashboard
};
