use js_sys::Uint8Array;
use noise::NoiseFn;
use noise::Perlin;
use noise::Seedable;
use rand_core::RngCore;
use rand_pcg::Pcg32;
use wasm_bindgen::prelude::*;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum CellResult {
  Open = 0,
  Normal = 1,
  Bomb = 2,
}

/// A chunk is this much in x and this much in y
pub const CHUNK_SIZE: i32 = 16;

// Use an irrational number to prevent artifact caused by the fact that perlin is always 0 at integer points.
const NOISE_SCALE: f64 = std::f64::consts::PI / 50.0;

#[wasm_bindgen(inspectable)]
pub struct Generator {
  seed: u32,
  perlin: Perlin,
}

impl Generator {
  fn gen_cell(&self, x: i32, y: i32) -> CellResult {
    let fx = x as f64 * NOISE_SCALE;
    let fy = y as f64 * NOISE_SCALE;
    let bomb_ness = self.perlin.get([fx, fy]).abs();
    let mut rvalue = Pcg32::new(
      (u64::from(x as u32) << 32) + u64::from(y as u32),
      0x784df1818e1dd6c8,
    )
    .next_u32() as f64;
    rvalue /= u32::MAX as f64;
    if bomb_ness < 0.15 {
      CellResult::Open
    } else if (0.40..0.53).contains(&bomb_ness) {
      if rvalue < 0.6 {
        CellResult::Bomb
      } else {
        CellResult::Normal
      }
    } else if bomb_ness > 0.60 {
      let mut p = (bomb_ness - 0.6) / (1.0 - 0.6);
      p = p.min(0.4);
      if rvalue < p {
        CellResult::Bomb
      } else {
        CellResult::Normal
      }
    } else {
      CellResult::Normal
    }
  }

  pub fn gen_chunk(&self, chunk_x: i32, chunk_y: i32) -> (Vec<CellResult>, Vec<u8>) {
    let mut cell_result_with_outline =
      vec![CellResult::Open; ((CHUNK_SIZE + 2) * (CHUNK_SIZE + 2)) as usize];
    for y in 0..(CHUNK_SIZE + 2) {
      for x in 0..(CHUNK_SIZE + 2) {
        let cell_x = chunk_x * CHUNK_SIZE - 1 + x;
        let cell_y = chunk_y * CHUNK_SIZE - 1 + y;
        cell_result_with_outline[(y * (CHUNK_SIZE + 2) + x) as usize] =
          self.gen_cell(cell_x, cell_y);
      }
    }
    let mut output_cr = vec![CellResult::Open; (CHUNK_SIZE * CHUNK_SIZE) as usize];
    let mut bomb_counts = vec![0u8; (CHUNK_SIZE * CHUNK_SIZE) as usize];
    for y in 0..CHUNK_SIZE {
      for x in 0..CHUNK_SIZE {
        let cell_result = &mut output_cr[(y * CHUNK_SIZE + x) as usize];
        *cell_result = cell_result_with_outline[((y + 1) * (CHUNK_SIZE + 2) + x + 1) as usize];
        let bomb_count = &mut bomb_counts[(y * CHUNK_SIZE + x) as usize];
        for yoff in -1..=1 {
          for xoff in -1..=1 {
            if cell_result_with_outline
              [((y + 1 + yoff) * (CHUNK_SIZE + 2) + (x + 1 + xoff)) as usize]
              == CellResult::Bomb
            {
              *bomb_count += 1;
            }
          }
        }
        if *bomb_count > 0 && *cell_result == CellResult::Open {
          *cell_result = CellResult::Normal;
        }
      }
    }
    (output_cr, bomb_counts)
  }
}

#[wasm_bindgen]
impl Generator {
  #[wasm_bindgen(constructor)]
  pub fn new_from_seed(seed: u32) -> Self {
    Generator {
      seed,
      perlin: Perlin::new().set_seed(seed),
    }
  }

  #[wasm_bindgen(getter)]
  pub fn seed(&self) -> u32 {
    self.seed
  }

  #[wasm_bindgen(js_name = "genChunk")]
  #[doc(hidden)]
  pub fn gen_chunk_wasm(&self, cx: i32, cy: i32, cr_buf: &Uint8Array, neigh_buf: &Uint8Array) {
    let (cr, neigh) = self.gen_chunk(cx, cy);
    let cr = cr.into_iter().map(|x| x as u8).collect::<Vec<_>>();
    cr_buf.copy_from(&cr);
    neigh_buf.copy_from(&neigh);
  }
}
