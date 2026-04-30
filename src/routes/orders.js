const express = require('express');
const router = express.Router();
const { db } = require('../firebase');
const { requireAdmin, requireAuth } = require('../middleware/auth');

const COL = 'orders';

// Estado machine – sin "confirmed"
const VALID_TRANSITIONS = {
  pending:   ['preparing', 'cancelled', 'expired'],
  preparing: ['ready', 'cancelled'],
  ready:     ['delivered', 'cancelled'],
  delivered: [],
  cancelled: [],
  expired:   []
};

const FINAL_STATUSES = ['delivered', 'cancelled', 'expired'];

// Métodos de pago válidos
const VALID_PAYMENT_METHODS = ['efectivo', 'transferencia', 'tarjeta', 'mercadopago'];

// POST /api/orders – público (web orders) + local orders via cpanel
router.post('/', async (req, res, next) => {
  try {
    const { customer, items, deliveryType, address, total, status, channel, paymentMethod, storeId, storeName } = req.body;
    if (!customer?.firstName || !customer?.phone || !items?.length) {
      return res.status(400).json({ error: 'Datos del pedido incompletos' });
    }

    // Local orders: delivered immediately, channel = local
    const isLocal = deliveryType === 'local';
    const order = {
      customer: {
        firstName: customer.firstName,
        lastName: customer.lastName || '',
        phone: customer.phone || '-',
        address: customer.address || address || '-',
        housingType: customer.housingType || 'house',
        apartmentDetails: customer.apartmentDetails || ''
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
      status: isLocal ? 'delivered' : 'pending',
      channel: channel || (isLocal ? 'local' : 'web'),
      paymentMethod: VALID_PAYMENT_METHODS.includes(paymentMethod) ? paymentMethod : 'efectivo',
      storeId: storeId || null,
      storeName: storeName || null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const docRef = await db.collection(COL).add(order);
    res.status(201).json({ id: docRef.id, ...order });
  } catch (err) { next(err); }
});

// GET /api/orders – requiere auth
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const { status, limit = 200, storeId } = req.query;
    let query = db.collection(COL).orderBy('createdAt', 'desc').limit(Number(limit));
    if (status) {
      query = db.collection(COL)
        .where('status', '==', status)
        .orderBy('createdAt', 'desc')
        .limit(Number(limit));
    }
    const snap = await query.get();
    let data = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    // Filtrar por local si se pasa storeId
    if (storeId) {
      data = data.filter(o => o.storeId === storeId);
    }

    const ONE_HOUR = 60 * 60 * 1000;
    const TWO_HOURS = 2 * 60 * 60 * 1000;
    const now = Date.now();

    // Auto-expirar pendientes sin gestión > 1h
    // Auto-cancelar preparando/listo sin actualización > 2h
    const toExpire = [];
    const toCancel = [];

    for (const o of data) {
      const age = now - new Date(o.createdAt).getTime();
      const lastUpdate = now - new Date(o.updatedAt || o.createdAt).getTime();

      if (o.status === 'pending' && age > ONE_HOUR) {
        toExpire.push(o);
      } else if ((o.status === 'preparing' || o.status === 'ready') && lastUpdate > TWO_HOURS) {
        toCancel.push(o);
      }
    }

    if (toExpire.length > 0 || toCancel.length > 0) {
      const batch = db.batch();
      const nowISO = new Date().toISOString();

      for (const o of toExpire) {
        batch.update(db.collection(COL).doc(o.id), { status: 'expired', updatedAt: nowISO });
        o.status = 'expired';
        o.updatedAt = nowISO;
      }
      for (const o of toCancel) {
        batch.update(db.collection(COL).doc(o.id), { status: 'cancelled', updatedAt: nowISO });
        o.status = 'cancelled';
        o.updatedAt = nowISO;
      }
      await batch.commit();
    }

    data.sort((a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

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

    if (FINAL_STATUSES.includes(currentStatus)) {
      return res.status(400).json({
        error: `El estado "${currentStatus}" es final y no puede modificarse`
      });
    }

    const allowed = VALID_TRANSITIONS[currentStatus] || [];
    if (!allowed.includes(status)) {
      return res.status(400).json({
        error: `No se puede pasar de "${currentStatus}" a "${status}". Permitidas: ${allowed.join(', ') || 'ninguna'}`
      });
    }
    await ref.update({ status, updatedAt: new Date().toISOString() });
    res.json({ id: req.params.id, status });
  } catch (err) { next(err); }
});

module.exports = router;
