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
//   node scripts/migrate.js            # aplica todas las pendientes
//   node scripts/migrate.js --status   # solo lista aplicadas/pendientes, no escribe nada
'use strict';
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH;
if (!DB_PATH) {
    console.error('[HS-102] [migrate] ERROR: falta DB_PATH en el entorno (.env).');
    process.exit(1);
}

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

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

function main() {
    const soloStatus = process.argv.includes('--status');
    const db = new Database(DB_PATH);
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
        for (const stmt of statements) {
            try {
                db.exec(stmt);
            } catch (e) {
                if (esErrorTolerado(e)) {
                    console.log(`[migrate]   (tolerado) ${e.message}`);
                } else {
                    console.error(`[migrate] ERROR aplicando ${archivo}: ${e.message}`);
                    console.error(`[migrate]   statement: ${stmt.slice(0, 200)}`);
                    db.close();
                    process.exit(1);
                }
            }
        }
        db.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(archivo);
        console.log(`[migrate] OK: ${archivo}`);
    }

    db.close();
    console.log(`[migrate] listo — ${pendientes.length} migración(es) aplicada(s).`);
}

main();
