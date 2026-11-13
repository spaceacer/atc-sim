// Flat-plane geometry helpers. Headings: 0 = north, clockwise, degrees.

const DEG = Math.PI / 180;

/** Feet per nautical mile. */
export const FT_PER_NM = 6076.12;

/** Normalise a heading to the range (0, 360]. 0 becomes 360, like ATC usage. */
export function normHeading(h: number): number {
  let r = h % 360;
  if (r <= 0) r += 360;
  return r;
}

/** Signed smallest difference to - from, in (-180, 180]. Positive = turn right. */
export function headingDiff(from: number, to: number): number {
  let d = (to - from) % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

/** Bearing from (x1, y1) to (x2, y2). */
export function bearing(x1: number, y1: number, x2: number, y2: number): number {
  return normHeading(Math.atan2(x2 - x1, y2 - y1) / DEG);
}

export function distance(x1: number, y1: number, x2: number, y2: number): number {
  return Math.hypot(x2 - x1, y2 - y1);
}

/** Unit vector components (east, north) for a heading. */
export function headingVector(h: number): { dx: number; dy: number } {
  return { dx: Math.sin(h * DEG), dy: Math.cos(h * DEG) };
}

/**
 * Position relative to a runway's extended centreline.
 *  alongTrack: nm before the threshold along the approach (positive = on approach side)
 *  crossTrack: nm right (+) / left (-) of the centreline as seen by a landing aircraft
 */
export function runwayRelative(
  x: number,
  y: number,
  thresholdX: number,
  thresholdY: number,
  runwayHeading: number,
): { alongTrack: number; crossTrack: number } {
  const { dx, dy } = headingVector(runwayHeading);
  const rx = x - thresholdX;
  const ry = y - thresholdY;
  // Landing direction is (dx, dy). Points on approach are "behind" the threshold.
  const alongTrack = -(rx * dx + ry * dy);
  // Right of track for direction (dx, dy) is (dy, -dx).
  const crossTrack = rx * dy - ry * dx;
  return { alongTrack, crossTrack };
}
