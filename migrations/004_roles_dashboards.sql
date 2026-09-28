-- Fase 3: rollen, dashboards en pagina-architectuur.
--   * Extra rollen (product_manager, compliance_manager) en gebruikersstatus 'blocked'
--   * Bedrijfsgegevens (KvK, land, adres, contact) + seat-limit override per bedrijf
--   * Productstatus 'review', DPP-velden, created_by/updated_by
--   * Company Admin-uitnodigingen (token alleen als SHA-256-hash, expiry, one-time-use)
--   * ScanEvents: bron + grove locatie (landcode), nooit IP-adressen
--
-- Idempotent en, net als 003, elke DDL-stap in EXEC(N'...') zodat SQL Server kolommen
-- die in dezelfde batch pas worden toegevoegd niet al bij het compileren probeert te binden.

------------------------------------------------------------------------------------------
-- Users: rollen + status
------------------------------------------------------------------------------------------
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CHK_Users_Role')
BEGIN
  EXEC(N'ALTER TABLE dbo.Users DROP CONSTRAINT CHK_Users_Role;');
END
EXEC(N'
  ALTER TABLE dbo.Users ADD CONSTRAINT CHK_Users_Role CHECK (role IN (
    ''system_owner'', ''company_admin'', ''company_user'', ''viewer'', ''product_manager'', ''compliance_manager''
  ));
');

IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CHK_Users_Status')
BEGIN
  EXEC(N'ALTER TABLE dbo.Users DROP CONSTRAINT CHK_Users_Status;');
END
EXEC(N'ALTER TABLE dbo.Users ADD CONSTRAINT CHK_Users_Status CHECK (status IN (''active'', ''inactive'', ''blocked''));');

-- system_owner hoort nooit bij een company; elke andere rol hoort bij precies één company.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CHK_Users_RoleCompany')
BEGIN
  EXEC(N'
    ALTER TABLE dbo.Users ADD CONSTRAINT CHK_Users_RoleCompany CHECK (
      (role = ''system_owner'' AND company_id IS NULL) OR (role <> ''system_owner'' AND company_id IS NOT NULL)
    );
  ');
END

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Users') AND name = 'last_login_at')
BEGIN
  EXEC(N'ALTER TABLE dbo.Users ADD last_login_at DATETIME2 NULL;');
END

------------------------------------------------------------------------------------------
-- Companies: bedrijfsgegevens + seat-limit override
------------------------------------------------------------------------------------------
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Companies') AND name = 'kvk_number')
  EXEC(N'ALTER TABLE dbo.Companies ADD kvk_number NVARCHAR(20) NULL;');
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Companies') AND name = 'country')
  EXEC(N'ALTER TABLE dbo.Companies ADD country NVARCHAR(100) NULL;');
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Companies') AND name = 'address')
  EXEC(N'ALTER TABLE dbo.Companies ADD address NVARCHAR(500) NULL;');
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Companies') AND name = 'contact_name')
  EXEC(N'ALTER TABLE dbo.Companies ADD contact_name NVARCHAR(200) NULL;');
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Companies') AND name = 'contact_email')
  EXEC(N'ALTER TABLE dbo.Companies ADD contact_email NVARCHAR(256) NULL;');
-- NULL = volg Plans.max_users. Effectieve limiet: COALESCE(Companies.max_users, Plans.max_users);
-- beide NULL = geen limiet.
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Companies') AND name = 'max_users')
  EXEC(N'ALTER TABLE dbo.Companies ADD max_users INT NULL;');

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CHK_Companies_MaxUsers')
  EXEC(N'ALTER TABLE dbo.Companies ADD CONSTRAINT CHK_Companies_MaxUsers CHECK (max_users IS NULL OR max_users >= 0);');

------------------------------------------------------------------------------------------
-- Plans
------------------------------------------------------------------------------------------
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Plans') AND name = 'description')
  EXEC(N'ALTER TABLE dbo.Plans ADD description NVARCHAR(500) NULL;');
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Plans') AND name = 'is_active')
  EXEC(N'ALTER TABLE dbo.Plans ADD is_active BIT NOT NULL CONSTRAINT DF_Plans_IsActive DEFAULT 1;');

------------------------------------------------------------------------------------------
-- Products: statusflow + DPP-velden
------------------------------------------------------------------------------------------
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CHK_Products_Status')
BEGIN
  EXEC(N'ALTER TABLE dbo.Products DROP CONSTRAINT CHK_Products_Status;');
END
EXEC(N'ALTER TABLE dbo.Products ADD CONSTRAINT CHK_Products_Status CHECK (status IN (''draft'', ''review'', ''published'', ''archived''));');

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Products') AND name = 'category')
  EXEC(N'ALTER TABLE dbo.Products ADD category NVARCHAR(100) NULL;');
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Products') AND name = 'materials')
  EXEC(N'ALTER TABLE dbo.Products ADD materials NVARCHAR(MAX) NULL;');
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Products') AND name = 'compliance_info')
  EXEC(N'ALTER TABLE dbo.Products ADD compliance_info NVARCHAR(MAX) NULL;');
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Products') AND name = 'recycling_info')
  EXEC(N'ALTER TABLE dbo.Products ADD recycling_info NVARCHAR(MAX) NULL;');
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Products') AND name = 'repair_info')
  EXEC(N'ALTER TABLE dbo.Products ADD repair_info NVARCHAR(MAX) NULL;');
-- Intern veld: wordt NOOIT op de publieke DPP-pagina getoond.
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Products') AND name = 'admin_notes')
  EXEC(N'ALTER TABLE dbo.Products ADD admin_notes NVARCHAR(MAX) NULL;');
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Products') AND name = 'created_by')
  EXEC(N'ALTER TABLE dbo.Products ADD created_by INT NULL CONSTRAINT FK_Products_CreatedBy REFERENCES dbo.Users(id);');
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Products') AND name = 'updated_by')
  EXEC(N'ALTER TABLE dbo.Products ADD updated_by INT NULL CONSTRAINT FK_Products_UpdatedBy REFERENCES dbo.Users(id);');

------------------------------------------------------------------------------------------
-- Documents
------------------------------------------------------------------------------------------
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Documents') AND name = 'created_by')
  EXEC(N'ALTER TABLE dbo.Documents ADD created_by INT NULL CONSTRAINT FK_Documents_CreatedBy REFERENCES dbo.Users(id);');
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Documents') AND name = 'updated_at')
  EXEC(N'ALTER TABLE dbo.Documents ADD updated_at DATETIME2 NOT NULL CONSTRAINT DF_Documents_UpdatedAt DEFAULT SYSUTCDATETIME();');

------------------------------------------------------------------------------------------
-- ScanEvents: alleen niet-herleidbare gegevens (geen IP, geen cookies)
------------------------------------------------------------------------------------------
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.ScanEvents') AND name = 'source')
  EXEC(N'ALTER TABLE dbo.ScanEvents ADD source NVARCHAR(20) NULL;');
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.ScanEvents') AND name = 'country_code')
  EXEC(N'ALTER TABLE dbo.ScanEvents ADD country_code NCHAR(2) NULL;');
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.ScanEvents') AND name = 'IX_ScanEvents_ScannedAt')
  EXEC(N'CREATE INDEX IX_ScanEvents_ScannedAt ON dbo.ScanEvents(scanned_at);');

------------------------------------------------------------------------------------------
-- AuditLogs
------------------------------------------------------------------------------------------
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.AuditLogs') AND name = 'IX_AuditLogs_Timestamp')
  EXEC(N'CREATE INDEX IX_AuditLogs_Timestamp ON dbo.AuditLogs(timestamp);');

------------------------------------------------------------------------------------------
-- CompanyInvitations (Company Admin-uitnodigingen door de System Owner)
------------------------------------------------------------------------------------------
IF OBJECT_ID('dbo.CompanyInvitations', 'U') IS NULL
BEGIN
  EXEC(N'
    CREATE TABLE dbo.CompanyInvitations (
      id INT IDENTITY(1,1) PRIMARY KEY,
      company_id INT NOT NULL,
      email NVARCHAR(256) NOT NULL,
      first_name NVARCHAR(100) NULL,
      last_name NVARCHAR(100) NULL,
      role NVARCHAR(30) NOT NULL CONSTRAINT DF_CompanyInvitations_Role DEFAULT ''company_admin'',
      -- SHA-256 van het random token; het token zelf wordt nooit opgeslagen.
      token_hash CHAR(64) NOT NULL,
      expires_at DATETIME2 NOT NULL,
      accepted_at DATETIME2 NULL,
      accepted_user_id INT NULL,
      revoked_at DATETIME2 NULL,
      created_by INT NULL,
      created_at DATETIME2 NOT NULL CONSTRAINT DF_CompanyInvitations_CreatedAt DEFAULT SYSUTCDATETIME(),
      CONSTRAINT UQ_CompanyInvitations_TokenHash UNIQUE (token_hash),
      CONSTRAINT FK_CompanyInvitations_Company FOREIGN KEY (company_id) REFERENCES dbo.Companies(id),
      CONSTRAINT FK_CompanyInvitations_AcceptedUser FOREIGN KEY (accepted_user_id) REFERENCES dbo.Users(id),
      CONSTRAINT FK_CompanyInvitations_CreatedBy FOREIGN KEY (created_by) REFERENCES dbo.Users(id),
      CONSTRAINT CHK_CompanyInvitations_Role CHECK (role IN (''company_admin''))
    );
  ');
  EXEC(N'CREATE INDEX IX_CompanyInvitations_CompanyId ON dbo.CompanyInvitations(company_id);');
END
