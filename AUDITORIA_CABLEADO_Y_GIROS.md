# Auditoría de cableado endpoint→front y completitud por giro

ERP white-label (bot WhatsApp + dashboard), instancia por cliente. Foco NUEVO (no repite `AUDITORIA_HERRAMIENTAS_USUARIOS_2.md`, cuyos huecos de fiado/OC/propina ya están cerrados: `pos/fiados/*/abono` y `pagos/*/marcar-pagado` ya se ven en el front — verificado `Pedidos.jsx:87`, `Fiados`/`Mostrador`).

Método: índice canónico (`node scripts/rutas/inventario.js --json`, **260 rutas / 23 módulos**) cruzado programáticamente contra las 246 llamadas `api.get|post|put|del` de `dashboard-ui/src/**`, más los `href`/download links. Cada hallazgo con grep negativo. **Cero cambios de código.**

---

## (A) Cableado: endpoints ↔ front

### A.1 — Endpoints huérfanos (backend sin ningún botón que los llame)

Descartados como falsos positivos del matcher (SÍ tienen consumidor, verificado): `plantilla-conteo` y `plantilla-horarios` (links `href` de descarga — `ConteoTab.jsx:63`, `Rrhh.jsx:113`), `variantes`/`aguinaldo`/`finiquito`/`contabilidad-electronica`/`cfdi`/`puntos/config`/`repartidores POST` (llamados con template o fuera de `api.`), `cupon/redimir` (bot-side, `referidosService.js`), `almacen/salida`+`traslado` (sí en Almacen.jsx). Los **realmente muertos**:

| Método · ruta | Backend | ¿Qué hace? | Grep negativo (front) | Gravedad |
|---|---|---|---|---|
| `POST /api/pos/venta/:id/cancelar` | `pos.js:438` (impl. `ventaCancelar` :262, PIN) | **Reversa completa de venta de mostrador**: `reversionService.revertirCobro` devuelve inventario + revierte puntos, marca `cancelado_por/_en` | `grep -niE "cancelar\|anular\|reembols" Mostrador.jsx` = **0** | **ALTO** |
| `POST /api/pagos/:id/cancelar` | `comunicacionPedidos.js:451` | Cancela un link de pago | `grep "pagos.*cancelar" dashboard-ui/src` = **0**; `Pedidos.jsx` solo llama `marcar-pagado`/`enviar-link` (:87,:193) | MEDIO |
| `POST /api/pagos/:id/regenerar` | `comunicacionPedidos.js:452` | Regenera un link de pago vencido/roto | `grep "regenerar" dashboard-ui/src` = **0** | MEDIO |

### A.2 — Front roto (llama endpoint inexistente)
**Ninguno.** El único "hit" del diff (`GET /api/tareas${vista`) es un artefacto de mi normalización de query-string; `GET /api/tareas` existe (`tareas.js:91`). El cableado en sentido front→back está sano.

### A.3 — Datos que el endpoint devuelve y el front ignora
No se hallaron casos graves: `GET /api/stats` (`core.js:129-134`) expone `ventas_hoy`/`pedidos_pagados_hoy`/`cola_atencion` y los tres se pintan en `Inicio.jsx`. `pos/reparto` GET+POST ambos consumidos (`Mostrador.jsx:308,313`). Comanda de cocina completa (`mesas.js:88` ↔ `Mesas.jsx`).

---

## (B) Completitud por giro

Fuente: `MODULOS_POR_GIRO` (`modulosDefaults.js:71`) + `GIROS`/`MENU_GIRO`/`GIRO_FLOWS` (`_giros.js`, `giroFlows.js`).

| Giro | Operación diaria esperada | ¿Completa? | Evidencia |
|---|---|---|---|
| jugueteria / retail | catálogo, búsqueda, carrito, envío, POS | **Sí** | menú completo/sin-wizard; `pos_activo` on |
| abarrotes / carnicería / ferretería | mostrador, fiado, abono, cobro | **Sí** (post fix v2) | `ventas_credito_activo`; abono `pos.js:442` ya en front |
| restaurante | mesas, comanda cocina, propina, reparto, domicilio | **Sí** | `mesas_activo`+`propina`+`reparto`+`repartidor`; comanda `mesas.js:88`; reparto UI `Mostrador.jsx:308` |
| servicios / mantenimiento / barbería / estética / uñas / tatuajes | agenda de citas, cobro de cita | **Sí** | `citasFlow` registrado en `GIRO_FLOWS` (`giroFlows.js:30-36`); `citas.js` cobra→pedido+asiento+puntos |
| **isp** (Internet/TV, planes) | **facturación recurrente mensual + suspensión por falta de pago** | **NO** | ver HUECO 1 |
| **freelancer** | (giro pedido en el encargo) | **NO EXISTE** | ver HUECO 2 |

---

## HUECOS reales (ordenados por gravedad, con fix mínimo)

### ALTO — 1. Giro `isp` no tiene su operación real (cobro recurrente); está clonado de "citas"
- **Qué falta:** `isp` (`_giros.js:60`, item='plan') recibe **`citas_activo`** (`modulosDefaults.js:80`) y el **menú de servicio con opción "citas"** (`_giros.js:132`), es decir se comporta como una barbería. Pero la operación diaria de un ISP es **facturar la mensualidad del plan y suspender al moroso**, no agendar una cita para un plan de internet.
- **Grep negativo:** `grep -rniE "suscrip|recurren|mensualidad|cobro_recurrente|plan_mensual" bot/ dashboard/` → **0** handlers de cobro recurrente (solo aparece el tag `cliente_recurrente`, que es otra cosa). No hay tabla de suscripciones, ni cron de corte mensual, ni estado activo/suspendido de servicio.
- **Gravedad ALTO por ser cosmético:** el vertical existe en el selector de onboarding (`listaGiros`) → un cliente ISP lo elige, obtiene vocabulario "plan" pero **cero herramientas para cobrar**; peor, le ofrecen "agenda una cita" que no aplica.
- **Fix mínimo (lean):** o (a) **quitar `isp` del selector** hasta que se implemente su ciclo de cobro (una línea en `GIROS`), evitando vender una capacidad inexistente; o (b) si se quiere soportar de verdad, reusar `ventas_credito`/`recordatorio_fiado` (ya existen) como base de "mensualidad vencida" y darle menú sin `citas`. La opción (a) es la honesta hoy.

### MEDIO — 2. Giro `freelancer` no existe (pedido en el encargo, ausente en el código)
- **Grep negativo:** `grep -rn "freelancer" bot/flows/ dashboard/ dashboard-ui/src/` → **0**. No está en `GIROS`, ni `MODULOS_POR_GIRO`, ni `MENU_GIRO`.
- **Impacto:** no es un hueco de UI rota (no se puede seleccionar lo que no existe), pero sí una brecha de catálogo de giros vs. lo prometido. Un freelancer opera con cotización→servicio→cobro, cubierto funcionalmente por `servicios` (`citas`+`pos`).
- **Fix mínimo:** aliasar `freelancer → servicios` (una entrada en `GIROS`/`MODULOS_POR_GIRO` reusando el preset de servicios), o dejarlo fuera explícitamente. No requiere flujo nuevo.

### ALTO — 3. Venta de mostrador no se puede cancelar/anular desde la UI
- **Qué falta:** `POST /api/pos/venta/:id/cancelar` está **completo** en backend (`pos.js:438`, PIN, `reversionService.revertirCobro` devuelve inventario y puntos) pero **no hay botón** en `Mostrador.jsx` (`grep -niE "cancelar|anular|reembols|devolver venta"` = 0).
- **Impacto operativo real:** un cajero que teclea mal una venta (pasa a diario en mostrador) no puede revertirla; el inventario queda descuadrado y el corte de caja infla. La lógica correcta YA está escrita, solo falta el botón.
- **Fix mínimo:** botón "Cancelar venta" en el ticket recién emitido de `Mostrador.jsx` → `api.post('/api/pos/venta/'+id+'/cancelar')` (el endpoint ya pide PIN y revierte todo). Cero backend nuevo.

### MEDIO — 4. Link de pago: sin cancelar ni regenerar desde el panel
- **Qué falta:** `POST /api/pagos/:id/cancelar` y `.../regenerar` (`comunicacionPedidos.js:451-452`) no tienen UI (`Pedidos.jsx` solo `marcar-pagado`/`enviar-link`). Un link roto/vencido o enviado por error se queda "colgado": el operador solo puede marcarlo pagado o reenviar el mismo link.
- **Fix mínimo:** dos acciones más en el modal de pago de `Pedidos.jsx` (`pagoModal`, :273) que llamen a los endpoints ya existentes. Cero backend nuevo.

---

## Veredicto

**Cableado:** sano en sentido front→back (cero llamadas rotas). Del lado back→front hay **3 endpoints muertos**, todos con la lógica ya escrita y solo faltos de botón — el más caro es **cancelar venta de mostrador** (ALTO, descuadra inventario/corte). Ninguno requiere backend nuevo; son cuatro botones.

**Giros:** los verticales con módulo real (retail, fiado, restaurante, y toda la familia de citas/servicios) están **completos y bien cableados**. Las dos brechas son de **catálogo de giros**: `isp` está vendido pero clonado de "citas" sin su cobro recurrente (HUECO 1, ALTO por cosmético), y `freelancer` simplemente no existe (HUECO 2). Fix honesto inmediato: no ofrecer en onboarding lo que no se opera (quitar/aliasar), y construir el ciclo de mensualidad de ISP solo cuando un cliente ISP lo pida.
