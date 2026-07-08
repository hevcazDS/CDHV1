// ÚNICA fuente de verdad de la jerarquía de roles y sus áreas (espejo
// frontend: dashboard-ui/src/lib/permisos.js — mantener idénticos).
// prime > gerente ("Administrador" en UI) son jerárquicos; el resto son
// ESPECIALISTAS: solo entran a sus áreas. Un rol/módulo ausente nunca
// bloquea la operación: gerente/prime cubren todas las áreas.
'use strict';

const RANGO_ROL = {
    cajero: 1, operador: 1, almacen: 1, compras: 1, rh: 1, contabilidad: 1, auditor: 1,
    usuario: 1,           // legacy → operador (migración 0023)
    gerente: 2, admin: 2, // "Administrador" en UI
    prime: 3,
};

// Áreas por rol especialista. gerente/prime pasan todas.
const AREAS_POR_ROL = {
    cajero:       ['pos'],
    operador:     ['pos', 'operacion'],
    almacen:      ['almacen'],
    compras:      ['compras', 'almacen_lectura'],
    rh:           ['rrhh'],
    contabilidad: ['finanzas', 'rrhh', 'cortes'],
    usuario:      ['pos', 'operacion'],
};

// Roles que un gerente ("Administrador") puede crear/editar/borrar.
// gerente y prime solo los gestiona prime.
const ROLES_CREABLES_POR_GERENTE = ['cajero', 'operador', 'almacen', 'compras', 'rh', 'contabilidad'];

function rangoDe(rol) { return RANGO_ROL[rol] || 0; }
function esAdminOMas(rol) { return rangoDe(rol) >= 2; }

// El AUDITOR pasa TODAS las áreas — pero solo en LECTURA: server.js
// bloquea cualquier método distinto de GET para este rol (punto único).
function esAuditor(rol) { return rol === 'auditor'; }
function permite(rol, area) {
    if (esAdminOMas(rol) || esAuditor(rol)) return true;
    return (AREAS_POR_ROL[rol] || []).includes(area);
}

module.exports = { RANGO_ROL, AREAS_POR_ROL, ROLES_CREABLES_POR_GERENTE, rangoDe, esAdminOMas, esAuditor, permite };
