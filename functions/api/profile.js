/**
 * /api/profile
 *
 * GET  → Devuelve el perfil del usuario autenticado (con plan).
 * POST → Crea el perfil si no existe, junto con empresa por defecto
 *        y registro en profile_company. Idempotente: si ya existe,
 *        devuelve el perfil y la empresa sin modificar nada.
 */

/**
 * Decodifica el payload de un JWT sin verificar firma.
 * Suficiente para obtener el `sub` del Access Token de Auth0.
 * D1 es inaccesible desde el exterior, por lo que el riesgo es acotado.
 */
function decodeJwtPayload(token) {
  try {
    const base64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = atob(base64);
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/**
 * Extrae y valida el token del header Authorization.
 * Devuelve { token, payload } o lanza Response con 401.
 */
function extractAuth(request) {
  const authHeader = request.headers.get("Authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) {
    return { error: new Response(JSON.stringify({ error: "Token requerido" }), { status: 401 }) };
  }

  const payload = decodeJwtPayload(token);
  if (!payload?.sub) {
    return { error: new Response(JSON.stringify({ error: "Token inválido" }), { status: 401 }) };
  }

  return { token, payload };
}

// ---------------------------------------------------------------------------
// GET /api/profile
// ---------------------------------------------------------------------------
export async function onRequestGet({ request, env }) {
  const { payload, error } = extractAuth(request);
  if (error) return error;

  const userId = payload.sub;

  const profile = await env.DB.prepare(`
    SELECT p.id, p.email, p.name, p.avatar_url, p.plan_id, p.created_at,
           pl.name AS plan_name
    FROM profiles p
    JOIN plans pl ON pl.id = p.plan_id
    WHERE p.id = ?
  `).bind(userId).first();

  if (!profile) {
    return new Response(JSON.stringify({ error: "Perfil no encontrado" }), { status: 404 });
  }

  return new Response(JSON.stringify({ profile }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// POST /api/profile
// ---------------------------------------------------------------------------
export async function onRequestPost({ request, env }) {
  const { payload, error } = extractAuth(request);
  if (error) return error;

  const userId  = payload.sub;
  const email   = payload.email   ?? "";
  const name    = payload.name    ?? payload.nickname ?? "";
  const picture = payload.picture ?? "";

  // ── ¿Ya existe el perfil? ──────────────────────────────────────────────
  const existing = await env.DB.prepare(`
    SELECT p.id, p.email, p.name, p.avatar_url, p.plan_id,
           c.id AS company_id, c.name AS company_name,
           c.fiscal_data, c.logo_url
    FROM profiles p
    LEFT JOIN profile_company pc ON pc.profile_id = p.id
    LEFT JOIN company c ON c.id = pc.company_id
    WHERE p.id = ?
    LIMIT 1
  `).bind(userId).first();

  if (existing) {
    const isComplete = isCompanyComplete(existing.fiscal_data);
    return new Response(
      JSON.stringify({
        isNew: false,
        needsOnboarding: !isComplete,
        profile: {
          id:         existing.id,
          email:      existing.email,
          name:       existing.name,
          avatar_url: existing.avatar_url,
          plan_id:    existing.plan_id,
        },
        company: {
          id:          existing.company_id,
          name:        existing.company_name,
          fiscal_data: existing.fiscal_data ? JSON.parse(existing.fiscal_data) : null,
          logo_url:    existing.logo_url,
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  // ── Usuario nuevo: crear perfil + empresa + profile_company en batch ───
  const companyId        = crypto.randomUUID();
  const profileCompanyId = crypto.randomUUID();
  const now              = Math.floor(Date.now() / 1000);

  // fiscal_data vacío — se completa en /app/config
  const defaultFiscalData = JSON.stringify({});
  const defaultCompanyName = name || "Mi empresa";

  const stmts = [
    env.DB.prepare(`
      INSERT INTO profiles (id, email, name, avatar_url, plan_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'free', ?, ?)
    `).bind(userId, email, name, picture, now, now),

    env.DB.prepare(`
      INSERT INTO company (id, name, fiscal_data, logo_url, created_at, updated_at)
      VALUES (?, ?, ?, NULL, ?, ?)
    `).bind(companyId, defaultCompanyName, defaultFiscalData, now, now),

    env.DB.prepare(`
      INSERT INTO profile_company (id, profile_id, company_id, role, created_at)
      VALUES (?, ?, ?, 'owner', ?)
    `).bind(profileCompanyId, userId, companyId, now),
  ];

  try {
    await env.DB.batch(stmts);
  } catch (err) {
    console.error("Error en batch de onboarding:", err);
    return new Response(
      JSON.stringify({ error: "Error al crear el perfil" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  return new Response(
    JSON.stringify({
      isNew: true,
      needsOnboarding: true,
      profile: { id: userId, email, name, avatar_url: picture, plan_id: "free" },
      company: { id: companyId, name: defaultCompanyName, fiscal_data: null, logo_url: null },
    }),
    { status: 201, headers: { "Content-Type": "application/json" } }
  );
}

// ---------------------------------------------------------------------------
// Helper: ¿la empresa tiene los campos mínimos completos?
// Considera completo si fiscal_data tiene razonSocial y numeroIdentificacionFiscal.
// ---------------------------------------------------------------------------
function isCompanyComplete(fiscalDataRaw) {
  if (!fiscalDataRaw) return false;
  try {
    const data = JSON.parse(fiscalDataRaw);
    return !!(data.razonSocial && data.numeroIdentificacionFiscal);
  } catch {
    return false;
  }
}
