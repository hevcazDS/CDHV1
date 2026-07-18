// abandonoHandler.js — Captura el motivo de abandono de carrito
// Módulo separado, igual que puntosHandler.js: el bot lo llama con handle()
// solo cuando el cliente está en MENU — si retorna null, el flujo continúa
// normal. Intercepta texto libre (precio/envío/otro) en respuesta al mensaje
// de recuperación de carrito que manda stockWatcher.js.
'use strict';

const db = require('../db_connection');

const _MOTIVOS = [
    { motivo: 'precio', re: /\bprecio\b/i },
    { motivo: 'envio',  re: /\benv[ií]o\b/i },
    { motivo: 'otro',   re: /\botro\b/i },
];

// Función principal — retorna string si manejó el mensaje, null si no
function handle(raw, tel) {
    const rawTrim = (raw || '').trim();
    const match = _MOTIVOS.find(m => m.re.test(rawTrim));
    if (!match) return null;

    try {
        const pendiente = db.prepare(`
            SELECT id FROM carritos_abandonados
            WHERE telefono LIKE ? AND notificado = 1 AND convertido = 0
              AND motivo IS NULL
              AND datetime(notificado_en, '+72 hours') >= datetime('now','localtime')
            ORDER BY notificado_en DESC LIMIT 1
        `).get('%' + tel + '%');
        if (!pendiente) return null;

        db.prepare('UPDATE carritos_abandonados SET motivo=? WHERE id=?').run(match.motivo, pendiente.id);
        // CRM (P0/P1-b): el "por qué se perdió" es el dato más valioso del pipeline
        // y ya se está capturando — llevarlo a la ficha (nota + etapa 'perdido', que
        // nunca degrada un 'ganado'). Solo datos, fail-soft.
        try {
            const crmBot = require('../../services/crmBot');
            crmBot.agregarNota(db, tel, 'Abandonó el carrito — motivo: ' + match.motivo);
            crmBot.avanzarEtapa(db, tel, 'perdido', { permitirPerdido: true });
        } catch (_) {}
        return '¡Gracias por contarnos! 🙏 Lo tomamos en cuenta.\n\nEscribe *hola* para ver el menú.';
    } catch (_) {
        // Columna `motivo` todavía no existe en producción, o cualquier otro
        // error de lectura — no interceptar, el flujo normal sigue intacto.
        return null;
    }
}

module.exports = { handle };
