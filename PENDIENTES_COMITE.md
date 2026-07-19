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
- [ ] 6. Unificar la ficha de cliente (Clientes + CRM en un drawer con tabs).
- [ ] 7. "Fiados vencidos" en el Inicio del dueño + preview del último mensaje
      en la cola de atención.
- [ ] 8. Cron de depreciación/impuestos en `stockWatcher`.
- [ ] 9. Validación visual en vivo en el motor de flujo (importar el linter
      existente al `MotorCanvas` y pintar nodos en rojo).
- [ ] 10. Actualizar `CLAUDE.md` (los 4 agentes lo pidieron; doc obsoleta).
      → cubierto en parte por el agente de documentación en curso.

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
