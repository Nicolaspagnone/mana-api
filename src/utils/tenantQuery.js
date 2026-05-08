const { db } = require('../firebase');

// ── Cache en memoria ──────────────────────────────────────
// Evita hits a Firestore en cada request
const tenantCache = new Map(); // key → { tenant, expiry }
const CACHE_TTL    = 5 * 60 * 1000; // 5 min (alineado con el prompt cache)
const CACHE_NEG    = 1 * 60 * 1000; // 1 min para resultados negativos

function getCached(key) {
  const entry = tenantCache.get(key);
  if (entry && Date.now() < entry.expiry) return entry.tenant;
  return undefined; // undefined = no hay cache (null = cache negativo)
}

function setCache(key, tenant) {
  tenantCache.set(key, {
    tenant,
    expiry: Date.now() + (tenant ? CACHE_TTL : CACHE_NEG)
  });
}

// ── Cache invalidation ────────────────────────────────────

/**
 * Invalida las entradas de cache de un tenant.
 * Llamar después de update/suspend/activate en tenantService.js.
 */
function clearTenantCache(tenantId, domain) {
  if (tenantId) tenantCache.delete(`id:${tenantId}`);
  if (domain)   tenantCache.delete(`domain:${domain}`);
}

// ── Resolvers ─────────────────────────────────────────────

/**
 * Busca tenant por dominio (solo activos).
 * Usado por: tenantMiddleware, origin cross-check.
 */
async function resolveTenantByDomain(domain) {
  const key = `domain:${domain}`;
  const cached = getCached(key);
  if (cached !== undefined) return cached;

  const snap = await db.collection('tenants')
    .where('domain', '==', domain)
    .where('active', '==', true)
    .limit(1)
    .get();

  const tenant = snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
  setCache(key, tenant);
  if (tenant) setCache(`id:${tenant.id}`, tenant);
  return tenant;
}

/**
 * Busca tenant por dominio SIN filtrar por active.
 * Usado por: GET /api/tenant/by-domain (para detectar tenants suspendidos y devolver 403).
 */
async function resolveTenantByDomainAny(domain) {
  // No cacheamos esta consulta — es solo para el bootstrap del frontend
  const snap = await db.collection('tenants')
    .where('domain', '==', domain)
    .limit(1)
    .get();

  return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
}

/**
 * Busca tenant por su ID (document ID en colección tenants).
 * Usado por: tenantMiddleware (producción via X-Tenant-Id validado)
 */
async function resolveTenantById(tenantId) {
  const key = `id:${tenantId}`;
  const cached = getCached(key);
  if (cached !== undefined) return cached;

  const doc = await db.collection('tenants').doc(tenantId).get();
  const tenant = doc.exists ? { id: doc.id, ...doc.data() } : null;
  setCache(key, tenant);
  return tenant;
}

// ── Query helpers ─────────────────────────────────────────

/**
 * Devuelve una Firestore query base ya filtrada por tenantId.
 * Reemplaza db.collection(COL) en todas las rutas.
 *
 * Uso: tenantQuery('orders', req.tenantId).where('status', '==', 'pending')
 */
function tenantQuery(collection, tenantId) {
  return db.collection(collection).where('tenantId', '==', tenantId);
}

/**
 * Verifica que un documento existe Y pertenece al tenant.
 * Usado en PUT/DELETE para evitar cross-tenant manipulation.
 *
 * Retorna:
 *   null  → documento no existe
 *   false → existe pero es de otro tenant
 *   data  → objeto con id + data (pertenece al tenant)
 */
async function assertTenantOwnership(collection, docId, tenantId) {
  const doc = await db.collection(collection).doc(docId).get();
  if (!doc.exists) return null;
  if (doc.data().tenantId !== tenantId) return false;
  return { id: doc.id, ...doc.data() };
}

module.exports = {
  resolveTenantByDomain,
  resolveTenantByDomainAny,
  resolveTenantById,
  tenantQuery,
  assertTenantOwnership,
  clearTenantCache,
};
