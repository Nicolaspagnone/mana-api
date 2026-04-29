/**
 * seed.js – Script para poblar Firestore con datos iniciales
 * Ejecutar UNA VEZ: node scripts/seed.js
 */
require('dotenv').config();
const { db } = require('../src/firebase');

async function seed() {
  console.log('🌱 Iniciando seed de Firestore...\n');

  // ── 1. Categorías ───────────────────────────────────────
  const categories = [
    { name: 'Empanadas', slug: 'empanada', emoji: '🥟', order: 1, active: true },
    { name: 'Pizzas',    slug: 'pizza',    emoji: '🍕', order: 2, active: true },
    { name: 'Sándwiches',slug: 'sandwich', emoji: '🥪', order: 3, active: true },
  ];

  const catIds = {};
  for (const cat of categories) {
    const ref = await db.collection('categories').add({ ...cat, createdAt: new Date().toISOString() });
    catIds[cat.slug] = ref.id;
    console.log(`✅ Categoría creada: ${cat.name} (${ref.id})`);
  }

  // ── 2. Productos ────────────────────────────────────────
  const products = [
    { name: 'Criolla Salada',  description: 'Carne molida, cebolla, ajo, papa, ají molido, pimentón, comino.',  price: 1400, categoryId: catIds['empanada'], img: 'assets/imgs/criolla-salada.jpg',  popular: true,  available: true, order: 1 },
    { name: 'Jamón y Queso',   description: 'Jamón y queso mozzarella.',                                          price: 1400, categoryId: catIds['empanada'], img: 'assets/imgs/jamonyqueso.jpg',     popular: false, available: true, order: 2 },
    { name: 'Pollo',           description: 'Pollo, cebolla, pimentón, ajo, ají molido, comino.',               price: 1400, categoryId: catIds['empanada'], img: 'assets/imgs/pollo.jpg',           popular: false, available: true, order: 3 },
    { name: 'Calabresa',       description: 'Salame tipo calabresa y queso fundido, levemente picante.',         price: 1400, categoryId: catIds['empanada'], img: 'assets/imgs/calabresa.jpg',       popular: false, available: true, order: 4 },
    { name: 'Árabe',           description: 'Masa casera rellena con carne condimentada, cebolla y tomate.',     price: 1400, categoryId: catIds['empanada'], img: 'assets/imgs/arabe.jpg',           popular: true,  available: true, order: 5 },
    { name: 'Criolla Dulce',   description: 'Carne molida, cebolla, papa, azúcar, comino, ají molido.',         price: 1400, categoryId: catIds['empanada'], img: 'assets/imgs/criolla-dulce.jpg',   popular: false, available: true, order: 6 },
    { name: 'Muzzarella',      description: 'Salsa de tomate casera y mozzarella abundante, clásica.',           price: 7500, categoryId: catIds['pizza'],    img: 'assets/imgs/pizza-muzza.jpg',     popular: true,  available: true, order: 1 },
    { name: 'Fugazza',         description: 'Pizza con salsa de tomate y muzarella fundida.',                    price: 8200, categoryId: catIds['pizza'],    img: 'assets/imgs/pizza-fugazza.jpg',   popular: false, available: true, order: 2 },
    { name: 'Calabresa Pizza', description: 'Mozzarella, rodajas de calabresa crocante y orégano.',              price: 7800, categoryId: catIds['pizza'],    img: 'assets/imgs/pizza-calabresa.jpg', popular: false, available: true, order: 3 },
    { name: 'Especial Maná',   description: 'Mozzarella fundida, jamón cocido, salsa de tomate y orégano.',     price: 9500, categoryId: catIds['pizza'],    img: 'assets/imgs/pizza-especial.jpg',  popular: true,  available: true, order: 4 },
    { name: 'Morrones',        description: 'Mozzarella fundida, morrones y orégano.',                           price: 9500, categoryId: catIds['pizza'],    img: 'assets/imgs/pizza-morrones.jpg',  popular: false, available: true, order: 5 },
  ];

  for (const prod of products) {
    const ref = await db.collection('products').add({ ...prod, createdAt: new Date().toISOString() });
    console.log(`✅ Producto creado: ${prod.name} (${ref.id})`);
  }

  console.log('\n🎉 Seed completado! Ya podés usar el panel admin.');
}

seed().catch(err => {
  console.error('❌ Error en seed:', err);
  process.exit(1);
});
