-- Licentiegeldigheid per bedrijf (limieten leven op het Plan; de toewijzing en de
-- looptijd op het bedrijf). NULL = geen begin-/einddatum vastgelegd (geldt als
-- doorlopend geldig).
IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.Companies') AND name = 'license_start'
)
BEGIN
  EXEC(N'ALTER TABLE dbo.Companies ADD license_start DATE NULL;');
END

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.Companies') AND name = 'license_end'
)
BEGIN
  EXEC(N'ALTER TABLE dbo.Companies ADD license_end DATE NULL;');
END
