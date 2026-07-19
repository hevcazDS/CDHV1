# Pendientes — Comité técnico multidisciplinario (2026-07)

Auditoría de 4 agentes (contabilidad/finanzas, arquitectura, operación día a día,
motor de flujo vs ComfyUI). Veredicto: el sistema está **mucho más completo** de
lo que dice `CLAUDE.md` (~65 migraciones atrás). Ya es un ERP contable real
(partida doble, libros inmutables, CFDI 4.0 con PAC real Facturapi, DIOT, nómina,
contabilidad electrónica). Lo que falta es **blindar los bordes de falla del
dinero**, no rediseñar.

## P0 — Integridad del dinero (HECHO — commit 2026-07-19)
- [x] 1. Barrido de asientos huérfanos: `contabilidadService.barrerAsientosHuerfanos`
      corre en `stockWatcher.runAll` (`checkAsientosHuerfanos`). Ventana 3 días,
      idempotente, fail-closed. (Finanzas S1/S3 + Arq R2)
- [x] 2. Migraciones transaccionales: `scripts/migrate.js` envuelve cada archivo
      en `db.transaction()` (excepto los que usan PRAGMA foreign_keys). Rollback
      sin estado parcial verificado. (Arq R1)
- [x] 3. Guard idempotente en `asientoCostoVenta` + reporte `GET /api/erp/integridad`
      (`ventasSinAsiento`) + `parseInt`→`parseFloat` en `costeoService`. (Finanzas S1/S5)
- [x] 4. `asientoReembolso` + wiring en `devolucionesPut` con flag `reembolso`
      (sin flag = idéntico; un cambio de mercancía no mueve caja). (Finanzas S2)
- [x] 5. `tests/test_contabilidad.js` 5/5 (cuadre + idempotencia + reversa +
      barrido + reembolso), cableado en `npm test`. (Arq R8)

## P1 — Completitud y experiencia
- [x] 6. Ficha de cliente unificada: `components/FichaCliente.jsx` (drawer con
      tabs Resumen + Seguimiento), usado por Clientes.jsx y Crm.jsx. Elimina la
      doble ficha; ambas páginas reusan el mismo componente.
- [x] 7. "Fiados vencidos" en el Inicio del dueño (VistaAdminF, tarjeta en
      "Requiere tu mano" → /fiados) + preview del último mensaje del cliente en
      la fila de la cola de atención (ColaAtencion + subconsulta en el endpoint).
- [x] 8. Cron de depreciación en `stockWatcher` (`checkDepreciacion`, mensual,
      idempotente, fail-closed). Además (nota del dueño): **terrenos no se
      deprecian** (categoría nueva, cuenta 125) y **revaluación al alza** de
      inmuebles/terrenos (`revaluarActivo` → superávit por revaluación 330,
      capital). Migración 0085 + `POST /api/erp/activos/:id/revaluar`.
      test_activos_fijos 8/8. UI: botón Revaluar + categoría Terrenos en ActivosFijosTab.
- [x] 9. Validación visual en vivo en `MotorCanvas`: subconjunto del linter sobre
      el lienzo (huérfano vía BFS desde el inicial = rojo; sin salida = ámbar),
      con ⚠ por nodo + resumen en la barra. El servidor sigue re-validando al
      guardar; esto solo adelanta el aviso. Usa tokens var(--red)/var(--yellow).
- [x] 10. `CLAUDE.md` actualizado: banner "Estado actual (2026-07)" arriba con
      las 5 discrepancias corregidas + puntero a `docs/` como fuente fiel.

## P2 — Estructural (cuando el volumen lo justifique)
- [x] 11. `db/schema.sql` reconciliado con producción (fuente de verdad = BD ya
      migrada 0001-0085): +26 tablas y +97 columnas que solo vivían en migraciones.
      Era un BUG real: el instalador usa schema.sql como estado final (sella
      migraciones sin correrlas), así que un cliente nuevo nacía sin RBAC/facturación/
      caja/etc. Verificado end-to-end: instancia nueva = 126 tablas = producción,
      DRIFT CERO. Guard de schema + suite exit 0.
- [x] 12. Verificación de restauración de respaldos: `scripts/verificarRespaldo.js`
      (CLI `npm run backup:verificar <archivo>` para .db/.gz/.gz.enc) + integrado
      en `backup.js`: snapshot CONSISTENTE vía API .backup() (antes readFileSync
      sobre WAL vivo = riesgo de artefacto corrupto) y verificación del artefacto
      (integrity + tablas críticas + mayor cuadra) ANTES de enviar; si no
      restaura, no se envía y checkBackupReciente alerta. Probado contra el
      respaldo real de producción + caso corrupto rechazado.
- [x] 13. Cierre contable anual: `contabilidadService.cierreAnual(anio)` traspasa
      el saldo de resultados (ingreso/costo/gasto) del ejercicio a "Utilidad
      acumulada" (302, capital), deja las cuentas en cero y bloquea el año
      (periodo_cerrado=AAAA-12). Idempotente por año. Migración 0086 (cuenta 302,
      aplicada a producción+instancias), `POST /api/erp/cierre-anual`, botón
      "Cerrar ejercicio" en ContabilidadTab, contract test. Suite exit 0.
- [ ] 14. Plano contable consolidado en Postgres para flota (rompe el techo de
      escalabilidad; deja SQLite por instancia para el bot).

## Agentes paralelos (COMPLETADOS)
- [x] Documentación completa: 11 archivos en `docs/` (README, ARQUITECTURA,
      MODULOS, CONTABILIDAD, BASE_DE_DATOS, API, BOT, FRONTEND, OPERACION,
      DESPLIEGUE). Derivada del código real, no de CLAUDE.md.
- [x] Revisión de visibilidad por rol. Hallazgos accionables abajo.

## Hallazgos del agente de visibilidad por rol (pendientes)
- [x] **P0-visibilidad** (HECHO): gate `roles:['gerente']` en `/api/guias`,
      `/api/metricas`, `/api/conversion` (fuga hermana) y `/api/busquedas`.
      Verificado: solo Guias/Metricas/Busquedas.jsx (todas gerente) los consumen.
- [x] **P1-visibilidad** (HECHO): guardas `tieneRango(gerente)` en `App.jsx` para
      `/correo`, `/guias`, `/modulos`, `/busquedas`, `/cola-envios`, `/metricas`.
      Al teclear la URL sin rango, el catch-all `*` redirige a `/`.
- [x] **P2-visibilidad** (HECHO): `Modulos.jsx` refleja `DEPENDE_DE` — el toggle
      de Facturación queda deshabilitado (con razón visible) hasta activar
      Contabilidad, y Contabilidad no se puede apagar con Facturación activa. La
      pestaña CRM "Tareas" se renombró a "Seguimientos" (vs las Tareas del Panel).
      Ficha unificada ya cubierta en P1-6.

## Re-auditoría 2026-07-19 (post-implementación)
Calificaciones: Contabilidad 7.5→**8.4** · Motor vs ComfyUI 7→**7.4** · Operación ~8→**8.5**.
Hallazgos corregidos el mismo día: H1 doble-resolución de devolución (guard de
transición 409), H2 cierre del año en curso (guard de ejercicio concluido),
H3 depreciación duplicada sin gate + subledger avanzaba sin asiento en mes
cerrado, H4 reembolso de fiado no cobrado (ahora cancela 105/208, no caja),
H5 devolución a costo congelado (netea contra el COGS de la venta), H6 barrido
también repara venta_credito faltante, H7 primera sync IMAP por secuencia (no
UID), H8 cierre anual atómico, H9 gates en ticket/devoluciones/etiquetas/
imagenes_clientes/logs_error, H10 PDF sin SSRF (bloqueo de subrecursos de red).
- [x] Pendientes menores de la re-auditoría (TODOS cerrados 2026-07-19):
      reembolso proporcional a lo cobrado (neto de línea × factor de cupón);
      nodos terminales del motor con flag `params.terminal` (sin ámbar falso);
      token de flota solo por header; secretos.js convergido (pac/gateway
      delegan, round-trip intercambiable verificado).
- [x] Motor de flujo (para subir de 7.4): undo/redo (Ctrl+Z/Y, 50 pasos,
      coalescencia), simulador "▶ Probar" desde el lienzo (con aviso de cambios
      sin guardar), condiciones tipadas en cables (Select con las `salidas`
      reales de la acción origen + aviso si el resultado no existe), piezas
      finales legítimas sin ruido. test_motor_editor 6/6, lienzo 14/14,
      golden+paridad byte-idéntico.

## Nota para el equipo
Los 4 agentes coincidieron: `CLAUDE.md` está ~65 migraciones desactualizado.
La documentación nueva en `docs/` es ahora la fuente fiel; actualizar CLAUDE.md
con las 5 discrepancias (roles ~9 no 3; contabilidad/CFDI real; ruteo por tronco;
módulos nuevos; 84 migraciones) — ver P1-10.
