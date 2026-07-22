# Operación por rol

Guía del día a día por rol. El acceso lo gobierna el RBAC de
[ARQUITECTURA.md](ARQUITECTURA.md#rbac--roles-y-áreas): **jerárquicos**
(prime > gerente > especialistas) y **especialistas por área**. El sidebar solo
muestra lo que el rol puede tocar (más los módulos encendidos).

Roles: `cajero`, `operador`, `almacen`, `compras`, `rh`, `contabilidad`,
`auditor`, `gerente` ("Administrador"), `prime` (dueño).

---

## Cajero (`cajero`) — área `pos`

Cobra ventas de mostrador y de mesa.
- **Mostrador** — arma carrito, cobra (efectivo/tarjeta/transferencia/link), imprime ticket. Requiere `pos_activo`.
- **Mesas / Cocina** — abre mesas, agrega platillos con comentarios, manda a cocina, cobra. Requiere `mesas_activo`.
- Redime cupones en el cobro.
- No ve pedidos de WhatsApp ni contabilidad.

## Operador (`operador`, `usuario` legacy) — áreas `pos` + `operacion`

El "todero" de piso: todo lo del cajero **más** la operación de WhatsApp.
- **Pedidos** — edita, marca pagado (el chokepoint que dispara kardex+asientos+puntos), asigna repartidor ("va en camino"/"entregado").
- **Devoluciones**, **Cola de atención** (retoma clientes que el bot escaló), **Chat y mensajes**, **Clientes**.
- **CRM · Pipeline** — mueve etapas, deja notas, ve timeline.
- **Citas / Check-in / Órdenes de servicio / Suscripciones / Documentos** (según módulos). Cambiar el `monto` (cobro recurrente) de una suscripción exige **PIN**.
- **Fiados** (si `ventas_credito_activo`) — junto con finanzas.
- Control del bot (start/stop/restart, QR).

## Almacén (`almacen`) — área `almacen`

- **Almacén**: inventario, **kardex**, calendario, caducidades, conteos físicos (plantilla → capturar → aplicar), ubicaciones, mermas.
- **Salida** y **traslado** entre sucursales requieren **PIN de autorización**.
- **Recibe órdenes de compra** (recepción, incl. parcial) — cruza con Compras.
- `compras` tiene `almacen_lectura` (ve inventario sin mover).

## Compras (`compras`) — áreas `compras` + `almacen_lectura`

- **Proveedores** y **órdenes de compra** (crear, reordenar desde historial, cancelar).
- **Cuentas por pagar** (ve; pagar es de finanzas).
- **Solicitudes de compra** (crea; aprobar es de gerente).
- Carga de **factura de proveedor** (XML CFDI → proveedor + CxP + asiento automático).

## RH (`rh`) — área `rrhh`

Requiere `rrhh_activo` / `nomina_fiscal_activo`.
- **Recursos Humanos**: empleados (alta requiere **PIN**, fija el salario inicial), horarios (import por Excel), incapacidades.
- **Nómina**: calcula, **paga (PIN)**, timbra CFDI de nómina.
- **Aguinaldo / finiquito**: calcula y **paga (PIN)** por `tipo_baja` (renuncia/despido/jubilación), séptimo día, prima dominical, IMSS patronal, vacaciones LFT.

## Contabilidad (`contabilidad`) — áreas `finanzas` + `rrhh` + `cortes`

El contador. Todo bajo **Finanzas** (`/erp`):
- **Libro mayor**, asientos (registro manual + auto), plan de cuentas, rastro/auditoría.
- **Impuestos, DIOT, contabilidad electrónica SAT**, flujo de caja, salud financiera, tablero, unit-economics, rentabilidad por cliente/vendedor.
- **CFDI**: timbrar pedidos, cancelar, complemento de pago (REP). Baúl contable (archivar/exportar CFDIs por lote).
- **Conciliación bancaria** (importar estado de cuenta, conciliar).
- **Activos fijos** (alta, depreciación, baja con PIN).
- **Cierre de período** (`YYYY-MM`); autoriza captura en meses cerrados con huella.
- **Cortes de caja** (gerente+; contabilidad los ve por su área `cortes`).

## Auditor (`auditor`) — todas las áreas, **solo lectura**

Ve todo lo de gerente salvo `/prime` y `/modulos`. `server.js` bloquea todo
método ≠ GET en un punto único: no puede modificar nada.

## Gerente / "Administrador" (`gerente`) — rango 2, todas las áreas

Además de cubrir todas las áreas especialistas:
- **Catálogo/Productos** (alta/edición, costo/margen, entrada de mercancía, variantes, media avanzada).
- **Módulos** (enciende/apaga capacidades), **tono del bot**, **ofertas/promociones/cupones**, **métodos de pago**.
- **Marketing**, **Correo** (redactar/enviar), **CRM campañas/segmentos**.
- **Métricas** y **reportes** del negocio, **búsquedas**.
- **Cortes de caja**, aprobar solicitudes de compra, envío masivo.
- Gestiona usuarios especialistas (no gerente/prime).

## Prime (dueño) — rango 3, todo

Todo lo del gerente **más** configuración sensible:
- **Onboarding** (creó la instancia como primer usuario prime).
- **Integraciones**: PAC (timbrado real), pasarela de pago, régimen fiscal, zona horaria, tope de descuento, envío default.
- **Motor de flujo** (lienzo React Flow del comportamiento del bot).
- **Usuarios** de cualquier rol (crear/editar/borrar; no puede borrarse a sí mismo ni al último prime).
- **Seguridad operativa**: PIN de autorización, backup cifrado, reset de instancia, restaurar BD, purgar sesión WhatsApp.
- **Datos LLM** (exportar dataset), **multi-instancia** (`/api/instancias`), **Beta/Pruebas**.

---

## El flujo del dinero en la operación

Sin importar el canal (bot WhatsApp, POS de mostrador, fiado), **todo cobro
converge en `marcar-pagado`**, que en un solo punto descuenta inventario
(kardex), asienta la venta y el costo (partida doble), acredita puntos de
lealtad y premia al referidor. Ver [CONTABILIDAD.md](CONTABILIDAD.md#tipos-de-asiento-y-el-flujo-del-dinero).

## Widget de soporte

En **toda** instancia hay un botón flotante de **Hevcaz Solutions** (el
proveedor del software, distinto del negocio cliente) con su contacto.
