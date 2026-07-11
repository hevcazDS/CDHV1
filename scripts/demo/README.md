# Modo DEMO — una tienda por giro con un año de datos

Genera un clon de la base real **por cada giro**, lo orquesta para ese vertical
y lo llena con **un año de operación simulada**, para revisar que todos los
reportes (ventas, métricas, embudos, ERP/finanzas, corte de caja, nómina,
márgenes, rotación) se vean según corresponda. **No toca la base real.**

## Uso

```bash
# 1) Genera los clones demo (uno por giro) en demo/  (usa DB_PATH real de .env)
npm run demo:generar            # todos los giros
npm run demo:generar abarrotes carniceria   # solo esos

# 2) Construye el frontend si no está construido
npm run build:dashboard-ui

# 3) Levanta el HUB pre-login y abre http://127.0.0.1:4000
npm run demo
```

En el hub eliges el giro → abre esa tienda en su propio puerto. Entra con
cualquiera de estos usuarios, **todos con clave `123`**:

| Usuario | Rol | Ve |
|---------|-----|----|
| `prime` | dueño | todo: finanzas, nómina, usuarios, integraciones |
| `gerente` | tienda | catálogo, almacén, reportes, compras, ofertas |
| `caja` | cajero | mostrador/POS, cobros, corte propio, devoluciones |
| `almacen` | almacén | inventario, conteos, traslados |
| `rh` | recursos humanos | empleados, nómina |
| `conta` | contabilidad | finanzas/ERP (lectura+asientos) |
| `compras` | compras | órdenes de compra, proveedores |
| `auditor` | solo lectura | todo en lectura |

**La juguetería conserva los datos reales de Julio Cepeda** (solo se le fijan
los usuarios demo con clave 123); los demás giros tienen su propio catálogo.

## Reversible

```bash
npm run demo:limpiar     # borra la carpeta demo/ (los clones), nada más
```

La carpeta `demo/` está en `.gitignore` (no se versiona, se regenera). También
`node scripts/demo/seed.js <db> <giro> --revertir` quita solo lo sembrado de un
clon concreto (folios `DEMO-*`, clientes/empleados demo), dejando el resto.

## Piezas

- `catalogos.js` — catálogo mínimo por giro (nombre del negocio + ~12 productos).
- `seed.js` — siembra un año en una BD concreta usando **el mismo código de la
  app** (fija `DB_PATH` y requiere `_shared`/`contabilidadService`/`kardexService`
  → los reportes salen consistentes con producción). Reversible.
- `generar.js` — clona la BD real por giro y llama a `seed.js`.
- `servir.js` — el hub pre-login: landing "escoge el giro" + levanta cada tienda
  a demanda en su puerto y redirige.
