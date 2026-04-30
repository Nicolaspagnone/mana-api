require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const categoriesRouter = require('./routes/categories');
const productsRouter = require('./routes/products');
const ordersRouter = require('./routes/orders');
const authRouter = require('./routes/auth');
const usersRouter = require('./routes/users');
const settingsRouter = require('./routes/settings');
const storesRouter = require('./routes/stores');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(helmet());

app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes, intentá más tarde.' }
}));

app.use(express.json({ limit: '2mb' }));

app.use('/api/auth', authRouter);
app.use('/api/categories', categoriesRouter);
app.use('/api/products', productsRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/users', usersRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/stores', storesRouter);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use((req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada' });
});

app.use((err, req, res, next) => {
  console.error('Error:', err.message);
  res.status(err.status || 500).json({ error: err.message || 'Error interno del servidor' });
});

app.listen(PORT, () => {
  console.log(`🍕 Maná Backend corriendo en http://localhost:${PORT}`);
});
