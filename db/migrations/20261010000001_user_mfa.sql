-- Optionele tweestapsverificatie (TOTP, RFC 6238) voor alle accounts; sterk
-- aanbevolen voor Platform Owner, Partner Admins en Bedrijfsbeheerders. Vervangt de
-- MFA die met het uitfaseren van Microsoft Entra is vervallen.
--
-- - mfa_secret_enc / mfa_pending_secret_enc: het TOTP-geheim, AES-256-GCM-versleuteld
--   door de applicatie (sleutel MFA_ENCRYPTION_KEY uit Secrets Manager). Nooit in
--   platte tekst in de database.
-- - mfa_recovery_hashes: JSON-array met SHA-256-hashes van eenmalige herstelcodes.
-- - mfa_last_step: laatst gebruikte TOTP-tijdstap (een code is maar één keer geldig).
--
-- Puur additief en idempotent; bestaande accounts houden hun gedrag (MFA uit).

ALTER TABLE dbo.users ADD COLUMN IF NOT EXISTS mfa_secret_enc text NULL;
ALTER TABLE dbo.users ADD COLUMN IF NOT EXISTS mfa_pending_secret_enc text NULL;
ALTER TABLE dbo.users ADD COLUMN IF NOT EXISTS mfa_enabled_at timestamptz NULL;
ALTER TABLE dbo.users ADD COLUMN IF NOT EXISTS mfa_recovery_hashes text NULL;
ALTER TABLE dbo.users ADD COLUMN IF NOT EXISTS mfa_last_step bigint NULL;
