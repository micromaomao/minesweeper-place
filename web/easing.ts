export function factor_ease(current: number, target: number, min_speed: number, max_speed: number, factor: number, dt: number): number {
  let min_off = dt * min_speed;
  let max_off = dt * max_speed;
  let diff = Math.abs(current - target);
  if (diff < min_off) {
    return target;
  }
  let off = diff * factor * dt;
  if (off < min_off) {
    off = min_off;
  }
  if (off > max_off) {
    off = max_off;
  }
  return current + Math.sign(target - current) * off;
}
