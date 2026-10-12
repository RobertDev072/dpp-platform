-- Kleine WebP-versie van de productfoto voor het publieke paspoort (minder dataverkeer
-- en snellere pagina's). Het origineel blijft ongewijzigd bewaard. Additief, idempotent.
ALTER TABLE dbo.products ADD COLUMN IF NOT EXISTS photo_thumb_blob_name varchar(300) NULL;
