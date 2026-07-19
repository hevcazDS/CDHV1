// scripts/migrate.js — runner de migraciones versionadas (Fase JIUA 8)
//
// `db/schema.sql` + scripts/instalarBaseDeDatos.js siguen siendo la forma de
// crear una base de datos NUEVA desde cero. Este script es para llevar una
// base YA desplegada al día sin volver a correr el instalador completo:
// aplica cada archivo de migrations/*.sql como máximo una vez, registrado en
// `schema_migrations`. Cada migración nueva debe reflejarse también a mano
// en db/schema.sql (igual que las migraciones_pendientes/* históricas ya
// quedaron integradas ahí) para que instalaciones nuevas no dependan de
// correr este runner.
//
// Uso:
//   node scripts/migrate.js            # aplica pendientes a DB_PATH (.env)
//   node scripts/migrate.js --status   # solo lista aplicadas/pendientes, no escribe
//   node scripts/migrate.js --db <ruta># aplica a una BD específica
//   node scripts/migrate.js --all      # aplica a DB_PATH + TODAS las instancias/*.db
//                                       # (hosting multi-instancia: cada tienda su BD;
//                                       #  sin esto una tienda queda sin las tablas nuevas)
'use strict';
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');
const INSTANCIAS_DIR = path.join(__dirname, '..', 'instancias');

// Split ingenuo por ';' pero respetando profundidad BEGIN/END, para no
// cortar a la mitad el cuerpo de un CREATE TRIGGER (que tiene sus propios
// ';' internos). Suficiente para SQL controlado y escrito a mano en este
// repo, no pretende ser un parser SQL general.
function splitStatements(rawSql) {
    const sql = rawSql.split('\n').map(l => l.replace(/--.*$/, '')).join('\n');
    const statements = [];
    let depth = 0;
    let start = 0;
    const re = /\bBEGIN\b|\bEND\b|;/gi;
    let m;
    while ((m = re.exec(sql))) {
        const tok = m[0].toUpperCase();
        if (tok === 'BEGIN') depth++;
        else if (tok === 'END') depth = Math.max(0, depth - 1);
        else if (tok === ';' && depth === 0) {
            const stmt = sql.slice(start, m.index + 1).trim();
            if (stmt) statements.push(stmt);
            start = m.index + 1;
        }
    }
    const tail = sql.slice(start).trim();
    if (tail) statements.push(tail);
    return statements;
}

// Errores esperables al reaplicar un ALTER TABLE ADD COLUMN (u otro cambio
// ya presente porque la BD se creó con un db/schema.sql ya actualizado) — se
// loguean y se sigue, no abortan la migración completa.
const ERRORES_TOLERADOS = [/duplicate column name/i, /already exists/i];
function esErrorTolerado(e) {
    return ERRORES_TOLERADOS.some(re => re.test(e.message));
}

function listaMigraciones() {
    if (!fs.existsSync(MIGRATIONS_DIR)) return [];
    return fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort();
}

function migrarBase(dbPath, soloStatus) {
    console.log(`\n[migrate] === ${dbPath} ===`);
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 5000');
    db.pragma('foreign_keys = ON');

    db.prepare(
        "CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, aplicado_en TEXT DEFAULT (datetime('now','localtime')))"
    ).run();

    const aplicadas = new Set(db.prepare('SELECT version FROM schema_migrations').all().map(r => r.version));
    const archivos = listaMigraciones();
    const pendientes = archivos.filter(f => !aplicadas.has(f));

    if (soloStatus) {
        console.log(`[migrate] ${archivos.length} migración(es) en total, ${aplicadas.size} aplicada(s), ${pendientes.length} pendiente(s).`);
        for (const f of archivos) console.log(`  [${aplicadas.has(f) ? 'x' : ' '}] ${f}`);
        db.close();
        return;
    }

    if (!pendientes.length) {
        console.log('[migrate] nada pendiente — base de datos al día.');
        db.close();
        return;
    }

    for (const archivo of pendientes) {
        const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, archivo), 'utf8');
        const statements = splitStatements(sql);
        console.log(`[migrate] aplicando ${archivo} (${statements.length} statement(s))...`);

        // Aplica los statements de UN archivo (errores tolerados se saltan; el
        // resto se lanza para abortar). El INSERT en schema_migrations va junto,
        // para que "migración aplicada" sea atómico con sus cambios.
        const aplicarArchivo = () => {
            for (const stmt of statements) {
                try {
                    db.exec(stmt);
                } catch (e) {
                    if (esErrorTolerado(e)) { console.log(`[migrate]   (tolerado) ${e.message}`); }
                    else { e._stmt = stmt; throw e; }
                }
            }
            db.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(archivo);
        };

        // Por defecto se envuelve en transacción: si un statement no tolerado
        // falla, se revierte TODO el archivo (sin estado parcial). Excepción:
        // `PRAGMA foreign_keys` es no-op dentro de una transacción, así que las
        // migraciones que reconstruyen tablas con FK apagadas se corren sin
        // envolver (mismo comportamiento de antes) para no cambiar su semántica.
        const tienePragma = /^\s*PRAGMA\b/im.test(sql);
        const ejecutar = tienePragma ? aplicarArchivo : db.transaction(aplicarArchivo);
        try {
            ejecutar();
        } catch (e) {
            console.error(`[migrate] ERROR aplicando ${archivo}: ${e.message}`);
            if (e._stmt) console.error(`[migrate]   statement: ${e._stmt.slice(0, 200)}`);
            if (!tienePragma) console.error('[migrate]   (revertido — sin estado parcial)');
            db.close();
            process.exit(1);
        }
        console.log(`[migrate] OK: ${archivo}`);
    }

    db.close();
    console.log(`[migrate] listo — ${pendientes.length} migración(es) aplicada(s).`);
}

// Lista de BDs a migrar según los flags. Por defecto solo DB_PATH (compatible).
function basesAMigrar() {
    const args = process.argv.slice(2);
    const iDb = args.indexOf('--db');
    if (iDb >= 0 && args[iDb + 1]) return [args[iDb + 1]];
    const bases = [];
    if (process.env.DB_PATH) bases.push(process.env.DB_PATH);
    if (args.includes('--all')) {
        try {
            for (const f of fs.readdirSync(INSTANCIAS_DIR)) {
                if (f.endsWith('.db')) bases.push(path.join(INSTANCIAS_DIR, f));
            }
        } catch (_) { /* sin carpeta instancias — nada que agregar */ }
    }
    // dedupe por ruta absoluta resuelta
    return [...new Map(bases.map(p => [path.resolve(p), p])).values()];
}

function main() {
    const soloStatus = process.argv.includes('--status');
    const bases = basesAMigrar();
    if (!bases.length) {
        console.error('[HS-102] [migrate] ERROR: falta DB_PATH en el entorno (.env) o --db/--all.');
        process.exit(1);
    }
    for (const dbPath of bases) {
        if (!fs.existsSync(dbPath)) { console.warn(`[migrate] (omitida, no existe) ${dbPath}`); continue; }
        migrarBase(dbPath, soloStatus);
    }
}

main();
