const express = require('express');
const router  = express.Router();
const rateLimit = require('express-rate-limit');
const jwt       = require('jsonwebtoken');
const { db }    = require('../firebase');

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Demasiados intentos de login.' }
});

const JWT_SECRET   = process.env.JWT_SECRET;
const SESSION_HOURS = 8;

// POST /api/auth/login
router.post('/login', loginLimiter, async (req, res) => {
  const { username, password } = req.body;
  if (!password) return res.status(400).json({ error: 'Contraseña requerida' });

  const uname = username || 'admin';

  try {
    // Buscar usuario filtrando por tenantId — sin mezclar datos entre tenants
    const snap = await db.collection('cpanel_users')
      .where('username', '==', uname)
      .where('tenantId', '==', req.tenantId)
      .limit(1)
      .get();

    if (snap.empty) {
      return res.status(403).json({ error: 'Usuario o contraseña incorrectos' });
    }

    const doc  = snap.docs[0];
    const user = { id: doc.id, ...doc.data() };

    if (user.password !== password) {
      return res.status(403).json({ error: 'Usuario o contraseña incorrectos' });
    }

    const payload = {
      userId:      user.id,
      username:    user.username,
      role:        user.role        || 'operator',
      permissions: user.permissions || ['pedidos'],
      storeId:     user.storeId     || '',
      storeName:   user.storeName   || '',
      tenantId:    req.tenantId     // ← incluido en el JWT para validación posterior
    };

    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: `${SESSION_HOURS}h` });
    res.json({ token, user: payload });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno' });
  }
});

// GET /api/auth/me – verifica token
router.get('/me', (req, res) => {
  const auth = req.headers['authorization'];
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'No autorizado' });
  try {
    const payload = jwt.verify(auth.slice(7), JWT_SECRET);
    res.json({ user: payload });
  } catch {
    res.status(401).json({ error: 'Token expirado o inválido' });
  }
});

module.exports = router;
