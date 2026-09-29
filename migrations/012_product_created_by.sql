-- Fase 5 (productoverzicht): wie heeft het product aangemaakt. Additief; bestaande
-- producten houden NULL (aanmaker onbekend).
IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.Products') AND name = 'created_by'
)
BEGIN
  EXEC(N'ALTER TABLE dbo.Products ADD created_by INT NULL
    CONSTRAINT FK_Products_CreatedBy REFERENCES dbo.Users(id);');
END
