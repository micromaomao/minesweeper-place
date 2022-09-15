import { CHUNK_SIZE } from "../consts";
import { Generator } from "../gen/pkg.web/gen";
import { Chunk } from "./chunk";

export interface Bounds {
  x1: number, y1: number, x2: number, y2: number
}

export class ChunkManager {
  generator: Generator;
  loaded_chunks: Map<string, Chunk>;
  loading_queue: Map<string, Promise<Chunk>>;

  constructor(generator: Generator) {
    this.generator = generator;
    this.loaded_chunks = new Map();
    this.loading_queue = new Map();
  }

  private chunk_key(chunk_x: number, chunk_y: number) {
    return `${chunk_x},${chunk_y}`;
  }

  load(chunk_x: number, chunk_y: number): Promise<Chunk> {
    const key = this.chunk_key(chunk_x, chunk_y);
    let existing_chunk = this.loaded_chunks.get(key);
    if (existing_chunk) {
      return Promise.resolve(existing_chunk);
    }
    let existing_p = this.loading_queue.get(key);
    if (existing_p) {
      return existing_p;
    }
    let p = this._load_chunk(chunk_x, chunk_y).then(chunk => {
      if (this.loading_queue.has(key)) {
        this.loading_queue.delete(key);
      }
      this.loaded_chunks.set(key, chunk);
      return Promise.resolve(chunk);
    });
    this.loading_queue.set(key, p);
    return p;
  }

  private async _load_chunk(chunk_x: number, chunk_y: number): Promise<Chunk> {
    return Chunk.fromGenerator(this.generator, chunk_x, chunk_y);
  }

  unload(chunk_x: number, chunk_y: number) {
    let key = this.chunk_key(chunk_x, chunk_y);
    this._unload(key);
  }

  private _unload(chunk_key: string) {
    this.loaded_chunks.delete(chunk_key);
  }

  worldRectToChunkBounds(world_rect: Bounds): Bounds {
    let { x1, x2, y1, y2 } = world_rect;
    return {
      x1: Math.floor(x1 / CHUNK_SIZE),
      y1: Math.floor(y1 / CHUNK_SIZE),
      x2: Math.ceil(x2 / CHUNK_SIZE),
      y2: Math.ceil(y2 / CHUNK_SIZE)
    };
  }

  ensureChunksIn(chunk_bounds: Bounds) {
    for (let cy = chunk_bounds.y1; cy < chunk_bounds.y2; cy += 1) {
      for (let cx = chunk_bounds.x1; cx < chunk_bounds.x2; cx += 1) {
        this.load(cx, cy);
      }
    }
  }

  unloadOutside(chunk_bounds: Bounds) {
    let to_delete = new Set<string>();
    for (let key of this.loaded_chunks.keys()) {
      let [xstr, ystr] = key.split(",");
      let x = parseInt(xstr);
      let y = parseInt(ystr);
      if (x < chunk_bounds.x1 || x >= chunk_bounds.x2 || y < chunk_bounds.y1 || y >= chunk_bounds.y2) {
        to_delete.add(key);
      }
    }
    for (let k of to_delete) {
      this._unload(k);
    }
  }

  hasLoading() {
    return this.loading_queue.size > 0;
  }

  /**
   * Get a loaded chunk. Will return undefined if not loaded.
   */
  getChunk(chunk_x: number, chunk_y: number): Chunk | undefined {
    let key = this.chunk_key(chunk_x, chunk_y);
    let chunk = this.loaded_chunks.get(key);
    return chunk;
  }

  /**
   * Like getChunk, but takes a block coordinate and get the chunk containing it, as well as returning an index.
   */
  getChunkOfBlock(x: number, y: number): [Chunk, number] | undefined {
    let cx = Math.floor(x / CHUNK_SIZE);
    let cy = Math.floor(y / CHUNK_SIZE);
    let c = this.getChunk(cx, cy);
    if (!c) {
      return undefined;
    }
    let idx = c.cell_index_at(x - cx * CHUNK_SIZE, y - cy * CHUNK_SIZE);
    return [c, idx];
  }
}
