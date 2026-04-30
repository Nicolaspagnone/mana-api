const express = require('express');
const router = express.Router();
const { db } = require('../firebase');
const { requireAdmin } = require('../middleware/auth');

const COL = 'cpanel_users';
const ALL_PERMISSIONS = ['dashboard', 'categorias', 'productos', 'pedidos', 'usuarios'];

// GET /api/users – admin
router.get('/', requireAdmin, async (req, res, next) => {
  try {
    const snap = await db.collection(COL).orderBy('createdAt', 'asc').get();
    const users = snap.docs.map(d => {
      const data = d.data();
      const { password, ...safe } = data; // never expose password
      return { id: d.id, ...safe };
    });
    res.json(users);
  } catch (err) { next(err); }
});

// POST /api/users – admin – crear usuario
router.post('/', requireAdmin, async (req, res, next) => {
  try {
    const { username, password, role = 'operator', permissions = ['pedidos'], storeId, storeName } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'username y password son requeridos' });
    }
    // Check username unique
    const existing = await db.collection(COL).where('username', '==', username).limit(1).get();
    if (!existing.empty) {
      return res.status(400).json({ error: 'El nombre de usuario ya existe' });
    }
    // Validate permissions
    const validPerms = permissions.filter(p => ALL_PERMISSIONS.includes(p));
    const userData = {
      username,
      password, // plain text (same as existing ADMIN_SECRET pattern)
      role: role === 'admin' ? 'admin' : 'operator',
      permissions: validPerms,
      storeId: storeId || null,
      storeName: storeName || null,
      createdAt: new Date().toISOString()
    };
    const docRef = await db.collection(COL).add(userData);
    res.status(201).json({ id: docRef.id, username, role, permissions: validPerms, storeId: storeId || null, storeName: storeName || null });
  } catch (err) { next(err); }
});

// PUT /api/users/:id – admin – editar usuario
router.put('/:id', requireAdmin, async (req, res, next) => {
  try {
    const ref = db.collection(COL).doc(req.params.id);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ error: 'Usuario no encontrado' });

    const update = { updatedAt: new Date().toISOString() };
    if (req.body.password) update.password = req.body.password;
    if (req.body.role) update.role = req.body.role === 'admin' ? 'admin' : 'operator';
    if (req.body.permissions) {
      update.permissions = req.body.permissions.filter(p => ALL_PERMISSIONS.includes(p));
    }
    if (req.body.storeId !== undefined) update.storeId = req.body.storeId || null;
    if (req.body.storeName !== undefined) update.storeName = req.body.storeName || null;
    if (req.body.username) update.username = req.body.username;

    await ref.update(update);
    const updated = (await ref.get()).data();
    const { password, ...safe } = updated;
    res.json({ id: req.params.id, ...safe });
  } catch (err) { next(err); }
});

// DELETE /api/users/:id – admin
router.delete('/:id', requireAdmin, async (req, res, next) => {
  try {
    const ref = db.collection(COL).doc(req.params.id);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ error: 'Usuario no encontrado' });
    await ref.delete();
    res.json({ message: 'Usuario eliminado' });
  } catch (err) { next(err); }
});

module.exports = router;
