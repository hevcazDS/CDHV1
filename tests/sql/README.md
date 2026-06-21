# SQL de prueba contra el esquema real

Estos scripts corren contra `Base de datos demo/jugueteria.db` (copia de la
BD real que agregaste) — son de solo lectura, no modifican nada. A diferencia
de `migraciones_pendientes/` (carpeta de cambios a aplicar una sola vez, ya
borrada — su contenido quedó confirmado y aplicado contra producción), estos
son **regresivos**: vuelve a correrlos cada vez que se toque una tabla
relacionada, para detectar a tiempo lo que antes solo se descubría en
producción.

## Cómo correrlos

```bash
sqlite3 "Base de datos demo/jugueteria.db" < tests/sql/01_reporte_revenue.sql
```

(o con node: `node -e "const db=require('better-sqlite3')('Base de datos demo/jugueteria.db',{readonly:true}); ..."`)

Cada script imprime filas solo cuando algo está mal — si no imprime nada
(o imprime "OK"), pasó.

## Qué prueba cada uno

- **01_reporte_revenue** — compara `pedidos.total` (lo que suma
  `/api/reporte`) contra el dinero real en `links_pago`/`pedido_detalle`.
  **Ya arreglado en el código**: `grabarPedidoPickup`/`Envio`/`Split` en
  `_shared.js` insertan el pedido y luego hacen
  `UPDATE pedidos SET subtotal=?, total=? WHERE id_pedido=?` (y `descuento=?`
  en el caso de envío), así que pedidos nuevos sí llevan el total real. Este
  script queda como regresión y para detectar filas viejas (creadas antes
  del fix) que aún tengan `total` en 0 — el backfill correspondiente
  (`0004_backfill_pedidos_total.sql`) ya se aplicó contra producción y se
  borró junto con el resto de `migraciones_pendientes/`.
- **02_devoluciones_contrato** — las columnas que `asesorFlow.js` usa en su
  INSERT deben existir en `devoluciones`. Esta prueba habría detectado el bug
  real que encontramos: el código mandaba `canal`, columna que no existe en
  esta tabla, y el INSERT fallaba en silencio (estaba en try/catch). Ya
  arreglado en el código; este script queda para que no vuelva a pasar.
- **03_marketing_contrato** — columnas que usan las funciones nuevas de
  `stockWatcher.js` (cupón 24h de carrito abandonado, reactivación de
  clientes dormidos) contra `carritos_abandonados`, `promociones`,
  `clientes`, `pedidos`, `cola_notificaciones`.
- **04_lealtad_backfill** — valida que la migración `021_lealtad_descuento.sql`
  sea segura de correr contra este esquema (sintaxis + columnas reales).
