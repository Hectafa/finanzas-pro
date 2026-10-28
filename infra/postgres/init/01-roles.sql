-- Se ejecuta una sola vez, al crear el volumen de datos.
-- finanzas_owner: dueño del esquema, ejecuta migraciones. No lo usa la API en tiempo de ejecución.
-- finanzas_app:   rol de la API. No es dueño de tablas, por lo que la seguridad por fila (RLS) le aplica.
CREATE ROLE finanzas_app LOGIN PASSWORD 'finanzas_app_dev' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;

CREATE DATABASE finanzas_test OWNER finanzas_owner;

GRANT CONNECT ON DATABASE finanzas_dev TO finanzas_app;
GRANT CONNECT ON DATABASE finanzas_test TO finanzas_app;
