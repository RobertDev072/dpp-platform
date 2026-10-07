-- Bulkimport (Import Center) en print-/labelprofielen per bedrijf. Additief:
-- bestaande tabellen en data blijven ongewijzigd. Idempotent.

CREATE TABLE IF NOT EXISTS import_jobs (
  id SERIAL PRIMARY KEY,
  company_id INT NOT NULL REFERENCES companies(id),
  created_by INT NULL REFERENCES users(id),
  file_name VARCHAR(255) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'running',
  -- Wat te doen met een rij die een bestaand product (zelfde SKU of GTIN) raakt.
  duplicate_mode VARCHAR(10) NOT NULL DEFAULT 'skip',
  total_rows INT NOT NULL DEFAULT 0,
  processed_rows INT NOT NULL DEFAULT 0,
  created_count INT NOT NULL DEFAULT 0,
  updated_count INT NOT NULL DEFAULT 0,
  skipped_count INT NOT NULL DEFAULT 0,
  error_count INT NOT NULL DEFAULT 0,
  -- JSON: kolom → veld (alleen ter naslag in het Import Center).
  mapping TEXT NULL,
  -- JSON-array van { row, product, field, error, suggestion } (max. 2000 regels).
  errors TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ NULL,
  CONSTRAINT chk_import_jobs_status CHECK (status IN ('running', 'completed', 'completed_with_errors', 'failed', 'cancelled')),
  CONSTRAINT chk_import_jobs_duplicate_mode CHECK (duplicate_mode IN ('skip', 'update', 'create'))
);
CREATE INDEX IF NOT EXISTS ix_import_jobs_company_created ON import_jobs(company_id, created_at DESC);

CREATE TABLE IF NOT EXISTS print_profiles (
  id SERIAL PRIMARY KEY,
  company_id INT NOT NULL REFERENCES companies(id),
  name VARCHAR(100) NOT NULL,
  purpose VARCHAR(200) NULL,
  -- Volledige profielinstellingen (papier, raster, marges, media, printer, QR,
  -- template-elementen) als JSON: het formaat kan groeien zonder schemawijziging.
  -- Validatie gebeurt in de API (src/schemas/printProfiles.schema.js).
  settings TEXT NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_by INT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_print_profiles_company ON print_profiles(company_id);

-- Duplicaatdetectie bij import (zelfde bedrijf, SKU/GTIN hoofdletterongevoelig).
CREATE INDEX IF NOT EXISTS ix_products_company_sku ON products(company_id, lower(sku)) WHERE sku IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_products_company_gtin ON products(company_id, gtin) WHERE gtin IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_products_company_updated ON products(company_id, updated_at DESC);

ALTER TABLE import_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE print_profiles ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON import_jobs, print_profiles FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON import_jobs, print_profiles FROM authenticated';
  END IF;
END
$$;
