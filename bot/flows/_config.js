// flows/_config.js — Sistema de tonos y módulos
// ═══════════════════════════════════════════════════════════════
// TONOS (configuracion.tono_bot):
//   A = Formal (usted)   B = Casual   C = Amigable (default)
//   D = Ventas 23-40 (beneficio primero, urgencia honesta)
// MÓDULOS (configuracion.<clave>_activo = '1'/'0'):
//   puntos, ofertas, upselling, lista_espera, carritos, vision, csat
// El dashboard escribe en la tabla `configuracion`; aquí se lee
// con cache de 60s — sin reiniciar el bot.
// REGLA DE NEGOCIO: la palabra "gratis" SOLO se usa para envío/flete.
// ═══════════════════════════════════════════════════════════════
'use strict';
const db = require('../db_connection');

const TONOS_VALIDOS = ['A', 'B', 'C', 'D'];
const TTL_MS = 60_000;
let _cache = { tono: 'C', modulos: {}, ts: 0 };

function _refresh() {
    const now = Date.now();
    if (now - _cache.ts < TTL_MS) return;
    try {
        db.prepare(
            "CREATE TABLE IF NOT EXISTS configuracion (clave TEXT PRIMARY KEY, valor TEXT NOT NULL DEFAULT '1', descripcion TEXT, actualizado_en TEXT DEFAULT (datetime('now','localtime')))"
        ).run();
        const rows = db.prepare('SELECT clave, valor FROM configuracion').all();
        const map = {};
        for (const r of rows) map[r.clave] = String(r.valor);
        _cache.modulos = map;
        _cache.tono = TONOS_VALIDOS.includes(map.tono_bot) ? map.tono_bot : 'C';
        _cache.ts = now;
    } catch (_) {
        _cache.ts = now; // no martillar la DB si falla
    }
}

function getTono() { _refresh(); return _cache.tono; }
function invalidarCache() { _cache.ts = 0; }

// Lectura genérica de cualquier clave de `configuracion`, con el mismo cache
// de 60s que tono/módulos -- usada para ajustes que antes solo vivían en
// .env (operador_telefono, bot_email_usuario, etc.) y ahora prime puede
// sobreescribir desde el dashboard sin reiniciar el bot. `fallback` es lo
// que se devuelve si la clave nunca se ha escrito (normalmente la env var).
function getValor(clave, fallback = null) {
    _refresh();
    const v = _cache.modulos[clave];
    return (v !== undefined && v !== '') ? v : fallback;
}

// Flags que arrancan apagados si nunca se han tocado en `configuracion`:
// puntos (módulo opcional), las dos integraciones de API real (deben
// quedarse en modo simulado/demo hasta que el usuario prime las encienda),
// y la reconexión automática de WhatsApp en el mismo proceso (por defecto
// el bot se queda detenido tras un 'disconnected' en vez de reintentar solo
// — ver bot/index.js y bot/reconexionAutomatica.js).
const _DEFAULT_OFF = new Set(['puntos_activo', 'pago_real_activo', 'estafeta_real_activo', 'reconexion_auto_activo']);

function moduloActivo(clave) {
    _refresh();
    const v = _cache.modulos[clave];
    if (v === undefined) return !_DEFAULT_OFF.has(clave);
    return v === '1' || v === 'true';
}

// ── Diccionario de frases por tono ────────────────────────────
// Placeholders: {nombre} {ciudad} {flete} {carrito} {horario} {n}
const FRASES = {
    saludo_nuevo: {
        A: 'Bienvenido a *Julio Cepeda Jugueterías*. Es un gusto atenderle.',
        B: '¡Hola! Soy el bot de *Julio Cepeda*. ¿Qué necesitas?',
        C: '🧸 ¡Hola! Bienvenido a *Julio Cepeda Jugueterías* 🎉',
        D: '🧸 ¡Hola! Soy *Julio Cepeda*. +600 juguetes, varios con entrega hoy. ¿Qué buscas?',
    },
    saludo_recurrente: {
        A: 'Bienvenido nuevamente{nombre}. Es un placer atenderle otra vez.',
        B: '¡Hola de nuevo{nombre}! ¿Qué buscas hoy?',
        C: '🧸 ¡Bienvenido de vuelta{nombre}! Qué gusto verte de nuevo en *Julio Cepeda Jugueterías* 🎉',
        D: '{nombre}¡qué bueno verte de nuevo! 🧸 ¿Repetimos la experiencia o buscamos algo nuevo?',
    },
    menu_opciones: {
        A: '¿En qué podemos servirle el día de hoy?\n\n1️⃣  Buscar un producto\n2️⃣  Recibir una recomendación\n3️⃣  Rastrear su pedido\n4️⃣  Hablar con un asesor\n5️⃣  Su código de referido',
        B: '1️⃣  Buscar juguete\n2️⃣  Ayúdame a elegir\n3️⃣  Rastrear pedido\n4️⃣  Asesor\n5️⃣  Mi código de referido',
        C: 'Soy tu asistente de ventas. ¿Cómo te puedo ayudar?\n\n1️⃣  🔍 Sé qué juguete busco\n2️⃣  🧙 No sé qué pedir — ¡ayúdame!\n3️⃣  📦 Rastrear mi pedido\n4️⃣  👤 Hablar con un asesor\n5️⃣  🎁 Mi código de referido',
        D: '¿Qué hacemos?\n\n1️⃣  🔍 Ya sé qué busco\n2️⃣  🎯 Recomiéndame algo (3 preguntas, 30 segundos)\n3️⃣  📦 ¿Dónde va mi pedido?\n4️⃣  👤 Hablar con una persona\n5️⃣  🎁 Mi código de referido',
    },
    buscar_inicio: {
        A: '🔍 Indíquenos el nombre o descripción del producto. También puede enviar una fotografía 📸 o el enlace del artículo 🔗',
        B: '🔍 Dime qué buscas. Acepto nombre, foto 📸 o link 🔗',
        C: '🔍 ¿Qué juguete buscas? Puedes:\n\n· Escribir el nombre o descripción\n· Enviar una *foto* del juguete 📸\n· Pegar el *link* de donde lo viste 🔗\n\n_Ej: "carro de control remoto"_',
        D: 'Dispara 🎯 Nombre, foto 📸 o link 🔗 — lo que tengas. Yo lo encuentro en el catálogo.',
    },
    wizard_q1: {
        A: 'Con gusto le ayudamos a elegir. 🎁\n\n*Pregunta 1 de 3* — ¿Para quién es el juguete?\n\n1️⃣  👶 Bebé (0–2 años)\n2️⃣  🧒 Niño/a (3–8 años)\n3️⃣  🧑 Preadolescente (9–12)\n4️⃣  🎓 Adolescente / Adulto',
        B: 'Va. 3 preguntas y te doy opciones.\n\n¿Para quién es?\n\n1️⃣  👶 Bebé (0–2)\n2️⃣  🧒 Niño/a (3–8)\n3️⃣  🧑 De 9–12\n4️⃣  🎓 Adolescente / adulto',
        C: '🧙 ¡Te ayudo a encontrar el regalo perfecto! 🎁\n\n*Pregunta 1 de 3* — ¿Para quién es el juguete?\n\n1️⃣  👶 Bebé (0–2 años)\n2️⃣  🧒 Niño/a (3–8 años)\n3️⃣  🧑 Preadolescente (9–12)\n4️⃣  🎓 Adolescente / Adulto',
        D: '🎯 3 preguntas rápidas.\n\n*1/3* ¿Para quién es?\n\n1️⃣ 👶 Bebé (0–2)\n2️⃣ 🧒 Niño/a (3–8)\n3️⃣ 🧑 9–12\n4️⃣ 🎓 Adolescente/adulto',
    },
    asesor_notificado: {
        A: '👤 Su solicitud ha sido registrada y nuestro equipo de ventas notificado.\n⏰ Horario de atención: *{horario}*',
        B: '👤 Listo, ya avisé al equipo.\n⏰ Horario: *{horario}*',
        C: '👤 Hemos notificado a nuestro equipo de ventas.\n\n⏰ Horario de atención: *{horario}*',
        D: '✅ Listo, una persona te escribe pronto.\n⏰ *{horario}*',
    },
    agregado_pagar: {
        A: '✅ *{producto}* fue agregado a su carrito.\n\n📮 Indíquenos su *código postal* para verificar disponibilidad y proceder al pago:',
        B: '✅ *{producto}* agregado 🛒\n\n📮 Pásame tu *código postal* para checar disponibilidad y pagar:',
        C: '✅ *{producto}* agregado al carrito 🛒\n\n📮 Dime tu *código postal* para revisar disponibilidad y proceder al pago:',
        D: '*{producto}* en el carrito ✅\n\n📮 Tu *código postal* y te digo si lo tienes hoy mismo:',
    },
    disponibilidad_local: {
        A: '✅ Confirmamos disponibilidad en *{ciudad}*. ¿Cómo prefiere recibir su pedido?\n\n1️⃣  🏪 Recoger en sucursal — _sin costo, disponible hoy_\n2️⃣  🚚 Envío a domicilio — {flete}',
        B: '✅ Sí hay en *{ciudad}*. ¿Lo recoges o te lo mandamos?\n\n1️⃣  🏪 Pick Up — _sin costo, hoy_\n2️⃣  🚚 Envío — {flete}',
        C: '✅ Hay disponibilidad en *{ciudad}*. ¿Cómo lo recibes?\n\n1️⃣  🏪 Pick Up — _Sin costo, listo hoy_\n2️⃣  🚚 Envío a domicilio — {flete}',
        D: 'Está en *{ciudad}* y puede ser tuyo HOY ✅\n\n1️⃣  🏪 Lo recojo yo — _sin costo, listo en horas_\n2️⃣  🚚 Mándamelo — {flete}',
    },
    cancelado: {
        A: '❌ Su pedido ha sido cancelado. Quedamos a sus órdenes cuando guste retomarlo. Escriba *hola* para volver.',
        B: '❌ Cancelado. Aquí ando si cambias de opinión — escribe *hola*.',
        C: '❌ Pedido cancelado. Escribe *hola* cuando quieras volver. 🧸',
        D: 'Cancelado, sin dramas ✌️ Tu carrito te espera si regresas — escribe *hola* cuando quieras.',
    },
    error_generico: {
        A: '⚠️ Ha ocurrido un error en el sistema. Le pedimos escribir *hola* para reiniciar la conversación.',
        B: '⚠️ Algo falló. Escribe *hola* y reiniciamos.',
        C: '⚠️ ¡Ups! Algo salió mal. Escribe *hola* para reiniciar la conversación. 🧸',
        D: '⚡ Se cruzaron los cables. Escribe *hola* y seguimos.',
    },
    texto_libre: {
        A: 'Buen día. Soy el asistente virtual de *Julio Cepeda Jugueterías*. ¿En qué producto podemos ayudarle? 🧸',
        B: 'Hola, soy el bot de *Julio Cepeda*. ¿Qué juguete buscas? 🧸',
        C: 'Hola, soy el asistente de *Julio Cepeda Jugueterías*. ¿En qué juguete puedo ayudarte hoy? 🧸',
        D: '¡Hola! 🧸 Aquí *Julio Cepeda* — dime qué buscas (nombre, foto o link) y lo encuentro en segundos.',
    },
    lista_espera_oferta: {
        A: '🔍 Por el momento este artículo se encuentra agotado, pero recibiremos más unidades pronto. Si lo desea, le notificamos por WhatsApp en cuanto esté disponible:\n\n1️⃣  🔔 Notificarme cuando llegue\n2️⃣  🔍 Ver alternativas disponibles\n3️⃣  🏠 Volver al menú',
        B: '🔍 Está agotado ahorita, pero viene más. ¿Te aviso cuando llegue o vemos otra opción?\n\n1️⃣  🔔 Avísame\n2️⃣  🔍 Ver alternativas\n3️⃣  🏠 Menú',
        C: '🔍 ¡Este juguete está volando pero muy pronto tendremos más piezas! ¿Te avisamos por WhatsApp en cuanto aterrice en la tienda?\n\n1️⃣  🔔 Avísame cuando llegue\n2️⃣  🔍 ¡Cero estrés! Te ayudo a encontrar algo mejor hoy mismo\n3️⃣  🏠 Volver al menú principal',
        D: '📈 Agotado ahora, pero viene más en camino.\n\n1️⃣ 🔔 Avísame cuando llegue\n2️⃣ 🎯 Ver algo igual de bueno hoy\n3️⃣ 🏠 Menú',
    },
    gracias_cierre: {
        A: '🎉 Agradecemos su compra en *Julio Cepeda Jugueterías*.\n\n📋 Folio: *{folio}*\n\nLe avisaremos por este medio al confirmar su pago. 📲',
        B: '🎉 ¡Gracias por tu compra!\n\n📋 Folio: *{folio}*\n\nTe aviso cuando se confirme el pago. 📲',
        C: '🎉 *¡Gracias por tu compra en Julio Cepeda Jugueterías!*\n\n📋 Folio: *{folio}*\n\nTe avisamos por aquí cuando confirmemos tu pago. 📲\n\n¡Hasta pronto! 🧸',
        D: '🎉 ¡Listo! Pedido *{folio}* en marcha.\n\nTe aviso por aquí al confirmar tu pago. 📲',
    },
};

function t(clave, vars = {}) {
    const set = FRASES[clave];
    if (!set) return '';
    let txt = set[getTono()] || set.C || '';
    for (const k of Object.keys(vars)) {
        txt = txt.split('{' + k + '}').join(vars[k] == null ? '' : String(vars[k]));
    }
    return txt;
}

module.exports = { t, getTono, moduloActivo, getValor, invalidarCache, FRASES, TONOS_VALIDOS };
