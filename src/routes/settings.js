const express = require('express');
const router = express.Router();
const { db } = require('../firebase');
const { requireAdmin } = require('../middleware/auth');

const ALLOWED_FIELDS = ['storeSelectionEnabled'];

function settingsRef(tenantId) {
  return db.collection('settings').doc(tenantId);
}

// GET /api/settings – público
router.get('/', async (req, res, next) => {
  try {
    const snap = await settingsRef(req.tenantId).get();
    const data = snap.exists ? snap.data() : {};
    res.json({ storeSelectionEnabled: !!data.storeSelectionEnabled });
  } catch (err) { next(err); }
});

// GET /api/settings/admin – solo admin
router.get('/admin', requireAdmin, async (req, res, next) => {
  try {
    const snap = await settingsRef(req.tenantId).get();
    const data = snap.exists ? snap.data() : {};
    res.json({ storeSelectionEnabled: !!data.storeSelectionEnabled });
  } catch (err) { next(err); }
});

// PUT /api/settings – solo admin
router.put('/', requireAdmin, async (req, res, next) => {
  try {
    const update = {};
    for (const key of ALLOWED_FIELDS) {
      if (req.body[key] !== undefined) update[key] = req.body[key];
    }
    if (Object.keys(update).length === 0) {
      return res.status(400).json({ error: 'No se enviaron campos válidos' });
    }
    await settingsRef(req.tenantId).set(update, { merge: true });
    const snap = await settingsRef(req.tenantId).get();
    const data = snap.data() || {};
    res.json({ storeSelectionEnabled: !!data.storeSelectionEnabled });
  } catch (err) { next(err); }
});

module.exports = router;
