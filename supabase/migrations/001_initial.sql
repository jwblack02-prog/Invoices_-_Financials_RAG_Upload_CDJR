CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS document_chunks (
  id TEXT PRIMARY KEY,
  embedding VECTOR(3072),
  text TEXT NOT NULL,
  source_file TEXT NOT NULL,
  onedrive_file_id TEXT NOT NULL,
  folder_path TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  total_chunks INTEGER NOT NULL,
  last_modified TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chunks_file_id ON document_chunks(onedrive_file_id);
CREATE INDEX IF NOT EXISTS idx_chunks_file_modified ON document_chunks(onedrive_file_id, last_modified);

CREATE TABLE IF NOT EXISTS delta_state (
  id TEXT PRIMARY KEY DEFAULT 'default',
  delta_token TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION match_documents(
  query_embedding VECTOR(3072),
  match_count INT DEFAULT 5
) RETURNS TABLE (id TEXT, score FLOAT, text TEXT, metadata JSONB)
AS $$
  SELECT
    dc.id,
    1 - (dc.embedding <=> query_embedding) AS score,
    dc.text,
    jsonb_build_object(
      'source_file', dc.source_file,
      'onedrive_file_id', dc.onedrive_file_id,
      'folder_path', dc.folder_path,
      'chunk_index', dc.chunk_index,
      'total_chunks', dc.total_chunks,
      'last_modified', dc.last_modified
    ) AS metadata
  FROM document_chunks dc
  ORDER BY dc.embedding <=> query_embedding
  LIMIT match_count;
$$ LANGUAGE sql STABLE;
