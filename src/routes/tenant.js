const express = require('express');
const router  = express.Router();
const { resolveTenantByDomainAny } = require('../utils/tenantQuery');

/**
 * GET /api/tenant/by-domain?domain=manaempanadas.app
 *
 * Endpoint público — excluido del tenantMiddleware.
 * El frontend lo llama al iniciar usando window.location.hostname.
 *
 * En desarrollo local el frontend envía domain=localhost o 127.0.0.1;
 * resolvemos contra DEV_TENANT para que features/theme/logo estén disponibles.
 */
router.get('/by-domain', async (req, res, next) => {
  try {
    let { domain } = req.query;
    if (!domain) return res.status(400).json({ error: 'Parámetro domain requerido' });

    // En dev local redirigir al tenant configurado en DEV_TENANT
    if (domain === 'localhost' || domain === '127.0.0.1') {
      const devDomain = process.env.DEV_TENANT;
      if (!devDomain) {
        return res.status(404).json({ error: 'DEV_TENANT no configurado en .env' });
      }
      domain = devDomain;
    }

    // Usamos la consulta sin filtro active para poder detectar suspensión
    const tenant = await resolveTenantByDomainAny(domain);
    if (!tenant) return res.status(404).json({ error: 'Tenant no encontrado para ese dominio' });

    // Tenant suspendido → 403 con flag para que el frontend muestre pantalla específica
    if (tenant.active === false) {
      return res.status(403).json({ suspended: true, error: 'Cuenta suspendida. Contactá al soporte.' });
    }

    // Solo exponer campos públicos — nunca secrets ni limits internos sensibles
    const { id, name, domain: d, plan, features, theme, logoUrl } = tenant;
    res.json({
      tenantId: id,
      name,
      domain:   d,
      plan:     plan || 'free',
      features: features || {},
      theme:    theme   || {},
      logoUrl:  logoUrl || null,
    });
  } catch (err) { next(err); }
});

module.exports = router;
