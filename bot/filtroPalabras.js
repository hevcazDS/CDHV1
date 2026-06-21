// filtroPalabras.js — Lista negra y frases de queja: base (código) + personalizadas (BD)
// Módulo compartido entre bot/index.js (aplica el filtro en cada mensaje) y
// dashboard/server.js (API para que el usuario prime vea/agregue palabras).
//
// Las palabras BASE viven aquí en código y siempre se aplican, sin importar
// si la tabla `palabras_filtro` existe, está vacía o la consulta a la BD
// falla — así una palabra agregada/quitada desde el dashboard nunca puede
// romper el filtro ni dejar pasar contenido que antes se bloqueaba.
'use strict';

const log = require('./logger')('filtroPalabras');

// Palabras cortas: solo coinciden como palabra completa
const BW_WORD_BASE = [
    'pene','pito','verga','polla','culo','ano','senos','nalgas','tetas',
    'chichis','panocha','chocho','follar','coger','puta','putona','desnudo',
    'desnuda','encuerado','encuerada','xxx','crack',
    'fuck','cock','ass','nude','naked','bitch','slut','whore','porn',
];
// Palabras/frases largas: coincidencia por substring
const BW_LONG_BASE = [
    'vagina','vulva','clitoris','masturbacion','masturbarse','orgasmo',
    'eyaculacion','corrida','mamada','cogida','sexo oral','fornicacion',
    'prostituta','escort','prepago','fichera',
    'pornografia','porno','hentai','onlyfans','chaturbate',
    'penis','pussy','cunt','boobs','tits','blowjob','handjob','dildo','vibrator',
    'cocaina','heroina','metanfetamina','crystal meth','fentanilo',
];
const RISK_WORDS_BASE = {
    'sexo':5,'sex':5,'follar':5,'coger':5,'mame':5,'chingar':4,
    'sensual':1,'sexy':1,'sexi':1,'lenceria':1,'adulto':2,'erotico':2,'erotica':2,
};
const QUEJA_L1_BASE = [
    'queja','reclamo','exijo','inaceptable','terrible','pesimo','pésimo',
    'estafa','fraude','mentira','profeco','abogado','devolucion','devolución',
    'reembolso','devolver','defectuoso','roto','dañado','falla','no funciona',
    'no sirve','cobro indebido','no llegó','no llego',
];
const QUEJA_L2_BASE = [
    'quiero hablar con','pasame con','pásame con','hablar con alguien',
    'quiero una persona','un humano','gerente','supervisor','encargado',
    'no me resuelves','basta del robot','no sirves','no ayudas',
];

const CATEGORIAS = ['bw_word', 'bw_long', 'risk', 'queja_l1', 'queja_l2'];

// Crea la tabla si no existe — idempotente, se puede llamar desde el bot y
// desde el dashboard sin coordinarse (procesos independientes).
function asegurarTabla(db) {
    try {
        db.prepare(`CREATE TABLE IF NOT EXISTS palabras_filtro (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            categoria TEXT NOT NULL CHECK(categoria IN ('bw_word','bw_long','risk','queja_l1','queja_l2')),
            palabra TEXT NOT NULL,
            puntos INTEGER,
            origen TEXT NOT NULL DEFAULT 'dashboard' CHECK(origen IN ('codigo_fuente','dashboard')),
            activo INTEGER NOT NULL DEFAULT 1,
            creado_por TEXT,
            creado_en TEXT DEFAULT (datetime('now','localtime'))
        )`).run();
        db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_palabras_filtro_unica ON palabras_filtro(categoria, palabra)').run();
    } catch (e) {
        log.warn('No se pudo asegurar la tabla', e);
    }
}

// Palabras agregadas desde el dashboard (origen='dashboard', activo=1) — lo
// único que el bot necesita leer en caliente; las BASE ya están en código.
// Cualquier error (tabla no existe, BD ocupada, etc.) devuelve listas vacías.
function cargarPersonalizadas(db) {
    const vacio = { bwWord: [], bwLong: [], risk: {}, quejaL1: [], quejaL2: [] };
    try {
        const filas = db.prepare(
            "SELECT categoria, palabra, puntos FROM palabras_filtro WHERE origen='dashboard' AND activo=1"
        ).all();
        const out = { bwWord: [], bwLong: [], risk: {}, quejaL1: [], quejaL2: [] };
        for (const f of filas) {
            const p = (f.palabra || '').toLowerCase().trim();
            if (!p) continue;
            if (f.categoria === 'bw_word') out.bwWord.push(p);
            else if (f.categoria === 'bw_long') out.bwLong.push(p);
            else if (f.categoria === 'risk') out.risk[p] = f.puntos || 1;
            else if (f.categoria === 'queja_l1') out.quejaL1.push(p);
            else if (f.categoria === 'queja_l2') out.quejaL2.push(p);
        }
        return out;
    } catch (_) {
        return vacio;
    }
}

// Vista combinada para el panel de prime: palabras BASE (código — visibles
// pero no editables) + palabras agregadas desde el dashboard (editables y
// borrables). Las BASE se reconstruyen al vuelo desde los arreglos de arriba,
// nunca se duplican en la tabla.
function listarTodas(db) {
    const base = []
        .concat(BW_WORD_BASE.map(p => ({ categoria: 'bw_word', palabra: p })))
        .concat(BW_LONG_BASE.map(p => ({ categoria: 'bw_long', palabra: p })))
        .concat(Object.entries(RISK_WORDS_BASE).map(([p, puntos]) => ({ categoria: 'risk', palabra: p, puntos })))
        .concat(QUEJA_L1_BASE.map(p => ({ categoria: 'queja_l1', palabra: p })))
        .concat(QUEJA_L2_BASE.map(p => ({ categoria: 'queja_l2', palabra: p })))
        .map(r => ({ id: null, puntos: null, creado_por: null, creado_en: null, ...r, origen: 'codigo_fuente', activo: 1 }));

    let personalizadas = [];
    try {
        personalizadas = db.prepare(
            'SELECT id, categoria, palabra, puntos, origen, activo, creado_por, creado_en FROM palabras_filtro ORDER BY creado_en DESC'
        ).all();
    } catch (_) { /* tabla no existe todavía — solo se muestran las BASE */ }

    return base.concat(personalizadas);
}

function agregarPalabra(db, { categoria, palabra, puntos, creado_por }) {
    asegurarTabla(db);
    const p = String(palabra).toLowerCase().trim();
    const info = db.prepare(
        "INSERT INTO palabras_filtro (categoria, palabra, puntos, origen, creado_por) VALUES (?, ?, ?, 'dashboard', ?)"
    ).run(categoria, p, categoria === 'risk' ? (puntos || 1) : null, creado_por || null);
    return info.lastInsertRowid;
}

function eliminarPalabra(db, id) {
    const fila = db.prepare('SELECT origen FROM palabras_filtro WHERE id=?').get(id);
    if (!fila) return { ok: false, error: 'No encontrada' };
    if (fila.origen === 'codigo_fuente') return { ok: false, error: 'Esta palabra está fija en el código fuente — no se puede eliminar desde el panel' };
    db.prepare('DELETE FROM palabras_filtro WHERE id=?').run(id);
    return { ok: true };
}

function togglePalabra(db, id, activo) {
    const fila = db.prepare('SELECT origen FROM palabras_filtro WHERE id=?').get(id);
    if (!fila) return { ok: false, error: 'No encontrada' };
    if (fila.origen === 'codigo_fuente') return { ok: false, error: 'Esta palabra está fija en el código fuente — no se puede desactivar desde el panel' };
    db.prepare('UPDATE palabras_filtro SET activo=? WHERE id=?').run(activo ? 1 : 0, id);
    return { ok: true };
}

module.exports = {
    BW_WORD_BASE, BW_LONG_BASE, RISK_WORDS_BASE, QUEJA_L1_BASE, QUEJA_L2_BASE,
    CATEGORIAS,
    asegurarTabla, cargarPersonalizadas, listarTodas, agregarPalabra, eliminarPalabra, togglePalabra,
};
