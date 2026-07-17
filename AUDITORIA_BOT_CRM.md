# Auditoría: qué le falta al BOT para atender bien con el CRM

> Análisis 2026-07-17 (solo lectura, evidencia archivo:línea). Marco: el CRM ya
> existe (`dashboard/routes/crm.js`, `services/crmCampanas.js`, migraciones
> 0074-0076). **Principio rector del dueño**: el bot de WhatsApp es lo importante;
> el CRM lo apoya. Las brechas priorizadas son cosas que hacen al BOT **atender
> mejor** (resolver solo, escalar bien, reconocer al cliente), no features de panel.

## Hallazgo de fondo

El CRM tiene pipeline, notas, timeline, tareas, segmentos y campañas. El bot tiene
las **acciones** para alimentarlo (`crm_cambiar_etapa`, `crm_crear_tarea`,
`crm_agregar_nota` — `bot/flows/motor/actions.js:75-100`), **pero están inertes**:
solo las invoca el motor de flujo por grafo, que es `motor_flujo_activo` en
DEFAULT_OFF (`bot/flows/modulosDefaults.js:61`) y además "ON sin grafo activo no
opea" (`bot/actionHandler.js:150-154`). **Resultado: hoy, en producción (Julio
Cepeda y clones), el bot NO alimenta el pipeline durante la conversación.** El CRM
se puebla por derivación (`etapa NULL → ganado si pagó, si no lead`, `crm.js:18-22`)
y por el `lead_score` nocturno de stockWatcher (`stockWatcher.js:562-589`), no por
lo que pasa en el chat.

## (a) Capacidad CRM ↔ ¿el bot la alimenta/usa hoy?

| Capacidad CRM | ¿Bot? | Evidencia |
|---|---|---|
| Etapa `ganado` | Parcial (derivada, no en vivo) | Se infiere de pedido pagado en `crm.js:18-22`; el bot no la escribe al confirmar |
| Etapa `cotizado` | **No** | Ninguna ruta del bot pone `cotizado`; no existe concepto de cotización en flows |
| Etapa `contactado` | **No** | El primer mensaje del cliente no mueve etapa |
| Etapa `perdido` + motivo | **No** | `abandonoHandler.js:32` guarda `carritos_abandonados.motivo` pero **no** mueve etapa ni escribe nota CRM |
| `lead_score` por señales de compra | Parcial (batch, no conversacional) | Recalculo nocturno pedidos×10+gastado (`stockWatcher.js:576`); el chat no lo sube por intención |
| Tags de interés/intención | Parcial | `tagCliente` marca `pedido_`, `queja`, `blacklist` (`_shared.js:1189`); no tag de producto/categoría de interés |
| Notas automáticas desde la charla | **No** (acción inerte) | `crm_agregar_nota` existe pero solo vía motor OFF (`actions.js:93`) |
| Tareas de seguimiento desde la charla | **No** (acción inerte) | `crm_crear_tarea` idem (`actions.js:84`) |
| `marketing_opt_out` respetado (saliente) | **Sí** | Segmentos filtran `COALESCE(marketing_opt_out,0)=0` (`crm.js:161`); BAJA/ALTA en `actionHandler.js:100-107` |
| Campañas con gate humano | **Sí** | `campanaLanzar` gerente+, `INSERT log campana_lanzada` (`crm.js:246-258`) |
| Reconocer cliente en campaña activa | **No** | El bot no lee `crm_campana_inscritos`; saluda igual |
| Saludo diferenciado por etapa/valor | Parcial (crudo) | `menuPrincipal` distingue recurrente por `tags LIKE '%pedido_%'` (`_shared.js:1166`), **no** por etapa ni `lead_score` |
| Timeline del cliente (citas/notas/etapa) | N/A (lo lee el panel) | `crm.js:76-91` — el bot no necesita leerlo |

## (b) Top brechas priorizadas

### P0 — El bot no alimenta el pipeline en vivo (etapa cotizado/contactado/perdido)
- **Qué falta**: al confirmar pedido → `ganado`; al recibir el primer msg de un lead
  → `contactado`; al abandonar carrito con motivo → `perdido` + nota. Hoy nada de
  esto ocurre sin el motor (OFF).
- **Por qué importa para atender**: el equipo humano que retoma un chat escalado ve
  la etapa/nota y sabe en qué punto está el cliente; sin esto, escala "a ciegas".
- **Tipo**: **acción del lienzo YA existe** — el problema es que está inerte. No es
  código nuevo del bot: es **cablear las 3 acciones a puntos fijos del código**
  (no depender del motor por grafo).

### P0 — Reagendar / cancelar cita por el bot
- **Qué falta**: hoy `citasFlow.js:171` dice *"si necesitas cambiarla, escribe
  asesor"* — cero self-service. El cliente espera cambiar/cancelar su cita solo.
- **Por qué importa**: es la gestión de atención más pedida en giros de servicio
  (barbería/estética/uñas); mandar todo a humano satura `cola_atencion` con algo
  automatizable, y una cita no cancelada = slot muerto.
- **Tipo**: **MÓDULO/flow nuevo del bot** (estados `S.CITA_GESTION`), envuelve tablas
  `citas` (ya existen `estatus`, `slotsLibres`).

### P1 — `lead_score` no sube por señales de compra en la charla
- **Qué falta**: intención de compra fuerte (agrega al carrito, pide cotización,
  vuelve varias veces) no toca el score hasta el batch nocturno.
- **Por qué importa**: un lead caliente HOY debería subir de prioridad HOY para que
  el gerente lo trabaje; el batch lo entierra 24h.
- **Tipo**: **acción/gestión** — pequeño `+score` en `_shared` al agregar-al-carrito
  / confirmar, reutilizando el `UPDATE clientes SET lead_score` de `stockWatcher.js:583`.

### P1 — Capturar el motivo de no-compra dentro del pipeline
- **Qué falta**: `abandonoHandler` ya pregunta y guarda `motivo` (precio/envío/otro)
  pero **solo en `carritos_abandonados`**; no llega al CRM como etapa `perdido` ni
  como nota en la ficha.
- **Por qué importa**: el "por qué se perdió" es el dato más valioso del pipeline y
  ya se está capturando — solo se está tirando fuera del CRM.
- **Tipo**: **gestión** — en `abandonoHandler.js:32` añadir `crm_agregar_nota` +
  (opcional) mover a `perdido`. Envuelve la acción ya existente.

### P2 — Reconocer cliente en campaña activa / saludar por etapa
- **Qué falta**: `menuPrincipal` no lee `etapa`/`lead_score`/campaña; saluda "de
  vuelta" solo por tag `pedido_`.
- **Por qué importa**: un `ganado` recurrente y un lead frío merecen distinto tono;
  si el cliente responde a una campaña, el bot debería saber que viene de ahí.
- **Tipo**: **gestión** — enriquecer el saludo de `_shared.js:1160` leyendo
  `etapa`/`lead_score` (sin mensajes salientes nuevos).

### P2 — Consultar estado de cita/cotización por el bot
- **Qué falta**: "rastrear" cubre pedido/envío, pero no "¿cómo va mi cita?" ni "¿mi
  cotización?". 
- **Por qué importa**: reduce escaladas por preguntas de estatus.
- **Tipo**: **flow** menor (solo si se adopta cotizaciones; hoy `documentos_activo`
  existe pero el bot no lo consulta).

## (c) Plan corto (P0/P1)

**P0-a — Alimentar pipeline en vivo** (sin depender del motor):
- Etapa `ganado`: en los `grabarPedido*` de `_shared.js` (chokepoint de venta),
  llamar `crm_cambiar_etapa` con `etapa:'ganado'` (envuelve el `UPDATE clientes
  SET etapa` + `INSERT crm_etapas` de `actions.js:80-81`). Idempotente (ya es
  UPDATE por id).
- Etapa `contactado`: en `actionHandler.handleAction`, si el cliente existe y su
  etapa es `lead`/NULL, subir a `contactado` una vez.
- Flag: reutilizar que las acciones ya no escriben mensajes → sin gate (son datos).
  Bandera opcional `crm_bot_alimenta_activo` DEFAULT_OFF para clones que no quieran.

**P0-b — Reagendar/cancelar cita**:
- Nuevo `bot/flows/citasGestionFlow.js`, estados `S.CITA_GESTION`/`S.CITA_REAGENDA`.
- Entrada: `menuFlow` cuando `citas_activo` y el cliente tiene cita futura; o keyword
  "cancelar cita".
- Cancelar = `UPDATE citas SET estatus='cancelada'`; reagendar = reusar
  `slotsLibres`/`diasDisponibles` de `citasFlow.js` y `UPDATE fecha/hora`.
- Frase de confirmación + `logEvento('cita_cancelada'|'cita_reagendada')`.

**P1-a — Score en caliente**: en `agregarAlCarrito` / confirmación de `_shared.js`,
`UPDATE clientes SET lead_score = lead_score + N` (N pequeño, p.ej. +5 agregar,
+15 confirmar). Reusa el UPDATE de `stockWatcher.js:583`; el batch nocturno lo
normaliza igual.

**P1-b — Motivo de no-compra al CRM**: en `abandonoHandler.js:32`, tras guardar
`motivo`, llamar `crm_agregar_nota` (`"Abandonó carrito — motivo: "+motivo`) y
mover etapa a `perdido` solo si no está `ganado`.

## (d) Qué NO hacer

- **NO** convertir el bot en panel: sin kanban, sin edición de segmentos/campañas
  desde el chat. El bot **alimenta y consulta datos del cliente**, no administra CRM.
- **Masivos SIEMPRE con gate humano**: ninguna acción del bot debe lanzar campañas
  ni mensajes a un segmento. Eso vive en `campanaLanzar` (gerente+, `crm.js:246`) con
  escalonado 15-120s. Las acciones CRM del bot son **datos** (etapa/nota/tarea), nunca
  envíos (`actions.js:71-74` lo dice explícito).
- **opt-out SIEMPRE respetado**: no reactivar `marketing_opt_out=0` desde el bot salvo
  el ALTA explícito del cliente (`actionHandler.js:104`); toda audiencia ya filtra
  opt-out (`crm.js:161`).
- **Dinero solo por `marcar-pagado`**: no crear puntos/etapa `ganado` "pagado" desde
  el chat; `ganado` puede escribirse por confirmación de pedido, pero el **cobro real**
  sigue siendo el único chokepoint (`grabarPedido*` + `marcar-pagado`).
- **NO** tocar el hot-path de checkout sellado ni las acciones `sellada:true`
  (`actions.js:44-64`).
```
```
