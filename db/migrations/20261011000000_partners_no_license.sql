-- Partners (resellers) hebben zelf geen abonnement of licentie: alleen hun klanten.
-- Een plan of licentieperiode op een partnerbedrijf had geen functie, maar kon wel
-- blokkeren (een verlopen licentie hield het aanmaken van Partner Admins tegen).
--
-- - Ruimt eventuele oude plan-/licentievelden op partnerbedrijven op.
-- - Dwingt het daarna af in de database, naast de controle in de API.
--
-- Idempotent.

UPDATE dbo.companies
SET plan_id = NULL, license_start = NULL, license_end = NULL, updated_at = now()
WHERE kind = 'partner'
  AND (plan_id IS NOT NULL OR license_start IS NOT NULL OR license_end IS NOT NULL);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_companies_partner_no_license') THEN
    ALTER TABLE dbo.companies
      ADD CONSTRAINT chk_companies_partner_no_license
      CHECK (kind = 'customer' OR (plan_id IS NULL AND license_start IS NULL AND license_end IS NULL));
  END IF;
END $$;
