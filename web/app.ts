import init_wasm, { Generator } from "../gen/pkg.web/gen";
import { CELL_RESULTS, CELL_STATES, CHUNK_SIZE, MAP_SEED } from "../consts";
import { Chunk } from "./chunk";
import { Bounds, ChunkManager } from "./chunk_manager";
import { factor_ease } from "./easing";
import { Player } from "./player";

async function init() {
  let main_canvas: HTMLCanvasElement = document.createElement("canvas");
  let loading = document.getElementsByClassName("loading")[0];
  loading.textContent = "Preparing wasm\u2026";
  await init_wasm();
  loading.textContent = "Initializing map\u2026";
  document.body.appendChild(main_canvas);

  let app = new MinesweeperApp(main_canvas, () => {
    loading.remove();
  });

  function handle_resize() {
    main_canvas.width = window.innerWidth * window.devicePixelRatio;
    main_canvas.height = window.innerHeight * window.devicePixelRatio;
    window.scrollTo(0, 0);
    app.handleResize();
  }

  handle_resize();
  window.addEventListener("resize", handle_resize);
}

if (document.readyState !== "complete") {
  document.addEventListener("readystatechange", () => {
    if (document.readyState === "complete") {
      init();
    }
  });
} else {
  init();
}

class MinesweeperApp {
  canvas: HTMLCanvasElement;
  generator: Generator;
  chunk_manager: ChunkManager;
  center_pos: [number, number];
  client_player: Player;
  scale: number;
  last_update_time: number;
  current_update_time: number;
  on_init_complete: (() => void) | null;
  draw_context: CanvasRenderingContext2D;
  gui_scale: number;
  visible_world_rect: Bounds;
  players: Player[];
  mouse_sensitivity_inv: number;
  cursor_at_world: [number, number];
  clicking_block: [number, number] | null;
  open_nearby_cells_queue: [number, number][];
  last_nearby_cell_auto_open_time: number;

  constructor(canvas: HTMLCanvasElement, on_init_complete: (() => void) | null = null) {
    this.canvas = canvas;
    this.generator = new Generator(MAP_SEED);
    this.chunk_manager = new ChunkManager(this.generator);
    this.client_player = new Player();
    this.center_pos = this.client_player.targeted_block.map(x => x + 0.5) as [number, number];
    this.scale = this.getDefaultScale();
    this.last_update_time = Date.now();
    this.on_init_complete = on_init_complete;
    this.draw_context = canvas.getContext("2d")!;
    this.gui_scale = this.scale / 32;
    this.players = [this.client_player];
    this.cursor_at_world = [0.5, 0.5];
    this.mouse_sensitivity_inv = this.scale * 1.8;
    this.clicking_block = null;
    this.open_nearby_cells_queue = [];
    this.last_nearby_cell_auto_open_time = Date.now();

    this.update = this.update.bind(this);
    this.update();

    this.handleMouseDown = this.handleMouseDown.bind(this);
    this.handleMouseMove = this.handleMouseMove.bind(this);
    this.handleMouseUp = this.handleMouseUp.bind(this);
    this.handleTouchStart = this.handleTouchStart.bind(this);
    this.handleTouchMove = this.handleTouchMove.bind(this);
    this.handleTouchEnd = this.handleTouchEnd.bind(this);
    this.handleWheel = this.handleWheel.bind(this);
    canvas.addEventListener("mousedown", this.handleMouseDown);
    canvas.addEventListener("mousemove", this.handleMouseMove);
    canvas.addEventListener("mouseup", this.handleMouseUp);
    canvas.addEventListener("contextmenu", evt => evt.preventDefault());
    canvas.addEventListener("touchstart", this.handleTouchStart);
    canvas.addEventListener("wheel", this.handleWheel);
    canvas.addEventListener("pointerlockerror", evt => {
      alert("Pointer lock is not supported on your browser. Please use an alternative browser to play this game.");
    });

    this.animateOpenNearbyCells(...this.client_player.targeted_block);
  }

  getDefaultScale() {
    let smallest_axis = Math.min(window.innerWidth, window.innerHeight);
    let target_nb_blocks = 15;
    if (window.innerWidth > 800 && window.innerHeight > 800) {
      target_nb_blocks = 30;
    }
    let pix_per_block = smallest_axis / target_nb_blocks;
    return pix_per_block * window.devicePixelRatio;
  }

  handleResize() {
  }

  get deltaT() {
    return (this.current_update_time - this.last_update_time) / 1000;
  }

  update() {
    this.current_update_time = Date.now();
    let old_player_pos = this.client_player.targeted_block.slice();
    this.client_player.targeted_block = this.cursor_at_world.map(x => Math.floor(x)) as [number, number];
    if (old_player_pos[0] != this.client_player.targeted_block[0] || old_player_pos[1] != this.client_player.targeted_block[1]) {
      this.animateOpenNearbyCells(...this.client_player.targeted_block);
    }
    this.center_pos = this.center_pos.map((curr, i) => {
      let target = this.client_player.targeted_block[i] + 0.5;
      return factor_ease(curr, target, 1, Infinity, 6, this.deltaT);
    }) as [number, number];
    this.visible_world_rect = this.getVisibleWorldRectFromCenter(this.center_pos);
    this.ensureRegion();
    if (!this.chunk_manager.hasLoading() && this.on_init_complete) {
      this.on_init_complete();
      this.on_init_complete = null;
    }
    if (this.last_nearby_cell_auto_open_time < this.current_update_time - 10) {
      this.iterOpenNearbyCells();
      this.last_nearby_cell_auto_open_time = this.current_update_time;
    }
    this.draw();
    this.last_update_time = this.current_update_time;
    requestAnimationFrame(this.update);
  }

  getVisibleWorldRectFromCenter(center: [number, number]): Bounds {
    let width = this.canvas.width;
    let height = this.canvas.height;
    let blocks_per_screen_pixel = 1 / this.scale;
    let width_blocks = (width / 2) * blocks_per_screen_pixel;
    let height_blocks = (height / 2) * blocks_per_screen_pixel;
    return {
      x1: center[0] - width_blocks,
      x2: center[0] + width_blocks,
      y1: center[1] - height_blocks,
      y2: center[1] + height_blocks
    };
  }

  ensureRegion() {
    let player_bounds = this.chunk_manager.worldRectToChunkBounds(this.getVisibleWorldRectFromCenter(this.client_player.targeted_block.map(x => x + 0.5) as [number, number]));
    let visible_bounds = this.chunk_manager.worldRectToChunkBounds(this.visible_world_rect);
    let union_bounds: Bounds = {
      x1: Math.min(player_bounds.x1, visible_bounds.x1),
      x2: Math.max(player_bounds.x2, visible_bounds.x2),
      y1: Math.min(player_bounds.y1, visible_bounds.y1),
      y2: Math.max(player_bounds.y2, visible_bounds.y2)
    };
    // TODO: enable when multi-server ready
    // this.chunk_manager.unloadOutside(union_bounds);
    this.chunk_manager.ensureChunksIn(player_bounds);
  }

  worldToScreen(x: number, y: number): [number, number] {
    let x1 = (x - this.center_pos[0]) * this.scale + this.canvas.width / 2;
    let y1 = (y - this.center_pos[1]) * this.scale + this.canvas.height / 2;
    return [x1, y1];
  }

  draw() {
    let ctx = this.draw_context;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    for (let chunk of this.chunk_manager.loaded_chunks.values()) {
      this.drawChunk(chunk);
    }
    if (this.clicking_block) {
      let [x, y] = this.worldToScreen(...this.clicking_block);
      ctx.fillStyle = "#000";
      ctx.globalAlpha = 0.3;
      ctx.fillRect(x, y, this.scale, this.scale);
      this, ctx.globalAlpha = 1;
    }
    for (let p of this.players) {
      if (p != this.client_player) {
        this.drawPlayer(p);
      }
    }
    this.drawPlayer(this.client_player);
    // cursor
    ctx.fillStyle = "#000";
    let dot_width = Math.max(this.gui_scale * 2, 2);
    let cursor_coord = this.worldToScreen(...this.cursor_at_world);
    ctx.fillRect(cursor_coord[0] - dot_width / 2, cursor_coord[1] - dot_width / 2, dot_width, dot_width);
  }

  drawChunk(chunk: Chunk) {
    let ctx = this.draw_context;
    let chunk_top_left = chunk.top_left;
    if (chunk_top_left[0] + CHUNK_SIZE < this.visible_world_rect.x1 || chunk_top_left[0] >= this.visible_world_rect.x2 ||
      chunk_top_left[1] + CHUNK_SIZE < this.visible_world_rect.y1 || chunk_top_left[1] >= this.visible_world_rect.y2) {
      return;
    }
    for (let y = 0; y < CHUNK_SIZE; y += 1) {
      for (let x = 0; x < CHUNK_SIZE; x += 1) {
        let idx = chunk.cell_index_at(x, y);
        if (chunk.cell_type[idx] == CELL_RESULTS.Open) {
          continue;
        }
        let [sx, sy] = this.worldToScreen(chunk_top_left[0] + x, chunk_top_left[1] + y);
        let [sw, sh] = [this.scale, this.scale];
        if (!(chunk.cell_state[idx] & CELL_STATES.Clicked) && chunk.cell_type[idx] != CELL_RESULTS.Open) {
          // border
          ctx.fillStyle = "#979797";
          ctx.fillRect(sx, sy, sw, sh);
          // inner
          const border = this.gui_scale;
          ctx.fillStyle = "#eeeeee";
          ctx.fillRect(sx + border, sy + border, sw - border * 2, sh - border * 2);
          if (chunk.cell_state[idx] & CELL_STATES.Flagged) {
            ctx.fillStyle = "red";
            ctx.font = `${this.gui_scale * 20}px monospace`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText("F", sx + sw / 2, sy + sh / 2 + this.gui_scale * 2, sw);
          }
        } else if (chunk.cell_type[idx] == CELL_RESULTS.Normal) {
          // number
          let b_count = chunk.neighbouring_bombs_count[idx];
          if (b_count > 0) {
            // TODO: colors
            ctx.fillStyle = "#000";
            ctx.font = `${this.gui_scale * 20}px monospace`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(b_count.toString(), sx + sw / 2, sy + sh / 2 + this.gui_scale * 2, sw);
          }
        } else if (chunk.cell_type[idx] == CELL_RESULTS.Bomb) {
          ctx.fillStyle = "red";
          ctx.font = `${this.gui_scale * 20}px monospace`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText("!", sx + sw / 2, sy + sh / 2 + this.gui_scale * 2, sw);
        }
      }
    }
  }

  drawPlayer(player: Player) {
    let ctx = this.draw_context;
    let is_us = player === this.client_player;
    let [block_x, block_y] = player.targeted_block;
    let in_view = block_x >= this.visible_world_rect.x1 && block_x < this.visible_world_rect.x2 && block_y >= this.visible_world_rect.y1 && block_y < this.visible_world_rect.y2;
    if (in_view) {
      ctx.strokeStyle = "#28ff49"; // TODO: randomize
      ctx.lineWidth = this.gui_scale * 3;
      let rect_coord = this.worldToScreen(block_x, block_y);
      ctx.strokeRect(...rect_coord, this.scale, this.scale);
    }
  }

  handleMouseDown(evt: MouseEvent) {
    evt.preventDefault();
    if (document.pointerLockElement !== this.canvas) {
      this.canvas.requestPointerLock();
    } else {
      if (evt.button == 0 || evt.button == 1) {
        this.actionBeginClick();
      } else if (evt.button == 2) {
        this.actionFlag(...this.client_player.targeted_block);
      }
    }
  }

  handleMouseMove(evt: MouseEvent) {
    evt.preventDefault();
    if (document.pointerLockElement !== this.canvas) {
      return;
    }
    this.actionMove(evt.movementX, evt.movementY);
  }

  handleMouseUp(evt: MouseEvent) {
    evt.preventDefault();
    let current_target = this.client_player.targeted_block;
    if (this.clicking_block) {
      if (this.clicking_block[0] === current_target[0] && this.clicking_block[1] === current_target[1]) {
        this.actionClick(...this.clicking_block);
      }
      this.clicking_block = null;
    }
  }

  handleTouchStart(evt: TouchEvent) {
    evt.preventDefault();
    document.addEventListener("touchmove", this.handleTouchMove);
    document.addEventListener("touchend", this.handleTouchEnd);
  }

  handleTouchMove(evt: TouchEvent) {
    evt.preventDefault();
    // TODO
  }

  handleTouchEnd(evt: TouchEvent) {
    evt.preventDefault();
    document.removeEventListener("touchmove", this.handleTouchMove);
    document.removeEventListener("touchend", this.handleTouchEnd);
  }

  handleWheel(evt: WheelEvent) {
    let d_scale = -Math.sign(evt.deltaY) * 0.2;
    this.scale *= 1 + d_scale;
    if (this.scale < 20) {
      this.scale = 20;
    }
    if (this.scale > window.innerWidth / 10) {
      this.scale = window.innerWidth / 10;
    }
    this.gui_scale = this.scale / 32;
  }

  actionMove(dx: number, dy: number) {
    dx = Math.sign(dx) * Math.max(Math.pow(Math.abs(dx), 1.1), dx);
    dy = Math.sign(dy) * Math.max(Math.pow(Math.abs(dy), 1.1), dy);
    this.cursor_at_world[0] += dx / this.scale;
    this.cursor_at_world[1] += dy / this.scale;
  }

  isClickable(c: Chunk, idx: number) {
    return !(c.cell_state[idx] & CELL_STATES.Clicked) && !(c.cell_state[idx] & CELL_STATES.Flagged) && c.cell_type[idx] != CELL_RESULTS.Open;
  }

  isFlaggable(c: Chunk, idx: number) {
    return (c.cell_state[idx] & CELL_STATES.Flagged) || this.isClickable(c, idx);
  }

  computeAutoClickTargets(block_x: number, block_y: number): [number, number][] {
    let cidx = this.chunk_manager.getChunkOfBlock(block_x, block_y);
    if (!cidx) {
      return [];
    }
    let [c, idx] = cidx;
    if (!(c.cell_state[idx] & CELL_STATES.Clicked) || c.cell_type[idx] != CELL_RESULTS.Normal) {
      return [];
    }
    let bomb_count = c.neighbouring_bombs_count[idx];
    let targets: [number, number][] = [];
    let found_bombs_count = 0;
    for (let off_y = -1; off_y <= 1; off_y += 1) {
      for (let off_x = -1; off_x <= 1; off_x += 1) {
        if (off_y == 0 && off_x == 0) {
          continue;
        }
        cidx = this.chunk_manager.getChunkOfBlock(block_x + off_x, block_y + off_y);
        if (!cidx) {
          return [];
        }
        [c, idx] = cidx;
        if ((c.cell_state[idx] & CELL_STATES.Flagged) || ((c.cell_state[idx] & CELL_STATES.Clicked) && c.cell_type[idx] == CELL_RESULTS.Bomb)) {
          // Either user suspected this is a bomb, or this is a bomb that has been revealed.
          // Either way, we count it.
          found_bombs_count += 1;
        } else if (!(c.cell_state[idx] & CELL_STATES.Clicked) && c.cell_type[idx] != CELL_RESULTS.Open) {
          // A click candidate
          targets.push([block_x + off_x, block_y + off_y]);
        }
      }
    }
    if (found_bombs_count == bomb_count) {
      return targets;
    } else {
      return [];
    }
  }

  actionBeginClick() {
    let pos = this.client_player.targeted_block.slice() as [number, number];
    let cidx = this.chunk_manager.getChunkOfBlock(...pos);
    if (!cidx) {
      return;
    }
    let [c, idx] = cidx;
    if (this.isClickable(c, idx) || this.computeAutoClickTargets(...pos).length > 0) {
      this.clicking_block = pos;
    }
  }

  actionClick(block_x: number, block_y: number): boolean {
    let cidx = this.chunk_manager.getChunkOfBlock(block_x, block_y);
    if (!cidx) {
      return false;
    }
    let [c, idx] = cidx;
    if (c.cell_state[idx] & CELL_STATES.Flagged) {
      return false;
    }
    if (this.isClickable(c, idx)) {
      this.clicking_block = null;
      c.cell_state[idx] |= CELL_STATES.Clicked;
      return true;
    }
    let targets = this.computeAutoClickTargets(block_x, block_y);
    if (targets.length > 0) {
      for (let [x, y] of targets) {
        this.actionClick(x, y);
      }
      return true;
    }
    return false;
  }

  actionFlag(block_x: number, block_y: number) {
    let cidx = this.chunk_manager.getChunkOfBlock(block_x, block_y);
    if (!cidx) {
      return;
    }
    let [c, idx] = cidx;
    if (this.isFlaggable(c, idx)) {
      c.cell_state[idx] ^= CELL_STATES.Flagged;
    }
  }

  iterOpenNearbyCells() {
    let new_nexts: [number, number][] = [];
    for (let n of this.open_nearby_cells_queue) {
      new_nexts.push(...this._tryOpenNearbyCellsSingle(...n));
    }
    this.open_nearby_cells_queue = new_nexts;
  }

  animateOpenNearbyCells(target_x: number, target_y: number) {
    this.open_nearby_cells_queue.push([target_x, target_y]);
  }

  _tryOpenNearbyCellsSingle(target_x: number, target_y: number): [number, number][] {
    let cidx = this.chunk_manager.getChunkOfBlock(target_x, target_y);
    if (!cidx) {
      return [];
    }
    let [c, idx] = cidx;
    let nexts: [number, number][] = [];
    if (((c.cell_state[idx] & CELL_STATES.Clicked) || (c.cell_type[idx] === CELL_RESULTS.Open)) && c.neighbouring_bombs_count[idx] === 0) {
      for (let yoff = -1; yoff <= 1; yoff += 1) {
        for (let xoff = -1; xoff <= 1; xoff += 1) {
          if (xoff == 0 && yoff == 0) {
            continue;
          }
          let bx = target_x + xoff;
          let by = target_y + yoff;
          cidx = this.chunk_manager.getChunkOfBlock(bx, by);
          if (!cidx) {
            continue;
          }
          [c, idx] = cidx;
          if (c.cell_type[idx] == CELL_RESULTS.Normal && !(c.cell_state[idx] & (CELL_STATES.Flagged | CELL_STATES.Clicked))) {
            this.actionClick(bx, by);
            nexts.push([bx, by]);
          }
        }
      }
    }
    return nexts;
  }

}
