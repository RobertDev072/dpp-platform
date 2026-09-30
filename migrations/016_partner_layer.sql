-- Partner/Reseller-laag: een Partner is een bedrijfssoort (kind='partner') zonder
-- productmodules; klantbedrijven verwijzen via partner_id naar hun reseller.
-- Limieten/verbruik blijven strikt per klant-tenant (partner_id is alleen een
-- relatiespoor, nooit een aggregatieniveau).

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.Companies') AND name = 'kind'
)
BEGIN
  EXEC(N'ALTER TABLE dbo.Companies ADD kind NVARCHAR(20) NOT NULL
    CONSTRAINT DF_Companies_Kind DEFAULT ''customer'';');
  EXEC(N'ALTER TABLE dbo.Companies ADD CONSTRAINT CHK_Companies_Kind
    CHECK (kind IN (''customer'', ''partner''));');
END

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.Companies') AND name = 'partner_id'
)
BEGIN
  EXEC(N'ALTER TABLE dbo.Companies ADD partner_id INT NULL
    CONSTRAINT FK_Companies_Partner REFERENCES dbo.Companies(id);');
  -- Alleen klantbedrijven kunnen een partner hebben.
  EXEC(N'ALTER TABLE dbo.Companies ADD CONSTRAINT CHK_Companies_PartnerOnCustomer
    CHECK (partner_id IS NULL OR kind = ''customer'');');
END

-- Rol partner_admin toevoegen (zelfde drop/create-patroon als migratie 007).
IF EXISTS (
  SELECT 1 FROM sys.check_constraints
  WHERE name = 'CHK_Users_Role' AND parent_object_id = OBJECT_ID('dbo.Users')
)
BEGIN
  ALTER TABLE dbo.Users DROP CONSTRAINT CHK_Users_Role;
END

EXEC(N'ALTER TABLE dbo.Users ADD CONSTRAINT CHK_Users_Role
  CHECK (role IN (''platform_owner'', ''partner_admin'', ''company_admin'', ''company_user''));');

-- De owner bepaalt per plan of partners het aan klanten mogen toewijzen.
IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.Plans') AND name = 'partner_assignable'
)
BEGIN
  EXEC(N'ALTER TABLE dbo.Plans ADD partner_assignable BIT NOT NULL
    CONSTRAINT DF_Plans_PartnerAssignable DEFAULT 1;');
END

-- Data-omzetting (besluit Robert): Certification B.v wordt Partner; zijn
-- gebruikers worden partner_admin. Via EXEC, want de kolom 'kind' bestaat pas
-- runtime (dezelfde batch zou anders al bij het compileren struikelen).
EXEC(N'UPDATE dbo.Companies SET kind = ''partner'' WHERE name = ''Certification B.v'';');
EXEC(N'UPDATE u SET u.role = ''partner_admin''
FROM dbo.Users u
JOIN dbo.Companies c ON c.id = u.company_id
WHERE c.kind = ''partner'' AND u.role IN (''company_admin'', ''company_user'');');
