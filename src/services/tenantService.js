/**
 * tenantService.js
 *
 * Fuente única de verdad para crear / actualizar / suspender tenants.
 * Usado tanto por el script CLI como por las rutas de platform admin.
 */

const { db } = require('../firebase');
const { clearTenantCache } = require('../utils/tenantQuery');

// ── Crear tenant completo ─────────────────────────────────────────────────────
async function createTenant({
  id,
  name,
  domain,
  plan           = 'free',
  primaryColor   = '#FF0D0D',
  secondaryColor = '#F2D200',
  tertiaryColor  = '#FFF8F0',
  logoUrl        = null,
  mercadopago    = true,
  multiStore     = false,
  adminUser      = 'admin',
  adminPass,
}) {
  if (!id || !name || !domain || !adminPass) {
    throw new Error('Faltan campos requeridos: id, name, domain, adminPass');
  }

  // ── Verificar unicidad ────────────────────────────────────────────────────
  const existing = await db.collection('tenants').doc(id).get();
  if (existing.exists) {
    throw Object.assign(new Error(`Ya existe un tenant con ID "${id}"`), { code: 'DUPLICATE_ID' });
  }

  const domainSnap = await db.collection('tenants')
    .where('domain', '==', domain).limit(1).get();
  if (!domainSnap.empty) {
    throw Object.assign(new Error(`Ya existe un tenant con dominio "${domain}"`), { code: 'DUPLICATE_DOMAIN' });
  }

  // ── Tenant ────────────────────────────────────────────────────────────────
  const tenantData = {
    name,
    domain,
    plan,
    active: true,
    features: { mercadopago, multiStore },
    theme: {
      primaryColor,
      ...(secondaryColor ? { secondaryColor } : {}),
      ...(tertiaryColor  ? { tertiaryColor  } : {}),
    },
    ...(logoUrl ? { logoUrl } : {}),
    createdAt: new Date().toISOString(),
  };
  await db.collection('tenants').doc(id).set(tenantData);
  clearTenantCache(id, domain);

  // ── Usuario admin ─────────────────────────────────────────────────────────
  const adminData = {
    tenantId:    id,
    username:    adminUser,
    password:    adminPass,
    role:        'admin',
    permissions: ['dashboard', 'categorias', 'productos', 'pedidos', 'usuarios'],
    storeId:     null,
    storeName:   null,
    createdAt:   new Date().toISOString(),
  };
  await db.collection('cpanel_users').add(adminData);

  // ── Settings iniciales ────────────────────────────────────────────────────
  const settingsData = {
    tenantId:              id,
    storeSelectionEnabled: multiStore,
    createdAt:             new Date().toISOString(),
  };
  await db.collection('settings').doc(id).set(settingsData);

  return { tenantId: id, ...tenantData };
}

// ── Listar todos los tenants ──────────────────────────────────────────────────
async function listTenants() {
  const snap = await db.collection('tenants').get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ── Obtener tenant por ID ─────────────────────────────────────────────────────
async function getTenant(id) {
  const doc = await db.collection('tenants').doc(id).get();
  if (!doc.exists) return null;
  return { id: doc.id, ...doc.data() };
}

// ── Actualizar tenant ─────────────────────────────────────────────────────────
async function updateTenant(id, updates) {
  const ref = db.collection('tenants').doc(id);
  const doc = await ref.get();
  if (!doc.exists) throw Object.assign(new Error('Tenant no encontrado'), { code: 'NOT_FOUND' });

  // Si cambia dominio, verificar que no esté en uso
  if (updates.domain && updates.domain !== doc.data().domain) {
    const domainSnap = await db.collection('tenants')
      .where('domain', '==', updates.domain).limit(1).get();
    if (!domainSnap.empty) {
      throw Object.assign(new Error(`Dominio "${updates.domain}" ya en uso`), { code: 'DUPLICATE_DOMAIN' });
    }
  }

  await ref.update({ ...updates, updatedAt: new Date().toISOString() });
  const updated = await ref.get();
  const updatedData = updated.data();
  // Invalidar cache por ID y por dominio (puede haber cambiado el dominio)
  clearTenantCache(id, updatedData?.domain);
  if (updates.domain && updates.domain !== updatedData?.domain) {
    clearTenantCache(null, updates.domain); // dominio viejo también
  }
  return { id: updated.id, ...updatedData };
}

// ── Suspender / activar tenant ────────────────────────────────────────────────
async function setTenantActive(id, active) {
  return updateTenant(id, { active });
}

// ── Stats rápidas para el dashboard ──────────────────────────────────────────
async function getPlatformStats() {
  const [tenantsSnap, usersSnap, ordersSnap] = await Promise.all([
    db.collection('tenants').get(),
    db.collection('cpanel_users').get(),
    db.collection('orders').get(),
  ]);

  const tenants = tenantsSnap.docs.map(d => d.data());
  const active  = tenants.filter(t => t.active !== false).length;

  return {
    totalTenants:  tenants.length,
    activeTenants: active,
    suspended:     tenants.length - active,
    totalUsers:    usersSnap.size,
    totalOrders:   ordersSnap.size,
  };
}

module.exports = { createTenant, listTenants, getTenant, updateTenant, setTenantActive, getPlatformStats };
