-- Fase 3: productdetails voor het publieke productpaspoort (onderdelen, duurzaamheid,
-- compliance, batches, documentcategorieen) plus de velden die de publieke paspoortpagina
-- direct op Products/Documents nodig heeft.
--
-- Idempotent: CREATE TABLE alleen als de tabel nog niet bestaat, ALTER TABLE via de
-- guarded EXEC()-aanpak uit migration 003 (kolomnamen worden anders al bij het compileren
-- van deze batch gebonden, nog voordat een eerdere ALTER TABLE in dezelfde batch is
-- uitgevoerd).

IF OBJECT_ID('dbo.ProductParts', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.ProductParts (
    id INT IDENTITY PRIMARY KEY,
    product_id INT NOT NULL REFERENCES dbo.Products(id),
    company_id INT NOT NULL REFERENCES dbo.Companies(id),
    part_number NVARCHAR(100) NOT NULL,
    name NVARCHAR(200) NOT NULL,
    description NVARCHAR(MAX) NULL,
    image_url NVARCHAR(1000) NULL,
    created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
  );
END

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID('dbo.ProductParts') AND name = 'IX_ProductParts_ProductId'
)
BEGIN
  CREATE INDEX IX_ProductParts_ProductId ON dbo.ProductParts(product_id);
END

IF OBJECT_ID('dbo.ProductSustainability', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.ProductSustainability (
    product_id INT NOT NULL PRIMARY KEY REFERENCES dbo.Products(id),
    co2_footprint_kg DECIMAL(10, 2) NULL,
    co2_reduction_pct DECIMAL(5, 2) NULL,
    recycled_material_pct DECIMAL(5, 2) NULL,
    materials NVARCHAR(MAX) NULL, -- JSON array van objecten met material en pct
    epd_url NVARCHAR(1000) NULL,
    recyclable BIT NULL,
    reach_conform BIT NULL,
    rohs_conform BIT NULL,
    expected_lifespan_years INT NULL,
    updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
  );
END

IF OBJECT_ID('dbo.ProductCompliance', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.ProductCompliance (
    product_id INT NOT NULL PRIMARY KEY REFERENCES dbo.Products(id),
    ce_marked BIT NULL,
    applicable_regulations NVARCHAR(MAX) NULL, -- JSON array van strings
    updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
  );
END

IF OBJECT_ID('dbo.ProductBatches', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.ProductBatches (
    id INT IDENTITY PRIMARY KEY,
    product_id INT NOT NULL REFERENCES dbo.Products(id),
    company_id INT NOT NULL REFERENCES dbo.Companies(id),
    batch_number NVARCHAR(100) NOT NULL,
    production_date DATE NULL,
    quantity INT NULL,
    created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
  );
END

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID('dbo.ProductBatches') AND name = 'IX_ProductBatches_ProductId'
)
BEGIN
  CREATE INDEX IX_ProductBatches_ProductId ON dbo.ProductBatches(product_id);
END

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.Products') AND name = 'highlights'
)
BEGIN
  -- JSON array van korte strings, gebruikt voor de publieke "In het kort"-bullet-list.
  EXEC(N'ALTER TABLE dbo.Products ADD highlights NVARCHAR(MAX) NULL;');
END

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.Products') AND name = 'category_label'
)
BEGIN
  -- Vrije tekst producttype, bijv. "Industriele pomp".
  EXEC(N'ALTER TABLE dbo.Products ADD category_label NVARCHAR(100) NULL;');
END

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.Documents') AND name = 'category'
)
BEGIN
  EXEC(N'ALTER TABLE dbo.Documents ADD category NVARCHAR(30) NOT NULL DEFAULT ''document'';');
END

IF NOT EXISTS (
  SELECT 1 FROM sys.check_constraints WHERE name = 'CHK_Documents_Category'
)
BEGIN
  EXEC(N'
    ALTER TABLE dbo.Documents
      ADD CONSTRAINT CHK_Documents_Category
      CHECK (category IN (''document'', ''manual'', ''video'', ''3d_model''));
  ');
END
