export interface DriveItemChange {
  id: string;
  name: string;
  parentPath: string;
  lastModifiedDateTime: string;
  size: number;
  deleted: boolean;
  isFile: boolean;
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
  };
}

export interface EmbeddedChunk extends ChunkRecord {
  embedding: number[];
}
