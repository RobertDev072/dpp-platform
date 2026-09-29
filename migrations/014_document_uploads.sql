-- Documentupload naar Azure Blob Storage (naast de bestaande URL-documenten).
-- blob_name verwijst naar de private documenten-container; storage_url wordt
-- optioneel (een document heeft precies één bron: URL of upload).
IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.Documents') AND name = 'blob_name'
)
BEGIN
  EXEC(N'ALTER TABLE dbo.Documents ADD blob_name NVARCHAR(300) NULL;');
END

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.Documents') AND name = 'file_size'
)
BEGIN
  EXEC(N'ALTER TABLE dbo.Documents ADD file_size INT NULL;');
END

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.Documents') AND name = 'mime_type'
)
BEGIN
  EXEC(N'ALTER TABLE dbo.Documents ADD mime_type NVARCHAR(100) NULL;');
END

-- storage_url mag leeg zijn zodra er een blob is; minstens één bron verplicht.
IF EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.Documents') AND name = 'storage_url' AND is_nullable = 0
)
BEGIN
  EXEC(N'ALTER TABLE dbo.Documents ALTER COLUMN storage_url NVARCHAR(1000) NULL;');
END

IF NOT EXISTS (
  SELECT 1 FROM sys.check_constraints
  WHERE name = 'CHK_Documents_HasSource' AND parent_object_id = OBJECT_ID('dbo.Documents')
)
BEGIN
  EXEC(N'ALTER TABLE dbo.Documents ADD CONSTRAINT CHK_Documents_HasSource
    CHECK (storage_url IS NOT NULL OR blob_name IS NOT NULL);');
END
