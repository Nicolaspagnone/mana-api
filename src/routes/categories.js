const express = require('express');
const router = express.Router();
const { db } = require('../firebase');
const { requireAdmin } = require('../middleware/auth');

const COL = 'categories';

// GET /api/categories – público (para el front)
router.get('/', async (req, res, next) => {
  try {
    const snap = await db.collection(COL).orderBy('order').get();
    const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    res.json(data);
  } catch (err) { next(err); }
});

// GET /api/categories/:id – público
router.get('/:id', async (req, res, next) => {
  try {
    const doc = await db.collection(COL).doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ error: 'Categoría no encontrada' });
    res.json({ id: doc.id, ...doc.data() });
  } catch (err) { next(err); }
});

// POST /api/categories – admin
router.post('/', requireAdmin, async (req, res, next) => {
  try {
    const { name, slug, emoji, order = 0, active = true } = req.body;
    if (!name || !slug) return res.status(400).json({ error: 'name y slug son requeridos' });
    const docRef = await db.collection(COL).add({
      name, slug, emoji: emoji || '🍽️', order, active,
      createdAt: new Date().toISOString()
    });
    res.status(201).json({ id: docRef.id, name, slug, emoji, order, active });
  } catch (err) { next(err); }
});

// PUT /api/categories/:id – admin
router.put('/:id', requireAdmin, async (req, res, next) => {
  try {
    const { name, slug, emoji, order, active } = req.body;
    const ref = db.collection(COL).doc(req.params.id);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ error: 'Categoría no encontrada' });
    const update = { updatedAt: new Date().toISOString() };
    if (name !== undefined) update.name = name;
    if (slug !== undefined) update.slug = slug;
    if (emoji !== undefined) update.emoji = emoji;
    if (order !== undefined) update.order = order;
    if (active !== undefined) update.active = active;
    await ref.update(update);
    res.json({ id: req.params.id, ...doc.data(), ...update });
  } catch (err) { next(err); }
});

// DELETE /api/categories/:id – admin
router.delete('/:id', requireAdmin, async (req, res, next) => {
  try {
    const ref = db.collection(COL).doc(req.params.id);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ error: 'Categoría no encontrada' });
    // Verificar que no tenga productos asociados
    const prods = await db.collection('products').where('categoryId', '==', req.params.id).limit(1).get();
    if (!prods.empty) {
      return res.status(400).json({ error: 'No se puede eliminar: tiene productos asociados.' });
    }
    await ref.delete();
    res.json({ message: 'Categoría eliminada' });
  } catch (err) { next(err); }
});

module.exports = router;
