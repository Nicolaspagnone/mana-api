require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const { tenantMiddleware } = require('./middleware/tenant');

const categoriesRouter = require('./routes/categories');
const productsRouter = require('./routes/products');
const ordersRouter = require('./routes/orders');
const authRouter = require('./routes/auth');
const usersRouter = require('./routes/users');
const settingsRouter = require('./routes/settings');
const storesRouter = require('./routes/stores');
const paymentsRouter = require('./routes/payments');
const tenantRouter = require('./routes/tenant');
const platformRouter = require('./routes/platform/index');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(helmet());

app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Tenant-Id']
}));

app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes, intentá más tarde.' }
}));

app.use(express.json({ limit: '2mb' }));

// ── Rutas excluidas del tenantMiddleware ──────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});
app.use('/api/tenant',   tenantRouter);
app.use('/api/platform', platformRouter);

// ── Tenant middleware — aplica a todas las rutas siguientes ──
// Excluye webhooks de MercadoPago (llegan desde servidores externos)
app.use((req, res, next) => {
  if (req.path.startsWith('/api/payments/mercadopago/webhook/')) return next();
  return tenantMiddleware(req, res, next);
});

app.use('/api/auth', authRouter);
app.use('/api/categories', categoriesRouter);
app.use('/api/products', productsRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/users', usersRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/stores', storesRouter);
app.use('/api/payments', paymentsRouter);

app.use((req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada' });
});

app.use((err, req, res, next) => {
  console.error('Error:', err.message);
  res.status(err.status || 500).json({ error: err.message || 'Error interno del servidor' });
});

app.listen(PORT, () => {
  console.log(`🍕 Saas PedidosCBA corriendo en http://localhost:${PORT}`);
});
