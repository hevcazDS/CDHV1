# Informe: CRM integrado (bot WhatsApp + workflows del motor) — viabilidad

> Análisis 2026-07-15 (agente, evidencia archivo:línea). Pregunta del dueño:
> ¿crear un CRM mezclando el bot con los workflows? Pros, contras y dónde estamos.

## Dónde estamos: ~60-70% de un CRM YA EXISTE

| Fundamento | % | Evidencia |
|---|---|---|
| **Datos de cliente** | 85% | `clientes` con tags, canal_origen, **lead_score FUNCIONAL** (stockWatcher.js:562-589: pedidos×10 + gastado/100 ± tags), preferencias del wizard (edad/género/presupuesto), historial conversacional con `paso_actual`+`intencion` (0019) y outcome (venta/escalación/queja/abandono) |
| **Automatizaciones** | 75% | stockWatcher: carritos abandonados 2h/24h (¡con descuento variable por lead_score!), seguimiento 48h, dormidos 40d, recompra consumibles, CSAT, recordatorios de cita, fiados, suscripciones — TODAS por cola_notificaciones (auditables, anti-baneo) |
| **Canal WhatsApp** | 70% | sesión por cliente, escalada a humano (cola_atencion como bandeja ACD), historial de mensajes, masivos con gate humano + escalonado 15-120s |
| **Motor de flujo** | 40% | conversacional + checkout; le faltan triggers por EVENTO (lead_score>X, cambio de etapa) — pero sus `actions.js` son el enchufe natural |

## Qué falta (tabla de esfuerzo)

| Pieza | Esfuerzo | Sobre qué se construye |
|---|---|---|
| Pipeline de etapas (lead→contactado→cotizado→ganado/perdido) + kanban | **M** (3-4d) | `clientes.lead_score` + columna `etapa` + log `crm_etapas` |
| Notas por cliente | **S** | tabla `crm_notas` + form en perfil |
| Timeline unificado (pedidos+mensajes+notas+cambios) | **M** | query que junta lo existente |
| Tareas de seguimiento por cliente (≠ tareas de ERP) | **M** | `crm_tareas` (tipo/vence/asignado) |
| Segmentación guardada (audiencias reutilizables) | **M** | `crm_segmentos` + el `/api/masivo/preview` que YA existe |
| Triggers por evento (score>80 → tarea/oferta) | **M** | 3a ola del motor: `evento→acción` reutilizando actions.js en stockWatcher |
| Campañas multi-paso (msg día 0, día 3, día 7) | **G** | `crm_campanas`+pasos + job en stockWatcher, SIEMPRE con aprobación humana |
| RFM/churn scoring dinámico | **G** | analytics semanal, no urgente |

## PROS
1. **El canal ES la ventaja**: CRM con WhatsApp nativo integrado al ERP — Pipedrive/HubSpot no tienen la conversación ni el inventario.
2. **Datos más ricos que un CRM comercial**: intención por mensaje, motivo de abandono, preferencias, score — ya capturados.
3. **Las automatizaciones YA SON maquinaria CRM** (recuperación, reactivación, CSAT) — solo falta exponerlas y hacerlas configurables.
4. **Cero dependencias nuevas**; white-label intacto (cada instancia su CRM, datos on-premise).
5. **ROI en semana 1**: pipeline+notas+timeline = 70% del valor con 20% de la complejidad.

## CONTRAS / RIESGOS
1. **whatsapp-web.js no oficial → riesgo de baneo**: un CRM invita a más envíos. Mitigación INNEGOCIABLE (ya es regla del proyecto): masivos solo con gate humano, escalonado 15-120s inmutable hasta API oficial de Meta, audit log de quién lanzó qué.
2. **Campañas nunca 100% automáticas** por lo anterior — más lento que un SaaS, pero sin riesgo.
3. **Scope creep brutal** (el CRM es un pozo): MVP acotado a pipeline+tareas+notas+segmentos+campañas simples. Reportería avanzada = fase aparte.
4. **Compite con el foco ERP**: tratarlo como mejora operativa de ventas, no producto nuevo.
5. Dos-vías es polling (30s), no webhook — suficiente para pyme; API oficial de Meta lo resolvería después.

## Arquitectura recomendada (lean — extender, no módulo aparte)
- Tablas `crm_etapas`, `crm_notas`, `crm_tareas`, `crm_segmentos`, `crm_campanas(+pasos)`, `crm_log_actividades` (todas simples).
- `dashboard/routes/crm.js` (~12-15 endpoints declarativos, patrón del tronco).
- `stockWatcher.checkCampanasCRM()` (mismo patrón que las 17 automatizaciones).
- `actions.js` del motor gana acciones CRM (`actualizar_etapa`, `crear_tarea`, `agregar_nota`) → el editor visual tipo ComfyUI puede armar workflows de seguimiento.
- UI: página CRM con PipelineKanban + perfil de cliente (notas/tareas/timeline) + segmentos; Mantine+recharts ya están.

## Plan por fases
1. **Semana 1 (MVP)**: pipeline + notas + timeline — el gerente ve dónde está cada lead y anota. 4-5 días.
2. **Semana 2**: tareas de seguimiento + segmentación guardada (reusa masivo/preview). 3-4 días.
3. **Semana 3**: campañas simples (secuencias con delays y condición de salto) + triggers por evento básicos — SIEMPRE aprobación humana al lanzar. 5 días.
4. **Después**: RFM/churn, webhooks/API oficial Meta, email/SMS gateways.

## Conclusión
**Viable y barato relativo**: el 60-70% ya está construido y probado en producción
(bot, score, automatizaciones, canal, motor). El MVP de 2-3 semanas convierte lo
que ya existe en un CRM operable, sin dependencias nuevas y sin tocar el hot-path
de ventas. El riesgo real no es técnico: es (a) el baneo si se relajan los
masivos — las reglas actuales deben permanecer selladas — y (b) el scope creep.
