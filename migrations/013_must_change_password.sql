-- Gedwongen wachtwoordwijziging bij eerste login met een tijdelijk wachtwoord.
-- Entra's eigen forceChangePasswordNextSignIn is onbruikbaar met de native-login-API
-- (geen wijzigingsceremonie), dus DPP dwingt dit zelf af: zolang deze vlag aan staat
-- maakt de login geen sessie aan totdat er een nieuw wachtwoord is ingesteld.
IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.Users') AND name = 'must_change_password'
)
BEGIN
  EXEC(N'ALTER TABLE dbo.Users ADD must_change_password BIT NOT NULL
    CONSTRAINT DF_Users_MustChangePassword DEFAULT 0;');
END
