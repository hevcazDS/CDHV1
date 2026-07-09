// flows/_giros.js — Presets de giro (vertical de negocio)
// ═══════════════════════════════════════════════════════════════
// El sistema dejó de ser exclusivo de juguetería: cada instancia elige
// un GIRO en el onboarding (configuracion.giro). El giro define el
// vocabulario que el bot usa ({item}/{items}/{emoji}) y, opcionalmente,
// reemplaza frases completas (campo `frases`) cuando un vertical necesita
// un texto muy distinto (ej. restaurante: "¿quieres ver el menú?").
//
// IMPORTANTE: el giro por defecto 'jugueteria' reproduce EXACTAMENTE el
// vocabulario que el bot ya usaba (item='juguete', emoji='🧸'), para que
// la instancia de Julio Cepeda no cambie ni una palabra al externalizar la
// copy. Los demás giros son la base para clientes nuevos.
'use strict';

// Cada giro: { label, vocab:{item, items, emoji}, frases?:{ clave:{A,B,C,D} } }
// Las claves de `frases` son las mismas de _config.js FRASES; si un tono no
// está definido en el override, _config.js cae al texto base (ya parametrizado
// con {negocio}/{item}/{items}/{emoji}).
const GIROS = {
    jugueteria: {
        label: '🧸 Juguetería / Retail',
        vocab: { item: 'juguete', items: 'juguetes', emoji: '🧸' },
        frases: {},
    },
    retail: {
        label: '🛍️ Retail genérico',
        vocab: { item: 'producto', items: 'productos', emoji: '🛍️' },
        frases: {},
    },
    restaurante: {
        label: '🍽️ Restaurante / Comida',
        vocab: { item: 'platillo', items: 'platillos', emoji: '🍽️' },
        frases: {
            menu_opciones: {
                A: '¿En qué podemos servirle hoy?\n\n1️⃣  Ver el menú / buscar un platillo\n2️⃣  Recomiéndeme algo\n3️⃣  Rastrear mi pedido\n4️⃣  Hablar con una persona\n5️⃣  Mi código de referido',
                B: '1️⃣  Ver el menú 🍽️\n2️⃣  ¿Qué me recomiendas?\n3️⃣  Rastrear pedido\n4️⃣  Persona\n5️⃣  Mi código de referido',
                C: '¡Hola! ¿Qué se te antoja hoy? 🍽️\n\n1️⃣  📋 Ver el menú / buscar platillo\n2️⃣  🤤 ¿Qué me recomiendas?\n3️⃣  🛵 Rastrear mi pedido\n4️⃣  👤 Hablar con una persona\n5️⃣  🎁 Mi código de referido',
                D: '¿Qué se te antoja? 🍽️\n\n1️⃣  📋 Ver el menú\n2️⃣  🔥 Lo más pedido\n3️⃣  🛵 ¿Dónde va mi pedido?\n4️⃣  👤 Hablar con una persona\n5️⃣  🎁 Mi código de referido',
            },
            buscar_inicio: {
                C: '🍽️ ¿Qué se te antoja? Escribe el nombre del platillo o pídeme el *menú*.',
            },
        },
    },
    abarrotes: {
        label: '🛒 Abarrotes / Minisúper',
        vocab: { item: 'producto', items: 'productos', emoji: '🛒' },
        frases: {},
    },
    carniceria: {
        label: '🥩 Carnicería',
        vocab: { item: 'corte', items: 'cortes', emoji: '🥩' },
        frases: {},
    },
    ferreteria: {
        label: '🔧 Ferretería',
        vocab: { item: 'producto', items: 'productos', emoji: '🔧' },
        frases: {},
    },
    isp: {
        label: '📡 Internet / TV (planes)',
        vocab: { item: 'plan', items: 'planes', emoji: '📡' },
        frases: {},
    },
    servicios: {
        label: '🛠️ Servicios',
        vocab: { item: 'servicio', items: 'servicios', emoji: '🛠️' },
        frases: {},
    },
    mantenimiento: {
        label: '🔧 Mantenimiento',
        vocab: { item: 'servicio', items: 'servicios', emoji: '🔧' },
        frases: {},
    },
    barberia: {
        label: '💈 Barbería',
        vocab: { item: 'servicio', items: 'servicios', emoji: '💈' },
        frases: {
            buscar_inicio: {
                C: '💈 ¿Qué servicio buscas? (corte, barba, etc.) o pide una *cita*.',
            },
        },
    },
    tatuajes: {
        label: '🎨 Estudio de tatuajes',
        vocab: { item: 'diseño', items: 'diseños', emoji: '🎨' },
        frases: {},
    },
    estetica: {
        label: '💅 Estética / Belleza',
        vocab: { item: 'servicio', items: 'servicios', emoji: '💅' },
        frases: {},
    },
    unas: {
        label: '💅 Estudio de uñas',
        vocab: { item: 'servicio', items: 'servicios', emoji: '💅' },
        frases: {},
    },
    custom: {
        label: '⚙️ Personalizado (desde cero)',
        vocab: { item: 'producto', items: 'productos', emoji: '🛍️' },
        frases: {},
    },
};

// Giro por defecto si nunca se configuró: 'jugueteria' mantiene el
// comportamiento histórico de la instancia de Julio Cepeda intacto.
const GIRO_DEFAULT = 'jugueteria';

// ── Menú adaptativo por giro ────────────────────────────────────
// Cada giro puede mostrar MENOS opciones de las 5 canónicas
// (['buscar','wizard','rastrear','asesor','referidos']). Solo se listan
// aquí los giros que difieren del menú completo; los demás (jugueteria,
// restaurante) usan las 5 y su texto sale de FRASES.menu_opciones (t()),
// así Julio Cepeda queda byte-idéntico.
//
// El asistente "ayúdame a elegir" (wizard) es un cuestionario de regalo
// por edad/género pensado para juguetería; no aplica a una tienda que se
// vende por nombre de producto (ropa, abarrotes, ferretería) ni a un
// negocio de servicios (barbería, uñas), así que esos giros lo omiten.
// restaurante SÍ lo conserva (ahí es "¿qué me recomiendas?").
const _MENU_SIN_WIZARD = ['buscar', 'rastrear', 'asesor', 'referidos'];
// Giros de SERVICIO: además ofrecen "agendar cita" (la opción solo se
// muestra si el módulo citas_activo está encendido — menuItemsActivos).
const _MENU_SERVICIO = ['buscar', 'citas', 'rastrear', 'asesor', 'referidos'];
const MENU_GIRO = {
    retail:        _MENU_SIN_WIZARD,
    abarrotes:     _MENU_SIN_WIZARD,
    carniceria:    _MENU_SIN_WIZARD,
    ferreteria:    _MENU_SIN_WIZARD,
    servicios:     _MENU_SERVICIO,
    isp:           _MENU_SERVICIO,
    mantenimiento: _MENU_SERVICIO,
    barberia:      _MENU_SERVICIO,
    tatuajes:      _MENU_SERVICIO,
    estetica:      _MENU_SERVICIO,
    unas:          _MENU_SERVICIO,
    custom:        _MENU_SIN_WIZARD,
};

// Devuelve el orden de opciones del giro, o null si usa el menú completo
// (5 opciones, comportamiento histórico).
function menuDeGiro(clave) {
    return MENU_GIRO[clave] || null;
}

function getGiro(clave) {
    return GIROS[clave] || GIROS[GIRO_DEFAULT];
}

// Lista para el selector del onboarding: [{ clave, label }]
function listaGiros() {
    return Object.keys(GIROS).map(clave => ({ clave, label: GIROS[clave].label }));
}

module.exports = { GIROS, GIRO_DEFAULT, getGiro, listaGiros, menuDeGiro, MENU_GIRO };
