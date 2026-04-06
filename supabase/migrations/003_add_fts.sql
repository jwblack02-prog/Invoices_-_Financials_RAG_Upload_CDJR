-- Migration 003: Add full-text search (FTS) for hybrid retrieval
-- Fixes: wiADVISOR charges inside differently-named PDFs scoring below
-- vector similarity threshold and being missed by queries.

-- Add generated tsvector column (auto-updated on text changes)
ALTER TABLE document_chunks
  ADD COLUMN IF NOT EXISTS fts tsvector
    GENERATED ALWAYS AS (to_tsvector('english', text)) STORED;

-- GIN index for fast FTS lookups
CREATE INDEX IF NOT EXISTS document_chunks_fts_idx
  ON document_chunks USING gin(fts);

-- RPC: keyword search returning same row shape as match_documents
CREATE OR REPLACE FUNCTION search_documents_fts(
  search_query text,
  match_count  int DEFAULT 20
)
RETURNS TABLE (
  id       text,
  text     text,
  metadata jsonb,
  score    float
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    id,
    text,
    jsonb_build_object(
      'source_file',       source_file,
      'onedrive_file_id',  onedrive_file_id,
      'folder_path',       folder_path,
      'chunk_index',       chunk_index,
      'total_chunks',      total_chunks,
      'last_modified',     last_modified,
      'web_url',           web_url
    ) AS metadata,
    ts_rank(fts, plainto_tsquery('english', search_query))::float AS score
  FROM document_chunks
  WHERE fts @@ plainto_tsquery('english', search_query)
  ORDER BY score DESC
  LIMIT match_count;
$$;
