-- Rolmodel-herziening (zie plan "Platform Owner-rolmodel"):
-- 1. system_owner wordt platform_owner - er is er precies één (Robert, het geseede
--    break-glass-account). Singulariteit wordt op applicatieniveau afgedwongen: geen
--    enkel API-pad accepteert de rol platform_owner bij aanmaken of wijzigen (zie
--    users.schema.js), en het seed-script werkt alleen zijn eigen account bij. Bewust
--    geen DB-unique-index: de testsuite draait tegen dezelfde database en maakt
--    tijdelijke owner-testgebruikers aan die zo'n index zou blokkeren.
-- 2. De rol viewer vervalt: publieke QR-bezoekers hebben geen account; bestaande
--    viewer-rijen worden company_user.
-- 3. Gebruikersstatussen worden active/blocked/suspended/archived (soft delete);
--    bestaande inactive-rijen worden blocked. Companies krijgt 'blocked' erbij.
--
-- Volgorde is belangrijk: eerst de OUDE CHECK's droppen (die verbieden de nieuwe
-- waarden nog), dan de data omzetten, dan de nieuwe CHECK's aanbrengen. De code die
-- vóór deze migratie live staat accepteert beide rolnamen (overgangslaag in
-- src/utils/roles.js), dus de login breekt op geen enkel moment.

-- 1. Oude CHECK-constraints weg (idempotent).
IF EXISTS (
  SELECT 1 FROM sys.check_constraints
  WHERE name = 'CHK_Users_Role' AND parent_object_id = OBJECT_ID('dbo.Users')
)
BEGIN
  ALTER TABLE dbo.Users DROP CONSTRAINT CHK_Users_Role;
END

IF EXISTS (
  SELECT 1 FROM sys.check_constraints
  WHERE name = 'CHK_Users_Status' AND parent_object_id = OBJECT_ID('dbo.Users')
)
BEGIN
  ALTER TABLE dbo.Users DROP CONSTRAINT CHK_Users_Status;
END

IF EXISTS (
  SELECT 1 FROM sys.check_constraints
  WHERE name = 'CHK_Companies_Status' AND parent_object_id = OBJECT_ID('dbo.Companies')
)
BEGIN
  ALTER TABLE dbo.Companies DROP CONSTRAINT CHK_Companies_Status;
END

-- 2a. Data: rol-hernoeming en viewer-omzetting.
UPDATE dbo.Users SET role = 'platform_owner' WHERE role = 'system_owner';
UPDATE dbo.Users SET role = 'company_user' WHERE role = 'viewer';

-- 2b. Statussen: inactive -> blocked.
UPDATE dbo.Users SET status = 'blocked' WHERE status = 'inactive';

-- 3. Nieuwe CHECK-constraints.
EXEC(N'ALTER TABLE dbo.Users ADD CONSTRAINT CHK_Users_Role
  CHECK (role IN (''platform_owner'', ''company_admin'', ''company_user''));');

EXEC(N'ALTER TABLE dbo.Users ADD CONSTRAINT CHK_Users_Status
  CHECK (status IN (''active'', ''blocked'', ''suspended'', ''archived''));');

EXEC(N'ALTER TABLE dbo.Companies ADD CONSTRAINT CHK_Companies_Status
  CHECK (status IN (''active'', ''blocked'', ''suspended'', ''archived''));');
