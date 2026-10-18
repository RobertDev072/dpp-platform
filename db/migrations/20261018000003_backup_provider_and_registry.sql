-- Continuïteit (EN 18221-richting) en registratie (ESPR art. 13-richting):
-- 1. replicatie van elke paspoortversie naar een externe back-up-DPP-dienstverlener;
-- 2. aanmelding van paspoorten bij het EU DPP-register.
-- Beide staan uit tot er een partij/endpoint is geconfigureerd; de voortgang wordt per
-- product bijgehouden, zodat bij inschakelen ook de hele historie alsnog wordt verstuurd.

CREATE TABLE IF NOT EXISTS dbo.dppreplicationstate (
  product_id integer PRIMARY KEY REFERENCES dbo.products(id) ON DELETE CASCADE,
  last_version_id bigint NOT NULL DEFAULT 0,
  last_sent_at timestamptz NULL,
  attempts integer NOT NULL DEFAULT 0,
  last_error varchar(500) NULL,
  next_attempt_at timestamptz NULL
);

CREATE TABLE IF NOT EXISTS dbo.dppregistrations (
  public_id uuid PRIMARY KEY,
  product_id integer NOT NULL REFERENCES dbo.products(id) ON DELETE CASCADE,
  company_id integer NOT NULL REFERENCES dbo.companies(id) ON DELETE CASCADE,
  status varchar(20) NOT NULL DEFAULT 'queued',
  registry_reference varchar(200) NULL,
  attempts integer NOT NULL DEFAULT 0,
  last_error varchar(500) NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  registered_at timestamptz NULL,
  next_attempt_at timestamptz NULL,
  CONSTRAINT chk_dppregistrations_status CHECK (status IN ('queued', 'registered', 'failed'))
);
CREATE INDEX IF NOT EXISTS ix_dppregistrations_queue ON dbo.dppregistrations (next_attempt_at) WHERE status <> 'registered';
