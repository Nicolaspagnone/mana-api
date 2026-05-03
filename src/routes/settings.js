const express = require('express');
const router = express.Router();
const { db } = require('../firebase');
const { requireAdmin } = require('../middleware/auth');

const DOC = 'config/site';

const DEFAULTS = {
  whatsappPhone: '5493516361785',
  whatsappPhone2: '5493516361785',
  footerTagline: 'El sabor que te nutre el alma 🍕',
  instagramUrl: 'https://www.instagram.com/manaempanadas/',
  facebookUrl: 'https://facebook.com',
  deliveryRadius: '~5km desde cada local',
  mercadopagoAlias: '',
  mercadopagoPublicKey: '',
  mercadopagoAccessToken: '',
  mercadopagoTestMode: false,
  transferAlias: '',
  storeSelectionEnabled: false,
};

// GET /api/settings – público
router.get('/', async (req, res, next) => {
  try {
    const ref = db.doc(DOC);
    const snap = await ref.get();
    if (!snap.exists) {
      await ref.set(DEFAULTS);
      return res.json(DEFAULTS);
    }
    const data = { ...DEFAULTS, ...snap.data() };
    // No exponer el access token en el endpoint público
    delete data.mercadopagoAccessToken;
    res.json(data);
  } catch (err) { next(err); }
});

// GET /api/settings/admin – solo admin (incluye access token)
router.get('/admin', requireAdmin, async (req, res, next) => {
  try {
    const ref = db.doc(DOC);
    const snap = await ref.get();
    if (!snap.exists) {
      await ref.set(DEFAULTS);
      return res.json(DEFAULTS);
    }
    res.json({ ...DEFAULTS, ...snap.data() });
  } catch (err) { next(err); }
});

// PUT /api/settings – solo admin
router.put('/', requireAdmin, async (req, res, next) => {
  try {
    const allowed = Object.keys(DEFAULTS);
    const update = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) update[key] = req.body[key];
    }
    if (Object.keys(update).length === 0) {
      return res.status(400).json({ error: 'No se enviaron campos válidos' });
    }
    const ref = db.doc(DOC);
    await ref.set(update, { merge: true });
    const snap = await ref.get();
    res.json({ ...DEFAULTS, ...snap.data() });
  } catch (err) { next(err); }
});

module.exports = router;
