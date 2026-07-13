'use strict';
// bot/flows/motor/seeder.js — carga una plantilla de grafo (JSON) a las tablas
// flujo_grafo/flujo_nodo/flujo_arista de una instancia. Usado por el onboarding
// (Fase 5) y por el harness de paridad (Fase 3). NO activa sin pasar el linter
// salvo que se fuerce (tests).
//
// Formato de plantilla:
// { giro_base, nodos: [ { paso, tipo, render?, frase_clave?, accion_entrada?,
//   params?, es_inicial?, aristas: [ { orden?, input, destino, label?, accion?, params? } ] } ] }

const fs = require('fs');
const path = require('path');
const linter = require('./linter');

function cargarPlantilla(nombre) {
    const p = path.join(__dirname, 'plantillas', nombre + '.json');
    return JSON.parse(fs.readFileSync(p, 'utf8'));
}

// Construye la forma en memoria (igual que grafo.js) para poder lintar antes de tocar la BD.
function _aMemoria(plantilla) {
    const nodos = {}, aristas = {};
    let inicial = null;
    for (const n of plantilla.nodos) {
        nodos[n.paso] = { paso: n.paso, tipo: n.tipo || 'conversacion', render: n.render,
            frase_clave: n.frase_clave, accion_entrada: n.accion_entrada, params: n.params || {}, es_inicial: !!n.es_inicial };
        if (n.es_inicial) inicial = n.paso;
        for (const a of (n.aristas || [])) (aristas[n.paso] = aristas[n.paso] || []).push({ ...a, params: a.params || {} });
    }
    return { inicial, nodos, aristas };
}

// sembrar(db, plantilla, { activar, forzar }) → { id, valido, errs }
// activar: marca activo=1 (desactiva otros). forzar: activa aunque el linter falle (SOLO tests).
function sembrar(db, plantilla, opts = {}) {
    const mem = _aMemoria(plantilla);
    const val = linter.validar(mem);
    const valido = val.ok ? 1 : 0;

    const tx = db.transaction(() => {
        if (opts.activar) db.prepare('UPDATE flujo_grafo SET activo = 0').run();
        const gid = db.prepare('INSERT INTO flujo_grafo (version, giro_base, activo, valido) VALUES (1, ?, ?, ?)')
            .run(plantilla.giro_base || null, opts.activar ? 1 : 0, (valido || opts.forzar) ? 1 : 0).lastInsertRowid;
        const insN = db.prepare('INSERT INTO flujo_nodo (id_grafo, paso, tipo, render, frase_clave, accion_entrada, params_json, es_inicial) VALUES (?,?,?,?,?,?,?,?)');
        const insA = db.prepare('INSERT INTO flujo_arista (id_grafo, paso, orden, label, input, destino, accion, params_json) VALUES (?,?,?,?,?,?,?,?)');
        for (const n of plantilla.nodos) {
            insN.run(gid, n.paso, n.tipo || 'conversacion', n.render || null, n.frase_clave || null,
                n.accion_entrada || null, JSON.stringify(n.params || {}), n.es_inicial ? 1 : 0);
            let orden = 0;
            for (const a of (n.aristas || [])) {
                insA.run(gid, n.paso, a.orden ?? ++orden, a.label || null, a.input, a.destino, a.accion || null, JSON.stringify(a.params || {}));
            }
        }
        return gid;
    });
    const id = tx();
    try { require('./grafo').invalidar(); } catch (_) {}
    return { id, valido, errs: val.errs };
}

// Qué plantilla siembra cada giro en el onboarding. Los giros de servicio usan el
// delta de barbería (base sin wizard + citas); el resto comparte la base JC.
const PLANTILLA_POR_GIRO = {
    jugueteria: 'jugueteria', retail: 'jugueteria', abarrotes: 'jugueteria',
    carniceria: 'jugueteria', ferreteria: 'jugueteria', restaurante: 'jugueteria', custom: 'jugueteria',
    servicios: 'barberia', mantenimiento: 'barberia', barberia: 'barberia',
    tatuajes: 'barberia', estetica: 'barberia', unas: 'barberia', freelancer: 'barberia',
};

// Siembra la plantilla del giro (activa+válida) si existe. Idempotente en la
// práctica del onboarding (solo corre una vez, negocio_configurado lo bloquea).
// NO enciende motor_flujo_activo: el grafo queda listo pero el motor es opt-in
// desde Módulos (así una instancia nueva corre igual hasta que el dueño lo active).
function sembrarGiro(db, giro) {
    const nombre = PLANTILLA_POR_GIRO[giro];
    if (!nombre) return null;
    try { return sembrar(db, cargarPlantilla(nombre), { activar: true }); }
    catch (e) { return { id: null, valido: 0, errs: [e.message] }; }
}

module.exports = { cargarPlantilla, sembrar, sembrarGiro, PLANTILLA_POR_GIRO, _aMemoria };
