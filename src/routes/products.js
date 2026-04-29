const express = require('express');
const router = express.Router();
const { db } = require('../firebase');
const { requireAdmin } = require('../middleware/auth');

const COL = 'products';

// GET /api/products – público
router.get('/', async (req, res, next) => {
  try {
    let query = db.collection(COL);
    const { categoryId, available } = req.query;
    if (categoryId) query = query.where('categoryId', '==', categoryId);
    if (available === 'true') query = query.where('available', '==', true);
    const snap = await query.orderBy('order').get();
    const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    res.json(data);
  } catch (err) { next(err); }
});

// GET /api/products/:id – público
router.get('/:id', async (req, res, next) => {
  try {
    const doc = await db.collection(COL).doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ error: 'Producto no encontrado' });
    res.json({ id: doc.id, ...doc.data() });
  } catch (err) { next(err); }
});

// POST /api/products – admin
router.post('/', requireAdmin, async (req, res, next) => {
  try {
    const {
      name, description, price, categoryId,
      img = '', popular = false, available = true, order = 0,
      discountPct = 0
    } = req.body;
    if (!name || !price || !categoryId) {
      return res.status(400).json({ error: 'name, price y categoryId son requeridos' });
    }
    const catDoc = await db.collection('categories').doc(categoryId).get();
    if (!catDoc.exists) return res.status(400).json({ error: 'Categoría no encontrada' });

    const discount = Math.min(50, Math.max(0, Number(discountPct) || 0));

    const docRef = await db.collection(COL).add({
      name, description: description || '', price: Number(price),
      categoryId, img, popular, available, order: Number(order),
      discountPct: discount,
      createdAt: new Date().toISOString()
    });
    res.status(201).json({ id: docRef.id, name, price, categoryId, discountPct: discount });
  } catch (err) { next(err); }
});

// PUT /api/products/:id – admin
router.put('/:id', requireAdmin, async (req, res, next) => {
  try {
    const ref = db.collection(COL).doc(req.params.id);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ error: 'Producto no encontrado' });

    const allowed = ['name','description','price','categoryId','img','popular','available','order','discountPct'];
    const update = { updatedAt: new Date().toISOString() };
    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        if (key === 'price' || key === 'order') update[key] = Number(req.body[key]);
        else if (key === 'discountPct') update[key] = Math.min(50, Math.max(0, Number(req.body[key]) || 0));
        else update[key] = req.body[key];
      }
    }
    if (update.categoryId) {
      const catDoc = await db.collection('categories').doc(update.categoryId).get();
      if (!catDoc.exists) return res.status(400).json({ error: 'Categoría no encontrada' });
    }
    await ref.update(update);
    res.json({ id: req.params.id, ...doc.data(), ...update });
  } catch (err) { next(err); }
});

// PATCH /api/products/:id/toggle – admin
router.patch('/:id/toggle', requireAdmin, async (req, res, next) => {
  try {
    const ref = db.collection(COL).doc(req.params.id);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ error: 'Producto no encontrado' });
    const newVal = !doc.data().available;
    await ref.update({ available: newVal, updatedAt: new Date().toISOString() });
    res.json({ id: req.params.id, available: newVal });
  } catch (err) { next(err); }
});

// DELETE /api/products/:id – admin
router.delete('/:id', requireAdmin, async (req, res, next) => {
  try {
    const ref = db.collection(COL).doc(req.params.id);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ error: 'Producto no encontrado' });
    await ref.delete();
    res.json({ message: 'Producto eliminado' });
  } catch (err) { next(err); }
});

module.exports = router;
