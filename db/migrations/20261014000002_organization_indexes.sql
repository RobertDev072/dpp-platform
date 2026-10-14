-- Organisaties & gebruikers (admin): snel de klantbedrijven van een partner en de laatste
-- activiteit per gebruiker vinden, ook bij honderden klanten per partner. Additief.
CREATE INDEX IF NOT EXISTS ix_companies_partner_id ON dbo.companies (partner_id) WHERE partner_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_companies_kind_name ON dbo.companies (kind, lower(name));
CREATE INDEX IF NOT EXISTS ix_auditlogs_user_timestamp ON dbo.auditlogs (user_id, timestamp DESC);
