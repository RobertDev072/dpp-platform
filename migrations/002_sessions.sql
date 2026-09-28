-- Fase 2 auth: opaque server-side sessions (token wordt gehasht opgeslagen).

IF OBJECT_ID('dbo.Sessions', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.Sessions (
    id INT IDENTITY(1,1) PRIMARY KEY,
    user_id INT NOT NULL,
    token_hash CHAR(64) NOT NULL,
    created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    expires_at DATETIME2 NOT NULL,
    CONSTRAINT UQ_Sessions_TokenHash UNIQUE (token_hash),
    CONSTRAINT FK_Sessions_User FOREIGN KEY (user_id) REFERENCES dbo.Users(id)
  );

  CREATE INDEX IX_Sessions_UserId ON dbo.Sessions(user_id);
END
