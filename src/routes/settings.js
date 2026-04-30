const express = require('express');
const router = express.Router();
const { db } = require('../firebase');
const { requireAdmin } = require('../middleware/auth');

const DOC = 'config/site';

// Valores por defecto
const DEFAULTS = {
  whatsappPhone: '5493516361785',
  whatsappPhone2: '5493516361785',
  scheduleWeekdays: 'Lun-Vie: 11:00 - 23:00',
  scheduleSaturday: 'Sábados: 11:00 - 24:00',
  scheduleSunday: 'Domingos: 12:00 - 22:00',
  footerTagline: 'El sabor que te nutre el alma 🍕',
  instagramUrl: 'https://www.instagram.com/manaempanadas/',
  facebookUrl: 'https://facebook.com',
  deliveryRadius: '~5km desde cada local',
};

// GET /api/settings – público (el front lo necesita)
router.get('/', async (req, res, next) => {
  try {
    const ref = db.doc(DOC);
    const snap = await ref.get();
    if (!snap.exists) {
      // Inicializar con defaults
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
