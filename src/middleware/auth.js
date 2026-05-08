const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;

function requireAdmin(req, res, next) {
  const auth = req.headers['authorization'];
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No autorizado' });
  }
  try {
    const payload = jwt.verify(auth.slice(7), JWT_SECRET);

    // El tenantId del token debe coincidir con el tenant resuelto por dominio
    if (payload.tenantId !== req.tenantId) {
      return res.status(403).json({ error: 'Acceso denegado: el usuario no pertenece a este tenant' });
    }

    req.user = payload;

    if (payload.role !== 'admin') {
      return res.status(403).json({ error: 'Requiere permisos de administrador' });
    }
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Sesión expirada. Ingresá nuevamente.' });
    }
    return res.status(403).json({ error: 'Token inválido' });
  }
}

function requireAuth(req, res, next) {
  const auth = req.headers['authorization'];
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No autorizado' });
  }
  try {
    const payload = jwt.verify(auth.slice(7), JWT_SECRET);

    // El tenantId del token debe coincidir con el tenant resuelto por dominio
    if (payload.tenantId !== req.tenantId) {
      return res.status(403).json({ error: 'Acceso denegado: el usuario no pertenece a este tenant' });
    }

    req.user = payload;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Sesión expirada. Ingresá nuevamente.' });
    }
    return res.status(403).json({ error: 'Token inválido' });
  }
}

module.exports = { requireAdmin, requireAuth };
