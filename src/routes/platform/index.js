const express = require('express');
const authRouter      = require('./auth');
const tenantsRouter   = require('./tenants');
const dashboardRouter = require('./dashboard');

const router = express.Router();

router.use('/auth',      authRouter);
router.use('/tenants',   tenantsRouter);
router.use('/dashboard', dashboardRouter);

module.exports = router;
