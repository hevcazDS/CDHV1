// scripts/instalarBaseDeDatos.js
// Paso de "base de datos" de la instalación: el operador elige entre crear una base de
// datos NUEVA (se le corre db/schema.sql completo) o usar una que YA tiene.
// Para la que ya tiene, no se intenta detectar ni migrar un esquema
// ARBITRARIO de terceros (eso se resuelve a mano caso por caso) — pero sí se
// verifica/completa contra el propio db/schema.sql de este proyecto, que es
// un esquema conocido y controlado, no arbitrario.
//
// Uso:
//   node scripts/instalarBaseDeDatos.js crear-nueva <ruta.db> ["Nombre del negocio"] [tono A|B|C|D]
//   node scripts/instalarBaseDeDatos.js usar-existente <ruta.db>
//   node scripts/instalarBaseDeDatos.js verificar-y-completar <ruta.db>
//
// "usar-existente" es un chequeo rápido de solo lectura (avisa qué le falta,
// no toca nada). "verificar-y-completar" sí escribe: corre db/schema.sql
// (idempotente, crea lo que falte completo) y además agrega con ALTER TABLE
// cualquier columna que falte en una tabla que YA existía con otra forma —
// el caso real que causó el bucle de reinicio del dashboard (tabla
// `usuarios` vieja sin columna `username`, ver dashboard/server.js). Nunca
// borra ni renombra nada, solo agrega lo que falta.
//
// Imprime por stdout una línea `DB_PATH=<ruta absoluta>` al terminar bien,
// para que el script instalador (.sh/.ps1) la capture y la escriba en .env.
'use strict';
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const TONOS_VALIDOS = ['A', 'B', 'C', 'D'];
const TIPOS_VALIDOS = ['TEXT', 'INTEGER', 'REAL', 'BLOB'];

function fail(msg) {
    console.error('[instalarBaseDeDatos] ERROR: ' + msg);
    process.exit(1);
}

function leerSchemaSql() {
    const schemaPath = path.join(__dirname, '..', 'db', 'schema.sql');
    return fs.readFileSync(schemaPath, 'utf8');
}

// Extrae { nombreTabla: [{nombre, tipo}, ...] } de los CREATE TABLE IF NOT
// EXISTS de schema.sql. Solo lee nombre+tipo de columna, ignora a propósito
// NOT NULL / UNIQUE / CHECK / DEFAULT / REFERENCES: eso son justo las
// cláusulas que SQLite no deja agregar vía ALTER TABLE ADD COLUMN sobre una
// tabla con filas, así que una columna "recuperada" para una tabla vieja
// siempre se agrega simple (nullable, sin default) — suficiente para que el
// código deje de tronar por "no such column", no para reconstruir el
// constraint exacto sobre datos que ya existían sin él.
function parsearTablasEsperadas(schemaSql) {
    const tablas = {};
    const reTabla = /CREATE TABLE IF NOT EXISTS\s+(\w+)\s*\(([\s\S]*?)\n\);/g;
    let m;
    while ((m = reTabla.exec(schemaSql))) {
        const columnas = [];
        for (const lineaRaw of m[2].split('\n')) {
            const linea = lineaRaw.replace(/--.*$/, '').trim().replace(/,$/, '');
            if (!linea) continue;
            const colMatch = linea.match(/^([A-Za-z_][A-Za-z0-9_]*)\s+([A-Za-z]+)/);
            if (!colMatch) continue;
            const [, nombreCol, tipoCrudo] = colMatch;
            if (/^(PRIMARY|FOREIGN|UNIQUE|CHECK|CONSTRAINT)$/i.test(nombreCol)) continue;
            const tipo = TIPOS_VALIDOS.includes(tipoCrudo.toUpperCase()) ? tipoCrudo.toUpperCase() : 'TEXT';
            columnas.push({ nombre: nombreCol, tipo });
        }
        tablas[m[1]] = columnas;
    }
    return tablas;
}

function crearNueva(rutaDb, nombreNegocio, tono) {
    const rutaAbs = path.resolve(rutaDb);
    if (fs.existsSync(rutaAbs)) {
        fail(`ya existe un archivo en ${rutaAbs} — bórralo primero o usa "usar-existente"/"verificar-y-completar" si ya tiene el esquema correcto.`);
    }
    fs.mkdirSync(path.dirname(rutaAbs), { recursive: true });

    const db = new Database(rutaAbs);
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 5000');
    db.pragma('foreign_keys = ON');
    db.exec(leerSchemaSql());

    if (nombreNegocio) {
        db.prepare(
            "INSERT OR REPLACE INTO configuracion (clave, valor, actualizado_en) VALUES ('nombre_negocio', ?, datetime('now','localtime'))"
        ).run(nombreNegocio);
    }
    if (tono) {
        const t = tono.toUpperCase();
        if (!TONOS_VALIDOS.includes(t)) fail(`tono "${tono}" inválido — debe ser una de: ${TONOS_VALIDOS.join(', ')}`);
        db.prepare(
            "INSERT OR REPLACE INTO configuracion (clave, valor, actualizado_en) VALUES ('tono_bot', ?, datetime('now','localtime'))"
        ).run(t);
    }

    // Baseline de migraciones: schema.sql ya ES el estado final, así que una BD
    // recién creada sella TODAS las migrations/*.sql existentes como aplicadas.
    // Sin esto, `node scripts/migrate.js` intentaba re-correr la historia
    // completa sobre la BD fresca y tronaba en 0023 (asume columnas legacy del
    // sistema Python previo que solo existían en la BD de producción original).
    db.prepare(
        "CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, aplicado_en TEXT DEFAULT (datetime('now','localtime')))"
    ).run();
    const dirMigraciones = path.join(__dirname, '..', 'migrations');
    const selladas = fs.existsSync(dirMigraciones)
        ? fs.readdirSync(dirMigraciones).filter(f => f.endsWith('.sql')).sort()
        : [];
    const sellar = db.prepare('INSERT OR IGNORE INTO schema_migrations (version) VALUES (?)');
    for (const f of selladas) sellar.run(f);

    const nTablas = db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table'").get().n;
    db.close();

    console.error(`[instalarBaseDeDatos] OK: base de datos nueva creada en ${rutaAbs} (${nTablas} tablas, ${selladas.length} migraciones selladas como baseline).`);
    console.log('DB_PATH=' + rutaAbs);
}

function abrirYValidarSqlite(rutaAbs, opciones) {
    if (!fs.existsSync(rutaAbs)) {
        fail(`no existe ningún archivo en ${rutaAbs}.`);
    }
    let db;
    try {
        db = new Database(rutaAbs, opciones);
        db.prepare('SELECT COUNT(*) FROM sqlite_master').get();
    } catch (e) {
        fail(`${rutaAbs} no es un archivo SQLite válido (${e.message}).`);
    }
    return db;
}

function usarExistente(rutaDb) {
    const rutaAbs = path.resolve(rutaDb);
    const db = abrirYValidarSqlite(rutaAbs, { readonly: true });
    const tablasCriticas = ['clientes', 'productos', 'pedidos', 'sesiones_bot'];
    const faltantes = tablasCriticas.filter(t => {
        try { db.prepare(`SELECT 1 FROM ${t} LIMIT 1`).get(); return false; }
        catch (_) { return true; }
    });
    db.close();
    if (faltantes.length) {
        console.error(`[instalarBaseDeDatos] AVISO: ${rutaAbs} no tiene estas tablas esperadas: ${faltantes.join(', ')}.`);
        console.error('[instalarBaseDeDatos] Corre "verificar-y-completar" en vez de "usar-existente" para que se agreguen automáticamente.');
    } else {
        console.error(`[instalarBaseDeDatos] OK: ${rutaAbs} abre correctamente y tiene las tablas básicas esperadas.`);
    }
    console.log('DB_PATH=' + rutaAbs);
}

function verificarYCompletar(rutaDb) {
    const rutaAbs = path.resolve(rutaDb);
    const dbCheck = abrirYValidarSqlite(rutaAbs, { readonly: true });
    dbCheck.close();

    const schemaSql = leerSchemaSql();
    const tablasEsperadas = parsearTablasEsperadas(schemaSql);

    const db = new Database(rutaAbs);
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 5000');
    db.pragma('foreign_keys = ON');

    // Paso 1: tablas/índices que falten por completo — schema.sql ya es
    // 100% "IF NOT EXISTS", correrlo de nuevo sobre una BD existente es
    // seguro y solo crea lo que no estaba. Envuelto en try/catch porque un
    // CREATE UNIQUE INDEX puede aparecer en el archivo antes de que el Paso 2
    // alcance a reponer la columna en la que se apoya (p.ej. clientes.telefono
    // en una tabla `clientes` vieja sin esa columna) — un solo statement roto
    // no debe abortar la creación del resto de tablas; el Paso 3 vuelve a
    // intentar el archivo completo ya con las columnas repuestas.
    try {
        db.exec(schemaSql);
    } catch (e) {
        console.error(`[instalarBaseDeDatos] AVISO: pasada inicial de schema.sql se detuvo en: ${e.message} (se reintenta tras reponer columnas)`);
    }

    // Paso 2: columnas que falten en una tabla que YA existía con otra forma
    // (el bug real de `usuarios` sin `username` — CREATE TABLE IF NOT
    // EXISTS no corrige eso, solo ALTER TABLE lo hace).
    let columnasAgregadas = 0;
    for (const [tabla, columnasEsperadas] of Object.entries(tablasEsperadas)) {
        let columnasActuales;
        try {
            columnasActuales = db.prepare(`PRAGMA table_info(${tabla})`).all().map(c => c.name);
        } catch (_) { continue; }
        if (!columnasActuales.length) continue; // tabla aún no existe -- el Paso 3 la crea completa, no hay nada que reponer aquí
        for (const { nombre, tipo } of columnasEsperadas) {
            if (columnasActuales.includes(nombre)) continue;
            try {
                db.prepare(`ALTER TABLE ${tabla} ADD COLUMN ${nombre} ${tipo}`).run();
                columnasAgregadas++;
                console.error(`[instalarBaseDeDatos] + columna agregada: ${tabla}.${nombre} (${tipo})`);
            } catch (e) {
                console.error(`[instalarBaseDeDatos] AVISO: no se pudo agregar ${tabla}.${nombre}: ${e.message}`);
            }
        }
    }

    // Paso 3: con las columnas ya repuestas, los índices únicos que dependían
    // de ellas (idx_clientes_telefono, etc.) ya pueden crearse — segunda
    // pasada idempotente. Si hay datos duplicados que violan la unicidad,
    // se avisa pero no se aborta (eso es un problema de datos, no de esquema).
    try {
        db.exec(schemaSql);
    } catch (e) {
        console.error(`[instalarBaseDeDatos] AVISO: algún índice único no se pudo crear (posibles datos duplicados): ${e.message}`);
    }

    const nTablas = db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table'").get().n;
    db.close();

    if (columnasAgregadas > 0) {
        console.error(`[instalarBaseDeDatos] OK: ${rutaAbs} actualizado — ${columnasAgregadas} columna(s) agregada(s), ${nTablas} tablas en total.`);
    } else {
        console.error(`[instalarBaseDeDatos] OK: ${rutaAbs} ya tenía todo lo necesario (${nTablas} tablas).`);
    }
    console.log('DB_PATH=' + rutaAbs);
}

const [, , modo, rutaDb, nombreNegocio, tono] = process.argv;

if (modo === 'crear-nueva' && rutaDb) {
    crearNueva(rutaDb, nombreNegocio, tono);
} else if (modo === 'usar-existente' && rutaDb) {
    usarExistente(rutaDb);
} else if (modo === 'verificar-y-completar' && rutaDb) {
    verificarYCompletar(rutaDb);
} else {
    console.error('Uso:');
    console.error('  node scripts/instalarBaseDeDatos.js crear-nueva <ruta.db> ["Nombre del negocio"] [tono A|B|C|D]');
    console.error('  node scripts/instalarBaseDeDatos.js usar-existente <ruta.db>');
    console.error('  node scripts/instalarBaseDeDatos.js verificar-y-completar <ruta.db>');
    process.exit(1);
}
