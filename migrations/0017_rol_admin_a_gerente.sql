-- 0017_rol_admin_a_gerente.sql
-- Bloque 2B: consolidación de roles a 3 (prime > gerente > usuario). El rol
-- histórico 'admin' era el "manager operativo" → se renombra a 'gerente'.
-- (server.js ya mapea admin→rango de gerente por si quedara alguno sin migrar.)
UPDATE usuarios SET rol='gerente' WHERE rol='admin';
