-- Fase 4: gebruikers "verwijderen" (soft delete, consistent met het bestaande
-- active/blocked/suspended/archived-patroon uit migratie 007). 'deleted' komt er als
-- vijfde toegestane status bij; de rij zelf blijft bestaan (audit-trail/FK's blijven
-- intact), maar de gebruiker kan nooit meer inloggen (requireAuth accepteert alleen
-- status = 'active') en het bijbehorende Entra-account wordt verwijderd (users.routes.js).

IF EXISTS (
  SELECT 1 FROM sys.check_constraints
  WHERE name = 'CHK_Users_Status' AND parent_object_id = OBJECT_ID('dbo.Users')
)
BEGIN
  ALTER TABLE dbo.Users DROP CONSTRAINT CHK_Users_Status;
END

EXEC(N'ALTER TABLE dbo.Users ADD CONSTRAINT CHK_Users_Status
  CHECK (status IN (''active'', ''blocked'', ''suspended'', ''archived'', ''deleted''));');
