-- VeriPasso op Supabase Postgres: volledig schema (eindstand van de Azure SQL-
-- migraties 001-017, in één keer). Idempotent (IF NOT EXISTS), dus veilig om
-- opnieuw te draaien.
--
-- Naamgeving: snake_case tabellen (Postgres vouwt ongequote namen naar kleine
-- letters). Mapping vanaf Azure SQL staat in docs/migratie-azure-naar-vercel-supabase.md.
--
-- Verschillen met SQL Server die bewust zijn opgevangen:
-- - E-mail en slug zijn CITEXT: SQL Server vergeleek hoofdletterongevoelig (standaard-
--   collatie), Postgres niet. Zonder citext zou "Jan@X.nl" vs "jan@x.nl" ineens twee
--   accounts/een mislukte login opleveren.
-- - Gefilterde unieke indexen (WHERE ... IS NOT NULL) waren in SQL Server nodig omdat
--   UNIQUE maar één NULL toestond; Postgres staat meerdere NULLs toe, dus een gewone
--   UNIQUE volstaat.
-- - Users.entra_object_id/entra_subject_id zijn vervangen door auth_user_id: de id van
--   het account in Supabase Auth (de "sub" in Supabase-tokens is dezelfde uuid, dus
--   een aparte subject-kolom en just-in-time-koppeling zijn niet meer nodig).
-- - Supabase stelt het public-schema via de REST-API (PostgREST) bloot aan de
--   anon/authenticated-rollen. VeriPasso gebruikt die API niet: alle toegang loopt via
--   onze eigen server (rol postgres). Daarom staat RLS aan op elke tabel zónder
--   policies en zijn de rechten van anon/authenticated ingetrokken (onderaan).

CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE IF NOT EXISTS plans (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  max_users INT NOT NULL DEFAULT 1,
  max_products INT NOT NULL DEFAULT 10,
  feature_flags TEXT NULL,
  partner_assignable BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS companies (
  id SERIAL PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  slug CITEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  plan_id INT NULL REFERENCES plans(id),
  logo TEXT NULL,
  kind VARCHAR(20) NOT NULL DEFAULT 'customer',
  partner_id INT NULL REFERENCES companies(id),
  license_start DATE NULL,
  license_end DATE NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_companies_slug UNIQUE (slug),
  CONSTRAINT chk_companies_status CHECK (status IN ('active', 'blocked', 'suspended', 'archived')),
  CONSTRAINT chk_companies_kind CHECK (kind IN ('customer', 'partner')),
  CONSTRAINT chk_companies_partner_on_customer CHECK (partner_id IS NULL OR kind = 'customer')
);

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  company_id INT NULL REFERENCES companies(id),
  email CITEXT NOT NULL,
  -- Alleen voor lokale (bcrypt) accounts: het Platform Owner break-glass-account en
  -- lokale ontwikkeling zonder Supabase Auth.
  password_hash VARCHAR(255) NULL,
  -- Account in Supabase Auth (auth.users.id). Bewust géén FK naar auth.users: de app
  -- moet ook tegen een kale Postgres (lokaal/tests) kunnen draaien.
  auth_user_id UUID NULL,
  first_name VARCHAR(100) NULL,
  last_name VARCHAR(100) NULL,
  role VARCHAR(30) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_users_email UNIQUE (email),
  CONSTRAINT uq_users_auth_user_id UNIQUE (auth_user_id),
  CONSTRAINT chk_users_role CHECK (role IN ('platform_owner', 'partner_admin', 'company_admin', 'company_user')),
  CONSTRAINT chk_users_status CHECK (status IN ('active', 'blocked', 'suspended', 'archived', 'deleted')),
  CONSTRAINT chk_users_has_auth_method CHECK (password_hash IS NOT NULL OR auth_user_id IS NOT NULL OR status = 'deleted')
);
CREATE INDEX IF NOT EXISTS ix_users_company_id ON users(company_id);

CREATE TABLE IF NOT EXISTS products (
  id SERIAL PRIMARY KEY,
  company_id INT NOT NULL REFERENCES companies(id),
  name VARCHAR(200) NOT NULL,
  brand VARCHAR(150) NULL,
  model VARCHAR(150) NULL,
  sku VARCHAR(100) NULL,
  gtin VARCHAR(50) NULL,
  category_id INT NULL,
  category_label VARCHAR(100) NULL,
  description TEXT NULL,
  manufacturer VARCHAR(200) NULL,
  country_of_origin VARCHAR(100) NULL,
  photo_url VARCHAR(1000) NULL,
  -- Objectpad in de privé Storage-bucket product-images (geen URL, geen secret).
  photo_blob_name VARCHAR(255) NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'draft',
  -- JSON-array van korte strings ("In het kort" op het publieke paspoort).
  highlights TEXT NULL,
  -- Staat in elke geprinte QR-code ({QR_BASE_URL}/p/{public_id}): NOOIT wijzigen.
  public_id UUID NULL,
  published_at TIMESTAMPTZ NULL,
  created_by INT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_products_public_id UNIQUE (public_id),
  CONSTRAINT chk_products_status CHECK (status IN ('draft', 'published', 'archived'))
);
CREATE INDEX IF NOT EXISTS ix_products_company_id ON products(company_id);

CREATE TABLE IF NOT EXISTS documents (
  id SERIAL PRIMARY KEY,
  company_id INT NOT NULL REFERENCES companies(id),
  product_id INT NOT NULL REFERENCES products(id),
  type VARCHAR(50) NOT NULL,
  title VARCHAR(200) NOT NULL,
  language VARCHAR(10) NULL,
  storage_url VARCHAR(1000) NULL,
  -- Objectpad in de privé Storage-bucket product-documents.
  blob_name VARCHAR(300) NULL,
  file_size INT NULL,
  mime_type VARCHAR(100) NULL,
  is_public BOOLEAN NOT NULL DEFAULT FALSE,
  category VARCHAR(30) NOT NULL DEFAULT 'document',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_documents_category CHECK (category IN ('document', 'manual', 'video', '3d_model')),
  CONSTRAINT chk_documents_has_source CHECK (storage_url IS NOT NULL OR blob_name IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS ix_documents_product_id ON documents(product_id);
CREATE INDEX IF NOT EXISTS ix_documents_company_id ON documents(company_id);

CREATE TABLE IF NOT EXISTS scan_events (
  id BIGSERIAL PRIMARY KEY,
  product_id INT NOT NULL REFERENCES products(id),
  scanned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_agent VARCHAR(500) NULL,
  referrer VARCHAR(1000) NULL
);
CREATE INDEX IF NOT EXISTS ix_scan_events_product_id ON scan_events(product_id);
CREATE INDEX IF NOT EXISTS ix_scan_events_scanned_at ON scan_events(scanned_at);

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGSERIAL PRIMARY KEY,
  company_id INT NULL REFERENCES companies(id),
  user_id INT NULL REFERENCES users(id),
  impersonator_user_id INT NULL,
  action VARCHAR(100) NOT NULL,
  entity_type VARCHAR(50) NOT NULL,
  entity_id VARCHAR(50) NULL,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata TEXT NULL
);
CREATE INDEX IF NOT EXISTS ix_audit_logs_company_timestamp ON audit_logs(company_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS ix_audit_logs_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS ix_audit_logs_user_id ON audit_logs(user_id);

CREATE TABLE IF NOT EXISTS sessions (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id),
  token_hash CHAR(64) NOT NULL,
  impersonator_user_id INT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT uq_sessions_token_hash UNIQUE (token_hash)
);
CREATE INDEX IF NOT EXISTS ix_sessions_user_id ON sessions(user_id);

CREATE TABLE IF NOT EXISTS company_admin_invites (
  id SERIAL PRIMARY KEY,
  company_id INT NOT NULL REFERENCES companies(id),
  email CITEXT NOT NULL,
  first_name VARCHAR(100) NULL,
  last_name VARCHAR(100) NULL,
  token_hash CHAR(64) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  invited_by INT NOT NULL REFERENCES users(id),
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_company_admin_invites_token_hash UNIQUE (token_hash),
  CONSTRAINT chk_company_admin_invites_status CHECK (status IN ('pending', 'accepted', 'revoked', 'expired'))
);
CREATE INDEX IF NOT EXISTS ix_company_admin_invites_company_id ON company_admin_invites(company_id);

CREATE TABLE IF NOT EXISTS product_parts (
  id SERIAL PRIMARY KEY,
  product_id INT NOT NULL REFERENCES products(id),
  company_id INT NOT NULL REFERENCES companies(id),
  part_number VARCHAR(100) NOT NULL,
  name VARCHAR(200) NOT NULL,
  description TEXT NULL,
  image_url VARCHAR(1000) NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_product_parts_product_id ON product_parts(product_id);

CREATE TABLE IF NOT EXISTS product_sustainability (
  product_id INT PRIMARY KEY REFERENCES products(id),
  co2_footprint_kg NUMERIC(10, 2) NULL,
  co2_reduction_pct NUMERIC(5, 2) NULL,
  recycled_material_pct NUMERIC(5, 2) NULL,
  materials TEXT NULL, -- JSON-array van { material, pct }
  epd_url VARCHAR(1000) NULL,
  recyclable BOOLEAN NULL,
  reach_conform BOOLEAN NULL,
  rohs_conform BOOLEAN NULL,
  expected_lifespan_years INT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS product_compliance (
  product_id INT PRIMARY KEY REFERENCES products(id),
  ce_marked BOOLEAN NULL,
  applicable_regulations TEXT NULL, -- JSON-array van strings
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS product_batches (
  id SERIAL PRIMARY KEY,
  product_id INT NOT NULL REFERENCES products(id),
  company_id INT NOT NULL REFERENCES companies(id),
  batch_number VARCHAR(100) NOT NULL,
  production_date DATE NULL,
  quantity INT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_product_batches_product_id ON product_batches(product_id);

-- Monitoring (zie src/monitoring): dagelijkse snapshots en uurlijkse request-metrics.
CREATE TABLE IF NOT EXISTS system_metrics_snapshots (
  id SERIAL PRIMARY KEY,
  taken_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  database_size_bytes BIGINT NULL,
  database_max_bytes BIGINT NULL,
  blob_storage_bytes BIGINT NULL,
  blob_count INT NULL,
  partner_count INT NOT NULL DEFAULT 0,
  company_count INT NOT NULL DEFAULT 0,
  user_count INT NOT NULL DEFAULT 0,
  active_user_count INT NOT NULL DEFAULT 0,
  product_count INT NOT NULL DEFAULT 0,
  document_count INT NOT NULL DEFAULT 0,
  audit_log_count INT NOT NULL DEFAULT 0,
  scan_event_count INT NOT NULL DEFAULT 0,
  invite_count INT NOT NULL DEFAULT 0,
  table_stats TEXT NULL, -- JSON: per tabel rijen/bytes
  blob_stats TEXT NULL   -- JSON: per bucket bestanden/bytes
);
CREATE INDEX IF NOT EXISTS ix_system_metrics_snapshots_taken_at ON system_metrics_snapshots(taken_at);

-- Eén rij per (uur, scope, route, methode). Op Vercel draaien meerdere function-
-- instances tegelijk; elke instance telt zijn eigen requests op bij deze rij
-- (upsert), vandaar de unieke sleutel.
CREATE TABLE IF NOT EXISTS system_request_metrics_hourly (
  id SERIAL PRIMARY KEY,
  bucket_start TIMESTAMPTZ NOT NULL,
  scope VARCHAR(20) NOT NULL,   -- 'api' | 'public' | 'page'
  route VARCHAR(200) NOT NULL,  -- patroon, nooit een concrete URL met id's
  method VARCHAR(10) NOT NULL,
  request_count INT NOT NULL,
  error_4xx_count INT NOT NULL DEFAULT 0,
  error_5xx_count INT NOT NULL DEFAULT 0,
  duration_sum_ms BIGINT NOT NULL DEFAULT 0,
  duration_max_ms INT NOT NULL DEFAULT 0,
  p50_ms INT NULL,
  p95_ms INT NULL,
  p99_ms INT NULL,
  CONSTRAINT uq_system_request_metrics_hourly_key UNIQUE (bucket_start, scope, route, method)
);
CREATE INDEX IF NOT EXISTS ix_system_request_metrics_hourly_bucket ON system_request_metrics_hourly(bucket_start);

-- Rate limiting (brute-force-bescherming op login/reset). Op Vercel draaien meerdere
-- kortlevende function-instances; tellers in het geheugen zouden per instance gelden
-- en bij elke koude start verdwijnen. De sleutel is een hash (geen e-mailadres/IP
-- in leesbare vorm).
CREATE TABLE IF NOT EXISTS rate_limits (
  key CHAR(64) PRIMARY KEY,
  hits INT NOT NULL,
  reset_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_rate_limits_reset_at ON rate_limits(reset_at);

-- Supabase: niets van dit schema via de publieke REST-API (PostgREST) bereikbaar.
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'plans', 'companies', 'users', 'products', 'documents', 'scan_events', 'audit_logs',
    'sessions', 'company_admin_invites', 'product_parts', 'product_sustainability',
    'product_compliance', 'product_batches', 'system_metrics_snapshots',
    'system_request_metrics_hourly', 'rate_limits', 'schema_migrations'
  ]
  LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    END IF;
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon';
    EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated';
    EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM authenticated';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM authenticated';
  END IF;
END
$$;
