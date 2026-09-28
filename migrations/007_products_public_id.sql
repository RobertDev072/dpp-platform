-- Fase 3 (track C): public_id van producten uniek, maar alleen zodra het gezet is.
--
-- 001_init.sql maakte UQ_Products_PublicId als gewone UNIQUE constraint. SQL Server staat
-- daarin maar één NULL toe: zodra er één nooit-gepubliceerd product (public_id NULL) bestaat,
-- faalt elke volgende INSERT van een product zonder public_id. public_id wordt pas bij de
-- eerste publicatie gezet (zie §4 in docs/architecture-roles.md), dus NULL is de normale
-- staat van elk concept. Een gefilterde unieke index laat meerdere NULLs toe en dwingt
-- uniciteit af zodra public_id gezet is (zelfde aanpak als UQ_Users_EntraSubjectId in 003).
--
-- Idempotent en, net als 003/004, elke DDL-stap in EXEC(N'...').

IF EXISTS (
  SELECT 1 FROM sys.key_constraints
  WHERE parent_object_id = OBJECT_ID('dbo.Products') AND name = 'UQ_Products_PublicId' AND type = 'UQ'
)
BEGIN
  EXEC(N'ALTER TABLE dbo.Products DROP CONSTRAINT UQ_Products_PublicId;');
END

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID('dbo.Products') AND name = 'UQ_Products_PublicId'
)
BEGIN
  EXEC(N'
    CREATE UNIQUE INDEX UQ_Products_PublicId
      ON dbo.Products(public_id)
      WHERE public_id IS NOT NULL;
  ');
END
