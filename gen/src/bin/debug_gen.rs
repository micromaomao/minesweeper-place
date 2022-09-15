use gen::{CellResult, Generator, CHUNK_SIZE};
use std::fmt::Write;
fn main() {
  let g = Generator::new_from_seed(1);
  let (cr, neigh) = g.gen_chunk(0, 0);
  dump_chunk(&cr, &neigh);
}

fn dump_chunk(cr: &[CellResult], neigh: &[u8]) {
  assert_eq!(cr.len(), (CHUNK_SIZE * CHUNK_SIZE) as usize);
  assert_eq!(neigh.len(), (CHUNK_SIZE * CHUNK_SIZE) as usize);
  let mut s = String::new();
  for y in 0..CHUNK_SIZE {
    for x in 0..CHUNK_SIZE {
      let idx = (y * CHUNK_SIZE + x) as usize;
      let cell = cr[idx];
      let neigh = neigh[idx];
      if cell == CellResult::Open {
        assert_eq!(neigh, 0);
      }
      match cell {
        CellResult::Normal => write!(&mut s, "{}", neigh),
        CellResult::Bomb => write!(&mut s, "!"),
        CellResult::Open => write!(&mut s, "."),
      }
      .unwrap();
    }
    write!(&mut s, "\n").unwrap();
  }
  print!("{}", &s);
}
