// Anonymous usage counting with GoatCounter (https://www.goatcounter.com): page views plus a
// handful of named events, so we can see how many people play and which features they use.
// GoatCounter sets no cookies and stores no personal data. The simulation engine never imports
// this file; it is UI only.
//
// To turn it on, create a free GoatCounter site and put its code below (the "xyz" in
// xyz.goatcounter.com). While the code is empty, nothing is loaded and nothing is sent.

const GOATCOUNTER_CODE = '';

const COUNT_SCRIPT = 'https://gc.zgo.at/count.js';

interface GoatCounter {
  count?: (vars: { path: string; title?: string; event?: boolean }) => void;
}

/** True only on a real hosted page: not file://, not localhost, and not when the visitor sent Do Not Track. */
function enabled(): boolean {
  if (!GOATCOUNTER_CODE) return false;
  try {
    if (location.protocol !== 'https:') return false;
    const h = location.hostname;
    if (h === 'localhost' || h === '127.0.0.1' || h.endsWith('.local')) return false;
    if (navigator.doNotTrack === '1') return false;
    return true;
  } catch {
    return false;
  }
}

/** Load the counter (this also records the page view). Call once at start-up. */
export function initAnalytics(): void {
  if (!enabled()) return;
  try {
    const s = document.createElement('script');
    s.async = true;
    s.src = COUNT_SCRIPT;
    s.dataset.goatcounter = `https://${GOATCOUNTER_CODE}.goatcounter.com/count`;
    document.head.append(s);
  } catch {
    // Analytics must never break the game.
  }
}

/** Record a named event, for example `start/vabb/approach/standard`. Never throws. */
export function track(event: string): void {
  if (!enabled()) return;
  try {
    const gc = (window as unknown as { goatcounter?: GoatCounter }).goatcounter;
    // The script may still be loading; skip the event rather than queue it.
    gc?.count?.({ path: event, title: event, event: true });
  } catch {
    // ignore
  }
}

/** Bucket a number so the dashboard shows a few readable rows instead of one row per value. */
export function bucket(value: number, edges: number[]): string {
  let lo = -Infinity;
  for (const hi of edges) {
    if (value < hi) return lo === -Infinity ? `under-${hi}` : `${lo}-${hi}`;
    lo = hi;
  }
  return `${lo}-plus`;
}

/** Minutes played, bucketed. */
export function minutesBucket(ms: number): string {
  const b = bucket(ms / 60_000, [1, 5, 15, 30, 60]);
  return b.endsWith('-plus') ? `${b.slice(0, -5)}min-plus` : `${b}min`;
}

/** Score, bucketed. */
export function scoreBucket(score: number): string {
  return bucket(score, [0, 50, 100, 200, 400]);
}
