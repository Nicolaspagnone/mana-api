const jwt = require('jsonwebtoken');

const PLATFORM_JWT_SECRET =
  process.env.PLATFORM_JWT_SECRET || process.env.JWT_SECRET;

/**
 * requirePlatformAdmin
 *
 * Middleware que valida tokens de plataforma.
 * Los tokens de plataforma tienen role = 'platform_admin' y NO contienen tenantId.
 * Usa PLATFORM_JWT_SECRET (puede ser distinto al JWT_SECRET de tenants).
 */
function requirePlatformAdmin(req, res, next) {
  const auth = req.headers['authorization'];
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No autorizado' });
  }

  try {
    const payload = jwt.verify(auth.slice(7), PLATFORM_JWT_SECRET);

    if (payload.role !== 'platform_admin') {
      return res.status(403).json({ error: 'Requiere permisos de plataforma' });
    }

    req.platformAdmin = payload;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Sesión expirada. Ingresá nuevamente.' });
    }
    return res.status(403).json({ error: 'Token inválido' });
  }
}

module.exports = { requirePlatformAdmin, PLATFORM_JWT_SECRET };
