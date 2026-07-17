# Módulos de apoyo del bot: Cotizar en el chat + Tiempo de entrega

> 2026-07-17 · Dos acciones nuevas del motor de flujo (lienzo tipo ComfyUI) que el
> bot **interpreta** y responde. Son de APOYO al bot semiautónomo: contestan
> "¿cuánto me sale?" y "¿cuándo llega?" **sin escalar**. Julio Cepeda byte-idéntico
> (golden + paridad verdes) porque solo aplican si un autor las pone en su grafo.

## Qué se creó
| Pieza | Archivo | Qué hace |
|---|---|---|
| Acción `cotizar` | `bot/flows/motor/actions.js` | Calcula subtotal + envío + total del carrito. **Solo lectura, no cobra.** Devuelve slots `{cotizacion_subtotal, cotizacion_envio, cotizacion_total, cotizacion_n}`. Salidas: `ok`/`vacio`/`inactivo`. |
| Acción `tiempo_entrega` | `bot/flows/motor/actions.js` | Calcula la fecha estimada de entrega (envuelve `estafetaService.calcularFechaEntrega`, respeta config y no cuenta domingos). Devuelve `{eta_fecha, eta_fecha_iso}`. Salidas: `ok`/`no`/`inactivo`. |
| Flags de módulo | `bot/flows/modulosDefaults.js` | `cotizacion_activo`, `tiempo_entrega_activo` (DEFAULT_OFF). |
| Toggle en el panel | `dashboard-ui/src/pages/Modulos.jsx` | "🧾 Cotizar en el chat", "📦 Tiempo de entrega". |
| Metadata del editor | CATALOGO en `actions.js` | Aparecen en la paleta del lienzo como **no selladas**, con su descripción y slots. |
| Diálogo (4 tonos) | `FRASES` en `bot/flows/_config.js` | `cotizacion_resumen`, `cotizacion_vacia`, `eta_envio` — A/B/C/D. |
| Editable en "Editor del bot" | `dashboard/routes/primeConfig.js` | Añadidas al listado de frases con su descripción. |

## Cómo lo interpreta el bot (mecanismo, sin cambios al intérprete)
El autor arrastra la acción a una pieza y escribe su texto con slots:
*"💰 Total: ${cotizacion_total} — llega el {eta_fecha}"*. En runtime:
1. La acción calcula y devuelve los slots → el intérprete los fusiona en la sesión
   (`interprete.js:126-146`).
2. El texto de la pieza los interpola vía `t(frase_clave, slots)` (`interprete.js:60`
   → `_config.js:t`). Eso es "que el bot lo interprete".

## El diálogo NO rompe la gestión del modo de hablar (análisis pedido)
El "modo de hablar" es el tono (`configuracion.tono_bot` ∈ A/B/C/D), leído en cada
llamada a `t()` con caché de 60s — **sin reiniciar el bot**. Se verificó que un
cambio de tono durante la operación **no genera conflicto** con estos módulos:

- **Todo el diálogo nuevo pasa por `t()` con las 4 variantes A/B/C/D.** No hay texto
  hardcodeado que quedaría "fuera de tono" al cambiarlo (el bug clásico). Pinneado
  en el test: los 4 tonos renderizan no-vacío.
- **Los valores calculados son neutrales al tono** (un total es un número, una fecha
  es una fecha): la acción llena los mismos slots sin importar el tono, así que
  cambiar de tono solo cambia el *envoltorio* del mensaje, nunca el dato.
- **`t()` es stateless por llamada**: si un gerente cambia el tono a media
  conversación, el siguiente mensaje sale en el tono nuevo, sin estado corrupto.
- **Editable con default**: cada frase tiene su default por tono y se puede
  sobreescribir por instancia con `frase_<clave>` (Prime → Editor del bot). Ojo,
  comportamiento existente del sistema y **el único matiz a saber**: un override de
  instancia **gana sobre el tono** (pin) — si un negocio edita el texto, ese texto
  se usa en los 4 tonos hasta que borre el override. Es por diseño (la voz propia
  del negocio manda) y está pinneado en el test.

## Frontera respetada
- Cotización es **informativa**: nunca llama `grabar_pedido_*` ni descuenta stock.
  El dinero sigue solo por `marcar-pagado`/POS (frontera sellada intacta).
- Regla "gratis": solo el flete puede decirse "gratis"; el total siempre es precio.
- Ambas son solo lectura → si truenan, el intérprete cae al router (fail-closed).

## Test
`tests/test_motor_cotiza_eta.js` (9/9, `npm run test:cotiza`): cálculo, "gratis" solo
en flete, gating por módulo, solo-lectura, 4 tonos, y override editable. Golden +
paridad byte-idénticas; suite completa verde.
