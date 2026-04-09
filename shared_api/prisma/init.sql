-- MissionChain initial seed
-- Creates initial admin user + system config
INSERT INTO "SystemConfig" (id, key, value, "updatedAt")
VALUES
  ('cfg_maintenance', 'maintenance_mode', 'false', NOW()),
  ('cfg_seed_active', 'seed_round_active', 'true', NOW()),
  ('cfg_presale_active', 'presale_active', 'false', NOW())
ON CONFLICT (key) DO NOTHING;
