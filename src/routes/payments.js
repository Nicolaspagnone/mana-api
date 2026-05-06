const express = require('express');
const router = express.Router();
const { db } = require('../firebase');
const https = require('https');

// ── Helpers ───────────────────────────────────────────────

/**
 * Obtiene las credenciales MP del store del pedido.
 * Usado cuando ya tenemos el storeId (preference, retry-check).
 */
async function getMpCredentials(storeId) {
  if (!storeId) return { accessToken: '', isTestMode: false };
  const snap = await db.collection('stores').doc(storeId).get();
  if (!snap.exists) return { accessToken: '', isTestMode: false };
  const store = snap.data();
  return {
    accessToken: store.mercadopagoAccessToken || '',
    isTestMode: !!store.mercadopagoTestMode
  };
}

/**
 * Para el webhook: no sabemos el storeId aún.
 * Devuelve el primer access token disponible entre los locales activos.
 * En la práctica, las pymes usan una sola cuenta MP para todos sus locales.
 */
async function getAnyMpAccessToken() {
  const snap = await db.collection('stores').get();
  for (const doc of snap.docs) {
    const token = doc.data().mercadopagoAccessToken;
    if (token) return token;
  }
  return '';
}

function mpRequest(method, path, accessToken, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'api.mercadopago.com',
      path,
      method,
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        ...(bodyStr ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) } : {})
      }
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch (e) { reject(new Error('Error parsing MercadoPago response')); }
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// ── POST /api/payments/mercadopago/preference ─────────────
router.post('/mercadopago/preference', async (req, res, next) => {
  try {
    const { orderId, total, title, returnUrl, payerEmail } = req.body;

    if (!orderId || !total) {
      return res.status(400).json({ error: 'Faltan datos: orderId y total son requeridos' });
    }

    // Leer storeId del pedido para obtener las credenciales del local correcto
    const orderDoc = await db.collection('orders').doc(orderId).get();
    const storeId = orderDoc.exists ? orderDoc.data().storeId : null;
    const { accessToken, isTestMode } = await getMpCredentials(storeId);

    if (!accessToken) {
      return res.status(503).json({ error: 'MercadoPago no configurado para este local. Contactá al administrador.' });
    }

    const baseUrl = returnUrl || process.env.FRONTEND_URL || 'https://manaempanadas.com.ar';

    const preference = {
      items: [{
        title: title || 'Pedido Maná Empanadas',
        quantity: 1,
        unit_price: Number(total),
        currency_id: 'ARS'
      }],
      external_reference: orderId,
      back_urls: {
        success: `${baseUrl}/pedido/estado`,
        failure: `${baseUrl}/pedido/estado`,
        pending: `${baseUrl}/pedido/estado`
      },
      notification_url: process.env.MP_WEBHOOK_URL || undefined
    };

    if (baseUrl.startsWith('https://')) preference.auto_return = 'approved';

    if (isTestMode) {
      preference.payer = { email: payerEmail || 'test_user_comprador@testuser.com' };
    } else if (payerEmail) {
      preference.payer = { email: payerEmail };
    }

    console.log(`[MP] Creando preferencia - storeId: ${storeId}, isTest: ${isTestMode}, total: ${total}`);

    const mpResponse = await mpRequest('POST', '/checkout/preferences', accessToken, preference);

    if (mpResponse.status !== 201 && mpResponse.status !== 200) {
      console.error('[MP] Error al crear preferencia:', JSON.stringify(mpResponse.body));
      return res.status(502).json({
        error: 'Error al crear preferencia en MercadoPago',
        detail: mpResponse.body?.message || mpResponse.body?.cause?.[0]?.description || 'Error desconocido'
      });
    }

    const { id, init_point, sandbox_init_point } = mpResponse.body;
    console.log(`[MP] Preferencia creada - id: ${id}, isTest: ${isTestMode}`);
    res.json({ preferenceId: id, init_point, sandbox_init_point, isTest: isTestMode });

  } catch (err) { next(err); }
});

// ── POST /api/payments/mercadopago/retry-check ────────────
router.post('/mercadopago/retry-check', async (req, res, next) => {
  try {
    const { orderId } = req.body;
    if (!orderId) return res.status(400).json({ error: 'Falta orderId' });

    const orderRef = db.collection('orders').doc(orderId);
    const orderDoc = await orderRef.get();
    if (!orderDoc.exists) return res.status(404).json({ error: 'Pedido no encontrado' });

    const orderData = orderDoc.data();
    if (orderData.paid) return res.json({ alreadyPaid: true });

    const { accessToken } = await getMpCredentials(orderData.storeId);
    if (!accessToken) return res.json({ alreadyPaid: false });

    const mpResponse = await mpRequest(
      'GET',
      `/v1/payments/search?external_reference=${encodeURIComponent(orderId)}&sort=date_created&criteria=desc&range=date_created&begin_date=NOW-7DAYS&end_date=NOW`,
      accessToken
    );

    if (mpResponse.status !== 200) {
      console.error(`[MP RetryCheck] Error al buscar pagos para ${orderId}:`, JSON.stringify(mpResponse.body));
      return res.json({ alreadyPaid: false });
    }

    const results = mpResponse.body?.results || [];
    const expectedTotal = Number(orderData.total);
    const approvedPayment = results.find(payment => {
      if (payment.status !== 'approved') return false;
      const amount = Number(payment.transaction_amount);
      return !isNaN(amount) && !isNaN(expectedTotal) && Math.abs(amount - expectedTotal) <= 1;
    });

    if (approvedPayment) {
      await orderRef.update({
        paid: true,
        paymentId: String(approvedPayment.id),
        paidAmount: Number(approvedPayment.transaction_amount),
        updatedAt: new Date().toISOString()
      });
      console.log(`[MP RetryCheck] Pedido ${orderId} marcado como pagado`);
      return res.json({ alreadyPaid: true });
    }

    return res.json({ alreadyPaid: false });

  } catch (err) { next(err); }
});

// ── POST /api/payments/mercadopago/webhook ────────────────
router.post('/mercadopago/webhook', async (req, res) => {
  res.sendStatus(200); // Responder inmediatamente

  try {
    if (req.body.type !== 'payment') return;

    const paymentId = req.body?.data?.id;
    if (!paymentId) return;

    console.log('[MP Webhook] Recibido evento payment:', JSON.stringify(req.body));

    // Para el webhook no conocemos el storeId aún → usamos el primer token disponible.
    // Una vez que tengamos el external_reference (orderId), podríamos usar el del store,
    // pero la llamada a MP ya estará hecha y no se necesita más.
    const accessToken = await getAnyMpAccessToken();
    if (!accessToken) {
      console.error('[MP Webhook] No hay access token configurado en ningún local');
      return;
    }

    const mpResponse = await mpRequest('GET', `/v1/payments/${paymentId}`, accessToken);

    if (mpResponse.status !== 200) {
      console.error(`[MP Webhook] Error al consultar pago ${paymentId}:`, JSON.stringify(mpResponse.body));
      return;
    }

    const payment = mpResponse.body;
    const externalReference = payment.external_reference;
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

    const status = payment.status;
    const transactionAmount = Number(payment.transaction_amount);
    const expectedTotal = Number(orderData.total);

    if (isNaN(transactionAmount) || isNaN(expectedTotal)) {
      console.error('[MP Webhook] Montos inválidos');
      return;
    }

    const amountMatch = Math.abs(transactionAmount - expectedTotal) <= 1;
    console.log(`[MP Webhook] payment ${paymentId}: status=${status}, paid=${transactionAmount}, expected=${expectedTotal}, match=${amountMatch}`);

    if (status === 'approved' && !amountMatch) {
      console.error(`[MP Webhook] ALERTA: monto manipulado - pagado: ${transactionAmount}, esperado: ${expectedTotal}`);
    }

    if (status === 'approved' && amountMatch) {
      await orderRef.update({
        paid: true,
        paymentId: String(paymentId),
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
