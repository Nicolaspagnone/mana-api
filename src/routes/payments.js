const express = require('express');
const router = express.Router();
const { db } = require('../firebase');
const https = require('https');

const SETTINGS_DOC = 'config/site';

// POST /api/payments/mercadopago/preference
// Crea una preferencia de Checkout Pro y devuelve init_point
router.post('/mercadopago/preference', async (req, res, next) => {
  try {
    const { orderId, total, title, returnUrl } = req.body;

    if (!orderId || !total) {
      return res.status(400).json({ error: 'Faltan datos: orderId y total son requeridos' });
    }

    // Obtener access token desde Firestore
    const snap = await db.doc(SETTINGS_DOC).get();
    const settings = snap.exists ? snap.data() : {};
    const accessToken = settings.mercadopagoAccessToken || '';

    if (!accessToken) {
      return res.status(503).json({ error: 'MercadoPago no configurado. Contactá al administrador.' });
    }

    const baseUrl = returnUrl || process.env.FRONTEND_URL || 'https://manaempanadas.com.ar';

    const preference = {
      items: [
        {
          title: title || 'Pedido Maná Empanadas',
          quantity: 1,
          unit_price: Number(total),
          currency_id: 'ARS'
        }
      ],
      external_reference: orderId,
      back_urls: {
        success: `${baseUrl}/pedido?order=${orderId}&status=approved`,
        failure: `${baseUrl}/pedido?order=${orderId}&status=failure`,
        pending: `${baseUrl}/pedido?order=${orderId}&status=pending`
      },
      auto_return: 'approved',
      notification_url: process.env.MP_WEBHOOK_URL || undefined
    };

    // Llamada a API de MercadoPago
    const mpResponse = await new Promise((resolve, reject) => {
      const body = JSON.stringify(preference);
      const options = {
        hostname: 'api.mercadopago.com',
        path: '/checkout/preferences',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
          'Content-Length': Buffer.byteLength(body)
        }
      };

      const request = https.request(options, (response) => {
        let data = '';
        response.on('data', chunk => { data += chunk; });
        response.on('end', () => {
          try {
            resolve({ status: response.statusCode, body: JSON.parse(data) });
          } catch (e) {
            reject(new Error('Error parsing MercadoPago response'));
          }
        });
      });

      request.on('error', reject);
      request.write(body);
      request.end();
    });

    if (mpResponse.status !== 201 && mpResponse.status !== 200) {
      console.error('MercadoPago error:', mpResponse.body);
      return res.status(502).json({
        error: 'Error al crear preferencia en MercadoPago',
        detail: mpResponse.body?.message || 'Error desconocido'
      });
    }

    const { id, init_point, sandbox_init_point } = mpResponse.body;
    res.json({
      preferenceId: id,
      init_point,
      sandbox_init_point
    });

  } catch (err) {
    next(err);
  }
});

module.exports = router;
