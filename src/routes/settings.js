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
  storeLat: -31.4201,
  storeLng: -64.1888,
};

const rainCache = { value: null, expiry: 0 };
const holidayCache = { value: null, expiry: 0 };

async function fetchEsLluvia(lat, lng) {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=precipitation&timezone=America%2FArgentina%2FBuenos_Aires`;
    const res = await fetch(url);
    if (!res.ok) return false;
    const data = await res.json();
    return (data?.current?.precipitation ?? 0) > 0.2;
  } catch {
    return false;
  }
}

async function fetchEsFeriado() {
  const hoy = new Date();
  const year = hoy.getFullYear();
  const fechaHoy = `${year}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;
  try {
    const snap = await db.collection('feriados').where('date', '==', fechaHoy).limit(1).get();
    if (!snap.empty) return true;
  } catch { /* fallback a API */ }
  try {
    const res = await fetch(`https://date.nager.at/api/v3/PublicHolidays/${year}/AR`);
    if (!res.ok) return false;
    const feriados = await res.json();
    return feriados.some(f => f.date === fechaHoy);
  } catch {
    return false;
  }
}

async function getEsLluvia(lat, lng) {
  const now = Date.now();
  if (rainCache.value !== null && now < rainCache.expiry) return rainCache.value;
  const result = await fetchEsLluvia(lat, lng);
  rainCache.value = result;
  rainCache.expiry = now + 10 * 60 * 1000;
  return result;
}

async function getEsFeriado() {
  const now = Date.now();
  if (holidayCache.value !== null && now < holidayCache.expiry) return holidayCache.value;
  const result = await fetchEsFeriado();
  holidayCache.value = result;
  holidayCache.expiry = now + 24 * 60 * 60 * 1000;
  return result;
}

// GET /api/settings – público
router.get('/', async (req, res, next) => {
  try {
    const ref = db.doc(DOC);
    const snap = await ref.get();
    if (!snap.exists) await ref.set(DEFAULTS);
    const data = { ...DEFAULTS, ...(snap.exists ? snap.data() : {}) };
    delete data.mercadopagoAccessToken;
    const lat = data.storeLat ?? DEFAULTS.storeLat;
    const lng = data.storeLng ?? DEFAULTS.storeLng;
    const [esLluvia, esFeriado] = await Promise.all([getEsLluvia(lat, lng), getEsFeriado()]);
    res.json({ ...data, esLluvia, esFeriado });
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
