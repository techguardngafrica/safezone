-- Bootstrap: schemas and the application role (ADR-0001).
-- Runs as the schema owner. safezone_app is created without LOGIN and without a password;
-- each environment enables login out of band (vault/Terraform; locally `pnpm db:app-role`).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'safezone_app') THEN
    CREATE ROLE safezone_app NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
END
$$;

-- Guard against a role that was created elsewhere with dangerous attributes.
ALTER ROLE safezone_app NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;

CREATE SCHEMA IF NOT EXISTS "platform";
CREATE SCHEMA IF NOT EXISTS "tenant";
CREATE SCHEMA IF NOT EXISTS "audit";

-- Nobody gets objects in these schemas implicitly; every table grants explicitly.
REVOKE ALL ON SCHEMA "platform", "tenant", "audit" FROM PUBLIC;
GRANT USAGE ON SCHEMA "platform", "tenant", "audit" TO safezone_app;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
