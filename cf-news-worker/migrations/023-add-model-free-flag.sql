-- Add is_free flag to provider_models (free-marker from live /models).
-- modelRefresher detects free models (OpenRouter `:free`/zero pricing, Zen/OrcaRouter
-- `-free` suffix) at reconcile time and stores the flag. Free models get a score
-- bonus at enable time so they outrank paid peers of similar quality within the
-- same provider chain; read path (aiProvider.getModelSpecs score DESC) is unchanged.
ALTER TABLE provider_models ADD COLUMN is_free INTEGER NOT NULL DEFAULT 0;

INSERT OR REPLACE INTO app_config (key, value) VALUES ('model_sync_free_score_bonus', '20');
INSERT OR REPLACE INTO app_config (key, value) VALUES ('schema_version', '23');
