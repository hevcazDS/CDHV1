'use strict';
// Sucursal de facturación default (configuracion.sucursal_facturacion_default).
// El valor guardado es el ID de la sucursal; se resuelve a su nombre, con
// FALLBACK por nombre para instancias viejas que guardaron el nombre en vez del
// id. Devuelve el nombre (string) o null.
//
// Reemplaza 5 copias divergentes (pos/erpProveedores/mesas/compras/primeCatalogo):
// las de pos.js y primeCatalogo.js NO traían el fallback por-nombre → un negocio
// migrado que tuviera el nombre en la config no encontraba su sucursal (bug
// latente). Al centralizar aquí, todos obtienen el mismo comportamiento correcto.
function sucursalFacturacionDefault(db) {
    try {
        const v = db.prepare("SELECT valor FROM configuracion WHERE clave='sucursal_facturacion_default' LIMIT 1").get()?.valor;
        if (!v) return null;
        const porId = db.prepare('SELECT nombre FROM sucursales WHERE id=?').get(Number(v));
        if (porId) return porId.nombre;
        return db.prepare('SELECT nombre FROM sucursales WHERE nombre=?').get(v)?.nombre || null;
    } catch (_) { return null; }
}

// Sucursal EFECTIVA de una sesión del dashboard (multitienda, migración 0049):
// la tienda asignada al usuario (usuarios.sucursal) si existe en el catálogo;
// si no tiene (NULL — todos los usuarios pre-multitienda) cae a la sucursal de
// facturación default. Con una sola sucursal esto colapsa al comportamiento de
// siempre. Devuelve el nombre (string) o null.
function sucursalDeSesion(db, ses) {
    try {
        const s = ses && ses.username
            ? db.prepare('SELECT sucursal FROM usuarios WHERE username=?').get(ses.username)?.sucursal
            : null;
        if (s && db.prepare('SELECT 1 FROM sucursales WHERE nombre=?').get(s)) return s;
    } catch (_) { /* columna aún no migrada → default */ }
    return sucursalFacturacionDefault(db);
}

module.exports = { sucursalFacturacionDefault, sucursalDeSesion };
