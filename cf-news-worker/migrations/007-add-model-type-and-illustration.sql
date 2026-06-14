-- Drop unused news_illustrations table (replaced by news_summaries.illustration_url)
DROP TABLE IF EXISTS news_illustrations;

-- Add illustration_url to news_summaries
ALTER TABLE news_summaries ADD COLUMN illustration_url TEXT;

-- Add type column to provider_models (text/image/video)
ALTER TABLE provider_models ADD COLUMN type TEXT NOT NULL DEFAULT 'text';

-- Update Agnes image/video models to type='image'
UPDATE provider_models SET type = 'image' WHERE provider = 'agnes' AND model_id LIKE 'agnes-image-%';
UPDATE provider_models SET type = 'image' WHERE provider = 'agnes' AND model_id LIKE 'agnes-video-%';

-- Ensure Agnes image models exist
INSERT OR IGNORE INTO provider_models (provider, model_id, score, enabled, type) VALUES ('agnes', 'agnes-image-2.1-flash', 90, 1, 'image');
INSERT OR IGNORE INTO provider_models (provider, model_id, score, enabled, type) VALUES ('agnes', 'agnes-image-2.0-flash', 80, 1, 'image');
INSERT OR IGNORE INTO provider_models (provider, model_id, score, enabled, type) VALUES ('agnes', 'agnes-video-v2.0', 70, 1, 'image');

INSERT OR REPLACE INTO app_config (key, value) VALUES ('schema_version', '7');
