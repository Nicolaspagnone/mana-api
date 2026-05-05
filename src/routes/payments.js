const express = require('express');
const router = express.Router();
const { db } = require('../firebase');
const https = require('https');

const SETTINGS_DOC = 'config/site';

async function getMpAccessToken() {
  const snap = await db.doc(SETTINGS_DOC).get();
  const settings = snap.exists ? snap.data() : {};
  return settings.mercadopagoAccessToken || '';
}

async function mpGet(path, accessToken) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.mercadopago.com',
      path,
      method: 'GET',
      headers: { 'Authorization': `Bearer ${accessToken}` }
    };
    const request = https.request(options, (response) => {
      let data = '';
      response.on('data', chunk => { data += chunk; });
      response.on('end', () => {
        try { resolve({ status: response.statusCode, body: JSON.parse(data) }); }
        catch (e) { reject(new Error('Error parsing MercadoPago response')); }
      });
    });
    request.on('error', reject);
    request.end();
  });
}

// POST /api/payments/mercadopago/preference
router.post('/mercadopago/preference', async (req, res, next) => {
  try {
    const { orderId, total, title, returnUrl, payerEmail } = req.body;

    if (!orderId || !total) {
      return res.status(400).json({ error: 'Faltan datos: orderId y total son requeridos' });
    }

    const snap = await db.doc(SETTINGS_DOC).get();
    const settings = snap.exists ? snap.data() : {};
    const accessToken = settings.mercadopagoAccessToken || '';

    if (!accessToken) {
      return res.status(503).json({ error: 'MercadoPago no configurado. Contactá al administrador.' });
    }

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
        success: `${baseUrl}/pedido/estado`,
        failure: `${baseUrl}/pedido/estado`,
        pending: `${baseUrl}/pedido/estado`
      },
      notification_url: process.env.MP_WEBHOOK_URL || undefined
    };

    if (baseUrl.startsWith('https://')) {
      preference.auto_return = 'approved';
    }

    if (isTestMode) {
      preference.payer = { email: payerEmail || 'test_user_comprador@testuser.com' };
    } else if (payerEmail) {
      preference.payer = { email: payerEmail };
    }

    console.log(`[MP] Creando preferencia - isTest: ${isTestMode}, baseUrl: ${baseUrl}, total: ${total}`);

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

// POST /api/payments/mercadopago/webhook
router.post('/mercadopago/webhook', async (req, res) => {
  // Responder 200 inmediatamente
  res.sendStatus(200);

  try {
    if (req.body.type !== 'payment') {
      return;
    }

    console.log('[MP Webhook] Recibido evento payment:', JSON.stringify(req.body));

    const paymentId = req.body?.data?.id;
    if (!paymentId) return;

    const accessToken = await getMpAccessToken();
    if (!accessToken) {
      console.error('[MP Webhook] Access token no configurado');
      return;
    }

    const mpResponse = await mpGet(`/v1/payments/${paymentId}`, accessToken);

    if (mpResponse.status !== 200) {
      console.error(`[MP Webhook] Error al consultar pago ${paymentId}:`, JSON.stringify(mpResponse.body));
      return;
    }

    const payment = mpResponse.body;
    const status = payment.status;
    const externalReference = payment.external_reference;
    const transactionAmount = Number(payment.transaction_amount);

    if (!externalReference) {
      console.error(`[MP Webhook] Sin external_reference en pago ${paymentId}`);
      return;
    }

    const orderRef = db.collection('orders').doc(externalReference);
    const orderDoc = await orderRef.get();

    if (!orderDoc.exists) {
      console.error(`[MP Webhook] Pedido no encontrado: ${externalReference}`);
      return;
    }

    const orderData = orderDoc.data();

    if (orderData.paid) {
      console.log(`[MP Webhook] Pedido ${externalReference} ya estaba pagado`);
      return;
    }

    const expectedTotal = Number(orderData.total);

    if (isNaN(transactionAmount) || isNaN(expectedTotal)) {
      console.error('[MP Webhook] Error en montos inválidos');
      return;
    }

    const amountMatch = Math.abs(transactionAmount - expectedTotal) <= 1;
    const statusApproved = status === 'approved';

    console.log(`[MP Webhook] payment ${paymentId}: status=${status}, paid=${transactionAmount}, expected=${expectedTotal}, amountMatch=${amountMatch}`);

    if (statusApproved && !amountMatch) {
      console.error(`[MP Webhook] ALERTA: monto manipulado - pagado: ${transactionAmount}, esperado: ${expectedTotal}`);
    }

    if (statusApproved && amountMatch) {
      await orderRef.update({
        paid: true,
        status: 'pagado',
        paymentId: paymentId,
        paidAmount: transactionAmount,
        updatedAt: new Date().toISOString()
      });
      console.log(`[MP Webhook] Pedido ${externalReference} marcado como pagado`);
    }

  } catch (err) {
    console.error('[MP Webhook] Error procesando webhook:', err);
  }
});

module.exports = router;
