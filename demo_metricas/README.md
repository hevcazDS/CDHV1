# demo_metricas/

Dos scripts SQL para correr a mano contra una base real (no se ejecutan desde el código):

- `seed_metricas_demo.sql` — inserta datos sintéticos que cubren ventas, ventas activas,
  cancelaciones, devoluciones, quejas/escaladas, carritos abandonados, envíos, envíos
  masivos, puntos de lealtad, lista de espera, preventas, CSAT y búsquedas. Pensado para
  poder probar de punta a punta las páginas del dashboard y las métricas con datos
  completos. Los clientes demo usan teléfonos `529999000N` y `tags` incluye
  `demo_metricas` (mismo patrón que `tests/test_estres_bd.js`).
- `cleanup_metricas_demo.sql` — vacía por completo (no solo lo del seed) las tablas
  transaccionales/de marketing/de atención involucradas y reinicia sus contadores
  AUTOINCREMENT. No toca `productos`, `usuarios`, `configuracion` ni `puntos_entrega`.

Orden de uso:

```bash
sqlite3 "ruta/a/jugueteria.db" < demo_metricas/seed_metricas_demo.sql
# ... pruebas en el dashboard/bot ...
sqlite3 "ruta/a/jugueteria.db" < demo_metricas/cleanup_metricas_demo.sql
```

Requiere al menos un producto activo en `productos` y, idealmente, un punto activo en
`puntos_entrega` antes de correr el seed.
