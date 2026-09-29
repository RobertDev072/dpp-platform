-- Fase 2: impersonatie ("inloggen als", alleen Platform Owner) + audit-lees-API.
-- Alles additief: bestaande sessies en auditregels blijven onaangetast.

-- Sessions: wie impersoneert deze sessie (NULL = gewone eigen sessie).
IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.Sessions') AND name = 'impersonator_user_id'
)
BEGIN
  EXEC(N'ALTER TABLE dbo.Sessions ADD impersonator_user_id INT NULL
    CONSTRAINT FK_Sessions_Impersonator REFERENCES dbo.Users(id);');
END

-- AuditLogs: elke actie tijdens impersonatie is herleidbaar tot beide personen.
IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.AuditLogs') AND name = 'impersonator_user_id'
)
BEGIN
  EXEC(N'ALTER TABLE dbo.AuditLogs ADD impersonator_user_id INT NULL;');
END

-- Companies: bedrijfslogo (base64-data-URI, max ~200KB afgedwongen in de API).
-- Stond gepland voor migratie 009 maar is naar voren gehaald omdat /api/auth/me
-- het logo al meegeeft voor de AppShell-header.
IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.Companies') AND name = 'logo'
)
BEGIN
  EXEC(N'ALTER TABLE dbo.Companies ADD logo NVARCHAR(MAX) NULL;');
END

-- Indexen voor de audit-lees-API (paginering op tijd, filteren op entiteit).
IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID('dbo.AuditLogs') AND name = 'IX_AuditLogs_Company_Timestamp'
)
BEGIN
  CREATE INDEX IX_AuditLogs_Company_Timestamp
    ON dbo.AuditLogs(company_id, timestamp DESC)
    INCLUDE (action, entity_type, user_id);
END

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID('dbo.AuditLogs') AND name = 'IX_AuditLogs_Entity'
)
BEGIN
  CREATE INDEX IX_AuditLogs_Entity
    ON dbo.AuditLogs(entity_type, entity_id);
END
