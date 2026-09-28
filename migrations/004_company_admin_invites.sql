-- Fase 2: Company Admin invite-flow. Tokens worden alleen gehasht opgeslagen
-- (zelfde sha256-aanpak als de sessie-tokens in src/middleware/auth.js); het
-- plaintext-token bestaat alleen kort in het POST /invites-antwoord.

IF OBJECT_ID('dbo.CompanyAdminInvites', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.CompanyAdminInvites (
    id INT IDENTITY(1,1) PRIMARY KEY,
    company_id INT NOT NULL,
    email NVARCHAR(256) NOT NULL,
    first_name NVARCHAR(100) NULL,
    last_name NVARCHAR(100) NULL,
    token_hash CHAR(64) NOT NULL,
    status NVARCHAR(20) NOT NULL DEFAULT 'pending',
    invited_by INT NOT NULL,
    expires_at DATETIME2 NOT NULL,
    accepted_at DATETIME2 NULL,
    created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT UQ_CompanyAdminInvites_TokenHash UNIQUE (token_hash),
    CONSTRAINT FK_CompanyAdminInvites_Company FOREIGN KEY (company_id) REFERENCES dbo.Companies(id),
    CONSTRAINT FK_CompanyAdminInvites_InvitedBy FOREIGN KEY (invited_by) REFERENCES dbo.Users(id),
    CONSTRAINT CHK_CompanyAdminInvites_Status CHECK (status IN ('pending', 'accepted', 'revoked', 'expired'))
  );

  CREATE INDEX IX_CompanyAdminInvites_CompanyId ON dbo.CompanyAdminInvites(company_id);
END
