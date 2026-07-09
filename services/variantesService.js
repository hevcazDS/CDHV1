// Variantes talla×color con stock por sucursal. El agregado del producto en
// `inventarios` se mantiene = suma de variantes por sucursal, y cada ajuste
// pasa por el kardex (auditable). Sin variantes activas, nada cambia.
'use strict';
const db = require('../bot/db_connection');
const kardex = require('./kardexService');

function etiqueta(v) {
    return [v.talla, v.color].filter(Boolean).join(' / ') || ('#' + v.id);
}

function tieneVariantes(idProducto) {
    try {
        return db.prepare('SELECT COUNT(*) c FROM producto_variantes WHERE id_producto=? AND activo=1').get(idProducto).c > 0;
    } catch (_) { return false; } // BD sin migrar → sin variantes
}

// Variantes activas con su stock total (todas las sucursales) — para el bot
function variantesConStock(idProducto) {
    try {
        return db.prepare(`
            SELECT v.id, v.talla, v.color, v.sku, v.upc,
                   COALESCE((SELECT SUM(stock) FROM inventario_variantes iv WHERE iv.id_variante = v.id), 0) stock
            FROM producto_variantes v
            WHERE v.id_producto=? AND v.activo=1
            ORDER BY v.talla, v.color`).all(idProducto)
            .map(v => ({ ...v, etiqueta: etiqueta(v) }));
    } catch (_) { return []; }
}

// Matriz completa para el editor de Prime (stocks por sucursal)
function matrizDe(idProducto) {
    const vars = db.prepare('SELECT * FROM producto_variantes WHERE id_producto=? ORDER BY talla, color').all(idProducto);
    const stocks = db.prepare('SELECT * FROM inventario_variantes WHERE id_variante IN (SELECT id FROM producto_variantes WHERE id_producto=?)').all(idProducto);
    return vars.map(v => ({
        ...v, etiqueta: etiqueta(v),
        stocks: stocks.filter(s => s.id_variante === v.id).reduce((m, s) => (m[s.sucursal] = s.stock, m), {}),
    }));
}

// Guarda la matriz del editor: upsert de variantes + stocks por sucursal, y
// recalcula el AGREGADO del producto en inventarios vía kardex (delta).
const guardarMatriz = db.transaction((idProducto, filas, usuario) => {
    const vivos = [];
    for (const f of filas) {
        const talla = String(f.talla || '').trim() || null;
        const color = String(f.color || '').trim() || null;
        if (!talla && !color) continue;
        let v = db.prepare('SELECT id FROM producto_variantes WHERE id_producto=? AND talla IS ? AND color IS ?').get(idProducto, talla, color);
        if (!v) {
            const r = db.prepare('INSERT INTO producto_variantes (id_producto, talla, color, sku, upc) VALUES (?,?,?,?,?)')
                .run(idProducto, talla, color, String(f.sku || '').trim() || null, String(f.upc || '').trim() || null);
            v = { id: r.lastInsertRowid };
        } else {
            db.prepare('UPDATE producto_variantes SET sku=?, upc=?, activo=1 WHERE id=?')
              .run(String(f.sku || '').trim() || null, String(f.upc || '').trim() || null, v.id);
        }
        vivos.push(v.id);
        for (const [sucursal, st] of Object.entries(f.stocks || {})) {
            const n = Math.max(0, parseInt(st, 10) || 0);
            db.prepare(`INSERT INTO inventario_variantes (id_variante, sucursal, stock) VALUES (?,?,?)
                        ON CONFLICT(id_variante, sucursal) DO UPDATE SET stock=excluded.stock`).run(v.id, sucursal, n);
        }
    }
    // filas quitadas del editor → variante inactiva (histórico intacto)
    const marcador = vivos.length ? vivos : [0];
    db.prepare(`UPDATE producto_variantes SET activo=0 WHERE id_producto=? AND id NOT IN (${marcador.map(() => '?').join(',')})`)
      .run(idProducto, ...marcador);

    // Recalcular agregado por sucursal → kardex con el delta (auditable)
    const porSucursal = db.prepare(`
        SELECT iv.sucursal, SUM(iv.stock) total FROM inventario_variantes iv
        JOIN producto_variantes v ON v.id = iv.id_variante
        WHERE v.id_producto=? AND v.activo=1 GROUP BY iv.sucursal`).all(idProducto);
    for (const s of porSucursal) {
        const actual = db.prepare('SELECT stock FROM inventarios WHERE id_producto=? AND sucursal=?').get(idProducto, s.sucursal)?.stock || 0;
        const delta = (s.total || 0) - actual;
        if (delta !== 0) {
            kardex.movimiento({ id_producto: idProducto, sucursal: s.sucursal, tipo: 'ajuste_variantes', delta, motivo: 'Matriz de variantes', usuario });
        }
    }
    return { variantes: vivos.length };
});

// Al vender un item con variante: espejo en inventario_variantes (best
// effort — el agregado ya lo descuenta el kardex de la venta).
function descontarVariante(idVariante, sucursal, cantidad) {
    try {
        db.prepare('UPDATE inventario_variantes SET stock = MAX(0, stock - ?) WHERE id_variante=? AND sucursal=?')
          .run(Math.round(cantidad), idVariante, sucursal);
    } catch (_) {}
}

// Buscar por UPC/SKU de VARIANTE (escáner del POS)
function porCodigo(codigo) {
    try {
        return db.prepare(`
            SELECT v.id id_variante, v.id_producto, v.talla, v.color, p.name, p.price, p.tipo
            FROM producto_variantes v JOIN productos p ON p.id = v.id_producto
            WHERE v.activo=1 AND (v.upc=? OR v.sku=?) LIMIT 1`).get(codigo, codigo);
    } catch (_) { return null; }
}

module.exports = { tieneVariantes, variantesConStock, matrizDe, guardarMatriz, descontarVariante, porCodigo, etiqueta, _setDb: (d) => {} };
