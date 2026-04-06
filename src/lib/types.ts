export interface DriveItemChange {
  id: string;
  name: string;
  parentPath: string;
  lastModifiedDateTime: string;
  size: number;
  deleted: boolean;
  isFile: boolean;
  webUrl: string;
}

export interface DeltaResponse {
  items: DriveItemChange[];
  deltaToken: string;
}

export interface ChunkRecord {
  id: string;
  text: string;
  metadata: {
    source_file: string;
    onedrive_file_id: string;
    folder_path: string;
    chunk_index: number;
    total_chunks: number;
    last_modified: string;
    web_url: string;
  };
}

export interface EmbeddedChunk extends ChunkRecord {
  embedding: number[];
}

// === Query Types ===

export interface QueryRequest {
  question: string;
  chatId?: string; // Telegram chat ID — if set, task sends reply directly
}

export interface QueryMatch {
  id: string;
  score: number;
  text: string;
  metadata: Record<string, any>;
}

export interface QueryResponse {
  answer: string;
  sources: QueryMatch[];
}
