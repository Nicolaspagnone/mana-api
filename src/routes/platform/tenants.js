const express = require('express');
const { requirePlatformAdmin } = require('../../middleware/platformAuth');
const {
  createTenant,
  listTenants,
  getTenant,
  updateTenant,
  setTenantActive,
} = require('../../services/tenantService');

const router = express.Router();

// Todos los endpoints requieren platform admin
router.use(requirePlatformAdmin);

/**
 * GET /api/platform/tenants
 * Lista todos los tenants.
 */
router.get('/', async (req, res, next) => {
  try {
    const tenants = await listTenants();
    res.json(tenants);
  } catch (err) { next(err); }
});

/**
 * GET /api/platform/tenants/:id
 * Obtiene un tenant por ID.
 */
router.get('/:id', async (req, res, next) => {
  try {
    const tenant = await getTenant(req.params.id);
    if (!tenant) return res.status(404).json({ error: 'Tenant no encontrado' });
    res.json(tenant);
  } catch (err) { next(err); }
});

/**
 * POST /api/platform/tenants
 * Crea un nuevo tenant + usuario admin + settings iniciales.
 * Body: { id, name, domain, plan, primaryColor, logoUrl, mercadopago, multiStore, adminUser, adminPass }
 */
router.post('/', async (req, res, next) => {
  try {
    const tenant = await createTenant(req.body);
    res.status(201).json(tenant);
  } catch (err) {
    if (err.code === 'DUPLICATE_ID')     return res.status(409).json({ error: err.message });
    if (err.code === 'DUPLICATE_DOMAIN') return res.status(409).json({ error: err.message });
    next(err);
  }
});

/**
 * PUT /api/platform/tenants/:id
 * Actualiza campos del tenant (name, domain, plan, theme, features, logoUrl).
 * No cambia el usuario admin.
 */
router.put('/:id', async (req, res, next) => {
  try {
    // Campos permitidos para actualizar
    const allowed = ['name', 'domain', 'plan', 'logoUrl', 'theme', 'features'];
    const updates = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }

    const tenant = await updateTenant(req.params.id, updates);
    res.json(tenant);
  } catch (err) {
    if (err.code === 'NOT_FOUND')        return res.status(404).json({ error: err.message });
    if (err.code === 'DUPLICATE_DOMAIN') return res.status(409).json({ error: err.message });
    next(err);
  }
});

/**
 * PATCH /api/platform/tenants/:id/suspend
 * Suspende el tenant (active: false).
 */
router.patch('/:id/suspend', async (req, res, next) => {
  try {
    const tenant = await setTenantActive(req.params.id, false);
    res.json({ message: 'Tenant suspendido', tenant });
  } catch (err) {
    if (err.code === 'NOT_FOUND') return res.status(404).json({ error: err.message });
    next(err);
  }
});

/**
 * PATCH /api/platform/tenants/:id/activate
 * Reactiva el tenant (active: true).
 */
router.patch('/:id/activate', async (req, res, next) => {
  try {
    const tenant = await setTenantActive(req.params.id, true);
    res.json({ message: 'Tenant activado', tenant });
  } catch (err) {
    if (err.code === 'NOT_FOUND') return res.status(404).json({ error: err.message });
    next(err);
  }
});

module.exports = router;
