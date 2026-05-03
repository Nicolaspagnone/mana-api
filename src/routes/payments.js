const express = require('express');
const router = express.Router();
const { db } = require('../firebase');
const https = require('https');

const SETTINGS_DOC = 'config/site';

// POST /api/payments/mercadopago/preference
// Crea una preferencia de Checkout Pro y devuelve init_point
router.post('/mercadopago/preference', async (req, res, next) => {
  try {
    const { orderId, total, title, returnUrl, payerEmail } = req.body;

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

    // Usar el flag de modo prueba guardado en settings
    const isTestMode = !!settings.mercadopagoTestMode;

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
        success: `${baseUrl}/pedido/estado?status=approved`,
        failure: `${baseUrl}/pedido/estado?status=failure`,
        pending: `${baseUrl}/pedido/estado?status=pending`
      },
      notification_url: process.env.MP_WEBHOOK_URL || undefined
    };

    // auto_return: solo cuando back_url.success es HTTPS (requerido por MP).
    // En localhost/HTTP se omite para evitar el error de validación.
    if (baseUrl.startsWith('https://')) {
      preference.auto_return = 'approved';
    }

    // En modo test, el payer.email debe ser el usuario comprador de prueba (no el vendedor).
    // Esto evita que MP deshabilite el botón de pagar por email de vendedor == pagador.
    if (isTestMode) {
      preference.payer = { email: payerEmail || 'test_user_comprador@testuser.com' };
    } else if (payerEmail) {
      preference.payer = { email: payerEmail };
    }

    console.log(`[MP] Creando preferencia - isTest: ${isTestMode}, baseUrl: ${baseUrl}, total: ${total}`);

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
      console.error('[MP] Error al crear preferencia:', JSON.stringify(mpResponse.body));
      return res.status(502).json({
        error: 'Error al crear preferencia en MercadoPago',
        detail: mpResponse.body?.message || mpResponse.body?.cause?.[0]?.description || 'Error desconocido'
      });
    }

    const { id, init_point, sandbox_init_point } = mpResponse.body;
    console.log(`[MP] Preferencia creada - id: ${id}, isTest: ${isTestMode}`);
    res.json({
      preferenceId: id,
      init_point,
      sandbox_init_point,
      isTest: isTestMode
    });

  } catch (err) {
    next(err);
  }
});

// POST /api/payments/mercadopago/verify
// Verifica con la API de MP que un payment_id fue aprobado y que el monto coincide
router.post('/mercadopago/verify', async (req, res, next) => {
  try {
    const { paymentId, expectedTotal } = req.body;

    if (!paymentId) {
      return res.status(400).json({ error: 'Falta paymentId' });
    }

    if (expectedTotal === undefined || expectedTotal === null) {
      return res.status(400).json({ error: 'Falta expectedTotal' });
    }

    const snap = await db.doc(SETTINGS_DOC).get();
    const settings = snap.exists ? snap.data() : {};
    const accessToken = settings.mercadopagoAccessToken || '';

    if (!accessToken) {
      return res.status(503).json({ error: 'MercadoPago no configurado' });
    }

    const mpResponse = await new Promise((resolve, reject) => {
      const options = {
        hostname: 'api.mercadopago.com',
        path: `/v1/payments/${paymentId}`,
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`
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
      request.end();
    });

    if (mpResponse.status !== 200) {
      console.error('[MP] Error al verificar pago:', JSON.stringify(mpResponse.body));
      return res.status(502).json({ approved: false, error: 'No se pudo verificar el pago' });
    }

    const payment = mpResponse.body;
    const statusApproved = payment.status === 'approved';

    // Verificar que el monto pagado coincida con el total esperado (tolerancia de $1 por redondeos)
    const paidAmount = Number(payment.transaction_amount);
    const expected = Number(expectedTotal);
    const amountMatch = Math.abs(paidAmount - expected) <= 1;

    const approved = statusApproved && amountMatch;

    console.log(`[MP] Verificación payment ${paymentId}: status=${payment.status}, paid=${paidAmount}, expected=${expected}, amountMatch=${amountMatch}, approved=${approved}`);

    if (statusApproved && !amountMatch) {
      console.error(`[MP] ALERTA: monto manipulado - pagado: ${paidAmount}, esperado: ${expected}`);
    }

    res.json({ approved, status: payment.status, paidAmount, amountMatch });

  } catch (err) {
    next(err);
  }
});

module.exports = router;
