-- Fase 3 bugfix: UQ_Products_PublicId (migration 001) is een gewone UNIQUE constraint.
-- SQL Server staat maar één NULL toe in een gewone UNIQUE constraint/index, en public_id
-- is NULL voor elk product dat nog niet gepubliceerd is. Zodra een company een tweede
-- concept-product aanmaakt, faalt de INSERT dus met "Violation of UNIQUE KEY constraint
-- UQ_Products_PublicId ... duplicate key value is (<NULL>)". Zelfde patroon (en fix) als
-- UQ_Users_EntraSubjectId / UQ_Users_EntraObjectId in migration 003: vervang de gewone
-- UNIQUE constraint door een gefilterde index die alleen niet-NULL public_id's uniek
-- afdwingt, zodat meerdere concept-producten met public_id = NULL naast elkaar mogen bestaan.

IF EXISTS (
  SELECT 1 FROM sys.key_constraints
  WHERE name = 'UQ_Products_PublicId' AND parent_object_id = OBJECT_ID('dbo.Products')
)
BEGIN
  ALTER TABLE dbo.Products DROP CONSTRAINT UQ_Products_PublicId;
END

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID('dbo.Products') AND name = 'UQ_Products_PublicId'
)
BEGIN
  CREATE UNIQUE INDEX UQ_Products_PublicId
    ON dbo.Products(public_id)
    WHERE public_id IS NOT NULL;
END
