import { CHUNK_SIZE } from "../consts";
import type { Generator } from "../gen/pkg.web/gen";

export class Chunk {
  private _chunk_x: number;
  private _chunk_y: number;

  /**
   * The type of each cell. Values are one of CELL_RESULTS.*.
   *
   * This array must not be modified.
   */
  cell_type: Uint8Array;

  /**
   * Cache of neighbour bomb count.
   *
   * This array must not be modified.
   */
  neighbouring_bombs_count: Uint8Array;

  /**
   * State of the cell. A bit-combination of CELL_STATES.
   */
  cell_state: Uint8Array;

  private constructor(chunk_x: number, chunk_y: number) {
    this._chunk_x = chunk_x;
    this._chunk_y = chunk_y;
    this.cell_type = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
    this.neighbouring_bombs_count = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
    this.cell_state = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
  }

  static fromGenerator(g: Generator, chunk_x: number, chunk_y: number): Chunk {
    let c = new Chunk(chunk_x, chunk_y);
    g.genChunk(chunk_x, chunk_y, c.cell_type, c.neighbouring_bombs_count);
    return c;
  }

  get chunk_x() {
    return this._chunk_x;
  }
  get chunk_y() {
    return this._chunk_y;
  }
  get top_left() {
    return [this.chunk_x * CHUNK_SIZE, this.chunk_y * CHUNK_SIZE];
  }

  /**
   * Get the array index of a cell in this chunk. x and y needs to be between 0 and CHUNK_SIZE-1.
   */
  cell_index_at(x: number, y: number) {
    return y * CHUNK_SIZE + x;
  }
}
