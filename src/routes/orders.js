const express = require('express');
const router = express.Router();
const { db } = require('../firebase');
const { requireAdmin, requireAuth } = require('../middleware/auth');

const COL = 'orders';

// Estado machine: qué transiciones están permitidas
const VALID_TRANSITIONS = {
  pending:   ['confirmed', 'cancelled'],
  confirmed: ['preparing', 'cancelled'],
  preparing: ['ready', 'cancelled'],
  ready:     ['delivered'],
  delivered: [],   // estado final
  cancelled: []    // estado final
};

// POST /api/orders – público
router.post('/', async (req, res, next) => {
  try {
    const { customer, items, deliveryType, address, total } = req.body;

    if (!customer?.firstName || !customer?.phone || !items?.length) {
      return res.status(400).json({ error: 'Datos del pedido incompletos' });
    }

    const order = {
      customer: {
        firstName: customer.firstName,
        lastName: customer.lastName || '',
        phone: customer.phone,
        address: address || ''
      },
      items: items.map(i => ({
        productId: i.productId,
        productName: i.productName,
        quantity: Number(i.quantity),
        unitPrice: Number(i.unitPrice),
        discountPct: Number(i.discountPct || 0),
        subtotal: Number(i.subtotal)
      })),
      deliveryType: deliveryType || 'pickup',
      total: Number(total),
      status: 'pending',
      channel: 'web',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const docRef = await db.collection(COL).add(order);
    res.status(201).json({ id: docRef.id, ...order });
  } catch (err) { next(err); }
});

// GET /api/orders – requiere auth (cualquier usuario)
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const { status, limit = 50 } = req.query;
    let query = db.collection(COL).orderBy('createdAt', 'desc').limit(Number(limit));
    if (status) query = db.collection(COL).where('status', '==', status).orderBy('createdAt', 'desc').limit(Number(limit));
    const snap = await query.get();
    const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    res.json(data);
  } catch (err) { next(err); }
});

// GET /api/orders/:id – requiere auth
router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const doc = await db.collection(COL).doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ error: 'Pedido no encontrado' });
    res.json({ id: doc.id, ...doc.data() });
  } catch (err) { next(err); }
});

// PATCH /api/orders/:id/status – requiere auth + state machine
router.patch('/:id/status', requireAuth, async (req, res, next) => {
  try {
    const { status } = req.body;
    const ref = db.collection(COL).doc(req.params.id);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ error: 'Pedido no encontrado' });

    const currentStatus = doc.data().status;
    const allowed = VALID_TRANSITIONS[currentStatus] || [];

    if (!allowed.includes(status)) {
      return res.status(400).json({
        error: `No se puede pasar de "${currentStatus}" a "${status}". Transiciones permitidas: ${allowed.join(', ') || 'ninguna (estado final)'}`
      });
    }

    await ref.update({ status, updatedAt: new Date().toISOString() });
    res.json({ id: req.params.id, status });
  } catch (err) { next(err); }
});

module.exports = router;
