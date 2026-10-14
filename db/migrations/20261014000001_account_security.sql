-- Accountbeveiliging (additief, idempotent).
--
-- 1. Tijdelijk wachtwoord is maximaal 24 uur geldig. Na die tijd weigert de login het,
--    ook als het wachtwoord klopt; de beheerder geeft dan een nieuw tijdelijk wachtwoord.
ALTER TABLE dbo.users ADD COLUMN IF NOT EXISTS temp_password_expires_at timestamptz NULL;

-- 2. Activatielinks (uitnodigingen) voor de eerste beheerder van een bedrijf: ook voor
--    de eerste Partner Admin van een partner. Rol staat vast in de uitnodiging.
ALTER TABLE dbo.companyadmininvites ADD COLUMN IF NOT EXISTS role varchar(30) NOT NULL DEFAULT 'company_admin';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_companyadmininvites_role') THEN
    ALTER TABLE dbo.companyadmininvites
      ADD CONSTRAINT chk_companyadmininvites_role CHECK (role IN ('company_admin', 'partner_admin'));
  END IF;
END $$;

-- Hooguit één openstaande uitnodiging per bedrijf en e-mailadres: een nieuwe link maakt
-- de vorige ongeldig (zie invites.repository.js createInvite). Bestaande dubbele
-- openstaande uitnodigingen eerst intrekken (alleen de nieuwste blijft).
UPDATE dbo.companyadmininvites i SET status = 'revoked'
WHERE i.status = 'pending' AND EXISTS (
  SELECT 1 FROM dbo.companyadmininvites newer
  WHERE newer.company_id = i.company_id AND lower(newer.email) = lower(i.email)
    AND newer.status = 'pending' AND newer.id > i.id
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_companyadmininvites_pending_email
  ON dbo.companyadmininvites (company_id, lower(email)) WHERE status = 'pending';
