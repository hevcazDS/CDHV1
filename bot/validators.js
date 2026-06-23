// validators.js — Validación con Zod
'use strict';

const { z }    = require('zod');
const crypto   = require('crypto');
const log      = require('./logger')('validators');

// Comparación a tiempo constante para secretos (passwords, códigos de reset) — evita timing attacks
function safeEqual(a, b) {
    const ha = crypto.createHash('sha256').update(String(a ?? '')).digest();
    const hb = crypto.createHash('sha256').update(String(b ?? '')).digest();
    return crypto.timingSafeEqual(ha, hb);
}

// ── 1. Variables de entorno requeridas al arrancar ─────────────
function validarEnv() {
    const requeridas = ['DB_PATH', 'CHROME_PATH'];
    const faltantes  = requeridas.filter(k => !process.env[k]);
    if (faltantes.length) {
        log.error('❌ Variables de entorno faltantes: ' + faltantes.join(', '));
        log.error('Copia .env.template a .env y completa los valores.');
        return { ok: false, faltantes };
    }
    if (!process.env.ASESOR_WHATSAPP)
        log.warn('⚠️  ASESOR_WHATSAPP no configurado — escaladas no llegarán al asesor');
    if (!process.env.DASHBOARD_PASS || process.env.DASHBOARD_PASS === 'cambiar_esto_urgente')
        log.warn('⚠️  DASHBOARD_PASS usa valor por defecto inseguro');
    return { ok: true };
}

// ── 2. Validar mensaje entrante de WhatsApp ────────────────────
function validarMensajeWhatsApp(msg) {
    if (!msg || typeof msg !== 'object') return { ok: false };
    if (!msg.from)                       return { ok: false };
    if (msg.from.endsWith('@g.us'))      return { ok: false, tipo: 'grupo' };
    if (msg.from.endsWith('@broadcast')) return { ok: false, tipo: 'broadcast' };
    if (msg.isStatus)                    return { ok: false, tipo: 'status' };
    if (msg.fromMe)                      return { ok: false, tipo: 'propio' };
    return { ok: true };
}

// ── 3. Schemas Zod para rutas POST del dashboard ──────────────

const NotificarSchema = z.object({
    telefono:  z.string().min(1, 'telefono requerido'),
    mensaje:   z.string().min(1, 'mensaje requerido').max(2000, 'mensaje demasiado largo'),
    idPedido:  z.number().int().positive().optional().nullable(),
});

const MasivoSchema = z.object({
    mensaje:       z.string().min(1, 'mensaje requerido').max(2000, 'mensaje demasiado largo'),
    soloConPedido: z.boolean().default(false),
    limite:        z.number().int().min(1).max(500).default(50),
    soloTags:      z.array(z.string().max(50)).default([]),
    excluirTags:   z.array(z.string().max(50)).default([]),
    sinActividad:  z.boolean().default(false),
    enviarEn:      z.string().optional().nullable(),
});

const GuiaSchema = z.object({
    numeroGuia:  z.string().min(1, 'numeroGuia requerido').max(50),
    estatus:     z.enum(['generada','recolectada','en_camino','en_ciudad','intento_fallido','entregada']),
    descripcion: z.string().max(200).default(''),
    ubicacion:   z.string().max(100).default(''),
});

const PreventaSchema = z.object({
    id_producto:         z.number().int().positive('id_producto debe ser número positivo'),
    nombre_preventa:     z.string().min(1).max(100),
    fecha_llegada_est:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'fecha debe ser YYYY-MM-DD'),
    precio_preventa:     z.number().positive('precio debe ser positivo'),
    stock_maximo:        z.number().int().min(1).default(50),
    porcentaje_anticipo: z.number().int().min(10).max(100).default(50),
});

const ModuloConfigSchema = z.object({
    clave: z.enum([
        'puntos_activo','vision_activo','ofertas_activo',
        'upselling_activo','lista_espera_activo','carritos_activo','csat_activo',
        'referidos_activo','emojis_dashboard_activo',
    ]),
    activo: z.boolean(),
});

// Flags de API real (pago/Estafeta) y de reconexión automática — solo el
// usuario prime puede tocarlos, por eso viven en un schema separado del
// ModuloConfigSchema de uso general.
const PrimeConfigSchema = z.object({
    clave: z.enum(['pago_real_activo', 'estafeta_real_activo', 'reconexion_auto_activo']),
    activo: z.boolean(),
});

// Confirmación manual de pago (efectivo/transferencia fuera de PayPal) — el
// asesor debe capturar la referencia de pago antes de marcarlo como pagado.
const PagoConfirmadoSchema = z.object({
    referencia_pago: z.string().min(1, 'referencia_pago requerida').max(100),
});

// Costo de envío — usado tanto para corregir un pedido puntual
// (PUT /api/prime/envio/:id) como para el default global
// (PUT /api/prime/envio-default). Antes cada ruta repetía el mismo chequeo
// inline (Number.isFinite + >=0); centralizado aquí para que ambas usen el
// mismo helper validar() que el resto de rutas POST/PUT.
const CostoEnvioSchema = z.object({
    costo_envio: z.number().finite('costo_envio inválido').nonnegative('costo_envio inválido'),
});

// POST /api/cupon/redimir — antes no validaba el tipo de idTicket; un valor
// no numérico no tronaba (better-sqlite3 simplemente no matcheaba ninguna
// fila), pero dejaba el ticket sin ligar a la promoción de forma silenciosa.
const CuponRedimirSchema = z.object({
    codigo: z.string().min(1, 'Falta código'),
    // nullish (no solo optional): el caller puede mandar null explícito para
    // decir "sin ticket", igual que antes con el chequeo `if (idTicket)`.
    idTicket: z.coerce.number().int().positive().nullish(),
});

// Carrito armado a mano por un asesor (POS) para un cliente — ids de
// producto reales, validados/cargados desde la tabla productos en el
// endpoint, no se confía en nombre/precio que venga del cliente HTTP.
const VentaPreviaSchema = z.object({
    telefono: z.string().min(1, 'telefono requerido'),
    items: z.array(z.object({
        id_producto: z.number().int().positive(),
        cantidad:    z.number().int().min(1).max(20),
    })).min(1, 'agrega al menos un producto'),
});

// Nombre comercial mostrado en el dashboard — editable solo por prime, para
// poder revender el panel a otra juguetería sin tocar código.
const NegocioSchema = z.object({
    nombre_negocio: z.string().min(1, 'nombre_negocio requerido').max(80),
});

// Teléfono del operador (antes solo ASESOR_WHATSAPP en .env), contacto de
// soporte (url/teléfono/correo) y destino(s) de correo de los backups
// automáticos (scripts/backup.js) — todo editable solo por prime, sin
// reiniciar ningún proceso (mismo patrón de cache de 60s que tono_bot).
const ConfigContactoSchema = z.object({
    operador_telefono:    z.string().max(30).optional().nullable(),
    soporte_url:          z.string().max(300).optional().nullable(),
    soporte_telefono:     z.string().max(30).optional().nullable(),
    soporte_correo:       z.string().max(120).optional().nullable(),
    email_backup_destino: z.string().max(300).optional().nullable(),
});

// Correo + contraseña de aplicación que usa el propio bot para enviar (antes
// solo EMAIL_USER/EMAIL_PASS en .env) — separado de ConfigContactoSchema
// porque la contraseña nunca se debe regresar en un GET, solo escribirse.
const ConfigEmailBotSchema = z.object({
    bot_email_usuario:  z.string().max(120).optional().nullable(),
    bot_email_password: z.string().max(200).optional().nullable(),
});

// Palabra/frase agregada por el usuario prime a la lista negra o detector de
// quejas — enriquece el filtro base que vive en bot/filtroPalabras.js.
const PalabraFiltroSchema = z.object({
    categoria: z.enum(['bw_word', 'bw_long', 'risk', 'queja_l1', 'queja_l2']),
    palabra:   z.string().min(1, 'palabra requerida').max(100),
    puntos:    z.number().int().min(1).max(10).optional().nullable(),
});

// Umbral de stock mínimo por producto+sucursal (tabla `inventarios`) — leído
// por services/stockWatcher.js:checkStockMinimo() para decidir cuándo
// avisarle al asesor que un producto está por agotarse en una sucursal.
const InventarioMinimoSchema = z.object({
    stock_minimo: z.number().int().min(0, 'stock_minimo no puede ser negativo'),
});

// Sucursal (tienda/bodega) — registro maestro, solo lo gestiona prime.
const SucursalSchema = z.object({
    nombre:        z.string().min(1, 'nombre requerido').max(80),
    codigo:        z.string().max(20).optional().nullable(),
    direccion:     z.string().max(200).optional().nullable(),
    codigo_postal: z.string().max(10).optional().nullable(),
});
const SucursalUpdateSchema = z.object({
    nombre:        z.string().min(1).max(80).optional(),
    codigo:        z.string().max(20).optional().nullable(),
    direccion:     z.string().max(200).optional().nullable(),
    codigo_postal: z.string().max(10).optional().nullable(),
    activa:        z.boolean().optional(),
});

// Alta/edición de productos — solo prime crea catálogo nuevo o ajusta el
// stock fijo por sucursal (stock_tienda/stock_cedis/stock_san_luis_potosi),
// que es justo lo que bot/flows/_shared.js usa para buscar y recomendar.
// stock_sucursales es aparte: stock inicial por cada fila de `sucursales`
// (la red de 11 sucursales reales, ver migrations/0005_sucursales_seed.sql)
// que dashboard/routes/primeCatalogo.js inserta en `inventarios` -- no
// reemplaza ni se mezcla con los 3 campos fijos de arriba.
// edad_recomendada NO se acepta del cliente: dashboard/routes/primeCatalogo.js
// la calcula siempre a partir de edad_min/edad_max ("{min} a {max} años" /
// "{min}+ años" si max>=99) -- evita que quede texto libre inconsistente con
// los rangos numéricos que sí usa bot/flows/_shared.js para filtrar.
const ProductoBaseSchema = z.object({
    name:                  z.string().min(1, 'name requerido').max(200),
    cat:                   z.string().max(80).optional().nullable(),
    price:                 z.number().min(0),
    costo:                 z.number().min(0).optional().nullable(),
    sku:                   z.string().max(60).optional().nullable(),
    upc:                   z.string().max(60).optional().nullable(),
    brand:                 z.string().max(100).optional().nullable(),
    handle:                z.string().max(200).optional().nullable(),
    description:           z.string().max(2000).optional().nullable(),
    url_imagen:            z.string().max(500).optional().nullable(),
    tags:                  z.string().max(300).optional().nullable(),
    seo_description:       z.string().max(500).optional().nullable(),
    material:              z.string().max(100).optional().nullable(),
    color:                 z.string().max(60).optional().nullable(),
    target_audience:       z.string().max(100).optional().nullable(),
    tipo_juguete:          z.string().max(50).optional().nullable(),
    edad_min:              z.number().int().min(0).max(99).optional().nullable(),
    edad_max:              z.number().int().min(0).max(99).optional().nullable(),
    genero:                z.string().max(20).optional().nullable(),
    id_categoria:          z.number().int().positive().optional().nullable(),
    peso_kg:               z.number().min(0).optional().nullable(),
    alto_cm:               z.number().min(0).optional().nullable(),
    ancho_cm:              z.number().min(0).optional().nullable(),
    largo_cm:              z.number().min(0).optional().nullable(),
    stock_tienda:          z.number().int().min(0).default(0),
    stock_cedis:           z.number().int().min(0).default(0),
    stock_san_luis_potosi: z.number().int().min(0).default(0),
    stock_exhibicion:      z.number().int().min(0).default(0),
    stock_queretaro:       z.number().int().min(0).default(0),
    stock_monterrey:       z.number().int().min(0).default(0),
    stock_cdmx_centro:     z.number().int().min(0).default(0),
    stock_base:            z.number().int().min(0).optional().nullable(),
    // Reemplaza al viejo stock_sucursales (mapa por las 11 sucursales) --
    // ahora el alta solo siembra `inventarios` en la sucursal de
    // facturación default (configuracion.sucursal_facturacion_default),
    // un solo número en vez de un mapa completo.
    stock_inicial:         z.number().int().min(0).optional(),
});
const _edadCoherente = (d) => d.edad_max == null || d.edad_min == null || d.edad_max >= d.edad_min;
const _edadCoherenteOpts = { message: 'edad_max no puede ser menor que edad_min', path: ['edad_max'] };
const ProductoSchema = ProductoBaseSchema.refine(_edadCoherente, _edadCoherenteOpts);
const ProductoUpdateSchema = ProductoBaseSchema.partial().extend({
    activo: z.boolean().optional(),
}).refine(_edadCoherente, _edadCoherenteOpts);

// Categoría de producto (tabla `categorias`) — lookup creable desde el
// formulario de alta ("crear categoría nueva" en vez de texto libre suelto).
const CategoriaSchema = z.object({
    nombre:      z.string().min(1, 'nombre requerido').max(80),
    descripcion: z.string().max(300).optional().nullable(),
});

// Alta de usuarios del dashboard — solo prime crea cuentas y decide el rol.
const UsuarioSchema = z.object({
    username: z.string().min(3, 'username debe tener al menos 3 caracteres').max(40),
    password: z.string().min(8, 'password debe tener al menos 8 caracteres').max(200),
    rol:      z.enum(['usuario', 'gerente', 'prime']),
    nombre:   z.string().trim().min(1).max(80).optional(),
});
const UsuarioUpdateSchema = z.object({
    password: z.string().min(8).max(200).optional(),
    rol:      z.enum(['usuario', 'gerente', 'prime']).optional(),
    nombre:   z.string().trim().min(1).max(80).optional(),
});

// Helper: convertir error Zod a string legible
function zodError(err) {
    if (!err?.issues) return String(err);
    return err.issues.map(i => i.path.join('.') + ': ' + i.message).join(', ');
}

// Wrapper para safeParse que devuelve { success, data, error }
function safe(schema, data) {
    const r = schema.safeParse(data);
    if (r.success) return { success: true, data: r.data };
    return { success: false, error: zodError(r.error) };
}

module.exports = {
    validarEnv,
    validarMensajeWhatsApp,
    safeEqual,
    NotificarSchema:    { safeParse: (d) => safe(NotificarSchema, d)    },
    MasivoSchema:       { safeParse: (d) => safe(MasivoSchema, d)       },
    GuiaSchema:         { safeParse: (d) => safe(GuiaSchema, d)         },
    PreventaSchema:     { safeParse: (d) => safe(PreventaSchema, d)     },
    ModuloConfigSchema: { safeParse: (d) => safe(ModuloConfigSchema, d) },
    PrimeConfigSchema:  { safeParse: (d) => safe(PrimeConfigSchema, d) },
    PagoConfirmadoSchema: { safeParse: (d) => safe(PagoConfirmadoSchema, d) },
    CostoEnvioSchema:     { safeParse: (d) => safe(CostoEnvioSchema, d) },
    CuponRedimirSchema:   { safeParse: (d) => safe(CuponRedimirSchema, d) },
    VentaPreviaSchema:  { safeParse: (d) => safe(VentaPreviaSchema, d) },
    NegocioSchema:      { safeParse: (d) => safe(NegocioSchema, d) },
    ConfigContactoSchema: { safeParse: (d) => safe(ConfigContactoSchema, d) },
    ConfigEmailBotSchema: { safeParse: (d) => safe(ConfigEmailBotSchema, d) },
    PalabraFiltroSchema: { safeParse: (d) => safe(PalabraFiltroSchema, d) },
    InventarioMinimoSchema: { safeParse: (d) => safe(InventarioMinimoSchema, d) },
    SucursalSchema:       { safeParse: (d) => safe(SucursalSchema, d) },
    SucursalUpdateSchema: { safeParse: (d) => safe(SucursalUpdateSchema, d) },
    ProductoSchema:       { safeParse: (d) => safe(ProductoSchema, d) },
    ProductoUpdateSchema: { safeParse: (d) => safe(ProductoUpdateSchema, d) },
    CategoriaSchema:      { safeParse: (d) => safe(CategoriaSchema, d) },
    UsuarioSchema:        { safeParse: (d) => safe(UsuarioSchema, d) },
    UsuarioUpdateSchema:  { safeParse: (d) => safe(UsuarioUpdateSchema, d) },
};
