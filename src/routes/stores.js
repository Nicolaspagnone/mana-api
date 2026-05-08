const express = require('express');
const router = express.Router();
const { db } = require('../firebase');
const { requireAdmin, requireAuth } = require('../middleware/auth');
const { tenantQuery, assertTenantOwnership } = require('../utils/tenantQuery');

const COL = 'stores';

const DEFAULT_LAT = -31.4201;
const DEFAULT_LNG = -64.1888;

const SHIPPING_DEFAULTS = {
  costo_envio: 0,
  radio_envio: 5,
  base_km: 2,
  step_km: 0.5,
  step_price: 500,
  rain_extra: 500,
  holiday_extra: 700
};

// ── Weather / Holiday helpers ─────────────────────────────
const rainCacheByStore = new Map(); // storeId -> { value, expiry }
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

async function getEsLluvia(storeId, lat, lng) {
  const now = Date.now();
  const cached = rainCacheByStore.get(storeId);
  if (cached && now < cached.expiry) return cached.value;
  const result = await fetchEsLluvia(lat, lng);
  rainCacheByStore.set(storeId, { value: result, expiry: now + 10 * 60 * 1000 });
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

function stripSensitive(store) {
  const { mercadopagoAccessToken, ...safe } = store;
  return safe;
}

// ── Routes ────────────────────────────────────────────────

// GET /api/stores – público
router.get('/', async (req, res, next) => {
  try {
    const snap = await tenantQuery(COL, req.tenantId).get();

    if (snap.empty) {
      // Inicializar con los dos locales default
      const defaults = [
        {
          tenantId: req.tenantId,
          name: 'Local Urquiza',
          address: 'Urquiza 2041',
          addressFull: 'Justo José de Urquiza 2041, X5001 Córdoba',
          phone: '5493516361785',
          mapUrl: 'https://www.google.com/maps/search/?api=1&query=Justo+José+de+Urquiza+2041+Córdoba+Argentina',
          mapImg: 'https://i.postimg.cc/SnwrWdV5/mapa1.jpg',
          emoji: '🏬',
          scheduleWeekdays: 'Lun-Vie: 11:00 - 23:00',
          scheduleSaturday: 'Sábados: 11:00 - 24:00',
          scheduleSunday: 'Domingos: 12:00 - 22:00',
          ...SHIPPING_DEFAULTS,
          order: 1,
          active: true,
          isDefault: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        {
          name: 'FoodTruck',
          address: 'José Baigorri 690',
          addressFull: 'José Baigorri 690, X5000 Córdoba',
          phone: '5493516361785',
          mapUrl: 'https://www.google.com/maps/search/?api=1&query=José+Baigorri+690+Córdoba+Argentina',
          mapImg: 'https://i.postimg.cc/SnwrWdV5/mapa1.jpg',
          emoji: '🏪',
          scheduleWeekdays: 'Lun-Vie: 11:00 - 23:00',
          scheduleSaturday: 'Sábados: 11:00 - 24:00',
          scheduleSunday: 'Domingos: 12:00 - 22:00',
          ...SHIPPING_DEFAULTS,
          order: 2,
          active: true,
          isDefault: false,
          tenantId: req.tenantId,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ];
      const batch = db.batch();
      const results = [];
      for (const s of defaults) {
        const ref = db.collection(COL).doc();
        batch.set(ref, s);
        results.push({ id: ref.id, ...s });
      }
      await batch.commit();
      // Inject weather for defaults
      const esFeriado = await getEsFeriado();
      const withWeather = await Promise.all(results.map(async store => {
        const lat = store.lat ?? DEFAULT_LAT;
        const lng = store.lng ?? DEFAULT_LNG;
        const esLluvia = await getEsLluvia(store.id, lat, lng);
        return { ...stripSensitive(store), esLluvia, esFeriado };
      }));
      return res.json(withWeather);
    }

    const stores = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
    const esFeriado = await getEsFeriado();
    const withWeather = await Promise.all(stores.map(async store => {
      const lat = store.lat ?? DEFAULT_LAT;
      const lng = store.lng ?? DEFAULT_LNG;
      const esLluvia = await getEsLluvia(store.id, lat, lng);
      return { ...stripSensitive(store), esLluvia, esFeriado };
    }));
    res.json(withWeather);
  } catch (err) { next(err); }
});

// POST /api/stores – solo admin
router.post('/', requireAdmin, async (req, res, next) => {
  try {
    const { name, address, addressFull, phone, mapUrl, mapImg, emoji,
      scheduleWeekdays, scheduleSaturday, scheduleSunday, order, active } = req.body;
    if (!name) return res.status(400).json({ error: 'El nombre es requerido' });
    const store = {
      tenantId: req.tenantId,
      name, address: address || '', addressFull: addressFull || address || '',
      phone: phone || '', mapUrl: mapUrl || '',
      mapImg: mapImg || 'https://i.postimg.cc/SnwrWdV5/mapa1.jpg',
      emoji: emoji || '🏪',
      scheduleWeekdays: scheduleWeekdays || '', scheduleSaturday: scheduleSaturday || '',
      scheduleSunday: scheduleSunday || '', order: Number(order) || 99,
      active: active !== false, isDefault: false,
      costo_envio:    req.body.costo_envio    != null ? Number(req.body.costo_envio)    : SHIPPING_DEFAULTS.costo_envio,
      radio_envio:    req.body.radio_envio    != null ? Number(req.body.radio_envio)    : SHIPPING_DEFAULTS.radio_envio,
      base_km:        req.body.base_km        != null ? Number(req.body.base_km)        : SHIPPING_DEFAULTS.base_km,
      step_km:        req.body.step_km        != null ? Number(req.body.step_km)        : SHIPPING_DEFAULTS.step_km,
      step_price:     req.body.step_price     != null ? Number(req.body.step_price)     : SHIPPING_DEFAULTS.step_price,
      rain_extra:     req.body.rain_extra     != null ? Number(req.body.rain_extra)     : SHIPPING_DEFAULTS.rain_extra,
      holiday_extra:  req.body.holiday_extra  != null ? Number(req.body.holiday_extra)  : SHIPPING_DEFAULTS.holiday_extra,
      // Contacto & redes
      instagramUrl:   req.body.instagramUrl   || '',
      // Pagos
      mercadopagoAlias:       req.body.mercadopagoAlias       || '',
      mercadopagoAccessToken: req.body.mercadopagoAccessToken || '',
      mercadopagoTestMode:    !!req.body.mercadopagoTestMode,
      transferAlias:          req.body.transferAlias          || '',
      // Coordenadas
      ...(req.body.lat != null ? { lat: Number(req.body.lat) } : {}),
      ...(req.body.lng != null ? { lng: Number(req.body.lng) } : {}),
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    };
    const ref = await db.collection(COL).add(store);
    res.status(201).json({ id: ref.id, ...stripSensitive(store) });
  } catch (err) { next(err); }
});

// PUT /api/stores/:id – solo admin
router.put('/:id', requireAdmin, async (req, res, next) => {
  try {
    const existing = await assertTenantOwnership(COL, req.params.id, req.tenantId);
    if (existing === null)  return res.status(404).json({ error: 'Local no encontrado' });
    if (existing === false) return res.status(403).json({ error: 'Acceso denegado' });

    const ref = db.collection(COL).doc(req.params.id);
    const allowed = [
      'name','address','addressFull','phone','mapUrl','mapImg','emoji',
      'scheduleWeekdays','scheduleSaturday','scheduleSunday','order','active','isDefault',
      'costo_envio','radio_envio','base_km','step_km','step_price','rain_extra','holiday_extra',
      'instagramUrl',
      'mercadopagoAlias','mercadopagoAccessToken','mercadopagoTestMode','transferAlias',
      'lat','lng'
    ];
    const update = { updatedAt: new Date().toISOString() };
    for (const key of allowed) {
      if (req.body[key] !== undefined) update[key] = req.body[key];
    }

    // Si se marca como default, quitar default a los demás del mismo tenant
    if (update.isDefault === true) {
      const allSnap = await tenantQuery(COL, req.tenantId).get();
      const batch = db.batch();
      for (const d of allSnap.docs) {
        if (d.id !== req.params.id) batch.update(d.ref, { isDefault: false });
      }
      await batch.commit();
    }

    await ref.update(update);
    const updated = await ref.get();
    res.json({ id: updated.id, ...stripSensitive(updated.data()) });
  } catch (err) { next(err); }
});

// DELETE /api/stores/:id – solo admin
router.delete('/:id', requireAdmin, async (req, res, next) => {
  try {
    const existing = await assertTenantOwnership(COL, req.params.id, req.tenantId);
    if (existing === null)  return res.status(404).json({ error: 'Local no encontrado' });
    if (existing === false) return res.status(403).json({ error: 'Acceso denegado' });

    await db.collection(COL).doc(req.params.id).delete();
    res.json({ message: 'Local eliminado' });
  } catch (err) { next(err); }
});

module.exports = router;
