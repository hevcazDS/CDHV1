# Plan v3 — bugs de auditoría 2026-07-22 + limpieza de factorización

Generado tras auditoría completa del código (4 pasadas paralelas: bot/, dashboard/,
dashboard-ui/, services+scripts). Versión objetivo: **v1.1.0** (bump desde 1.0.8 en
`package.json` al cerrar la Fase 3; Fase 4 es limpieza interna, no requiere bump propio).

Regla: cada ítem se tacha aquí y se documenta en `CLAUDE.md` (banner) +
`INDICE_DOCUMENTACION.md` §6 al cerrarse, por la regla viva del propio repo.

## Fase 1 — Bugs críticos (alta severidad)

- [x] 1. `services/emailService.js` — contador RCPT-TO por booleano → contador real
      (`rcptPend`, igual que `backup.js`/`datasetExport.js`) + `tlsSock.on('error', reject)`.
      Bonus: mismo listener agregado en `backup.js`/`datasetExport.js`.
- [x] 2. `dashboard-ui/src/pages/prime/GeneralTab.jsx:700` — `restaurar()` ahora usa
      `bytesToBase64()` con chunks de 32KB en vez de spread total.
- [x] 3. `bot/flows/orderFlow.js` — escalación a asesor en pickup-único ahora va
      directo a `S.ASESOR` (mismo patrón que línea 391-392) en vez de llamar
      `resumenEscenariosMixtos` con datos `undefined`.
- [x] 4. `dashboard/routes/comunicacionPedidos.js` (`pagoCancelar`) — agregado
      `pin: true` en la ruta, mismo gate que `pos.js` `ventaCancelar`.

## Fase 2 — Bugs de severidad media

- [x] 5. `dashboard/routes/primeConfig.js` (`envioPut`) — ahora también actualiza
      `links_pago.monto` al corregir el costo de envío.
- [x] 6. `dashboard-ui/src/pages/Mostrador.jsx` + `dashboard/routes/pos.js` — validación
      de `efectivo_recibido >= total` en frontend (UX) y backend (defensa en profundidad).
- [x] 7. `dashboard-ui/src/pages/Notificaciones.jsx:34` — plantilla ahora usa
      `{negocio}` dinámico (mismo patrón que `Layout.jsx`, `/api/negocio` + localStorage).
- [x] 8. `services/stockWatcher.js` (`checkCarritosAbandonados24h`) — dedup ahora con
      ventana de 30 días (convención `MAX_PUNTOS_CANJE_30D`).
- [x] 9. `services/nominaService.js` (`pagar`) — abona a Caja(101)/Bancos(102) según
      `metodo_pago` de cada empleado, join con `empleados`.
- [x] 10. `bot/flows/_shared.js` (`aplicarCupon`) — cupón de porcentaje ahora clamped
       a `Math.min(..., subtotal)`, igual que el de monto fijo.
- [x] 11. `dashboard/routes/core.js` — `/api/pedidos` → `area:'operacion'`; `/api/stats`
       → `areas:['operacion','finanzas']` (contabilidad sí lo consume, almacén/compras/rh no).
- [x] 12. `bot/flows/addressFlow.js:97` — `tel` reemplazado por
       `userId.replace(/@.*$/, '').slice(0,20)` (mismo idioma que `actionHandler.js:32`).

## Fase 3 — Bugs de severidad baja

- [x] 13. `dashboard/routes/pos.js` (`productosGet`) — check de `posActivo(db)` movido
       al inicio de la función, antes del lookup de código de barras.
- [x] 14. `dashboard-ui/src/pages/Mostrador.jsx` — método de pago solo se fija por
       default la primera vez (`useRef`), ya no se resetea en refetch de fondo.
- [x] 15. `dashboard-ui/src/components/Layout.jsx` — "Usuarios"/"Configuración" ahora
       consideran el query param `?tab` al marcar el link activo.
- [x] 16. `bot/index.js` — `downloadMedia()` fallido ahora avisa al cliente en vez de
       caer en silencio.
- [x] 17. `dashboard/routes/erpContabilidad.js` (`asientosPost`) — mismo `override`
       de período cerrado que `gastosPost` (chequeo de rol + `configAudit.logCambio`).
- [x] 18. Doc: corregidas las notas de `INDICE_DOCUMENTACION.md` §"Arquitectura/operación"
       sobre `migrate.js --all` (ya migra `instancias/*.db`) y `backup.js` (ya las respalda).

## Fase 4 — Factorización / limpieza arquitectónica

- [x] 19. `services/stockWatcher.js` (989→~120 líneas) → split en `services/checks/`
       (`_shared.js`, `stock.js`, `marketing.js`, `sistema.js`, `operacion.js`, 26
       funciones repartidas). API pública sin cambios (`runAll` + funciones sueltas
       usadas por tests).
- [x] 20. `bot/flows/_shared.js` — `grabarPedidoPickup`/`PickupUnificado` unificadas
       en `_grabarPedidoPickupBase`; `Envio`/`Split` divergen demasiado, se dejaron
       aparte pero reusan 5 helpers de fragmentos comunes. Un reordenamiento inerte
       documentado (cliente antes que folio, sin relación entre tablas — revisado).
- [x] 21. `dashboard-ui/src/pages/Notificaciones.jsx` → `IndividualTab`/`MasivoTab`
       en el mismo archivo (confirmado que `Crm.jsx` no usa carpeta separada).
- [x] 22. `dashboard-ui/src/pages/prime/GeneralTab.jsx` (783→365 líneas) → 8
       componentes movidos a `pages/prime/general/*.jsx`.
- [x] 23. `bot/index.js` — 6 etapas tempranas del pipeline (burst/timeout/rate-limit/
       filtro-contenido/frustración/media-no-soportada) extraídas a funciones
       `_stageX`; la cola (visión→queja→intención→dispatch) se dejó inline por
       compartir demasiado estado mutable — decisión documentada en el propio código.
- [x] 24. `dashboard/routes/erpContabilidad.js` (`tablero()` 106→14 líneas) →
       7 helpers `_tableroX` + `_periodoAnterior()` compartido (deduplicó el cálculo
       de periodo anterior repetido en `comparativo`/`ticket`).
- [x] 25. SMTP duplicado 3 veces → `services/smtpClient.js` compartido (solo el
       handshake STARTTLS; el armado de MIME se queda en cada llamador). Revisado:
       las 3 APIs públicas (`emailService.js`/`backup.js`/`datasetExport.js`) quedan
       idénticas para sus propios llamadores.

## Fase 5 — Ronda 2 de auditoría (2026-07-22b) — áreas nunca revisadas

Segunda pasada (4 agentes en paralelo) sobre lo que la ronda 1 no cubrió: el resto de
`dashboard/routes/` (25 archivos), el motor de flujo visual (`bot/flows/motor/`) +
handlers del bot, y las páginas/scripts del frontend restantes.

- [x] 26. `bot/flows/motor/linter.js` (`PASOS_SELLADOS`) — agregados los 7 estados
       faltantes de `menuFlow.js` (confirmado contra su `STEPS` real).
- [~] 27. `bot/flows/motor/interprete.js` + `bot/actionHandler.js` — **investigado y
       dejado sin tocar a propósito**: `interprete.js` devuelve `undefined` desde 5
       puntos con garantías de seguridad incompatibles (2 son seguros de reintentar,
       1 ya invocó internamente el flujo real — reintentarlo sería una invocación
       duplicada —, 2 ocurren DESPUÉS de que la sesión ya avanzó — reintentar ahí
       correría un mensaje contra una sesión desactualizada, peor que el bug
       original). Arreglarlo bien requiere cambiar el contrato de retorno del motor
       (sentinela que distinga los 5 casos), no un fix quirúrgico. Documentado como
       hallazgo real, no forzado.
- [x] 28. `dashboard/routes/atencionCliente.js` + `catalogoCola.js` — `area:'operacion'`
       agregado a las 4 rutas GET sin gate.
- [x] 29. `dashboard/routes/mesas.js` (`quitarItem`) — ahora exige `AND id_mesa=?`.
- [x] 30. `dashboard/routes/rrhh.js` — `empleadosPost` ahora `pin:true`; `nominaPagar`
       ahora persiste `nominas.pagada_por` (migración 0087) y llama
       `configAudit.logCambio`, igual que aguinaldo/finiquito.
- [x] 31. `dashboard/routes/suscripciones.js` (`actualizar`) — PIN condicional (solo si
       `monto` cambia de verdad) + `configAudit.logCambio` con monto viejo→nuevo.
- [x] 32. `dashboard/routes/documentos.js` — `activo(db)` agregado a Get/Put; `Post`
       valida `plantilla.tipo === documento.tipo`; `Put` verifica que el id exista
       (404 si no).
- [x] 33. `dashboard-ui/src/pages/prime/UsuariosTab.jsx` — `confirmar()` agregado,
       mismo patrón que Rrhh/Crm/Cupones, con el username en el mensaje.
- [x] 34. `dashboard-ui/src/pages/Rrhh.jsx` — guard de NaN en `salario_diario`; query de
       `nominas` con `enabled: !moduloApagado`.
- [x] 35. `dashboard-ui/src/pages/Modulos.jsx` — fallback cambiado de `?? true` a
       `?? false` (falla hacia apagado) + switches deshabilitados mientras carga.
- [x] 36. `scripts/demo/seed.js` (teléfono generado una vez), `scripts/generar_sustitutos.js`
       (guard `base.price > 0`), `dashboard/routes/demo.js` (usa `subtotalR` real en
       vez de duplicar `total`) — los 3 corregidos.
- [x] 37. `TableroTab.jsx` (`Fila` movida a scope de módulo) + `ContabilidadTab.jsx`
       (6 `.toFixed(2)` con guard `?? 0` agregado).
- [x] 38. `ordenesServicio.js` — count+insert envuelto en `db.transaction()` (defensa
       en profundidad; el runtime síncrono de better-sqlite3 ya cerraba la ventana de
       carrera en la práctica). `negocioOnboarding.js` — dejado sin tocar, según plan.

## Verificación antes de cerrar cada fase

- `npm test` (suite completa) debe seguir en verde.
- Fases 1-3: rebuild + `docker compose up -d` en Oracle para que los fixes lleguen a
  `jiua.hevcaz.com`; verificar `/health`.
- Fase 4: es refactor puro (sin cambio de comportamiento) — verificar con los mismos
  tests, sin necesidad de que el dueño re-pruebe manualmente.
- Fase 5: mismo criterio que Fases 1-3 (son bugs reales) salvo el ítem 27 (motor de
  flujo), que se implementa solo si el fix es seguro sin arriesgar el fallback en
  producción — de lo contrario se documenta como hallazgo pendiente, no se fuerza.

## Fase 6 — Ronda 3 de auditoría (2026-07-22c) — seguridad core, resto de bot/flows, lib/UI restante

Tercera pasada (4 agentes): `dashboard/autorizacion.js`+`permisos.js`+`server.js`
(backbone de seguridad — **salió limpio**, sin vulnerabilidades reales, solo 2
oportunidades de hardening de baja prioridad, documentadas abajo sin implementar),
`menuFlow.js`/`cartFlow.js`/`asesorFlow.js` del bot (pase profundo, nunca hecho
antes), `dashboard-ui/src/lib/*`+`components/*` restantes, y ~30 pestañas de
erp/almacén/inicio.

- [x] 39. **Alta severidad, seguridad**: inyección de fórmulas CSV — `lib/csv.js`
       ahora antepone `'` a valores que empiezan con `=+-@`; `Pedidos.jsx` (el único
       exportador duplicado que existía) delega al helper compartido en vez de tener
       su propio escapador. Verificado que el resto de páginas ya usaba el compartido.
- [x] 40. **Alta severidad**: `bot/flows/menuFlow.js` (`ADD_MORE`) — reescrito para
       cumplir el menú prometido: 1/3 → `S.SHOW_CART` real (`mostrarCarrito`), 2 →
       seguir comprando. Eliminada la confirmación de compra falsa.
- [x] 41. **Media-alta, dinero**: `bot/flows/cartFlow.js` — nuevo helper
       `_revertirCupon()` (floor-guardado) llamado en las 2 rutas de abandono
       explícito (sin-stock, cancelar). **Gaps residuales documentados, no
       arreglados**: timeout de sesión y otros `clearSession()` del router
       (`actionHandler.js`, `asesorFlow.js`) que también pueden abandonar un cupón
       aplicado — requieren un mecanismo distinto (reconciliación periódica), fuera
       de alcance de un fix por-mensaje.
- [x] 42. `AuthContext.jsx` — `queryClient.clear()` en `logout()` y también en el
       handler `dashboard:unauthorized` (mismo problema, otro punto de salida).
- [x] 43. `Onboarding.jsx` + `negocioOnboarding.js` — mínimo subido a 8 caracteres en
       frontend y backend (mismo número que `seguridadOperativa.js` ya usaba en otro
       lado — consistente, no arbitrario).
- [x] 44. `ComprasTab.jsx` — "Reordenar"/"Cancelar OC" ahora ocultos tras
       `!soloRecepcion`; "Recibir todo"/"Parcial" siguen visibles para almacén.
- [x] 45. `cartFlow.js`/`menuFlow.js` (OFERTAS→`VIEW_PRODUCT`) — `data.products` ahora
       lleva TODAS las ofertas activas, no solo la elegida; "4️⃣ Volver al menú" desde
       ofertas va a `S.MENU` real (antes cayó a `SEARCHING`).
- [x] 46. Los 4 nits corregidos: `format.js` (`Number.isFinite` guard),
       `VistaAdmin.jsx` (2 queries muertas eliminadas), `ActivosFijosTab.jsx`
       (`depreciar` ahora checa `r.ok` como sus hermanas), `linter.js`
       (`SUSTITUTO`/`PREVENTA` removidos, confirmado sin uso real en todo el repo).

**No implementar, solo documentar** (bajo valor/alto riesgo relativo al beneficio):
- Sesiones sin timeout de inactividad (solo TTL absoluto) y contadores de
  fuerza-bruta/PIN en memoria (se resetean al reiniciar el proceso) — ambos de
  severidad baja, requieren trabajo de arquitectura (sesiones deslizantes o
  persistencia de contadores) desproporcionado al riesgo real dado que
  `HttpOnly`+`SameSite=Lax`+`Secure` en prod ya cierra los vectores de robo comunes.
- `bot/index.js` — el mutex por-usuario descarta (no encola) un segundo mensaje que
  llega mientras el primero se procesa; es una pérdida de UX (mensaje ignorado en
  silencio durante un `await` largo, ej. reenviar comprobante de pago), no de datos.
  Encolar correctamente requiere rediseñar el pipeline de mensajes — fuera de
  alcance de un fix puntual, se deja documentado.

## Fase 7 — Ronda 4 de auditoría (2026-07-22d) — scripts de guardia CI, tests, migraciones, desktop/

Cuarta pasada (3 agentes): los 5 scripts de guardia tipo CI (`scripts/rutas/`,
`scripts/db/`, `scripts/ui/`) nunca auditados a pesar de gatear `npm test`;
consistencia de las 87 migraciones (`NOT NULL` sin `DEFAULT`) — **sin hallazgos,
limpio**; `desktop/main.js`; revisión de factorización residual — **sin candidatos
nuevos, el trabajo de Fases 4/6 quedó bien**; y el arnés de los 5 tests principales
por falsos positivos (bugs en los TESTS, no en la app).

- [x] 47. **Alto valor**: `scripts/ui/estilo_guard.js` — `btn_clase_vieja`/
       `grid_fijo_inline` ahora escanean `['pages','components']`. Baseline
       regenerado a mano (sin flag de actualización en el script): 21→30 y 16→18
       respectivamente, reflejando la deuda real ya existente (de paso corrigió un
       baseline de `grid_fijo_inline` que ya estaba desactualizado).
- [x] 48. **Alto valor**: `scripts/db/schema_guard.js` — confirmado que el script SÍ
       escanea `.js` (no solo migraciones); agregado `checkAltersTemplateLiteral()`
       que detecta el patrón específico de `_asegurarColumnasUsuarios` (loop sobre
       un array de nombres de columna) y cruza cada uno contra `db/schema.sql`.
       Verificado contra el código real: 0 violaciones hoy (las 8 columnas ya
       están espejadas), el blindaje es para drift futuro.
- [x] 49. `tests/test_full_bot.js` — las 18 suites ahora se acumulan en
       `suitePromises` y el resumen final espera `await Promise.all(suitePromises)`
       en vez de un `setTimeout` fijo de 3s; cada cuerpo de suite quedó envuelto en
       try/catch que cuenta el fallo con el mismo formato que `assert()`.
- [x] 50. `tests/test_bot.js` — el runner `test()` ahora es `async` y espera
       (`await`) si `fn()` devuelve una promesa antes de contar pasada/fallida; el
       único test async real (imageAnalyzer) se encadena con `.then()` a un
       `runRestoYFinalizar()` que corre después. Verificado: los tests síncronos de
       esa función cuentan correcto sin `await` (garantía del lenguaje: el código
       antes del primer `await` de una función async corre síncrono). Brecha de
       fidelidad del mock de DB documentada con comentario, no arreglada (bajo
       riesgo, cambio mayor).
- [x] 51. `desktop/main.js` — guard `if (!win || win.isDestroyed()) return;` al
       inicio de `cargar()`.

**Confirmado limpio, sin acción**: 87 migraciones sin violaciones de `NOT NULL` sin
`DEFAULT`; `db/schema.sql` sincronizado también en el rango 0020-0071 (no solo lo
reciente); `scripts/rutas/inventario.js`/`requires.js`/`imports_jsx.js` sólidos;
factorización — ningún archivo nuevo amerita split tras las Fases 4/6.

## Fase 8 — Ronda 5 de auditoría (2026-07-22e) — docs/ vs. código real + configs de despliegue

Quinta pasada (3 agentes): verificación de `docs/` (la "fuente de verdad" según su
propio `README.md`/el banner de `CLAUDE.md`, nunca antes verificada contra el
código real) y de los archivos de despliegue (Dockerfile/docker-compose.yml/PM2/
Caddyfile/.env.example — **confirmados sin bugs reales de despliegue**, solo
gaps de documentación menores).

- [x] 52. `docs/BASE_DE_DATOS.md` — migraciones 84→87, tablas "~70+"→"~125"
       (`grep -c "CREATE TABLE" db/schema.sql`); fila de `nominas` con
       `pagada_por`/`0087`.
- [x] 53. `docs/ARQUITECTURA.md` + `docs/README.md` — migraciones 84→87.
- [x] 54. `docs/API.md` — módulos 30→31, agregado `primeCatalogo.js` al listado;
       `pagos/:id/cancelar` y `empleados` (POST) ahora muestran 🔐PIN.
- [x] 55. `docs/CONTABILIDAD.md` — sección de nómina ahora menciona el reparto
       Caja(101)/Bancos(102) por `metodo_pago` y `nominas.pagada_por`.
- [x] 56. `docs/FRONTEND.md` — agregado `DemoTab` y la carpeta
       `pages/prime/general/*.jsx` al listado de tabs de Prime.
- [x] 57. `docs/OPERACION.md` — RH y Operador ahora mencionan los PIN de alta de
       empleado y cambio de monto de suscripción.
- [x] 58. `docs/DESPLIEGUE.md` — agregada la ruta Docker completa
       (`build && up -d`, healthcheck) junto a la ruta PM2 existente.
- [x] 59. Nits de despliegue corregidos: comentario de `docker-compose.yml:14`
       ahora menciona Cloudflare Tunnel (no solo Caddy); `.env.example` con
       placeholders de `ANTHROPIC_API_KEY`/`OPENAI_API_KEY`. **Hallazgo adicional
       al implementar**: `.dockerignore` tenía `bot/imagenes_clientes`, que
       NUNCA matcheó nada — las carpetas reales del build context están en la
       raíz (`imagenes_clientes`/`imagenes_productos`, montadas por
       `docker-compose.yml` a `/app/bot/imagenes_*`). Corregido a las rutas
       reales — antes, cualquier foto de cliente/producto acumulada se horneaba
       sin necesidad en cada build de imagen.

**Confirmado limpio, sin acción**: Dockerfile (`COPY . .` capta todos los archivos
nuevos de las Fases 4-7 automáticamente); healthcheck de docker-compose coincide
con `/health` real; ambos `ecosystem*.config.js` siguen siendo necesarios (uno
para dev local/Windows, el otro invocado de verdad dentro del contenedor);
`docs/MODULOS.md` — los 27 defaults verificados uno por uno contra
`modulosDefaults.js`, exactos; `docs/BOT.md` — ya refleja el pipeline
refactorizado y los fixes de `menuFlow.js`/`cartFlow.js`.

## Verificación dedicada de las refactorizaciones (Fase 4, ítems 19-25)

A pedido explícito, revisión de código enfocada específicamente en los 7
refactors de la Fase 4 (no búsqueda de bugs nuevos) — ¿preservan el
comportamiento exacto? ¿quedó algo suelto o duplicado?

- [x] Split de `stockWatcher.js` → `services/checks/*.js` (ítem 19): **correcto,
      sin hallazgos**. Las 26 funciones repartidas sin duplicados ni omisiones,
      rutas `require()` correctas (un nivel más profundo), estado compartido
      (`db`/`log`) obtenido de forma independiente en cada archivo, el fix de
      ventana de 30 días (ítem 8) sobrevivió intacto al split.
- [x] SMTP unificado en `services/smtpClient.js` (ítem 25): **correcto, sin
      hallazgos**. Las 3 APIs públicas (`emailService.js`/`backup.js`/
      `datasetExport.js`) sin cambios para sus llamadores reales; fidelidad de
      mensajes de error por `.stage` verificada en los 4 casos; código muerto
      (`net`/`tls`/máquina de estados vieja) confirmado eliminado, no solo
      suplementado.
- [x] Split de `Notificaciones.jsx` → `IndividualTab`/`MasivoTab` (ítem 21):
      **correcto, sin hallazgos**. Estado bien repartido, sin referencias
      cruzadas; el fix de white-label (ítem 7, `nombreNegocio`) aterrizó en el
      tab correcto.
- [x] Split de `GeneralTab.jsx` → `pages/prime/general/*.jsx` (ítem 22):
      **1 hallazgo real, corregido**: `CifradoBackup.jsx` tenía 2 emojis sin
      pasar por `useTextoEmoji()` (el archivo no importaba el hook) — se
      escapó del split porque los demás componentes SÍ lo importaban cada
      uno por su cuenta. Corregido con el mismo patrón que `PacConfig.jsx`. El
      fix de seguridad del chunking de base64 (ítem 2) sí sobrevivió intacto.
- [x] Extracción del pipeline de `bot/index.js` (ítem 23): **correcto, sin
      hallazgos**. Los 6 `_stageX` reciben los parámetros exactos, semántica de
      early-return preservada, el fix de imagen silenciosa (ítem 16) quedó bien
      posicionado en la cola inline (como decía el plan, no se extrajo).
- [x] Dedup parcial de `grabarPedido*` en `_shared.js` (ítem 20): **correcto,
      sin hallazgos**. Todos los call sites siguen matcheando firmas; los
      `opts` de las 2 unificadas difieren donde deben; el rollback de cupón
      (ítem 41, en `cartFlow.js`) es independiente y no interfiere.
- [x] Split de `tablero()` en `erpContabilidad.js` (ítem 24): **correcto, sin
      hallazgos**. Mismo orden y mismas llaves del JSON de respuesta;
      `_periodoAnterior()` deduplicado de verdad (sin math inline residual); el
      fix de período cerrado en `asientosPost` (ítem 17, función separada) sin
      afectar.

**Resultado**: 6 de 7 refactors perfectos al primer intento; 1 con un detalle
menor de gating de emoji, ya corregido. Build reverificado limpio.

## Fase 9 — Auditoría de arquitecto/experto (2026-07-22f) — optimización y candidatos de librería

A pedido explícito ("como un experto programador... punto de optimización...
agregando alguna nueva dependencia"), 4 agentes evaluaron el proyecto con
lente de arquitecto (no búsqueda de bugs) en bot/, dashboard backend,
frontend, y dependencias/services. Veredictos y hallazgos:

### Decisiones de arquitectura confirmadas (mantener tal cual, no cambiar)
- Mutex por-usuario en `bot/index.js` sin cola real: correcto dejarlo así —
  WhatsApp no garantiza orden de entrega, una librería de cola agregaría
  complejidad sin comprar corrección real.
- `sessionManager.js` (Map en memoria + SQLite): `lru-cache` no mejoraría
  nada real — la lógica de persistir carritos abandonados es de dominio, no
  de mecánica de caché.
- Rate limiting (bot y dashboard): hand-rolled es proporcional al modelo de
  amenaza real (single-process, equipo pequeño/interno) — `rate-limiter-flexible`
  solo se justifica con múltiples instancias/Redis, que no aplica aquí.
- Motor de flujo: intérprete a medida es la decisión correcta, `xstate` no
  encaja (el grafo persiste en BD, tiene handoff a código legacy, contrato
  fail-closed) — el único gap real (sin detección de ciclos) es ~30 líneas
  de Tarjan en el linter existente, no una librería nueva.
- Backend nativo `http` (sin Express) a 343 rutas: sigue siendo la decisión
  correcta — el tronco declarativo ya da lo que Express daría, migrar 343
  handlers en un sistema vivo no se justifica.
- Frontend: code-splitting ya óptimo, Context+React Query es la arquitectura
  correcta (sin evidencia de prop-drilling que justifique Zustand), sin
  dependencias obsoletas/infladas.
- SMTP (`services/smtpClient.js`, recién unificado): mejor que nodemailer
  para el caso de uso actual — la unificación de esta sesión ya cerró la
  brecha que hubiera justificado el swap.

- [x] 60. **Bug real nuevo, medio**: `dashboard-ui/src/pages/erp/ComprasTab.jsx`
       — 3 llamadas a `qc.invalidateQueries()` sin `queryKey` (Reordenar,
       Cancelar OC, Recepción parcial) invalidaban TODAS las queries activas
       de la app en vez de solo `erp-ocs`/`erp-cxp`. Corregido.
- [x] 61. **Bug real nuevo, bajo-medio**: `bot/index.js` — `fs.existsSync`/
       `mkdirSync`/`writeFileSync` síncronos al guardar cada foto de cliente
       bloqueaban el event loop del bot (single-thread) para TODOS los
       usuarios mientras dura el disco I/O. Convertido a `fs.promises`.
- [x] 62. **Bug real, medio — corregido, autorizado por el dueño**:
       `services/imagenWebp.js`/`imagenProducto.js` usaban
       `execFileSync('cwebp', ..., {timeout:15000})` — bloqueaba el event loop
       hasta 15s por conversión + dependía de un binario frágil del sistema.
       **Adoptado `sharp`** (nueva dependencia de producción): los 2 archivos
       reescritos a async, quitado `webp` del `Dockerfile` (sharp bundlea
       libvips, sin binario externo), `bot/index.js`/`primeCatalogo.js`
       actualizados a `await` las funciones ahora-async. De paso se agregó
       redimensionado (tope 1600px al lado mayor — antes se guardaba a
       resolución completa de cámara). `package-lock.json` regenerado con
       Node del mismo SO que la imagen (`node:20-bookworm`, vía Docker) para
       que el binario nativo de sharp coincida con la plataforma real.
       **Verificado funcional end-to-end** (no solo build/sintaxis): conversión
       real 2000×1500→1600×1200 dentro del contenedor, redimensiona, borra el
       original, retorna el basename correcto.
- [x] 63. **Migración a `node:test` — iniciada y verificada, autorizada por el
       dueño**: 58 archivos de test en total; 39 necesitan la BD real de
       producción sembrada (no se puede migrar a ciegas sin poder ejecutar y
       verificar — riesgo de introducir el mismo tipo de bug de conteo que
       esta migración busca eliminar). **19 archivos migrados Y ejecutados de
       verdad** (DB `:memory:`/mock/fixture aislada — verificado archivo por
       archivo antes de correr nada, cero riesgo a la BD de producción):
       `test_activos_fijos.js`, `test_citas.js`, `test_dashboard_control.js`,
       `test_direccion_guardada.js`, `test_erp.js`, `test_lealtad.js`,
       `test_multitienda.js`, `test_pin_tronco.js`, `test_puntos_compra.js`,
       `test_referidos.js`, `test_reversion.js`, `test_roles_erp.js`,
       `test_salud_negocio.js`, `test_variantes.js`, `test_bot.js` (el más
       grande y complejo, 617 líneas — **117/117 pasan** con la lógica real
       del bot cargada), `test_gimnasio.js`, `test_imagen_producto.js`,
       `test_motor_actions.js`, `test_motor_conversaciones.js`.
       **Corrida consolidada final: 229/231 pasan.** Los 2 que fallan
       (`test_roles_erp.js`, sección Kardex/Nómina) son un bug PREEXISTENTE
       del fixture (esquema de `nominas`/`empleados` desactualizado frente a
       las columnas reales que `nominaService.js` ya usa) — confirmado
       reconstruyendo el archivo original y corriéndolo: falla igual, no es
       una regresión de la migración. De paso se encontraron y arreglaron 2
       bugs de fixture similares en `test_erp.js` (mismo tipo de columnas
       faltantes) que si no se arreglaban, hubieran tronado igual con el
       runner viejo. `tests/fixture_min.js` (helper compartido, no es un test
       en sí) se dejó intacto. `tests/golden_snapshot.js` se dejó SIN migrar
       a propósito — su modo `--update` no encaja con el modelo de
       `node:test`, se verificó que sigue funcionando como está.
       `package.json` actualizado (8 scripts `test:*` + el script compuesto
       `test`). **Actualización — los 36 restantes también migrados**: se
       hizo una copia desechable de la BD real vía `Database.backup()`
       (checkpoint de WAL incluido, consistente), duplicada en 5 copias
       independientes (`data/test_copia_1.db`...`_5.db`, una por lote en
       paralelo para que no colisionaran entre sí) y usada solo vía
       `-e DB_PATH=/data/test_copia_N.db` — la BD real (`data/jugueteria.db`)
       nunca se tocó (confirmado: mtime sin cambios antes/después, 0 clientes
       de prueba). **Resultado: 36/36 archivos migrados y ejecutados de
       verdad, 366/366 pruebas pasan** en la corrida consolidada final.
       Se encontraron y corrigieron 5 bugs preexistentes más de fixtures
       desactualizados (mismo patrón que `test_erp.js`: `test_carrito.js`
       sin `stock_exhibicion`, `test_dashboard_api.js` sin 3 columnas de
       `pedidos`, `test_motor_c1c2c3.js` con un nodo `MENU` sin
       `delegar:true`, `test_motor_interprete.js` con un fixture usando
       `MENU` como nombre no-sellado cuando ya está sellado desde el ítem 26)
       y 2 bugs reales de la propia conversión (no del código de la app):
       `test_marketing.js` tenía lecturas que quedaban diferidas después de
       mutaciones posteriores por el modelo de ejecución de `node:test`
       (corregido capturando el valor en el punto correcto del programa);
       `test_dashboard_api.js` dejaba el proceso colgado porque `server.js`
       nunca cierra su `listen()` (corregido con la bandera oficial
       `--test-force-exit`). `test_notificaciones.js`/`test_full_bot.js`
       verificados sin ningún intento real de red/SMTP/WhatsApp (credenciales
       falsas forzadas + confirmado en logs que ninguna suite llega a enviar
       de verdad). Las copias de BD se borraron al terminar.
       **Migración final: 55 de 58 archivos en `node:test`** (95%). Quedan
       sin migrar a propósito: `fixture_min.js` (helper, no es un test),
       `golden_snapshot.js` (su modo `--update` no encaja con el modelo de
       node:test, verificado que sigue funcionando tal cual),
       `test_rutas_smoke.js` (necesita un servidor dashboard vivo, no solo
       una BD — fuera de alcance de esta ronda).
- [x] 64. Nit de documentación: `docs/API.md` decía "importar Excel" para el
       import de horarios de RRHH — en realidad es CSV puro
       (`linea.split(',')`, sin manejo de campos con comillas). Corregido el
       texto; no se adoptó `xlsx` (no se pidió soporte real de `.xlsx`).

## Fase 10 — Segunda revisión de optimización/refactorización (2026-07-22g)

A pedido explícito ("revisa de nuevo el código en optimización y
refactorización"), 2 agentes revisaron: (A) si los 64 fixes acumulados sobre
los mismos archivos a lo largo de la sesión degradaron su estructura
("parches sobre parches"), y (B) terreno nuevo — eficiencia del build Docker,
`bot/flows/motor/actions.js`, `services/pacService.js`.

- [x] 65. **Verificación de calidad, sin hallazgos**: los 9 archivos más
       tocados de la sesión (`bot/index.js`, `_shared.js`, `cartFlow.js`,
       `menuFlow.js`, `erpContabilidad.js`, `rrhh.js`, `GeneralTab.jsx`+
       `general/*.jsx`, `nominaService.js`, `imagenProducto.js`/
       `imagenWebp.js`) revisados uno por uno — **ninguna degradación
       estructural**. Cada fix aterrizó en un lugar aislado y de propósito
       único; ninguno requirió "parchar un parche".
- [x] 66. **Real, corregido**: `Dockerfile` instalaba el paquete apt `sqlite3`
       (el binario CLI) sin usarlo nunca — toda la app usa `better-sqlite3`
       (paquete npm). Confirmado con grep (0 usos) antes de quitarlo. Único
       lugar que menciona `sqlite3` CLI es `tests/sql/README.md`, y es una
       conveniencia de desarrollo LOCAL (`sqlite3 archivo.db < query.sql`),
       no algo que el contenedor de producción necesite.
- [ ] 67. Nits de muy baja prioridad, documentados, no implementados:
       `bot/flows/motor/actions.js` repite 3 veces el mismo lookup de
       cliente por teléfono (`crm_cambiar_etapa`/`crm_crear_tarea`/
       `crm_agregar_nota`) — podría ser un helper compartido, pero es un
       lookup indexado (no hay problema de rendimiento real, solo
       duplicación de 3 líneas). `services/pacService.js`'s
       `enviarComprobante()` re-consulta `pedidos`/`clientes` que `timbrar()`
       ya había consultado — consulta local barata a SQLite, no una llamada
       al PAC, bajísima prioridad.
- [x] 68. Confirmado limpio, sin acción: `Dockerfile`'s cacheo de capas ya es
       correcto (manifiestos antes que código fuente en las 3 etapas);
       `npm ci --omit=dev` ya es production-only; el stage `ui` no filtra
       `node_modules` al final, solo `dist`; `nodemon` (única devDependency)
       confirmado sin uso en el entrypoint de Docker.

## Fase 11 — Cuarta pasada de espagueti/120 líneas + verificación de integración (2026-07-22h)

A pedido explícito ("vuelve a revisar... espagueti... revisa si tus
refactorizaciones no causan conflicto"), 2 agentes: uno re-audita
factorización (cuarta pasada — ya se hizo en Fase 1/4/7/10), otro verifica
que las 5 áreas de refactor más entrelazadas de la sesión realmente encajen
entre sí, no solo que cada diff se vea bien aislado.

- [x] 69. **Cuarta pasada de espagueti: sin hallazgos nuevos.** Censo actual:
       111 de 259 archivos superan 120 líneas (43%, misma proporción que al
       inicio de la sesión — 106/245). Los 5 archivos que crecieron después
       de su propio split de la Fase 4 (`erpContabilidad.js` 832→891,
       `bot/index.js` 1258→1311, `_shared.js` 1372→1391, `menuFlow.js`
       720→725, `cartFlow.js` 422→444) fueron releídos completos uno por
       uno: el crecimiento es de piezas independientes agregadas (un fix de
       ~15-20 líneas cada vez, con su propio comentario, sin tocar código
       vecino), no de código enredado. Ningún archivo "se volteó" a necesitar
       un split nuevo.
- [x] 70. **Verificación de integración — 4 de 5 áreas limpias, 1 hallazgo
       real (pero con conclusión corregida, ver abajo)**: split de
       `stockWatcher.js` vs. `stockWatcher.worker.js` — compone bien, forma
       de export sin cambios. Unificación de `smtpClient.js` vs. los 3
       llamadores — ninguno se volvió a tocar después de la unificación,
       compone bien. `sharp` vs. extracción del pipeline vs. fix de fs async
       en `bot/index.js` (3 ediciones de 3 rondas distintas sobre el MISMO
       bloque) — se encadenan correctamente en una sola secuencia async
       coherente. `Dockerfile` (dos paquetes apt quitados en rondas
       distintas: `webp` y `sqlite3`) vs. `docker-compose.yml` — ambos
       quitados limpio, los 4 paquetes que quedan siguen siendo necesarios,
       los volúmenes de imágenes siguen alineados con lo que escribe el
       código reescrito para `sharp`.
- [x] 71. **El "hallazgo" de `npm test` — investigado y CORREGIDO, no es un
       bug**: el agente de integración señaló que `test:carrito`,
       `test:dashboard-api`, `test:estres` y `test:marketing` existen y
       pasan pero no están en la cadena `&&` del script compuesto `test`, y
       recomendó agregarlos. **Verificado que esto es diseño intencional
       preexistente, NO una regresión de esta sesión** — ninguno de los 4
       estaba en el `test` compuesto en el commit inicial de esta sesión
       (`git show <primer-commit>:package.json`, 0 coincidencias). Motivo
       real: estos 4 archivos necesitan una BD real sembrada; si se
       agregaran a `npm test` (que corre contra `DB_PATH` real por default,
       sin la copia desechable que se usó explícitamente para migrarlos con
       seguridad), cada corrida futura de `npm test` volvería a insertar
       datos de prueba en la BD de producción — exactamente el incidente de
       contaminación que ya se limpió más de una vez en sesiones anteriores
       (ver `CLAUDE.md`, nota de la 3ª pasada 2026-07-21). Mismo motivo por
       el que `test:notificaciones`/`test:fullbot`/`test:smoke` tampoco están
       en la cadena. **No se tocó `package.json`** — la exclusión es
       correcta y se deja así a propósito.
