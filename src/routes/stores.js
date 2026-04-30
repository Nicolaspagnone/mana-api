const express = require('express');
const router = express.Router();
const { db } = require('../firebase');
const { requireAdmin, requireAuth } = require('../middleware/auth');

const COL = 'stores';

// GET /api/stores – público
router.get('/', async (req, res, next) => {
  try {
    const snap = await db.collection(COL).orderBy('order', 'asc').get();
    if (snap.empty) {
      // Inicializar con los dos locales default
      const defaults = [
        {
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
          order: 2,
          active: true,
          isDefault: false,
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
      return res.json(results);
    }
    res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  } catch (err) { next(err); }
});

// POST /api/stores – solo admin
router.post('/', requireAdmin, async (req, res, next) => {
  try {
    const { name, address, addressFull, phone, mapUrl, mapImg, emoji,
      scheduleWeekdays, scheduleSaturday, scheduleSunday, order, active } = req.body;
    if (!name) return res.status(400).json({ error: 'El nombre es requerido' });
    const store = {
      name, address: address || '', addressFull: addressFull || address || '',
      phone: phone || '', mapUrl: mapUrl || '',
      mapImg: mapImg || 'https://i.postimg.cc/SnwrWdV5/mapa1.jpg',
      emoji: emoji || '🏪',
      scheduleWeekdays: scheduleWeekdays || '', scheduleSaturday: scheduleSaturday || '',
      scheduleSunday: scheduleSunday || '', order: Number(order) || 99,
      active: active !== false, isDefault: false,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    };
    const ref = await db.collection(COL).add(store);
    res.status(201).json({ id: ref.id, ...store });
  } catch (err) { next(err); }
});

// PUT /api/stores/:id – solo admin
router.put('/:id', requireAdmin, async (req, res, next) => {
  try {
    const ref = db.collection(COL).doc(req.params.id);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ error: 'Local no encontrado' });

    const allowed = ['name','address','addressFull','phone','mapUrl','mapImg','emoji',
      'scheduleWeekdays','scheduleSaturday','scheduleSunday','order','active','isDefault'];
    const update = { updatedAt: new Date().toISOString() };
    for (const key of allowed) {
      if (req.body[key] !== undefined) update[key] = req.body[key];
    }

    // Si se marca como default, quitar default a los demás
    if (update.isDefault === true) {
      const allSnap = await db.collection(COL).get();
      const batch = db.batch();
      for (const d of allSnap.docs) {
        if (d.id !== req.params.id) batch.update(d.ref, { isDefault: false });
      }
      await batch.commit();
    }

    await ref.update(update);
    const updated = await ref.get();
    res.json({ id: updated.id, ...updated.data() });
  } catch (err) { next(err); }
});

// DELETE /api/stores/:id – solo admin
router.delete('/:id', requireAdmin, async (req, res, next) => {
  try {
    const ref = db.collection(COL).doc(req.params.id);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ error: 'Local no encontrado' });
    await ref.delete();
    res.json({ message: 'Local eliminado' });
  } catch (err) { next(err); }
});

module.exports = router;
