/**
 * /api/company/[id]
 *
 * PUT → Actualiza nombre y/o fiscal_data de una empresa existente.
 *       Solo puede hacerlo el owner o un admin de esa empresa.
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
// PUT /api/company/[id]
// ---------------------------------------------------------------------------
export async function onRequestPut({ request, env, params }) {
  const { payload, error } = extractAuth(request);
  if (error) return error;

  const userId    = payload.sub;
  const companyId = params.id;

  if (!companyId) {
    return new Response(
      JSON.stringify({ error: "ID de empresa requerido" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // ── Verificar que el usuario tiene permisos sobre esta empresa ─────────
  const membership = await env.DB.prepare(`
    SELECT role FROM profile_company
    WHERE profile_id = ? AND company_id = ?
  `).bind(userId, companyId).first();

  if (!membership) {
    return new Response(
      JSON.stringify({ error: "Empresa no encontrada o sin permisos" }),
      { status: 403, headers: { "Content-Type": "application/json" } }
    );
  }

  if (!["owner", "admin"].includes(membership.role)) {
    return new Response(
      JSON.stringify({ error: "No tenés permisos para editar esta empresa" }),
      { status: 403, headers: { "Content-Type": "application/json" } }
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

  if (!name && !fiscal_data) {
    return new Response(
      JSON.stringify({ error: "Se requiere al menos 'name' o 'fiscal_data' para actualizar" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  if (fiscal_data) {
    const validationError = validateFiscalData(fiscal_data);
    if (validationError) {
      return new Response(
        JSON.stringify({ error: validationError }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }
  }

  // ── Construir UPDATE dinámico ─────────────────────────────────────────
  const now    = Math.floor(Date.now() / 1000);
  const fields = [];
  const values = [];

  if (name && typeof name === "string" && name.trim().length > 0) {
    fields.push("name = ?");
    values.push(name.trim());
  }

  if (fiscal_data) {
    fields.push("fiscal_data = ?");
    values.push(JSON.stringify(fiscal_data));
  }

  fields.push("updated_at = ?");
  values.push(now);
  values.push(companyId);

  try {
    await env.DB.prepare(`
      UPDATE company SET ${fields.join(", ")} WHERE id = ?
    `).bind(...values).run();
  } catch (err) {
    console.error("Error al actualizar empresa:", err);
    return new Response(
      JSON.stringify({ error: "Error al actualizar la empresa" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  const updated = await env.DB.prepare(`
    SELECT id, name, fiscal_data, logo_url, updated_at FROM company WHERE id = ?
  `).bind(companyId).first();

  return new Response(
    JSON.stringify({
      company: {
        ...updated,
        fiscal_data: updated.fiscal_data ? JSON.parse(updated.fiscal_data) : null,
      },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------
function validateFiscalData(fiscal_data) {
  if (typeof fiscal_data !== "object") return "'fiscal_data' debe ser un objeto";
  if (!fiscal_data.razonSocial?.trim()) return "'razonSocial' es requerido";
  if (!fiscal_data.numeroIdentificacionFiscal?.trim()) return "'numeroIdentificacionFiscal' es requerido";
  if (!fiscal_data.domicilioFiscal) return "'domicilioFiscal' es requerido";
  const { calle, codigoPostal, localidad, provincia } = fiscal_data.domicilioFiscal;
  if (!calle || !codigoPostal || !localidad || !provincia) {
    return "domicilioFiscal requiere: calle, codigoPostal, localidad, provincia";
  }
  if (!fiscal_data.actividadEconomica?.descripcion) return "'actividadEconomica.descripcion' es requerido";
  const regimenesValidos = [
    "Responsable Inscripto", "Monotributo", "Exento",
    "Simplificado", "Régimen General", "Pequeño Contribuyente", "Otro",
  ];
  if (!regimenesValidos.includes(fiscal_data.regimenFiscal)) {
    return `regimenFiscal debe ser uno de: ${regimenesValidos.join(", ")}`;
  }
  return null;
}
