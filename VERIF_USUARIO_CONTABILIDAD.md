# Verificación RBAC — rol `contabilidad`

Fecha: 2026-07-18 · Solo lectura de código (sin BD viva, sin git, sin pm2).

## (a) ¿Se puede crear hoy un usuario `contabilidad` desde el panel?

**SÍ.** Todas las capas lo incluyen, sin brecha.

## Evidencia (archivo:línea)

### 1. El rol existe

- CHECK del CREATE TABLE usuarios — `dashboard/server.js:197`
  `rol TEXT NOT NULL CHECK(rol IN ('cajero','operador','almacen','compras','rh','contabilidad','usuario','gerente','admin','prime'))`
- Jerarquía — `dashboard/permisos.js:9` → `contabilidad: 1` (especialista, rango 1)
- Áreas — `dashboard/permisos.js:22` → `contabilidad: ['finanzas', 'rrhh', 'cortes']`
  - Incluye `'finanzas'` ✅ · **NO** incluye `'operacion'` ✅ · **NO** incluye `'pos'`, `'compras'`, `'almacen'` ✅
- Creable por gerente — `dashboard/permisos.js:28` → `ROLES_CREABLES_POR_GERENTE` incluye `'contabilidad'`
- Espejo frontend idéntico — `dashboard-ui/src/lib/permisos.js:4,14,18`

### 2. Endpoint de alta

- Validador — `bot/validators.js:267` `UsuarioSchema.rol = z.enum([...,'contabilidad',...])` ✅ (y `UsuarioUpdateSchema` línea 277)
- POST `/api/prime/usuarios` — `dashboard/routes/primeUsuariosPuntos.js:15-43`, gate `roles:['gerente']` (línea 182).
  Línea 21: un gerente puede crear `contabilidad` porque está en `ROLES_CREABLES_POR_GERENTE`; prime también.
- **NO hay trampa** "rol en el CHECK pero fuera del schema": `contabilidad` está en CHECK, en `UsuarioSchema`, en `ROLES_CREABLES_POR_GERENTE` y en la UI.

### 3. UI de gestión

- `dashboard-ui/src/pages/prime/UsuariosTab.jsx:23` → `ROLES_OPCIONES` ofrece `contabilidad: 'Contabilidad (finanzas)'`
- `UsuariosTab.jsx:31` → `ROLES_INLINE` (cambio de rol en tabla) también lo ofrece.
- `contabilidad` NO está en `ROLES_ALTOS` (línea 16), así que un **gerente** lo ve y lo puede asignar (no requiere prime).

### 4. Qué ve / puede el rol `contabilidad`

Áreas: `finanzas`, `rrhh`, `cortes` (rango 1, especialista — NO admin).

Server-side gate (`dashboard/routes/_construirModulo.js:75-81`): `permite(ses.rol, area)` → 403 si el área no está.

**VE (correcto para contador):**
- Finanzas / ERP completo (`/erp`) — 30+ rutas `area:'finanzas'` en `erpContabilidad.js:705-733` (asientos, libro mayor, flujo caja, impuestos, DIOT, CFDI, conciliación, baúl). Ruta front `App.jsx:107` gateada `permite(rol,'finanzas')`. Sidebar `Layout.jsx:71` link "Finanzas" `area:'finanzas'`.
- **Salud del negocio (CAC/LTV)** — es un tab DENTRO de `/erp` (`Erp.jsx:28` `SaludNegocioTab`), backend `/api/erp/salud-financiera` `area:'finanzas'` (`erpContabilidad.js:722`). Por tanto contabilidad lo ve ✅.
- Compras (lectura cruzada) — `Layout.jsx:70` / `App.jsx:108` `areas:['compras','finanzas']` → contabilidad entra por `finanzas`. (Coherente: un contador consulta CxP/facturas.)
- Fiados — `App.jsx:117` `['pos','finanzas']` → entra por finanzas.
- RRHH — `Layout.jsx:76,138` link siempre visible para rh/contabilidad.

**NO ve / NO puede (correcto):**
- Catálogo/Productos — `Layout.jsx:64` `rolRequerido:'gerente'` → bloqueado (rango 1 < 2).
- Usuarios / Módulos / Configuración / Beta — `Layout.jsx:79-82` `rolRequerido gerente/prime` → bloqueado.
- Bot control, Marketing, Métricas, Búsquedas, Guías — `rolRequerido:'gerente'` → bloqueado.
- Operación (Pedidos/Cola/Clientes/CRM/POS/Almacén) — sin área `operacion`/`pos`/`almacen` → bloqueado front y back.
- Salvaguarda extra: solo Prime puede **desactivar** el módulo Contabilidad (`primeUsuariosPuntos.js:135`).

## (b) Brecha

**Ninguna.** No existe la brecha típica (rol en CHECK ausente del schema/UI). `contabilidad` está presente y consistente en las 5 capas: CHECK SQL, `permisos.js` (back), `lib/permisos.js` (front), `bot/validators.js` (schema), `UsuariosTab.jsx` (UI).

## (c) Coherencia para un contador

Correcta. Finanzas SÍ (ERP + Salud del negocio + impuestos + CFDI + conciliación), RRHH y cortes SÍ (por diseño), Compras/Fiados en lectura por finanzas. Catálogo NO, Usuarios NO, Bot NO, Operación/POS/Almacén NO.

## (d) Plan de corrección

**No se requiere.** El sistema permite crear y configurar bien un usuario `contabilidad` hoy.
