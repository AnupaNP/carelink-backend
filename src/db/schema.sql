-- ============================================================
-- CareLink Database Schema — PostgreSQL (Neon compatible)
-- ============================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── ENUM Types ──────────────────────────────────────────────
DO $$ BEGIN CREATE TYPE schedule_type AS ENUM ('medication','meal','activity');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE call_status AS ENUM ('pending','analysing','completed','failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE alert_severity AS ENUM ('URGENT','HIGH','MEDIUM','LOW');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE recurrence_type AS ENUM ('daily','weekdays','weekends','weekly','once');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Caregivers ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS caregivers (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         VARCHAR(255) NOT NULL,
  email        VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  phone        VARCHAR(20),
  avatar_url   TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ── Elders ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS elders (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  elder_uid         VARCHAR(20) UNIQUE NOT NULL,
  caregiver_id      UUID NOT NULL REFERENCES caregivers(id) ON DELETE CASCADE,
  name              VARCHAR(255) NOT NULL,
  age               INTEGER,
  phone             VARCHAR(20),
  photo_url         TEXT,
  medical_notes     TEXT,
  emergency_contact VARCHAR(255),
  emergency_phone   VARCHAR(20),
  address           TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ── Schedules ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS schedules (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  elder_id       UUID NOT NULL REFERENCES elders(id) ON DELETE CASCADE,
  type           schedule_type NOT NULL,
  label          VARCHAR(255) NOT NULL,
  scheduled_time TIME NOT NULL,
  recurrence     recurrence_type DEFAULT 'daily',
  notes          TEXT,
  is_active      BOOLEAN DEFAULT TRUE,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ── Calls ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS calls (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  elder_id        UUID NOT NULL REFERENCES elders(id) ON DELETE CASCADE,
  call_timestamp  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  duration_seconds INTEGER,
  raw_transcript  JSONB,
  llm_analysis    JSONB,
  status          call_status DEFAULT 'pending',
  error_message   TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── Alerts ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS alerts (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  elder_id   UUID NOT NULL REFERENCES elders(id) ON DELETE CASCADE,
  call_id    UUID REFERENCES calls(id) ON DELETE SET NULL,
  severity   alert_severity NOT NULL,
  message    TEXT NOT NULL,
  is_read    BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Indexes ──────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_elders_caregiver    ON elders(caregiver_id);
CREATE INDEX IF NOT EXISTS idx_schedules_elder     ON schedules(elder_id);
CREATE INDEX IF NOT EXISTS idx_schedules_active    ON schedules(elder_id, is_active);
CREATE INDEX IF NOT EXISTS idx_calls_elder         ON calls(elder_id);
CREATE INDEX IF NOT EXISTS idx_calls_status        ON calls(status);
CREATE INDEX IF NOT EXISTS idx_calls_timestamp     ON calls(elder_id, call_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_elder        ON alerts(elder_id);
CREATE INDEX IF NOT EXISTS idx_alerts_unread       ON alerts(elder_id, is_read);
CREATE INDEX IF NOT EXISTS idx_alerts_severity     ON alerts(severity);
