-- New uploads require capture context in the API. Columns remain nullable so
-- immutable historical media without location metadata stays readable.
ALTER TABLE app.workflow_media
  ADD COLUMN location_label text CHECK(location_label IS NULL OR length(location_label) BETWEEN 1 AND 500),
  ADD COLUMN captured_at_source text CHECK(captured_at_source IS NULL OR captured_at_source IN ('metadata','device','manual')),
  ADD COLUMN location_source text CHECK(location_source IS NULL OR location_source IN ('metadata','device','search'));
