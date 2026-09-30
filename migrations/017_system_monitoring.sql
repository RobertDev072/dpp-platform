-- Systeemmonitoring (Platform Owner observability):
-- 1. SystemMetricsSnapshots: dagelijkse momentopnames van omvang en aantallen
--    (database, blob-opslag, entiteiten) voor groeigrafieken en prognoses.
-- 2. SystemRequestMetricsHourly: uurlijkse request-telemetrie (per route),
--    geflusht vanuit het in-memory verzamelpunt zodat historie herstarts overleeft.
-- Beide tabellen blijven bewust klein: 1 snapshot/dag en max ~honderd rijen/uur,
-- met opschoning (90 dagen uurdata, 400 dagen snapshots) in de scheduler.

IF OBJECT_ID('dbo.SystemMetricsSnapshots', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.SystemMetricsSnapshots (
    id INT IDENTITY(1,1) PRIMARY KEY,
    taken_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    database_size_bytes BIGINT NULL,
    database_max_bytes BIGINT NULL,
    blob_storage_bytes BIGINT NULL,
    blob_count INT NULL,
    partner_count INT NOT NULL DEFAULT 0,
    company_count INT NOT NULL DEFAULT 0,
    user_count INT NOT NULL DEFAULT 0,
    active_user_count INT NOT NULL DEFAULT 0,
    product_count INT NOT NULL DEFAULT 0,
    document_count INT NOT NULL DEFAULT 0,
    audit_log_count INT NOT NULL DEFAULT 0,
    scan_event_count INT NOT NULL DEFAULT 0,
    invite_count INT NOT NULL DEFAULT 0,
    -- JSON: per-tabel rijen/bytes en per-container blob-verdeling. Als JSON zodat
    -- het schema niet hoeft te wijzigen wanneer er tabellen/containers bijkomen.
    table_stats NVARCHAR(MAX) NULL,
    blob_stats NVARCHAR(MAX) NULL
  );
  CREATE INDEX IX_SystemMetricsSnapshots_TakenAt ON dbo.SystemMetricsSnapshots(taken_at);
END

IF OBJECT_ID('dbo.SystemRequestMetricsHourly', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.SystemRequestMetricsHourly (
    id INT IDENTITY(1,1) PRIMARY KEY,
    bucket_start DATETIME2 NOT NULL,
    -- scope: 'api' | 'public' (publieke paspoortpagina's) | 'page' (overige pagina's)
    scope NVARCHAR(20) NOT NULL,
    -- route is een patroon ('/api/products/:id'), nooit een concrete URL met id's.
    route NVARCHAR(200) NOT NULL,
    method NVARCHAR(10) NOT NULL,
    request_count INT NOT NULL,
    error_4xx_count INT NOT NULL DEFAULT 0,
    error_5xx_count INT NOT NULL DEFAULT 0,
    duration_sum_ms BIGINT NOT NULL DEFAULT 0,
    duration_max_ms INT NOT NULL DEFAULT 0,
    p50_ms INT NULL,
    p95_ms INT NULL,
    p99_ms INT NULL
  );
  CREATE INDEX IX_SystemRequestMetricsHourly_Bucket ON dbo.SystemRequestMetricsHourly(bucket_start);
END
