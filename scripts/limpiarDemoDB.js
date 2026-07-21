'use strict';
require('dotenv').config();
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH;
if (!DB_PATH) { console.error('ERROR: DB_PATH no está definido en .env'); process.exit(1); }

const TABLAS_LIMPIAR = [
    'clientes', 'pedidos', 'pedido_detalle', 'links_pago',
    'asientos', 'asientos_detalle',
    'cola_notificaciones', 'cola_emails',
    'sesiones_bot', 'sesiones_dashboard', 'sesiones_usuario',
    'conversaciones', 'mensajes', 'mensajes_internos',
    'log_eventos', 'logs_error', 'bot_status_log',
    'metricas_bot', 'notificaciones_enviadas', 'configuracion_log',
    'activos_fijos', 'asistencias', 'citas', 'chats_iniciados',
    'canal_miembros', 'canales_internos', 'contadores_caso',
    'correos', 'cortes_caja', 'cortes_caja_legacy', 'cotizaciones_bot',
    'crm_campana_inscritos', 'crm_campana_pasos', 'crm_campanas',
    'crm_notas', 'crm_tareas', 'cuentas_pagar',
    'devolucion_detalle', 'devoluciones', 'direcciones_envio',
    'documentos', 'empleados', 'envios', 'estatus_envio_log',
    'estatus_pedido_log', 'facturas', 'guias_estafeta',
    'historial_costos', 'horarios_empleado', 'incapacidades_empleado',
    'intentos_entrega', 'intentos_pago', 'lista_espera',
    'mesa_items', 'nomina_extraordinaria', 'nominas',
    'ordenes_compra', 'ordenes_compra_detalle', 'ordenes_servicio',
    'pagos', 'preventa_clientes', 'preventas', 'puntos_cliente',
    'reembolsos', 'referidos', 'regalos_lealtad', 'repartidores',
    'repartos', 'reservas_pickup', 'suscripciones', 'tareas',
    'tickets_venta', 'transferencia_detalle', 'transferencias',
    'turnos_caja', 'valoraciones', 'ventas_previas', 'vision_cache',
    'vision_revisiones', 'promociones', 'alertas_reabasto', 'asesores',
    'solicitudes_compra', 'inventario_movimientos', 'movimientos_banco',
    'movimientos_contables', 'movimientos_inventario',
    'carritos_abandonados', 'cola_atencion',
];

const db = new Database(DB_PATH, { timeout: 5000 });
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = OFF'); // off durante limpieza para no depender del orden de borrado

const existentes = new Set(
    db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name)
);

const resumen = {};

db.transaction(() => {
    // trg_asientos_no_delete / trg_kardex_no_delete se saltan cuando
    // mantenimiento_bd='1'. Se restaura a '0' al final del bloque.
    if (existentes.has('configuracion')) {
        db.prepare("INSERT INTO configuracion (clave,valor) VALUES ('mantenimiento_bd','1') ON CONFLICT(clave) DO UPDATE SET valor='1'").run();
    }

    for (const t of TABLAS_LIMPIAR) {
        if (!existentes.has(t)) { resumen[t] = '(no existe)'; continue; }
        const { changes } = db.prepare(`DELETE FROM ${t}`).run();
        resumen[t] = changes;
    }

    if (existentes.has('series_folios')) {
        db.prepare('UPDATE series_folios SET ultimo_folio=0').run();
    }

    if (existentes.has('configuracion')) {
        db.prepare("UPDATE configuracion SET valor='' WHERE clave='whatsapp_qr'").run();
        db.prepare("UPDATE configuracion SET valor='0' WHERE clave='mantenimiento_bd'").run();
        const hoy = new Date().toISOString().slice(0, 10);
        // Sin esto el watcher dispararía reactivación masiva en el primer arranque
        db.prepare("INSERT INTO configuracion (clave,valor) VALUES ('dormidos_ultimo_dia',?) ON CONFLICT(clave) DO UPDATE SET valor=excluded.valor").run(hoy);
    }
})();

db.pragma('foreign_keys = ON');

console.log('\n=== limpiarDemoDB — resumen ===');
let totalFilas = 0;
for (const [tabla, n] of Object.entries(resumen)) {
    if (n === '(no existe)') { console.log(`  ${tabla}: (no existe — omitida)`); continue; }
    console.log(`  ${tabla}: ${n} fila(s) borrada(s)`);
    if (typeof n === 'number') totalFilas += n;
}
console.log(`\nTotal filas borradas: ${totalFilas}`);
console.log('Ejecutando VACUUM...');
db.prepare('VACUUM').run();
console.log('Listo.\n');
db.close();
