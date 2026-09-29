-- Fase 4: productfoto. Slaat de URL van de productfoto op (extern geplakte link, of de
-- publieke URL van een via Azure Blob Storage geuploade afbeelding).

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.Products') AND name = 'photo_url'
)
BEGIN
  EXEC(N'ALTER TABLE dbo.Products ADD photo_url NVARCHAR(1000) NULL;');
END
