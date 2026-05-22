/**
 * /api/company
 *
 * GET  → Devuelve todas las empresas del usuario autenticado.
 * POST → Crea una nueva empresa y la asocia al usuario (role: 'owner').
 *
 * Para editar una empresa existente usar PUT /api/company/[id].
 */

/**
 * Decodifica el payload de un JWT sin verificar firma.
 * (Misma lógica que en profile.js — en una refactor posterior
 *  esto puede extraerse a un módulo compartido en /functions/_shared/)
 */
function decodeJwtPayload(token) {
  try {
    const base64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(base64));
  } catch {
    return null;
  }
}

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
// GET /api/company
// Devuelve todas las empresas asociadas al usuario, con su rol.
// ---------------------------------------------------------------------------
export async function onRequestGet({ request, env }) {
  const { payload, error } = extractAuth(request);
  if (error) return error;

  const userId = payload.sub;

  const { results } = await env.DB.prepare(`
    SELECT
      c.id,
      c.name,
      c.fiscal_data,
      c.logo_url,
      c.created_at,
      c.updated_at,
      pc.role
    FROM company c
    JOIN profile_company pc ON pc.company_id = c.id
    WHERE pc.profile_id = ?
    ORDER BY c.created_at ASC
  `).bind(userId).all();

  const companies = results.map((row) => ({
    id:          row.id,
    name:        row.name,
    fiscal_data: row.fiscal_data ? JSON.parse(row.fiscal_data) : null,
    logo_url:    row.logo_url,
    role:        row.role,
    created_at:  row.created_at,
    updated_at:  row.updated_at,
  }));

  return new Response(JSON.stringify({ companies }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// POST /api/company
// Crea una nueva empresa y la vincula al usuario como 'owner'.
// Body esperado: { name, fiscal_data }
//   - name: string (requerido)
//   - fiscal_data: objeto con el schema definido (requerido)
// ---------------------------------------------------------------------------
export async function onRequestPost({ request, env }) {
  const { payload, error } = extractAuth(request);
  if (error) return error;

  const userId = payload.sub;

  // ── Verificar que el perfil existe ────────────────────────────────────
  const profile = await env.DB.prepare(
    "SELECT id FROM profiles WHERE id = ?"
  ).bind(userId).first();

  if (!profile) {
    return new Response(
      JSON.stringify({ error: "Perfil no encontrado. Completá el registro primero." }),
      { status: 404, headers: { "Content-Type": "application/json" } }
    );
  }

  // ── Parsear body ──────────────────────────────────────────────────────
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(
      JSON.stringify({ error: "Body JSON inválido" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const { name, fiscal_data } = body;

  // ── Validaciones mínimas ──────────────────────────────────────────────
  const validationError = validateCompanyInput(name, fiscal_data);
  if (validationError) {
    return new Response(
      JSON.stringify({ error: validationError }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // ── Insertar empresa + profile_company en batch ───────────────────────
  const companyId        = crypto.randomUUID();
  const profileCompanyId = crypto.randomUUID();
  const now              = Math.floor(Date.now() / 1000);
  const fiscalDataStr    = JSON.stringify(fiscal_data);

  try {
    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO company (id, name, fiscal_data, logo_url, created_at, updated_at)
        VALUES (?, ?, ?, NULL, ?, ?)
      `).bind(companyId, name.trim(), fiscalDataStr, now, now),

      env.DB.prepare(`
        INSERT INTO profile_company (id, profile_id, company_id, role, created_at)
        VALUES (?, ?, ?, 'owner', ?)
      `).bind(profileCompanyId, userId, companyId, now),
    ]);
  } catch (err) {
    console.error("Error al crear empresa:", err);
    return new Response(
      JSON.stringify({ error: "Error al crear la empresa" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  return new Response(
    JSON.stringify({
      company: {
        id:          companyId,
        name:        name.trim(),
        fiscal_data: fiscal_data,
        logo_url:    null,
        role:        "owner",
      },
    }),
    { status: 201, headers: { "Content-Type": "application/json" } }
  );
}

// ---------------------------------------------------------------------------
// Helper: validaciones mínimas del input
// ---------------------------------------------------------------------------
function validateCompanyInput(name, fiscal_data) {
  if (!name || typeof name !== "string" || name.trim().length === 0) {
    return "El campo 'name' es requerido";
  }

  if (!fiscal_data || typeof fiscal_data !== "object") {
    return "El campo 'fiscal_data' es requerido y debe ser un objeto";
  }

  if (!fiscal_data.razonSocial || fiscal_data.razonSocial.trim().length === 0) {
    return "El campo 'razonSocial' es requerido en fiscal_data";
  }

  if (!fiscal_data.numeroIdentificacionFiscal || fiscal_data.numeroIdentificacionFiscal.trim().length === 0) {
    return "El campo 'numeroIdentificacionFiscal' es requerido en fiscal_data";
  }

  if (!fiscal_data.domicilioFiscal) {
    return "El campo 'domicilioFiscal' es requerido en fiscal_data";
  }

  const { calle, codigoPostal, localidad, provincia } = fiscal_data.domicilioFiscal;
  if (!calle || !codigoPostal || !localidad || !provincia) {
    return "domicilioFiscal requiere: calle, codigoPostal, localidad, provincia";
  }

  if (!fiscal_data.actividadEconomica?.descripcion) {
    return "El campo 'actividadEconomica.descripcion' es requerido en fiscal_data";
  }

  const regimenesValidos = [
    "Responsable Inscripto",
    "Monotributo",
    "Exento",
    "Simplificado",
    "Régimen General",
    "Pequeño Contribuyente",
    "Otro",
  ];

  if (!regimenesValidos.includes(fiscal_data.regimenFiscal)) {
    return `regimenFiscal debe ser uno de: ${regimenesValidos.join(", ")}`;
  }

  return null;
}
