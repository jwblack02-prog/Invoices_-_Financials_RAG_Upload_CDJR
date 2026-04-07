-- Migration 004: Fix FTS to handle natural language queries
-- Problem: plainto_tsquery('english', user_question) uses AND logic and splits
-- hyphenated names like "WI-Advisor" into 'wi' & 'advisor' (two separate tokens),
-- which never matches the stored lexeme 'wiadvisor' (single token).
-- Result: natural language queries return 0 FTS matches.
--
-- Fix: strip hyphens from each word (merging "WI-Advisor" → "WIAdvisor"),
-- filter out short stop-words (≤ 3 chars), then OR-join remaining terms.
-- This turns "What have we spent on WI-Advisor since August 2025?" into
-- to_tsquery('english', 'spent | wiadvisor | since | august | 2025')
-- which correctly matches chunks containing 'wiadvisor'.

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
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  tsq   tsquery;
  terms text;
BEGIN
  -- Strip hyphens/punctuation from each word, filter short words, OR-join
  SELECT string_agg(lower(word), ' | ')
  INTO   terms
  FROM (
    SELECT regexp_replace(w, '[^a-zA-Z0-9]', '', 'g') AS word
    FROM   regexp_split_to_table(search_query, '\s+') AS t(w)
  ) cleaned
  WHERE  length(word) > 3;

  IF terms IS NULL OR terms = '' THEN
    RETURN;
  END IF;

  -- Build tsquery — catch any exception from invalid token strings
  BEGIN
    tsq := to_tsquery('english', terms);
  EXCEPTION WHEN OTHERS THEN
    RETURN;
  END;

  RETURN QUERY
  SELECT
    dc.id,
    dc.text,
    jsonb_build_object(
      'source_file',       dc.source_file,
      'onedrive_file_id',  dc.onedrive_file_id,
      'folder_path',       dc.folder_path,
      'chunk_index',       dc.chunk_index,
      'total_chunks',      dc.total_chunks,
      'last_modified',     dc.last_modified,
      'web_url',           dc.web_url
    ) AS metadata,
    ts_rank(dc.fts, tsq)::float AS score
  FROM   document_chunks dc
  WHERE  dc.fts @@ tsq
  ORDER  BY score DESC
  LIMIT  match_count;
END;
$$;
