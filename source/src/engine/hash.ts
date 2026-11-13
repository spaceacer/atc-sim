// Deterministic 32-bit FNV-1a hash of the full state, for replay/determinism checks.

import type { SimState } from './types.js';

export function stateHash(state: SimState): string {
  const text = JSON.stringify(state);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
