// scripts/crearInstanciaDemo.js — crea una TIENDA independiente (su propia BD)
// en instancias/<giro>.db, lista para abrirse desde el selector del dashboard.
//
//   node scripts/crearInstanciaDemo.js <giro> ["Nombre del negocio"] [usuario] [password]
//   node scripts/crearInstanciaDemo.js barberia "Barbería El Patrón"
//
// Deja la instancia CONFIGURADA (sin wizard): giro + módulos del giro
// (MODULOS_POR_GIRO) + sucursal "Principal" + usuario prime (default
// demo/demo1234 — cámbialo para algo que no sea demo local).
'use strict';
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const Database = require('better-sqlite3');
const { GIROS } = require('../bot/flows/_giros');
const { MODULOS_POR_GIRO } = require('../bot/flows/modulosDefaults');

const [, , giro, nombreArg, userArg, passArg] = process.argv;
if (!giro || !GIROS[giro]) {
    console.error('Uso: node scripts/crearInstanciaDemo.js <giro> ["Nombre"] [usuario] [password]');
    console.error('Giros: ' + Object.keys(GIROS).join(', '));
    process.exit(1);
}
const nombre = nombreArg || (GIROS[giro].label.replace(/^[^\s]+\s/, '') + ' Demo');
const usuario = userArg || 'demo';
const password = passArg || 'demo1234';

const dir = path.join(__dirname, '..', 'instancias');
fs.mkdirSync(dir, { recursive: true });
const rutaDb = path.join(dir, giro + '.db');
if (fs.existsSync(rutaDb)) {
    console.error('[instancia] Ya existe ' + rutaDb + ' — bórrala primero si quieres recrearla.');
    process.exit(1);
}

// 1. BD fresca con schema.sql + baseline de migraciones (Ola R)
execFileSync(process.execPath, [path.join(__dirname, 'instalarBaseDeDatos.js'), 'crear-nueva', rutaDb, nombre], { stdio: 'inherit' });

// 2. Configurarla como negocio ya operativo (equivalente al onboarding)
const db = new Database(rutaDb);
const setCfg = (clave, valor) => db.prepare(
    "INSERT OR REPLACE INTO configuracion (clave, valor, actualizado_en) VALUES (?,?,datetime('now','localtime'))"
).run(clave, String(valor));

setCfg('giro', giro);
setCfg('nombre_negocio', nombre);
setCfg('nombre_negocio_corto', nombre.split(' ').slice(0, 2).join(' '));
setCfg('moneda', 'MXN');
setCfg('iva_pct', '16');
setCfg('negocio_configurado', '1');
for (const m of (MODULOS_POR_GIRO[giro] || [])) setCfg(m, '1');

// Sucursal inicial + default de facturación (el POS la necesita)
const suc = db.prepare('INSERT INTO sucursales (nombre) VALUES (?)').run('Principal');
setCfg('sucursal_facturacion_default', String(suc.lastInsertRowid));

// Usuario dueño (prime) — mismo scrypt que dashboard/server.js
const salt = crypto.randomBytes(16).toString('hex');
const hash = crypto.scryptSync(password, salt, 64).toString('hex');
db.prepare('INSERT INTO usuarios (username, nombre, email, password_hash, id_rol, salt, rol) VALUES (?,?,?,?,?,?,?)')
  .run(usuario, usuario, usuario + '@local', hash, 2, salt, 'prime');
db.close();

console.log('');
console.log('[instancia] ✅ Tienda creada: ' + rutaDb);
console.log('[instancia]    Negocio: ' + nombre + ' (giro ' + giro + ')');
console.log('[instancia]    Módulos activados: ' + ((MODULOS_POR_GIRO[giro] || []).join(', ') || 'ninguno extra'));
console.log('[instancia]    Login: ' + usuario + ' / ' + password);
console.log('[instancia] Ábrela desde el dashboard (selector de tienda, solo Prime).');
