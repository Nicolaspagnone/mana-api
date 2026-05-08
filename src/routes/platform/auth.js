const express = require('express');
const jwt = require('jsonwebtoken');
const { db } = require('../../firebase');
const { requirePlatformAdmin, PLATFORM_JWT_SECRET } = require('../../middleware/platformAuth');

const router = express.Router();

/**
 * POST /api/platform/auth/login
 * Body: { username, password }
 *
 * Autentica un platform_admin. Devuelve JWT con role: 'platform_admin'.
 * NO incluye tenantId en el payload.
 */
router.post('/login', async (req, res, next) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Usuario y contraseña requeridos' });
    }

    const snap = await db.collection('platform_admins')
      .where('username', '==', username)
      .where('password', '==', password)
      .limit(1).get();

    if (snap.empty) {
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
    }

    const admin = snap.docs[0].data();

    const token = jwt.sign(
      { adminId: snap.docs[0].id, username: admin.username, role: 'platform_admin' },
      PLATFORM_JWT_SECRET,
      { expiresIn: '12h' }
    );

    res.json({
      token,
      admin: { username: admin.username, role: 'platform_admin' },
    });
  } catch (err) { next(err); }
});

/**
 * GET /api/platform/auth/me
 * Verifica token y devuelve los datos del admin.
 */
router.get('/me', requirePlatformAdmin, (req, res) => {
  res.json({ admin: req.platformAdmin });
});

module.exports = router;
