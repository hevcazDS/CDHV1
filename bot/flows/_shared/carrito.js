// ═══════════════════════════════════════════════════════
//  carrito.js — matemática de carrito, cupones, y partición
//  pickup/envío por stock. Extraído mecánicamente de bot/flows/_shared.js,
//  sin cambio de lógica.
// ═══════════════════════════════════════════════════════
const { db, maxMismoProd, stockBatch } = require('./_base');

/**
 * Agrega un producto al carrito.
 * Regla: mismo producto máximo MAX_MISMO_PROD veces.
 * Retorna { ok, carrito, total, escalar, cantidadActual }
 */
function agregarAlCarrito(carritoActual, producto) {
    const carrito = carritoActual ? [...carritoActual] : [];
    // misma prenda en otra talla/color = renglón aparte
    const idx     = carrito.findIndex(i => i.id === producto.id && (i.id_variante || null) === (producto.id_variante || null));
    const cantidadActual = idx >= 0 ? carrito[idx].cantidad : 0;

    if (cantidadActual >= maxMismoProd()) {
        return { ok: false, escalar: true, cantidadActual, carrito, total: totalCarrito(carrito) };
    }

    if (idx >= 0) {
        carrito[idx] = { ...carrito[idx], cantidad: carrito[idx].cantidad + 1 };
    } else {
        carrito.push({ ...producto, cantidad: 1 });
    }

    return { ok: true, escalar: false, cantidadActual: cantidadActual + 1, carrito, total: totalCarrito(carrito) };
}

function totalCarrito(carrito) {
    return carrito.reduce((sum, i) => sum + i.price * i.cantidad, 0);
}

function aplicarCupon(codigo, carrito, idProducto) {
    if (!codigo) return { ok: false, error: 'Sin código' };
    const hoy = new Date().toISOString().slice(0, 10);
    const promo = db.prepare(`
        SELECT * FROM promociones
        WHERE UPPER(codigo) = UPPER(?)
          AND activa = 1
          AND (fecha_inicio IS NULL OR fecha_inicio <= ?)
          AND (fecha_fin IS NULL OR fecha_fin >= ?)
          AND (usos_max = 0 OR usos_actual < usos_max)
        LIMIT 1
    `).get(codigo.trim(), hoy, hoy);

    if (!promo) return { ok: false, error: 'Código no válido o expirado' };

    // Alcance del cupón: producto único, categoría, marca o rango de edad
    // (Fase 2 — antes solo soportaba id_producto). Sin ninguno de los cuatro
    // aplica a todo el inventario. Basta con que UN item del carrito caiga
    // en el alcance para que el cupón sea válido (igual criterio que el
    // chequeo de id_producto que ya existía).
    if (promo.id_producto) {
        const tieneProducto = carrito.some(i => i.id === promo.id_producto);
        if (!tieneProducto) {
            const prod = db.prepare('SELECT name FROM productos WHERE id=?').get(promo.id_producto);
            return { ok: false, error: 'Este cupón aplica solo para *' + (prod?.name || 'un producto específico') + '*' };
        }
    } else if (promo.id_categoria || promo.brand || promo.edad_min != null || promo.edad_max != null) {
        const idsCarrito = carrito.map(i => i.id);
        if (!idsCarrito.length) return { ok: false, error: 'Tu carrito está vacío' };
        let sql = 'SELECT COUNT(*) AS n FROM productos WHERE id IN (' + idsCarrito.map(() => '?').join(',') + ')';
        const params = [...idsCarrito];
        if (promo.id_categoria) { sql += ' AND id_categoria=?'; params.push(promo.id_categoria); }
        if (promo.brand) { sql += ' AND brand=?'; params.push(promo.brand); }
        if (promo.edad_min != null || promo.edad_max != null) {
            sql += ' AND edad_min <= ? AND edad_max >= ?';
            params.push(promo.edad_max ?? 99, promo.edad_min ?? 0);
        }
        const { n } = db.prepare(sql).get(...params);
        if (!n) {
            const alcance = promo.id_categoria ? 'esta categoría' : promo.brand ? ('la marca ' + promo.brand) : 'este rango de edad';
            return { ok: false, error: 'Este cupón aplica solo para productos de ' + alcance + ' — ninguno de tu carrito califica.' };
        }
    }

    const subtotal = totalCarrito(carrito);
    let descuento = 0;
    if (promo.tipo === 'porcentaje') {
        descuento = Math.min(subtotal * (promo.valor / 100), subtotal);
    } else {
        descuento = Math.min(promo.valor, subtotal); // monto fijo — no puede superar el total
    }

    return {
        ok: true,
        promo,
        descuento:  parseFloat(descuento.toFixed(2)),
        totalFinal: parseFloat((subtotal - descuento).toFixed(2)),
        descripcion: promo.tipo === 'porcentaje'
            ? promo.valor + '% de descuento'
            : '$' + promo.valor.toFixed(2) + ' MXN de descuento',
    };
}

/** Valida stock de todos los items. Retorna array de items con problema. */
function validarStockMultiple(carrito, estadoCob) {
    const stock = stockBatch(carrito.map(i => i.id), estadoCob);
    return carrito.filter(item => {
        const { local, total } = stock.get(item.id);
        return local + total < item.cantidad;
    });
}

// ─────────────────────────────────────────────────────
//  PARTICIÓN DE CARRITO  (pickup disponible vs solo envío)
// ─────────────────────────────────────────────────────

/**
 * Clasifica cada item del carrito según stock local en la sucursal.
 * Retorna { pickup: [], envio: [], sinStock: [] }
 *   pickup   → tiene stock en tienda (puede recogerse hoy)
 *   envio    → solo stock en CEDIS/almacén (requiere envío o espera)
 *   sinStock → sin stock en ningún lado (escalar a asesor)
 */
function partirCarrito(carrito, estadoCob) {
    const pickup   = [];
    const envio    = [];
    const sinStock = [];
    const stock    = stockBatch(carrito.map(i => i.id), estadoCob);

    for (const item of carrito) {
        const { local: stLocal, total: stTotal } = stock.get(item.id);

        if (stLocal >= item.cantidad) {
            pickup.push({ ...item, _stLocal: stLocal, _stTotal: stTotal });
        } else if (stTotal >= item.cantidad) {
            // Calcular días estimados de entrega desde CEDIS
            const diasEst = stLocal > 0 ? 2 : 5;   // si hay algo en tienda viene pronto
            envio.push({ ...item, _stLocal: stLocal, _stTotal: stTotal, _diasEntrega: diasEst });
        } else {
            sinStock.push(item);
        }
    }
    return { pickup, envio, sinStock };
}

/**
 * Formatea bloque de productos con etiqueta de disponibilidad.
 * tipo: 'pickup' | 'envio'
 */
function formatParticion(items, tipo) {
    if (!items.length) return '';
    const icono = tipo === 'pickup' ? '🏪' : '📦';
    const label = tipo === 'pickup' ? 'Listo en tienda hoy' : 'Envío desde almacén';
    const lineas = items.map((i, n) => {
        const precio = `$${(i.price * i.cantidad).toFixed(2)}`;
        const extra  = tipo === 'envio' ? ` _(~${i._diasEntrega} días)_` : '';
        return `${n+1}. *${i.name}*  ×${i.cantidad}  ${precio}${extra}`;
    });
    return icono + ' *' + label + ':*\n' + lineas.join('\n');
}

/**
 * Genera el resumen del escenario mixto para presentar al cliente.
 * Incluye los tres escenarios posibles y sus costos.
 */
function resumenEscenariosMixtos(pickup, envio, subtotalPickup, subtotalEnvio, fleteEnvio, fleteUnificado) {
    const totalPickup  = subtotalPickup;
    const totalEnvio   = subtotalEnvio + fleteEnvio;
    const totalUnif    = subtotalPickup + subtotalEnvio + fleteUnificado;

    return (
        `📊 *Opciones de entrega para tu pedido:*

` +

        `*Opción A — Dos pedidos separados* ✂️
` +
        `${formatParticion(pickup,'pickup')}
` +
        `   💰 Subtotal pickup: $${subtotalPickup.toFixed(2)} MXN

` +
        `${formatParticion(envio,'envio')}
` +
        `   📦 Flete envío: ${fleteEnvio===0?'*¡GRATIS!*':`*$${fleteEnvio} MXN*`}
` +
        `   💰 Subtotal envío: $${totalEnvio.toFixed(2)} MXN
` +
        `━━━━━━━━━━━━━━━━━
` +
        `   💵 Total ambos pedidos: *$${(totalPickup+totalEnvio).toFixed(2)} MXN*

` +

        `*Opción B — Todo en sucursal* 🏪
` +
        `   Los ${envio.length} artículo${envio.length>1?'s':''} de envío llegarán a la tienda en ~${Math.max(...envio.map(i=>i._diasEntrega))} días hábiles.
` +
        `   💰 Total: *$${(subtotalPickup+subtotalEnvio).toFixed(2)} MXN* _(sin costo de flete)_

` +

        `*Opción C — Todo a domicilio* 🚚
` +
        `   📦 Flete único: ${fleteUnificado===0?'*¡GRATIS!*':`*$${fleteUnificado} MXN*`}
` +
        `   💰 Total: *$${totalUnif.toFixed(2)} MXN*`
    );
}

/** Formatea el carrito para mensaje WhatsApp */
function formatCarrito(carrito, flete = null) {
    if (!carrito || !carrito.length) return '_(Carrito vacío)_';
    const lineas = carrito.map((i, n) =>
        `${n+1}. *${i.name}*\n   💰 $${Number(i.price).toFixed(2)} × ${i.cantidad} = *$${(i.price * i.cantidad).toFixed(2)}*`
    );
    const subtotal = totalCarrito(carrito);
    let resumen = lineas.join('\n\n') + `\n\n━━━━━━━━━━━━━━━━━`;
    resumen += `\n🛒 Subtotal: *$${subtotal.toFixed(2)} MXN*`;
    if (flete !== null) {
        resumen += `\n📦 Envío: ${flete === 0 ? '*¡GRATIS!*' : `*$${flete} MXN*`}`;
        resumen += `\n💵 *Total: $${(subtotal + flete).toFixed(2)} MXN*`;
    }
    return resumen;
}

module.exports = {
    agregarAlCarrito,
    totalCarrito,
    aplicarCupon,
    validarStockMultiple,
    partirCarrito,
    formatParticion,
    resumenEscenariosMixtos,
    formatCarrito,
};
