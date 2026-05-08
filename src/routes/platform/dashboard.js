const express = require('express');
const { requirePlatformAdmin } = require('../../middleware/platformAuth');
const { getPlatformStats } = require('../../services/tenantService');

const router = express.Router();

/**
 * GET /api/platform/dashboard
 * Stats generales de la plataforma.
 */
router.get('/', requirePlatformAdmin, async (req, res, next) => {
  try {
    const stats = await getPlatformStats();
    res.json(stats);
  } catch (err) { next(err); }
});

module.exports = router;
