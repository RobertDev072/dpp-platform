-- Fase 4 (vervolg): productfoto-uploads gaan naar een prive Blob Storage-container.
-- photo_url blijft de kolom voor een door de gebruiker geplakte externe URL.
-- photo_blob_name is nieuw: alleen de blobnaam van een geuploade foto (geen URL, geen
-- secret) - de daadwerkelijke downloadlink wordt per aanvraag kortstondig gegenereerd
-- via een user-delegation SAS, nooit permanent opgeslagen.

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.Products') AND name = 'photo_blob_name'
)
BEGIN
  EXEC(N'ALTER TABLE dbo.Products ADD photo_blob_name NVARCHAR(255) NULL;');
END
