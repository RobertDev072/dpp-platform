-- Fase 1 fundament: Companies, Plans, Users, Products, Documents, ScanEvents, AuditLogs
-- Idempotent: elk blok slaat over als het object al bestaat, zodat de migratie veilig
-- opnieuw gedraaid kan worden.

IF OBJECT_ID('dbo.Plans', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.Plans (
    id INT IDENTITY(1,1) PRIMARY KEY,
    name NVARCHAR(100) NOT NULL,
    max_users INT NOT NULL DEFAULT 1,
    max_products INT NOT NULL DEFAULT 10,
    feature_flags NVARCHAR(MAX) NULL,
    created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
  );
END

IF OBJECT_ID('dbo.Companies', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.Companies (
    id INT IDENTITY(1,1) PRIMARY KEY,
    name NVARCHAR(200) NOT NULL,
    slug NVARCHAR(100) NOT NULL,
    status NVARCHAR(20) NOT NULL DEFAULT 'active',
    plan_id INT NULL,
    created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT UQ_Companies_Slug UNIQUE (slug),
    CONSTRAINT FK_Companies_Plan FOREIGN KEY (plan_id) REFERENCES dbo.Plans(id),
    CONSTRAINT CHK_Companies_Status CHECK (status IN ('active', 'suspended', 'archived'))
  );
END

IF OBJECT_ID('dbo.Users', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.Users (
    id INT IDENTITY(1,1) PRIMARY KEY,
    company_id INT NULL,
    email NVARCHAR(256) NOT NULL,
    password_hash NVARCHAR(255) NOT NULL,
    first_name NVARCHAR(100) NULL,
    last_name NVARCHAR(100) NULL,
    role NVARCHAR(30) NOT NULL,
    status NVARCHAR(20) NOT NULL DEFAULT 'active',
    created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT UQ_Users_Email UNIQUE (email),
    CONSTRAINT FK_Users_Company FOREIGN KEY (company_id) REFERENCES dbo.Companies(id),
    CONSTRAINT CHK_Users_Role CHECK (role IN ('system_owner', 'company_admin', 'company_user', 'viewer')),
    CONSTRAINT CHK_Users_Status CHECK (status IN ('active', 'inactive'))
  );

  CREATE INDEX IX_Users_CompanyId ON dbo.Users(company_id);
END

IF OBJECT_ID('dbo.Products', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.Products (
    id INT IDENTITY(1,1) PRIMARY KEY,
    company_id INT NOT NULL,
    name NVARCHAR(200) NOT NULL,
    brand NVARCHAR(150) NULL,
    model NVARCHAR(150) NULL,
    sku NVARCHAR(100) NULL,
    gtin NVARCHAR(50) NULL,
    category_id INT NULL,
    description NVARCHAR(MAX) NULL,
    manufacturer NVARCHAR(200) NULL,
    country_of_origin NVARCHAR(100) NULL,
    status NVARCHAR(20) NOT NULL DEFAULT 'draft',
    public_id UNIQUEIDENTIFIER NULL,
    published_at DATETIME2 NULL,
    created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT UQ_Products_PublicId UNIQUE (public_id),
    CONSTRAINT FK_Products_Company FOREIGN KEY (company_id) REFERENCES dbo.Companies(id),
    CONSTRAINT CHK_Products_Status CHECK (status IN ('draft', 'published', 'archived'))
  );

  CREATE INDEX IX_Products_CompanyId ON dbo.Products(company_id);
END

IF OBJECT_ID('dbo.Documents', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.Documents (
    id INT IDENTITY(1,1) PRIMARY KEY,
    company_id INT NOT NULL,
    product_id INT NOT NULL,
    type NVARCHAR(50) NOT NULL,
    title NVARCHAR(200) NOT NULL,
    language NVARCHAR(10) NULL,
    storage_url NVARCHAR(1000) NOT NULL,
    is_public BIT NOT NULL DEFAULT 0,
    created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_Documents_Company FOREIGN KEY (company_id) REFERENCES dbo.Companies(id),
    CONSTRAINT FK_Documents_Product FOREIGN KEY (product_id) REFERENCES dbo.Products(id)
  );

  CREATE INDEX IX_Documents_ProductId ON dbo.Documents(product_id);
  CREATE INDEX IX_Documents_CompanyId ON dbo.Documents(company_id);
END

IF OBJECT_ID('dbo.ScanEvents', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.ScanEvents (
    id BIGINT IDENTITY(1,1) PRIMARY KEY,
    product_id INT NOT NULL,
    scanned_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    user_agent NVARCHAR(500) NULL,
    referrer NVARCHAR(500) NULL,
    CONSTRAINT FK_ScanEvents_Product FOREIGN KEY (product_id) REFERENCES dbo.Products(id)
  );

  CREATE INDEX IX_ScanEvents_ProductId ON dbo.ScanEvents(product_id);
END

IF OBJECT_ID('dbo.AuditLogs', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.AuditLogs (
    id BIGINT IDENTITY(1,1) PRIMARY KEY,
    company_id INT NULL,
    user_id INT NULL,
    action NVARCHAR(100) NOT NULL,
    entity_type NVARCHAR(50) NOT NULL,
    entity_id NVARCHAR(50) NULL,
    timestamp DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    metadata NVARCHAR(MAX) NULL,
    CONSTRAINT FK_AuditLogs_Company FOREIGN KEY (company_id) REFERENCES dbo.Companies(id),
    CONSTRAINT FK_AuditLogs_User FOREIGN KEY (user_id) REFERENCES dbo.Users(id)
  );

  CREATE INDEX IX_AuditLogs_CompanyId ON dbo.AuditLogs(company_id);
END
