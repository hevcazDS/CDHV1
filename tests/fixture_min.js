'use strict';
// tests/fixture_min.js — siembra un sqlite temporal mínimo para el GOLDEN SNAPSHOT
// del bot (Fase 0 del motor de flujo). Reusa db/schema.sql (fuente real del
// esquema) en vez de re-tipear columnas — el CLAUDE.md advierte que el schema
// hand-typed drifta. Idempotente: cada llamada crea una BD nueva en el tmpdir.
//
// Columnas VERIFICADAS contra db/schema.sql (no las del esqueleto viejo):
//   inventarios(id_producto, sucursal[TEXT nombre], stock)  — no id_sucursal/cantidad
//   sucursales(nombre, codigo, codigo_postal)               — sin columna ciudad
//   cobertura(cp, estado, capital, ciudad, tiene_pickup)    — capital NOT NULL
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const os = require('os');

function crearFixture() {
    const dbPath = path.join(os.tmpdir(), 'jc_fixture_' + process.pid + '_' + Date.now() + '.db');
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    // 1) Estructura: aplicar el schema REAL (crea todas las tablas + seeds de
    //    metodos_pago / plan_cuentas / series_folios que ya trae schema.sql).
    db.exec(fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8'));

    // 2) Config = Julio Cepeda por defecto (giro juguetería, tono C). Así t()
    //    rinde byte-idéntico a las respuestas históricas de JC.
    const cfg = db.prepare('INSERT OR REPLACE INTO configuracion (clave, valor) VALUES (?, ?)');
    for (const [k, v] of [
        ['giro', 'jugueteria'], ['nombre_negocio', 'Julio Cepeda Jugueterías'],
        ['nombre_negocio_corto', 'Julio Cepeda'], ['tono_bot', 'C'], ['negocio_configurado', '1'],
    ]) cfg.run(k, v);

    // 3) Sucursal + productos con stock conocido (búsqueda, carrito, split, 0-stock).
    db.prepare("INSERT INTO sucursales (nombre, codigo, codigo_postal, activa) VALUES ('Matriz','MTY','64000',1)").run();
    const prod = db.prepare("INSERT INTO productos (tipo, name, cat, seo_description, tags, price, activo) VALUES ('fisico',?,?,?,?,?,1)");
    const inv = db.prepare("INSERT INTO inventarios (id_producto, sucursal, stock) VALUES (?, 'Matriz', ?)");
    for (const [name, cat, tags, precio, stock] of [
        ['Lego City Policía', 'construccion', 'lego construccion bloques', 599, 8],
        ['Muñeca Barbie',     'muñecas',      'barbie muñeca',            349, 4],
        ['Balón de fútbol',   'deportes',     'balon futbol deporte',     199, 0],  // 0 stock → rama lista de espera
    ]) {
        const id = prod.run(name, cat, name, tags, precio).lastInsertRowid;
        inv.run(id, stock);
    }
    // 3b) Un servicio (para el golden de citas cuando se prueba el giro servicio).
    db.prepare("INSERT INTO productos (tipo, name, cat, price, activo) VALUES ('servicio','Corte de cabello','servicios',150,1)").run();

    // 4) Cobertura de un CP conocido (checkout envío/pickup).
    db.prepare("INSERT INTO cobertura (cp, estado, capital, ciudad, activa, tiene_pickup) VALUES ('64000','NL','Monterrey','Monterrey',1,1)").run();

    db.close();
    return dbPath;   // el runner lo pone en process.env.DB_PATH antes de cargar el bot
}

// Ejecutable directo: crea el fixture e imprime un resumen (para depurar).
if (require.main === module) {
    const p = crearFixture();
    const db = new Database(p, { readonly: true });
    const n = (t) => db.prepare('SELECT COUNT(*) c FROM ' + t).get().c;
    console.log('Fixture creado:', p);
    console.log('  productos:', n('productos'), '| inventarios:', n('inventarios'),
        '| sucursales:', n('sucursales'), '| cobertura:', n('cobertura'), '| configuracion:', n('configuracion'));
    db.close();
}

module.exports = { crearFixture };
