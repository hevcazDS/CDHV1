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
- [ ] 9. Validación visual en vivo en el motor de flujo (importar el linter
      existente al `MotorCanvas` y pintar nodos en rojo).
- [x] 10. `CLAUDE.md` actualizado: banner "Estado actual (2026-07)" arriba con
      las 5 discrepancias corregidas + puntero a `docs/` como fuente fiel.

## P2 — Estructural (cuando el volumen lo justifique)
- [ ] 11. Reconciliar `db/schema.sql` con la BD real.
- [ ] 12. Backup incremental + verificación de restauración (obligación SAT 5 años).
- [ ] 13. Cierre contable anual formal (traspaso de resultados a capital).
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
- [ ] **P1-visibilidad**: rutas sin guarda en `App.jsx` que montan la carcasa al
      teclear la URL (`/modulos`, `/correo`, `/metricas`, `/busquedas`, `/cola-envios`).
      Envolver con el patrón `tieneRango` ya usado en `/prime`/`/marketing`/`/catalogo`.
- [ ] **P2-visibilidad**: reflejar `DEPENDE_DE` (facturación→contabilidad) en
      `Modulos.jsx` (deshabilitar toggle hasta activar el padre); desambiguar la
      doble "Tareas" (Panel vs CRM); unificar ficha de cliente (ya en P1-6).

## Nota para el equipo
Los 4 agentes coincidieron: `CLAUDE.md` está ~65 migraciones desactualizado.
La documentación nueva en `docs/` es ahora la fuente fiel; actualizar CLAUDE.md
con las 5 discrepancias (roles ~9 no 3; contabilidad/CFDI real; ruteo por tronco;
módulos nuevos; 84 migraciones) — ver P1-10.
