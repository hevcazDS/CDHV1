// ═══════════════════════════════════════════════════════
//  menu.js — formato de resultados de búsqueda + menú principal
//  adaptativo por giro. Extraído mecánicamente de bot/flows/_shared.js,
//  sin cambio de lógica.
// ═══════════════════════════════════════════════════════
const { db, log, giros, vocab, t, moduloActivo, getValor, referidosService } = require('./_base');

// ═══════════════════════════════════════════════════════
//  HELPERS FORMATO
// ═══════════════════════════════════════════════════════
function formatProducts(products) {
    return products.map((p,i) => {
        // ponytail: umbral fijo de "vendidos"; ajustar si ventas_simuladas cambia de escala.
        const _vendidos = p.ventas_simuladas > 20 ? `\n   🔥 ${p.ventas_simuladas} vendidos` : '';
        return `${i+1}. *${p.name}*\n   📦 ${p.cat} · 💰 $${Number(p.price).toFixed(2)}${_vendidos}`;
    }).join('\n\n');
}

// ── Menú adaptativo por giro ─────────────────────────────────────
// Opciones canónicas del menú principal, en su orden histórico. El giro
// puede mostrar un subconjunto (ver _giros.menuDeGiro). 'referidos' además
// se filtra si su módulo está apagado, pero SOLO en giros adaptativos —
// en jugueteria/restaurante se conserva el soft-gate histórico (la opción
// se muestra y el handler responde "no disponible").
const MENU_KEYS_DEFAULT = ['buscar', 'wizard', 'rastrear', 'asesor', 'referidos'];
const _MENU_NUM = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣'];

function menuEsAdaptativo(giroKey) {
    return !!giros.menuDeGiro(giroKey);
}

// Opciones realmente visibles para el giro, ya filtradas por módulo activo.
function menuItemsActivos(giroKey) {
    const base = giros.menuDeGiro(giroKey) || MENU_KEYS_DEFAULT;
    return base.filter(k => {
        if (k === 'referidos') {
            try { return !!(referidosService.referidosActivo && referidosService.referidosActivo()); }
            catch(_) { return false; }
        }
        if (k === 'citas') return moduloActivo('citas_activo'); // default OFF
        return true;
    });
}

// Resuelve el número/keyword tecleado en MENU a una clave canónica de opción
// ('buscar'|'wizard'|'rastrear'|'asesor'|'referidos'|null), respetando el
// orden REAL mostrado para el giro activo. Para giros NO adaptativos usa el
// orden fijo de 5 (así el dígito 5 sigue siendo 'referidos' aunque el módulo
// esté apagado — soft-gate histórico intacto).
const _MENU_ALIAS = {
    buscar:    ['buscar'],
    wizard:    ['wizard', 'ayuda'],
    rastrear:  ['rastrear', 'pedido', 'mis pedidos', 'historial'],
    asesor:    ['asesor'],
    citas:     ['cita', 'citas', 'agendar', 'agendar cita', 'reservar'],
    referidos: ['referido', 'referidos', 'codigo de referido', 'código de referido', 'mi codigo', 'mi código'],
};
function resolverOpcionMenu(action) {
    const a = (action || '').trim().toLowerCase();
    if (!a) return null;
    const giroKey = getValor('giro', 'jugueteria');
    const keys = menuEsAdaptativo(giroKey) ? menuItemsActivos(giroKey) : MENU_KEYS_DEFAULT;
    if (/^\d+$/.test(a)) {
        return keys[parseInt(a, 10) - 1] || null;
    }
    for (const k of keys) {
        if ((_MENU_ALIAS[k] || []).includes(a)) return k;
    }
    return null;
}

// Texto numerado de opciones para giros con menú adaptativo (menos opciones).
function menuOpcionesAdaptativo(giroKey) {
    const V = vocab();
    const keys = menuItemsActivos(giroKey);
    const LABELS = {
        buscar:    '🔍 Buscar ' + V.item,
        wizard:    '🧙 Ayúdame a elegir',
        rastrear:  '📦 Rastrear mi pedido',
        asesor:    '👤 Hablar con una persona',
        citas:     '📅 Agendar una cita',
        referidos: '🎁 Mi código de referido',
    };
    const lineas = keys.map((k, i) => (_MENU_NUM[i] || (i + 1) + '️⃣') + '  ' + (LABELS[k] || k));
    return 'Soy tu asistente. ¿Cómo te puedo ayudar?\n\n' + lineas.join('\n');
}

function menuPrincipal(tel) {
    // Saludo diferenciado para clientes recurrentes — usa el tono configurado
    let saludo = t('saludo_nuevo') || '🧸 ¡Hola! Bienvenido a *Julio Cepeda Jugueterías* 🎉';
    if (tel) {
        try {
            const cli = db.prepare('SELECT nombre, tags, etapa FROM clientes WHERE telefono=?').get(tel);
            if (cli) {
                const nombre = (cli.nombre || '').split(' ')[0];
                const nVar = nombre ? ', *' + nombre + '* ' : ' ';
                // P2 (CRM): un cliente 'ganado' (ya compró) recibe un saludo más
                // cálido de cliente frecuente; el resto de recurrentes (tag pedido_),
                // el de vuelta de siempre. Gated a crm_pipeline_activo → sin el CRM
                // el saludo es idéntico al histórico (JC byte-idéntico: no hay ganado).
                if (moduloActivo('crm_pipeline_activo') && cli.etapa === 'ganado') {
                    saludo = t('saludo_frecuente', { nombre: nVar }) ||
                        ('🧸 ¡Cuánto gusto tenerte de vuelta' + (nombre ? ', *' + nombre + '*' : '') + '! Gracias por tu preferencia 🎉');
                } else if ((cli.tags || '').includes('pedido_')) {
                    saludo = t('saludo_recurrente', { nombre: nVar }) ||
                        ('🧸 ¡Bienvenido de vuelta' + (nombre ? ', *' + nombre + '*' : '') + '! Qué gusto verte de nuevo 🎉');
                }
            }
        } catch(e) { log.debug('No se pudo cargar cliente para saludo: ' + e.message); }
    }
    // Giros adaptativos arman el menú dinámicamente (menos opciones); los
    // demás (jugueteria/restaurante) usan la frase del tono → byte-idéntico.
    const _giroKey = getValor('giro', 'jugueteria');
    const opciones = menuEsAdaptativo(_giroKey)
        ? menuOpcionesAdaptativo(_giroKey)
        : (t('menu_opciones') ||
            ('Soy tu asistente de ventas. ¿Cómo te puedo ayudar?\n\n' +
             '1️⃣  🔍 Sé qué juguete busco\n2️⃣  🧙 No sé qué pedir — ¡ayúdame!\n' +
             '3️⃣  📦 Rastrear mi pedido\n4️⃣  👤 Hablar con un asesor\n5️⃣  🎁 Mi código de referido'));
    return saludo + '\n\n' + opciones + '\n\n_Escribe el número de tu opción._';
}

module.exports = {
    formatProducts,
    menuEsAdaptativo,
    menuItemsActivos,
    resolverOpcionMenu,
    menuPrincipal,
};
