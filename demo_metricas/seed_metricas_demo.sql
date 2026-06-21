-- seed_metricas_demo.sql
-- ═══════════════════════════════════════════════════════════════════════
-- Carga datos sintéticos para poder probar/medir TODOS los procesos del
-- bot + dashboard: ventas, ventas activas, cancelaciones, devoluciones,
-- quejas/escaladas, carritos abandonados, envíos, envíos masivos, puntos
-- de lealtad, lista de espera, preventas, CSAT y búsquedas.
--
-- Marcador de datos demo (por si quieres identificarlos visualmente antes
-- de correr el cleanup): clientes.telefono empieza con '529999' y
-- clientes.tags incluye 'demo_metricas' — mismo patrón que ya usa
-- tests/test_estres_bd.js para no chocar nunca con teléfonos reales.
--
-- Requiere: al menos 1 fila en `productos` (activo=1) y, idealmente,
-- al menos 1 fila en `puntos_entrega` (activo=1) para los pedidos pickup.
-- Corre con: sqlite3 "ruta/a/jugueteria.db" < seed_metricas_demo.sql
-- ═══════════════════════════════════════════════════════════════════════

PRAGMA foreign_keys = ON;

-- Productos/puntos de entrega reales del catálogo — se referencian por
-- posición para no inventar IDs que no existan en tu base.
DROP TABLE IF EXISTS temp._demo_prod;
CREATE TEMP TABLE _demo_prod AS
    SELECT id, name, price, ROW_NUMBER() OVER (ORDER BY id) AS n
    FROM productos WHERE activo = 1 LIMIT 8;

DROP TABLE IF EXISTS temp._demo_punto;
CREATE TEMP TABLE _demo_punto AS
    SELECT id FROM puntos_entrega WHERE activo = 1 LIMIT 1;

-- ── 1. CLIENTES ─────────────────────────────────────────────────────────
INSERT INTO clientes (nombre, telefono, tags, activo, canal_origen, creado_en, ultima_actividad, lead_score) VALUES
('Maria Garcia',       '5299990001', 'demo_metricas',                    1, 'whatsapp', datetime('now','localtime','-58 days'), datetime('now','localtime','-50 days'), 85),
('Jose Hernandez',     '5299990002', 'demo_metricas',                    1, 'whatsapp', datetime('now','localtime','-50 days'), datetime('now','localtime','-49 days'), 40),
('Ana Lopez',          '5299990003', 'demo_metricas,cliente_satisfecho', 1, 'whatsapp', datetime('now','localtime','-45 days'), datetime('now','localtime','-40 days'), 90),
('Carlos Martinez',    '5299990004', 'demo_metricas',                    1, 'whatsapp', datetime('now','localtime','-40 days'), datetime('now','localtime','-39 days'), 20),
('Laura Sanchez',      '5299990005', 'demo_metricas,queja',              1, 'whatsapp', datetime('now','localtime','-38 days'), datetime('now','localtime','-36 days'), 15),
('Pedro Ramirez',      '5299990006', 'demo_metricas',                    1, 'whatsapp', datetime('now','localtime','-35 days'), datetime('now','localtime','-30 days'), 60),
('Sofia Torres',       '5299990007', 'demo_metricas',                    1, 'whatsapp', datetime('now','localtime','-30 days'), datetime('now','localtime','-28 days'), 70),
('Miguel Flores',      '5299990008', 'demo_metricas',                    1, 'whatsapp', datetime('now','localtime','-28 days'), datetime('now','localtime','-25 days'), 55),
('Daniela Cruz',       '5299990009', 'demo_metricas',                    1, 'whatsapp', datetime('now','localtime','-25 days'), datetime('now','localtime','-20 days'), 33),
('Jorge Diaz',         '5299990010', 'demo_metricas',                    1, 'whatsapp', datetime('now','localtime','-20 days'), datetime('now','localtime','-18 days'), 48),
('Patricia Vargas',    '5299990011', 'demo_metricas',                    1, 'whatsapp', datetime('now','localtime','-18 days'), datetime('now','localtime','-15 days'), 77),
('Roberto Mendoza',    '5299990012', 'demo_metricas',                    1, 'whatsapp', datetime('now','localtime','-15 days'), datetime('now','localtime','-12 days'), 62),
('Gabriela Ortiz',     '5299990013', 'demo_metricas',                    1, 'whatsapp', datetime('now','localtime','-10 days'), datetime('now','localtime','-8 days'),  29),
('Fernando Castillo',  '5299990014', 'demo_metricas',                    1, 'whatsapp', datetime('now','localtime','-7 days'),  datetime('now','localtime','-5 days'),  44),
('Valeria Reyes',      '5299990015', 'demo_metricas',                    1, 'whatsapp', datetime('now','localtime','-3 days'),  datetime('now','localtime','-1 days'),  91);

-- ── 2. PEDIDOS (ventas, ventas activas, cancelaciones, pickup) ─────────
-- 2a. Entregados (ventas completas) — 6
INSERT INTO pedidos (cliente, id_cliente, id_producto, ciudad_envio, cantidad, estatus, folio, canal_creacion, creado_en, actualizado_en, subtotal, descuento, total, cp) VALUES
('Maria Garcia',      (SELECT id FROM clientes WHERE telefono='5299990001'), (SELECT id FROM _demo_prod WHERE n=1), 'San Luis Potosi', 1, 'entregado', 'DEMO-PED-0001', 'bot', datetime('now','localtime','-55 days'), datetime('now','localtime','-52 days'), 599.00, 0,     749.00, '78000'),
('Jose Hernandez',    (SELECT id FROM clientes WHERE telefono='5299990002'), (SELECT id FROM _demo_prod WHERE n=2), 'Guadalajara',      2, 'entregado', 'DEMO-PED-0002', 'bot', datetime('now','localtime','-48 days'), datetime('now','localtime','-45 days'), 1198.00,0,    1347.00, '44100'),
('Ana Lopez',         (SELECT id FROM clientes WHERE telefono='5299990003'), (SELECT id FROM _demo_prod WHERE n=3), 'Leon',             1, 'entregado', 'DEMO-PED-0003', 'bot', datetime('now','localtime','-43 days'), datetime('now','localtime','-40 days'), 850.00, 85.00, 914.00, '37000'),
('Carlos Martinez',   (SELECT id FROM clientes WHERE telefono='5299990004'), (SELECT id FROM _demo_prod WHERE n=1), 'San Luis Potosi', 3, 'entregado', 'DEMO-PED-0004', 'asesor', datetime('now','localtime','-38 days'), datetime('now','localtime','-35 days'), 1797.00,0,  1946.00, '78210'),
('Laura Sanchez',     (SELECT id FROM clientes WHERE telefono='5299990005'), (SELECT id FROM _demo_prod WHERE n=4), 'Guadalajara',      1, 'entregado', 'DEMO-PED-0005', 'bot', datetime('now','localtime','-34 days'), datetime('now','localtime','-31 days'), 450.00, 0,     599.00, '44600'),
('Pedro Ramirez',     (SELECT id FROM clientes WHERE telefono='5299990006'), (SELECT id FROM _demo_prod WHERE n=2), 'Leon',             1, 'entregado', 'DEMO-PED-0006', 'bot', datetime('now','localtime','-29 days'), datetime('now','localtime','-26 days'), 599.00, 0,     749.00, '37150');

-- 2b. Cancelados — 3
INSERT INTO pedidos (cliente, id_cliente, id_producto, ciudad_envio, cantidad, estatus, folio, canal_creacion, creado_en, actualizado_en, subtotal, descuento, total, cp) VALUES
('Sofia Torres',      (SELECT id FROM clientes WHERE telefono='5299990007'), (SELECT id FROM _demo_prod WHERE n=3), 'San Luis Potosi', 1, 'cancelado', 'DEMO-PED-0007', 'bot', datetime('now','localtime','-27 days'), datetime('now','localtime','-26 days'), 850.00, 0, 999.00, '78000'),
('Miguel Flores',     (SELECT id FROM clientes WHERE telefono='5299990008'), (SELECT id FROM _demo_prod WHERE n=5), 'Guadalajara',      2, 'cancelado', 'DEMO-PED-0008', 'bot', datetime('now','localtime','-24 days'), datetime('now','localtime','-23 days'), 1100.00,0,1249.00, '44100'),
('Daniela Cruz',      (SELECT id FROM clientes WHERE telefono='5299990009'), (SELECT id FROM _demo_prod WHERE n=1), 'Leon',             1, 'cancelado', 'DEMO-PED-0009', 'bot', datetime('now','localtime','-22 days'), datetime('now','localtime','-21 days'), 599.00, 0, 748.00, '37000');

-- 2c. Ventas activas en curso (confirmado/preparando/enviado) — 5
INSERT INTO pedidos (cliente, id_cliente, id_producto, ciudad_envio, cantidad, estatus, folio, canal_creacion, creado_en, actualizado_en, subtotal, descuento, total, cp) VALUES
('Jorge Diaz',        (SELECT id FROM clientes WHERE telefono='5299990010'), (SELECT id FROM _demo_prod WHERE n=2), 'San Luis Potosi', 1, 'confirmado', 'DEMO-PED-0010', 'bot', datetime('now','localtime','-9 days'), datetime('now','localtime','-9 days'), 599.00, 0, 748.00, '78000'),
('Patricia Vargas',   (SELECT id FROM clientes WHERE telefono='5299990011'), (SELECT id FROM _demo_prod WHERE n=4), 'Guadalajara',      1, 'preparando', 'DEMO-PED-0011', 'bot', datetime('now','localtime','-7 days'), datetime('now','localtime','-6 days'), 450.00, 0, 599.00, '44100'),
('Roberto Mendoza',   (SELECT id FROM clientes WHERE telefono='5299990012'), (SELECT id FROM _demo_prod WHERE n=3), 'Leon',             2, 'enviado',    'DEMO-PED-0012', 'bot', datetime('now','localtime','-6 days'), datetime('now','localtime','-4 days'), 1700.00,0,1949.00, '37000'),
('Gabriela Ortiz',    (SELECT id FROM clientes WHERE telefono='5299990013'), (SELECT id FROM _demo_prod WHERE n=1), 'San Luis Potosi', 1, 'enviado',    'DEMO-PED-0013', 'bot', datetime('now','localtime','-4 days'), datetime('now','localtime','-2 days'), 599.00, 0, 748.00, '78210'),
('Fernando Castillo', (SELECT id FROM clientes WHERE telefono='5299990014'), (SELECT id FROM _demo_prod WHERE n=2), 'Guadalajara',      1, 'confirmado', 'DEMO-PED-0014', 'bot', datetime('now','localtime','-2 days'), datetime('now','localtime','-2 days'), 599.00, 0, 748.00, '44600');

-- 2d. Pendientes de pago (todavía sin link pagado) — 3
INSERT INTO pedidos (cliente, id_cliente, id_producto, ciudad_envio, cantidad, estatus, folio, canal_creacion, creado_en, actualizado_en, subtotal, descuento, total, cp) VALUES
('Valeria Reyes',     (SELECT id FROM clientes WHERE telefono='5299990015'), (SELECT id FROM _demo_prod WHERE n=3), 'Leon',             1, 'Pendiente', 'DEMO-PED-0015', 'bot', datetime('now','localtime','-1 days'), datetime('now','localtime','-1 days'), 850.00, 0, 999.00, '37000'),
('Maria Garcia',      (SELECT id FROM clientes WHERE telefono='5299990001'), (SELECT id FROM _demo_prod WHERE n=1), 'San Luis Potosi', 1, 'Pendiente', 'DEMO-PED-0016', 'bot', datetime('now','localtime','-12 hours'), datetime('now','localtime','-12 hours'), 599.00, 0, 748.00, '78000'),
('Jose Hernandez',    (SELECT id FROM clientes WHERE telefono='5299990002'), (SELECT id FROM _demo_prod WHERE n=4), 'Guadalajara',      1, 'Pendiente', 'DEMO-PED-0017', 'bot', datetime('now','localtime','-3 hours'),  datetime('now','localtime','-3 hours'),  450.00, 0, 599.00, '44100');

-- 2e. Pick up en tienda — 3
INSERT INTO pedidos (cliente, id_cliente, id_producto, ciudad_envio, cantidad, estatus, folio, canal_creacion, creado_en, actualizado_en, subtotal, descuento, total) VALUES
('Ana Lopez',         (SELECT id FROM clientes WHERE telefono='5299990003'), (SELECT id FROM _demo_prod WHERE n=2), '', 1, 'Pick Up Pendiente', 'DEMO-PED-0018', 'bot', datetime('now','localtime','-5 days'), datetime('now','localtime','-5 days'), 599.00, 0, 599.00),
('Carlos Martinez',   (SELECT id FROM clientes WHERE telefono='5299990004'), (SELECT id FROM _demo_prod WHERE n=1), '', 2, 'Pick Up Pendiente', 'DEMO-PED-0019', 'bot', datetime('now','localtime','-2 days'), datetime('now','localtime','-2 days'), 1198.00,0,1198.00),
('Laura Sanchez',     (SELECT id FROM clientes WHERE telefono='5299990005'), (SELECT id FROM _demo_prod WHERE n=3), '', 1, 'Pick Up Pendiente', 'DEMO-PED-0020', 'bot', datetime('now','localtime','-1 days'), datetime('now','localtime','-1 days'), 850.00, 0, 850.00);

-- ── 3. PEDIDO_DETALLE (líneas de carrito) ──────────────────────────────
INSERT INTO pedido_detalle (id_pedido, id_producto, cantidad, precio_unitario, subtotal_linea, sucursal_origen)
SELECT p.id_pedido, p.id_producto, p.cantidad, (SELECT price FROM _demo_prod WHERE n=1), p.subtotal, 'San Luis Potosi'
FROM pedidos p WHERE p.folio LIKE 'DEMO-PED-%';

-- ── 4. LINKS_PAGO ───────────────────────────────────────────────────────
INSERT INTO links_pago (id_pedido, id_metodo, url_link, token_externo, monto, moneda, estatus, fecha_expiracion, referencia_pago, pagado_en)
SELECT id_pedido, 4, 'https://demo.paypal.fake/' || folio, 'PP-' || folio, total, 'MXN',
       CASE
           WHEN estatus = 'entregado' THEN 'pagado'
           WHEN estatus = 'cancelado' THEN 'cancelado'
           WHEN estatus IN ('confirmado','preparando','enviado') THEN 'pagado'
           ELSE 'generado'
       END,
       datetime(creado_en, '+48 hours'),
       CASE WHEN estatus IN ('entregado','confirmado','preparando','enviado') THEN 'REF-' || folio ELSE NULL END,
       CASE WHEN estatus IN ('entregado','confirmado','preparando','enviado') THEN datetime(creado_en, '+1 hours') ELSE NULL END
FROM pedidos WHERE folio LIKE 'DEMO-PED-%';

-- ── 5. ENVIOS + GUIAS_ESTAFETA (solo pedidos de envío, no pickup) ──────
INSERT INTO envios (id_pedido, id_paqueteria, costo_envio, estatus, numero_guia, fecha_envio, fecha_entrega_estimada)
SELECT id_pedido, 1, 149.00,
       CASE WHEN estatus = 'entregado' THEN 'entregado'
            WHEN estatus IN ('confirmado','preparando') THEN 'preparando'
            WHEN estatus = 'enviado' THEN 'en_transito'
            ELSE 'pendiente' END,
       'DEMO-EST-' || folio,
       datetime(creado_en, '+1 days'),
       datetime(creado_en, '+3 days')
FROM pedidos WHERE folio LIKE 'DEMO-PED-%' AND folio NOT IN ('DEMO-PED-0018','DEMO-PED-0019','DEMO-PED-0020');

INSERT INTO guias_estafeta (id_envio, id_pedido, numero_guia, folio_interno, dest_nombre, dest_calle, dest_colonia, dest_ciudad, dest_estado, dest_cp, dest_telefono, peso_kg, alto_cm, ancho_cm, largo_cm, contenido, valor_declarado, fecha_envio_est, fecha_entrega_est, estatus, estatus_entrega, fecha_entrega_real, es_simulada)
SELECT e.id, p.id_pedido, e.numero_guia, 'DEMO-GE-' || p.folio,
       p.cliente, 'Calle Demo 123', 'Centro', p.ciudad_envio, 'Demo', '00000', '5299990000',
       1.5, 20, 20, 20, 'Juguete', p.total,
       datetime(p.creado_en, '+1 days'), datetime(p.creado_en, '+3 days'),
       CASE WHEN p.estatus = 'entregado' THEN 'entregada'
            WHEN p.estatus = 'enviado' THEN 'en_transito'
            ELSE 'generada' END,
       CASE WHEN p.estatus = 'entregado' THEN 'entregada' ELSE NULL END,
       CASE WHEN p.estatus = 'entregado' THEN datetime(p.creado_en, '+3 days') ELSE NULL END,
       1
FROM pedidos p JOIN envios e ON e.id_pedido = p.id_pedido
WHERE p.folio LIKE 'DEMO-PED-%';

-- ── 6. RESERVAS_PICKUP (los 3 pedidos pickup) ──────────────────────────
INSERT INTO reservas_pickup (id_pedido, id_punto, estatus, fecha_limite, codigo_retiro)
SELECT id_pedido, (SELECT id FROM _demo_punto), 'apartado', datetime(creado_en, '+72 hours'), 'DEMO-RET-' || folio
FROM pedidos WHERE folio IN ('DEMO-PED-0018','DEMO-PED-0019','DEMO-PED-0020');

-- ── 7. DEVOLUCIONES (sobre 2 pedidos ya entregados) ────────────────────
INSERT INTO devoluciones (id_pedido, motivo, estatus, notas, creada_en, resuelta_en, id_producto, cantidad) VALUES
((SELECT id_pedido FROM pedidos WHERE folio='DEMO-PED-0002'), 'Llegó dañado o defectuoso', 'aprobada',  'Se reembolsó al cliente', datetime('now','localtime','-44 days'), datetime('now','localtime','-42 days'), (SELECT id FROM _demo_prod WHERE n=2), 1),
((SELECT id_pedido FROM pedidos WHERE folio='DEMO-PED-0004'), 'Producto incorrecto (me llegó otro)', 'solicitada', NULL, datetime('now','localtime','-30 days'), NULL, (SELECT id FROM _demo_prod WHERE n=1), 1),
((SELECT id_pedido FROM pedidos WHERE folio='DEMO-PED-0006'), 'No funciona correctamente', 'rechazada', 'Fuera de garantía', datetime('now','localtime','-20 days'), datetime('now','localtime','-18 days'), (SELECT id FROM _demo_prod WHERE n=2), 1);

-- ── 8. COLA_ATENCION (quejas / escaladas) ──────────────────────────────
INSERT INTO cola_atencion (id_cliente, motivo_escalada, prioridad, estatus, tipo, caso, creada_en, atendida_en, resuelta_en) VALUES
((SELECT id FROM clientes WHERE telefono='5299990005'), 'Cliente molesto por retraso en envío', 2, 'resuelta', 'otro',       'CASO-DEMO-001', datetime('now','localtime','-33 days'), datetime('now','localtime','-33 days'), datetime('now','localtime','-32 days')),
((SELECT id FROM clientes WHERE telefono='5299990004'), 'Solicita estatus de su devolución',     1, 'atendida', 'devolucion', 'CASO-DEMO-002', datetime('now','localtime','-29 days'), datetime('now','localtime','-28 days'), NULL),
((SELECT id FROM clientes WHERE telefono='5299990009'), 'Quiere cancelar su pedido',              1, 'en_espera','otro',       'CASO-DEMO-003', datetime('now','localtime','-3 days'),  NULL, NULL),
((SELECT id FROM clientes WHERE telefono='5299990013'), 'Pregunta por tiempos de entrega',        3, 'en_espera','otro',       'CASO-DEMO-004', datetime('now','localtime','-1 days'),  NULL, NULL);

-- ── 9. CARRITOS_ABANDONADOS ─────────────────────────────────────────────
INSERT INTO carritos_abandonados (telefono, carrito_json, ultimo_paso, abandonado_en, notificado, notificado_en, convertido, motivo) VALUES
('5299990006', '[{"id":1,"name":"Demo Producto A","price":599,"cantidad":1}]', 'ASK_CP',   datetime('now','localtime','-26 days'), 1, datetime('now','localtime','-25 days'), 1, 'precio'),
('5299990007', '[{"id":2,"name":"Demo Producto B","price":850,"cantidad":1}]', 'DELIVERY', datetime('now','localtime','-15 days'), 1, datetime('now','localtime','-14 days'), 0, 'envio'),
('5299990010','[{"id":3,"name":"Demo Producto C","price":450,"cantidad":2}]', 'SHOW_CART', datetime('now','localtime','-8 days'),  1, datetime('now','localtime','-7 days'),  0, 'otro'),
('5299990012','[{"id":4,"name":"Demo Producto D","price":1100,"cantidad":1}]','ASK_CP',    datetime('now','localtime','-2 days'),  1, datetime('now','localtime','-1 days'),  0, NULL),
('5299990014','[{"id":5,"name":"Demo Producto E","price":599,"cantidad":1}]', 'SHOW_CART', datetime('now','localtime','-6 hours'), 0, NULL, 0, NULL);

-- ── 10. COLA_NOTIFICACIONES (envíos individuales + envíos masivos) ─────
INSERT INTO cola_notificaciones (tipo, destinatario, asunto, cuerpo, id_pedido, estatus, enviar_despues_de, campana, creada_en) VALUES
('whatsapp','5299990001','Actualización pedido','Tu pedido fue confirmado',(SELECT id_pedido FROM pedidos WHERE folio='DEMO-PED-0016'),'enviado',  NULL, NULL, datetime('now','localtime','-12 hours')),
('whatsapp','5299990010','Actualización pedido','Tu pedido va en camino',  (SELECT id_pedido FROM pedidos WHERE folio='DEMO-PED-0010'),'enviado',  NULL, NULL, datetime('now','localtime','-9 days')),
('whatsapp','5299990009','Actualización devolución','Tu devolución fue rechazada', NULL, 'error', NULL, NULL, datetime('now','localtime','-18 days')),
('whatsapp','5299990006','Carrito abandonado 24h','Vuelve y usa DEMO-VUELVE-01 🎁', NULL, 'enviado', NULL, 'carrito_abandonado_24h', datetime('now','localtime','-25 days')),
('whatsapp','5299990007','Carrito abandonado 24h','Vuelve y usa DEMO-VUELVE-02 🎁', NULL, 'pendiente', NULL, 'carrito_abandonado_24h', datetime('now','localtime','-14 days')),
('whatsapp','5299990002','Promocion masiva','¡Ofertas especiales para ti!', NULL, 'enviado',   NULL, 'promocion_masiva', datetime('now','localtime','-20 days')),
('whatsapp','5299990003','Promocion masiva','¡Ofertas especiales para ti!', NULL, 'enviado',   NULL, 'promocion_masiva', datetime('now','localtime','-20 days')),
('whatsapp','5299990008','Promocion masiva','¡Ofertas especiales para ti!', NULL, 'cancelado', NULL, 'promocion_masiva', datetime('now','localtime','-20 days')),
('whatsapp','5299990001','Cliente dormido','Te extrañamos, vuelve pronto',  NULL, 'pendiente', datetime('now','localtime','+1 days'), 'cliente_dormido', datetime('now','localtime','-1 days')),
('whatsapp','5299990011','Seguimiento de entrega','¿Cómo te fue con tu pedido?', (SELECT id_pedido FROM pedidos WHERE folio='DEMO-PED-0011'), 'pendiente', datetime('now','localtime','+1 days'), 'seguimiento_48h', datetime('now','localtime','-7 days'));

-- ── 11. PROMOCIONES (cupones demo) ──────────────────────────────────────
INSERT INTO promociones (codigo, descripcion, tipo, valor, id_producto, id_categoria, activa, fecha_inicio, fecha_fin, usos_max, usos_actual, creada_en) VALUES
('DEMO-VUELVE-01', 'Cupón carrito abandonado 24h (demo)', 'porcentaje', 5,  NULL, NULL, 1, date('now','localtime','-25 days'), date('now','localtime','+5 days'), 1, 1, datetime('now','localtime','-25 days')),
('DEMO-VUELVE-02', 'Cupón carrito abandonado 24h (demo)', 'porcentaje', 5,  NULL, NULL, 1, date('now','localtime','-14 days'), date('now','localtime','+16 days'), 1, 0, datetime('now','localtime','-14 days')),
('DEMO-LEAL-01',   'Cupón de lealtad por puntos (demo)',  'porcentaje', 10, NULL, NULL, 1, date('now','localtime','-10 days'), date('now','localtime','+80 days'), 1, 0, datetime('now','localtime','-10 days'));

-- ── 12. VALORACIONES (CSAT) ──────────────────────────────────────────────
INSERT INTO valoraciones (id_pedido, id_cliente, calificacion, canal, comentario, creada_en) VALUES
((SELECT id_pedido FROM pedidos WHERE folio='DEMO-PED-0001'), (SELECT id FROM clientes WHERE telefono='5299990001'), 5, 'whatsapp', 'Excelente servicio',           datetime('now','localtime','-51 days')),
((SELECT id_pedido FROM pedidos WHERE folio='DEMO-PED-0003'), (SELECT id FROM clientes WHERE telefono='5299990003'), 4, 'whatsapp', NULL,                            datetime('now','localtime','-39 days')),
((SELECT id_pedido FROM pedidos WHERE folio='DEMO-PED-0005'), (SELECT id FROM clientes WHERE telefono='5299990005'), 2, 'whatsapp', 'Llegó tarde',                   datetime('now','localtime','-30 days')),
((SELECT id_pedido FROM pedidos WHERE folio='DEMO-PED-0006'), (SELECT id FROM clientes WHERE telefono='5299990006'), 3, 'whatsapp', NULL,                            datetime('now','localtime','-25 days'));

-- ── 13. LISTA_ESPERA ──────────────────────────────────────────────────────
INSERT INTO lista_espera (id_producto, id_cliente, telefono, nombre_cliente, cantidad, precio_al_registrar, estatus, canal, notas, notificado_en, expira_notif_en) VALUES
((SELECT id FROM _demo_prod WHERE n=3), (SELECT id FROM clientes WHERE telefono='5299990008'), '5299990008', 'Miguel Flores',     1, 850.00, 'activa',     'whatsapp', 'Busqueda: demo producto agotado', NULL, NULL),
((SELECT id FROM _demo_prod WHERE n=4), (SELECT id FROM clientes WHERE telefono='5299990012'), '5299990012', 'Roberto Mendoza',   1, 450.00, 'notificado', 'whatsapp', 'Busqueda: demo otro agotado', datetime('now','localtime','-2 days'), datetime('now','localtime','+0 days')),
((SELECT id FROM _demo_prod WHERE n=1), (SELECT id FROM clientes WHERE telefono='5299990015'), '5299990015', 'Valeria Reyes',     2, 599.00, 'activa',     'whatsapp', 'Busqueda: demo tercero agotado', NULL, NULL);

-- ── 14. PREVENTAS + PREVENTA_CLIENTES ────────────────────────────────────
INSERT INTO preventas (id_producto, nombre_preventa, fecha_llegada_est, stock_maximo, stock_comprometido, precio_preventa, porcentaje_anticipo, activa)
VALUES ((SELECT id FROM _demo_prod WHERE n=2), 'Demo Preventa Especial', date('now','localtime','+20 days'), 50, 2, 699.00, 50, 1);

INSERT INTO preventa_clientes (id_preventa, id_cliente, telefono, nombre_cliente, cantidad, precio_total, anticipo_pagado, saldo_pendiente, folio, estatus)
SELECT (SELECT id FROM preventas WHERE nombre_preventa='Demo Preventa Especial'),
       (SELECT id FROM clientes WHERE telefono='5299990009'), '5299990009', 'Daniela Cruz', 1, 699.00, 349.50, 349.50, 'DEMO-PRV-0001', 'apartado'
UNION ALL
SELECT (SELECT id FROM preventas WHERE nombre_preventa='Demo Preventa Especial'),
       (SELECT id FROM clientes WHERE telefono='5299990014'), '5299990014', 'Fernando Castillo', 1, 699.00, 699.00, 0, 'DEMO-PRV-0002', 'pagado';

-- ── 15. LOG_EVENTOS (búsquedas, conversión, fallback, imagen) ──────────
INSERT INTO log_eventos (tipo_evento, canal, valor, telefono, resultados, compro, creado_en) VALUES
('busqueda',   'whatsapp', 'patines para niña',     '5299990001', 4, 1, datetime('now','localtime','-55 days')),
('busqueda',   'whatsapp', 'lego star wars',        '5299990002', 6, 1, datetime('now','localtime','-48 days')),
('busqueda',   'whatsapp', 'muñeca bebe llorona',   '5299990004', 0, 0, datetime('now','localtime','-39 days')),
('busqueda',   'whatsapp', 'carrito control remoto','5299990007', 3, 0, datetime('now','localtime','-27 days')),
('busqueda',   'whatsapp', 'pelota de futbol',      '5299990010', 5, 1, datetime('now','localtime','-9 days')),
('busqueda',   'whatsapp', 'rompecabezas 1000 piezas','5299990013', 2, 0, datetime('now','localtime','-4 days')),
('fallback',   'whatsapp', 'mensaje no entendido',  '5299990011', NULL, 0, datetime('now','localtime','-7 days')),
('imagen',     'whatsapp', 'foto de patines rosas', '5299990015', NULL, 1, datetime('now','localtime','-1 days'));

-- ── 16. TICKETS_VENTA + REGALOS_LEALTAD (puntos) ───────────────────────
INSERT INTO tickets_venta (codigo_qr, telefono_cliente, puntos_otorgados, puntos_reclamados, total, expira_reclamo_en, reclamado_en) VALUES
('TK-DEMO0001', '5299990003', 850,  1, 850.00,  datetime('now','localtime','-43 days','+2 hours'), datetime('now','localtime','-43 days','+1 hours')),
('TK-DEMO0002', '5299990006', 599,  1, 599.00,  datetime('now','localtime','-29 days','+2 hours'), datetime('now','localtime','-29 days','+1 hours')),
('TK-DEMO0003', '5299990012','1100', 0, 1100.00,datetime('now','localtime','-6 days','+2 hours'),  NULL);

INSERT INTO regalos_lealtad (id_cliente, telefono, codigo_cupon, valor, puntos_usados, expira_en, estatus) VALUES
((SELECT id FROM clientes WHERE telefono='5299990003'), '5299990003', 'DEMO-LEAL-01', 10, 2000, datetime('now','localtime','+80 days'), 'activo');

-- ═══════════════════════════════════════════════════════════════════════
-- Listo. Revisa el dashboard (Pedidos, Devoluciones, Cola de atención,
-- Carritos, Envíos, Notificaciones, Puntos, Preventas, Lista de Espera,
-- Métricas, Búsquedas) — todo debería poblarse con estos datos demo.
-- Cuando termines de probar, corre cleanup_metricas_demo.sql.
-- ═══════════════════════════════════════════════════════════════════════
