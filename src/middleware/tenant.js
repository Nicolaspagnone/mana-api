const { resolveTenantByDomain, resolveTenantById } = require('../utils/tenantQuery');

/**
 * Middleware multi-tenant.
 *
 * Estrategia de resolución:
 *   - Localhost/dev  → DEV_TENANT (.env) o ?__tenant= (query param)
 *   - Producción     → X-Tenant-Id header validado contra Firestore
 *                      + cross-check opcional con Origin header del browser
 *
 * Setea req.tenantId y req.tenant antes de llegar a cualquier ruta.
 */
async function tenantMiddleware(req, res, next) {
  try {
    const host = req.hostname;

    // ── Desarrollo local ──────────────────────────────────
    if (host === 'localhost' || host === '127.0.0.1') {
      const devDomain = process.env.DEV_TENANT || req.query.__tenant;
      if (!devDomain) {
        return res.status(400).json({
          error: 'DEV_TENANT no configurado. Agregalo al .env o usá ?__tenant=tudominio.app'
        });
      }
      const tenant = await resolveTenantByDomain(devDomain);
      if (!tenant || !tenant.active) {
        return res.status(403).json({ error: `Tenant "${devDomain}" no encontrado o inactivo` });
      }
      req.tenantId = tenant.id;
      req.tenant   = tenant;
      return next();
    }

    // ── Producción ────────────────────────────────────────
    const headerTenantId = req.headers['x-tenant-id'];
    if (!headerTenantId) {
      return res.status(400).json({ error: 'Header X-Tenant-Id requerido' });
    }

    // Validar el tenantId contra Firestore (no ciega confianza en el header)
    const tenant = await resolveTenantById(headerTenantId);
    if (!tenant || !tenant.active) {
      return res.status(403).json({ error: 'Tenant no válido o inactivo' });
    }

    // Cross-check con Origin header del browser (seguridad adicional)
    // Si el Origin está presente y su dominio resuelve a un tenant distinto → rechazar
    const origin = req.headers['origin'];
    if (origin) {
      try {
        const originDomain = new URL(origin).hostname;
        // Solo validar si el origin NO es el mismo backend ni localhost
        if (originDomain !== host && originDomain !== 'localhost') {
          const tenantByOrigin = await resolveTenantByDomain(originDomain);
          if (tenantByOrigin && tenantByOrigin.id !== headerTenantId) {
            console.warn(`[Tenant] Mismatch: X-Tenant-Id=${headerTenantId} Origin tenant=${tenantByOrigin.id}`);
            return res.status(403).json({ error: 'Tenant mismatch entre header y origin' });
          }
        }
      } catch {
        // Origin malformado — ignorar, no bloquear
      }
    }

    req.tenantId = tenant.id;
    req.tenant   = tenant;
    next();
  } catch (err) {
    console.error('[Tenant] Error en middleware:', err.message);
    res.status(500).json({ error: 'Error al resolver tenant' });
  }
}

module.exports = { tenantMiddleware };
