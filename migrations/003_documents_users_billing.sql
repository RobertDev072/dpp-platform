-- 003: documentbeheer, gebruikersactiviteit en abonnementsgegevens.
-- Alleen toevoegingen (nieuwe, nullable kolommen en indexen); bestaande data en
-- QR-URL's blijven ongewijzigd. Idempotent.

-- Documenten: versie, vervaldatum, uploader en archiveren (soft).
ALTER TABLE documents ADD COLUMN IF NOT EXISTS version VARCHAR(30) NULL;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS valid_until DATE NULL;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS uploaded_by INT NULL REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ NULL;
CREATE INDEX IF NOT EXISTS ix_documents_company_created ON documents(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_documents_valid_until ON documents(company_id, valid_until) WHERE valid_until IS NOT NULL AND archived_at IS NULL;

-- Uploader afleiden uit de auditlog voor bestaande documenten (best effort).
UPDATE documents d SET uploaded_by = a.user_id
FROM audit_logs a
WHERE d.uploaded_by IS NULL
  AND a.entity_type = 'Document' AND a.action = 'create'
  AND a.entity_id = d.id::text
  AND EXISTS (SELECT 1 FROM users u WHERE u.id = a.user_id);

-- Gebruikers: laatste login (voor gebruikersbeheer); gevuld bij elke login.
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ NULL;
UPDATE users u SET last_login_at = x.last_login
FROM (SELECT user_id, MAX(timestamp) AS last_login FROM audit_logs WHERE action = 'login' AND user_id IS NOT NULL GROUP BY user_id) x
WHERE u.id = x.user_id AND u.last_login_at IS NULL;

-- Sessies: zichtbaar maken wanneer en waarvandaan (grof) ingelogd is.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS user_agent VARCHAR(300) NULL;
CREATE INDEX IF NOT EXISTS ix_sessions_expires ON sessions(expires_at);

-- Plannen: prijs en extra limieten (weergave/waarschuwing; NULL = onbeperkt/onbekend).
ALTER TABLE plans ADD COLUMN IF NOT EXISTS price_monthly_cents INT NULL;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS max_storage_mb INT NULL;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS max_scans_month INT NULL;

-- Bedrijven: contactpersoon/facturatiegegevens voor Customer 360.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS contact_name VARCHAR(200) NULL;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS contact_email CITEXT NULL;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS contact_phone VARCHAR(50) NULL;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS billing_email CITEXT NULL;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS billing_reference VARCHAR(100) NULL;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS vat_number VARCHAR(30) NULL;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS notes TEXT NULL;

CREATE INDEX IF NOT EXISTS ix_scan_events_product_time ON scan_events(product_id, scanned_at DESC);
