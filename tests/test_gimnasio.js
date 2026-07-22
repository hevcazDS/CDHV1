'use strict';
// tests/test_gimnasio.js — preset del giro GIMNASIO (reusa citas+suscripción+pos,
// sin motor nuevo). Ancla el cableado para que un refactor no lo tire.
//   node --test tests/test_gimnasio.js
if (!process.env.CHROME_PATH) process.env.CHROME_PATH = '/usr/bin/true';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const g = require('../bot/flows/_giros');
const md = require('../bot/flows/modulosDefaults');
const gf = require('../bot/flows/giroFlows');

test('vocab del gimnasio: clase/clases/💪', () => {
    const v = g.getGiro('gimnasio').vocab;
    assert.deepStrictEqual({ item: v.item, items: v.items, emoji: v.emoji }, { item: 'clase', items: 'clases', emoji: '💪' });
});

test('menú de servicio (ofrece citas/reservar clase, sin wizard de regalo)', () => {
    const menu = g.menuDeGiro('gimnasio');
    assert(menu.includes('citas') && !menu.includes('wizard'));
});

test('módulos por giro: membresía (suscripción) + clases (citas) + suplementos (pos)', () => {
    const m = md.MODULOS_POR_GIRO.gimnasio;
    assert(m.includes('suscripcion_activo') && m.includes('citas_activo') && m.includes('pos_activo'));
});

test('flujos del giro incluyen el de citas (reservar/gestionar clase)', () => {
    const steps = gf.flowsDeGiro('gimnasio').flatMap(f => f.STEPS || []);
    assert(steps.includes('CITA_SERVICIO') && steps.includes('CITA_GESTION'));
});

test('el giro aparece en el catálogo de giros (onboarding lo listará)', () => {
    assert(g.getGiro('gimnasio').label.includes('Gimnasio'));
});
