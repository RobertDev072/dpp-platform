-- Rolmodel-herziening (zie plan "Platform Owner-rolmodel"):
-- 1. system_owner wordt platform_owner - er is er precies één (Robert, het geseede
--    break-glass-account). Singulariteit wordt fysiek afgedwongen met een gefilterde
--    unique index op de rolkolom zelf: een tweede platform_owner-rij is onmogelijk.
-- 2. De rol viewer vervalt: publieke QR-bezoekers hebben geen account; bestaande
--    viewer-rijen worden company_user.
-- 3. Gebruikersstatussen worden active/blocked/suspended/archived (soft delete);
--    bestaande inactive-rijen worden blocked. Companies krijgt 'blocked' erbij.
--
-- Volgorde is belangrijk: eerst de data omzetten, dan pas de strakkere CHECK's.
-- De code die vóór deze migratie live staat accepteert beide rolnamen (overgangslaag
-- in src/utils/roles.js), dus de login breekt op geen enkel moment.

-- 1a. Data: rol-hernoeming en viewer-omzetting.
UPDATE dbo.Users SET role = 'platform_owner' WHERE role = 'system_owner';
UPDATE dbo.Users SET role = 'company_user' WHERE role = 'viewer';

-- 1b. Statussen: inactive -> blocked.
UPDATE dbo.Users SET status = 'blocked' WHERE status = 'inactive';

-- 2. CHECK-constraints vervangen (drop + create, idempotent).
IF EXISTS (
  SELECT 1 FROM sys.check_constraints
  WHERE name = 'CHK_Users_Role' AND parent_object_id = OBJECT_ID('dbo.Users')
)
BEGIN
  ALTER TABLE dbo.Users DROP CONSTRAINT CHK_Users_Role;
END

EXEC(N'ALTER TABLE dbo.Users ADD CONSTRAINT CHK_Users_Role
  CHECK (role IN (''platform_owner'', ''company_admin'', ''company_user''));');

IF EXISTS (
  SELECT 1 FROM sys.check_constraints
  WHERE name = 'CHK_Users_Status' AND parent_object_id = OBJECT_ID('dbo.Users')
)
BEGIN
  ALTER TABLE dbo.Users DROP CONSTRAINT CHK_Users_Status;
END

EXEC(N'ALTER TABLE dbo.Users ADD CONSTRAINT CHK_Users_Status
  CHECK (status IN (''active'', ''blocked'', ''suspended'', ''archived''));');

IF EXISTS (
  SELECT 1 FROM sys.check_constraints
  WHERE name = 'CHK_Companies_Status' AND parent_object_id = OBJECT_ID('dbo.Companies')
)
BEGIN
  ALTER TABLE dbo.Companies DROP CONSTRAINT CHK_Companies_Status;
END

EXEC(N'ALTER TABLE dbo.Companies ADD CONSTRAINT CHK_Companies_Status
  CHECK (status IN (''active'', ''blocked'', ''suspended'', ''archived''));');

-- 3. Precies één Platform Owner, door de database zelf afgedwongen.
IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID('dbo.Users') AND name = 'UQ_Users_PlatformOwner'
)
BEGIN
  CREATE UNIQUE INDEX UQ_Users_PlatformOwner
    ON dbo.Users(role)
    WHERE role = 'platform_owner';
END
