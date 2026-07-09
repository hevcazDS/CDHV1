# Catálogo de códigos de error — Hevcaz Solutions (HS-xxx)

Códigos propios del proyecto para diagnóstico y soporte. Se loguean con el
prefijo `[HS-xxx]` en los logs de pm2/bot/dashboard — al reportar un problema,
citar el código. **No** son códigos HTTP (por eso llevan prefijo: un `402`
pelón se confundiría con "Payment Required" de HTTP).

## Arranque / infraestructura

| Código | Significado | Qué hacer |
|---|---|---|
| `HS-101` | Base de datos inaccesible (DB_PATH mal, archivo bloqueado o permisos) | Verificar `DB_PATH` en `.env` y permisos del archivo `.db` |
| `HS-102` | Una migración de `migrations/` falló al aplicarse | Revisar el SQL citado en el log; la BD NO quedó a medias (transaccional) |
| `HS-201` | El dashboard no pudo tomar el puerto (3001 ocupado) | Otro proceso usa el puerto: `pm2 list` / matar el proceso viejo |
| `HS-402` | Secreto de instancia inválido o corrupto (`dashboard/.instancia_secret`) | Se regenera solo (sesiones mueren, todos re-loguean). Si se repite: revisar permisos del archivo. **Nunca copiar este archivo entre servidores** |

## Bot / bridge de WhatsApp

| Código | Significado | Qué hacer |
|---|---|---|
| `HS-501` | Chrome/Puppeteer no encontrado o no arranca (CHROME_PATH) | Verificar `CHROME_PATH` en `.env`; en Docker, que la imagen tenga Chromium |
| `HS-502` | Bridge zombie: había un bot activo pero el proceso quedó colgado (típico tras reload del contenedor). El dashboard lo detecta al arrancar y **reinicia el bridge una sola vez** | Si tras el reinicio automático sigue caído, usar "Reiniciar bridge" en el panel; si tampoco, ver HS-503 |
| `HS-503` | Sesión de WhatsApp corrupta o en conflicto (`.wwebjs_auth`) | Prime → General → zona de peligro → "Borrar sesión de WhatsApp"; el siguiente arranque pide QR limpio |

## Reglas de arranque

1. **El dashboard SIEMPRE tiene prioridad**: arranca primero e independiente
   del bot — sin él no se opera nada.
2. El bot se levanta **bajo demanda** desde el panel (Prime/Administrador/
   Operador); al iniciarlo se abre la ventana del QR y se cierra sola al
   vincular.
3. **Anti-zombie**: al arrancar el dashboard, si la BD registra que el bot
   debía estar activo (`bot_estado_deseado=1`) pero pm2 lo reporta caído,
   se reinicia el bridge **una sola vez** (`HS-502`). Nunca en loop: si la
   sesión está corrupta de verdad, el remedio es purgarla (`HS-503`).
