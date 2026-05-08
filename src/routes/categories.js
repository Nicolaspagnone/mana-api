const express = require('express');
const router = express.Router();
const { db } = require('../firebase');
const { requireAdmin } = require('../middleware/auth');
const { tenantQuery, assertTenantOwnership } = require('../utils/tenantQuery');

const COL = 'categories';

// GET /api/categories – público (para el front)
router.get('/', async (req, res, next) => {
  try {
    const snap = await tenantQuery(COL, req.tenantId).get();
    const data = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    res.json(data);
  } catch (err) { next(err); }
});

// GET /api/categories/:id – público
router.get('/:id', async (req, res, next) => {
  try {
    const data = await assertTenantOwnership(COL, req.params.id, req.tenantId);
    if (data === null)  return res.status(404).json({ error: 'Categoría no encontrada' });
    if (data === false) return res.status(404).json({ error: 'Categoría no encontrada' });
    res.json(data);
  } catch (err) { next(err); }
});

// POST /api/categories – admin
router.post('/', requireAdmin, async (req, res, next) => {
  try {
    const { name, slug, emoji, order = 0, active = true } = req.body;
    if (!name || !slug) return res.status(400).json({ error: 'name y slug son requeridos' });
    const docRef = await db.collection(COL).add({
      tenantId: req.tenantId,
      name, slug, emoji: emoji || '🍽️', order, active,
      createdAt: new Date().toISOString()
    });
    res.status(201).json({ id: docRef.id, name, slug, emoji, order, active });
  } catch (err) { next(err); }
});

// PUT /api/categories/:id – admin
router.put('/:id', requireAdmin, async (req, res, next) => {
  try {
    const existing = await assertTenantOwnership(COL, req.params.id, req.tenantId);
    if (existing === null)  return res.status(404).json({ error: 'Categoría no encontrada' });
    if (existing === false) return res.status(403).json({ error: 'Acceso denegado' });

    const { name, slug, emoji, order, active } = req.body;
    const ref = db.collection(COL).doc(req.params.id);
    const update = { updatedAt: new Date().toISOString() };
    if (name !== undefined) update.name = name;
    if (slug !== undefined) update.slug = slug;
    if (emoji !== undefined) update.emoji = emoji;
    if (order !== undefined) update.order = order;
    if (active !== undefined) update.active = active;
    await ref.update(update);
    res.json({ id: req.params.id, ...existing, ...update });
  } catch (err) { next(err); }
});

// DELETE /api/categories/:id – admin
router.delete('/:id', requireAdmin, async (req, res, next) => {
  try {
    const existing = await assertTenantOwnership(COL, req.params.id, req.tenantId);
    if (existing === null)  return res.status(404).json({ error: 'Categoría no encontrada' });
    if (existing === false) return res.status(403).json({ error: 'Acceso denegado' });

    // Verificar que no tenga productos asociados en este tenant
    const prods = await tenantQuery('products', req.tenantId)
      .where('categoryId', '==', req.params.id).limit(1).get();
    if (!prods.empty) {
      return res.status(400).json({ error: 'No se puede eliminar: tiene productos asociados.' });
    }
    await db.collection(COL).doc(req.params.id).delete();
    res.json({ message: 'Categoría eliminada' });
  } catch (err) { next(err); }
});

module.exports = router;
