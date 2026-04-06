-- Add web_url column for OneDrive direct links
ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS web_url TEXT;

-- Friendly name visible in Supabase dashboard
COMMENT ON TABLE document_chunks IS 'CDJR Invoice Uploads';

-- Recreate match_documents to include web_url in metadata
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
      'last_modified', dc.last_modified,
      'web_url', dc.web_url
    ) AS metadata
  FROM document_chunks dc
  ORDER BY dc.embedding <=> query_embedding
  LIMIT match_count;
$$ LANGUAGE sql STABLE;
