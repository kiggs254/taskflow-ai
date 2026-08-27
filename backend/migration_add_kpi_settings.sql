-- Migration: monthly KPI reporting settings
-- Run: psql -U <user> -d <db> -f migration_add_kpi_settings.sql
--
-- Holds where to reach the fleet manager (ebiz-manager) and WHICH of its instances
-- count as work. That allowlist is the point: most of the fleet is personal side
-- projects, and a personal project's downtime must never land in a work KPI score.

CREATE TABLE IF NOT EXISTS kpi_settings (
    user_id           INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    fleet_base_url    TEXT,                          -- https://manager.example.com
    fleet_api_key     TEXT,                          -- matches KPI_API_KEY on that side
    work_instance_ids JSONB NOT NULL DEFAULT '[]'::jsonb,  -- deployment ids counted as work
    sheet_id          TEXT,                          -- Google Sheet the monthly tabs go into
    created_at        TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON COLUMN kpi_settings.work_instance_ids IS
  'ebiz-manager deployment ids that count as work. Empty = whole fleet, which is usually wrong.';
