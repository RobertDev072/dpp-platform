-- Fase 2.5: Microsoft Entra External ID als identity provider.
-- Voegt externe identity-referenties toe aan Users en maakt password_hash optioneel,
-- zodat Entra-gekoppelde gebruikers geen lokaal wachtwoord meer nodig hebben.
-- Bestaande bcrypt-accounts (bijv. de gezaaide System Owner) blijven ongewijzigd werken.
--
-- Twee losse velden, bewust niet één "entra_object_id":
--   entra_object_id  = Graph directory-object-id, bekend direct bij het aanmaken van de
--                       gebruiker via Graph. Gebruikt voor beheeracties (disable/reset).
--   entra_subject_id = de "sub"-claim uit het ID-token bij inloggen. Deze is pairwise
--                       per app-registratie en dus NIET gegarandeerd gelijk aan
--                       entra_object_id; pas bekend na de eerste succesvolle login.
--
-- Elke DDL-stap staat in EXEC(N'...'): binnen één batch bindt SQL Server kolomnamen van
-- latere statements al bij het compileren, nog voordat een eerdere ALTER TABLE in
-- dezelfde batch is uitgevoerd. EXEC stelt de parsing uit tot runtime.

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.Users') AND name = 'entra_object_id'
)
BEGIN
  EXEC(N'ALTER TABLE dbo.Users ADD entra_object_id NVARCHAR(255) NULL;');
END

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.Users') AND name = 'entra_subject_id'
)
BEGIN
  EXEC(N'ALTER TABLE dbo.Users ADD entra_subject_id NVARCHAR(255) NULL;');
END

IF EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.Users') AND name = 'password_hash' AND is_nullable = 0
)
BEGIN
  EXEC(N'ALTER TABLE dbo.Users ALTER COLUMN password_hash NVARCHAR(255) NULL;');
END

IF NOT EXISTS (
  SELECT 1 FROM sys.check_constraints WHERE name = 'CHK_Users_HasAuthMethod'
)
BEGIN
  -- entra_object_id alleen (zonder entra_subject_id) is een geldige, tijdelijke staat:
  -- een via Graph aangemaakte gebruiker vóór de eerste succesvolle login (entra_subject_id
  -- wordt pas gezet op het moment van "just-in-time"-koppelen, zie entraLogin.service.js).
  EXEC(N'
    ALTER TABLE dbo.Users
      ADD CONSTRAINT CHK_Users_HasAuthMethod
      CHECK (password_hash IS NOT NULL OR entra_subject_id IS NOT NULL OR entra_object_id IS NOT NULL);
  ');
END

-- SQL Server staat maar één NULL toe in een gewone UNIQUE constraint; een gefilterde
-- index laat wel meerdere NULLs toe (bcrypt-only accounts) en dwingt uniciteit alleen
-- af zodra entra_subject_id daadwerkelijk gezet is.
IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID('dbo.Users') AND name = 'UQ_Users_EntraSubjectId'
)
BEGIN
  EXEC(N'
    CREATE UNIQUE INDEX UQ_Users_EntraSubjectId
      ON dbo.Users(entra_subject_id)
      WHERE entra_subject_id IS NOT NULL;
  ');
END

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID('dbo.Users') AND name = 'UQ_Users_EntraObjectId'
)
BEGIN
  EXEC(N'
    CREATE UNIQUE INDEX UQ_Users_EntraObjectId
      ON dbo.Users(entra_object_id)
      WHERE entra_object_id IS NOT NULL;
  ');
END
