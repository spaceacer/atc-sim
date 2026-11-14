// Colour and font themes. One compact spec per theme expands into the CSS
// custom properties the stylesheet reads and the two canvas palettes (radar
// and ground). Applying a theme is instant and needs no reload.
//
// Altitude trail colours are deliberately NOT themed: they encode data, so a
// given colour means the same height in every theme.

import { setRadarPalette } from './radar.js';
import { setGroundPalette } from './ground/view.js';

export type ThemeId = 'midnight' | 'green' | 'amber' | 'daylight';

interface Spec {
  id: ThemeId;
  name: string;
  blurb: string;
  fonts: { head: string; body: string; mono: string };
  /** Radar scope and its chrome. */
  scope: string;
  edge: string;
  line: string;
  text: string;
  dim: string;
  faint: string;
  /** Accent: selection, primary buttons, highlights. */
  accent: string;
  onAccent: string;
  arrival: string;
  departure: string;
  cleared: string;
  conflict: string;
  warning: string;
  runway: string;
  runwayIdle: string;
  centreline: string;
  boundary: string;
  grid: string;
  /** Side panel. */
  panel: string;
  panelLine: string;
  ink: string;
  inkQuiet: string;
  ok: string;
  warn: string;
  bad: string;
  /** Raised buttons and the selected strip. */
  solid: string;
  onSolid: string;
  solidDim: string;
  strips: { arr: string; arrBg: string; arrHover: string; dep: string; depBg: string; depHover: string };
  /** Main menu surfaces. */
  menuSide: string;
  menuField: string;
  menuLine: string;
  ground: { bg: string; grass: string; pavement: string; apron: string; runway: string; taxi: string };
  /** Swatches shown on the picker: background, accent, text. */
  swatch: [string, string, string];
  light: boolean;
}

const SPECS: readonly Spec[] = [
  {
    id: 'midnight',
    name: 'Midnight aviation',
    blurb: 'Deep navy with electric cyan. Space Grotesk and Inter.',
    fonts: { head: "'Space Grotesk'", body: "'Inter'", mono: "'JetBrains Mono'" },
    scope: '#0e1830',
    edge: '#0a1224',
    line: '#1f2f55',
    text: '#e6eef9',
    dim: '#8196b8',
    faint: '#4a5f86',
    accent: '#22d3ee',
    onAccent: '#04121a',
    arrival: '#a8e6c1',
    departure: '#fbbf24',
    cleared: '#93c5fd',
    conflict: '#ff6b81',
    warning: '#ff9f1c',
    runway: '#d0dbee',
    runwayIdle: '#5f7396',
    centreline: '#3b4f78',
    boundary: '#2a3d66',
    grid: '#16233f',
    panel: '#111c36',
    panelLine: '#1f2f55',
    ink: '#e6eef9',
    inkQuiet: '#8196b8',
    ok: '#4ade80',
    warn: '#fbbf24',
    bad: '#ff6b81',
    solid: '#1f2f55',
    onSolid: '#e6eef9',
    solidDim: '#a3b5d3',
    strips: { arr: '#38a9c9', arrBg: '#16254a', arrHover: '#1c2e5a', dep: '#fbbf24', depBg: '#2a2a33', depHover: '#34343f' },
    menuSide: '#0b142a',
    menuField: '#08101f',
    menuLine: 'rgba(255, 255, 255, 0.08)',
    ground: { bg: '#0a1224', grass: '#0e1830', pavement: '#27375c', apron: '#1f2d4f', runway: '#41547d', taxi: '#c9a227' },
    swatch: ['#0a1224', '#22d3ee', '#e6eef9'],
    light: false,
  },
  {
    id: 'green',
    name: 'Aviation green',
    blurb: 'Deep forest with aviation green. IBM Plex Sans and Inter.',
    fonts: { head: "'IBM Plex Sans'", body: "'Inter'", mono: "'JetBrains Mono'" },
    scope: '#0f2219',
    edge: '#0b1a14',
    line: '#1f4a38',
    text: '#d9f5e6',
    dim: '#7fa896',
    faint: '#4a7a64',
    accent: '#3ddc84',
    onAccent: '#06140d',
    arrival: '#9fd8bb',
    departure: '#f2c14e',
    cleared: '#7fd3ff',
    conflict: '#ff6b5b',
    warning: '#ff9f1c',
    runway: '#d3e8dc',
    runwayIdle: '#5f8a74',
    centreline: '#3d6b55',
    boundary: '#2a5a45',
    grid: '#143024',
    panel: '#112a20',
    panelLine: '#1f4a38',
    ink: '#d9f5e6',
    inkQuiet: '#7fa896',
    ok: '#3ddc84',
    warn: '#f2c14e',
    bad: '#ff6b5b',
    solid: '#1f4a38',
    onSolid: '#d9f5e6',
    solidDim: '#9fc4b2',
    strips: { arr: '#3b9c6c', arrBg: '#153527', arrHover: '#1b4130', dep: '#f2c14e', depBg: '#2f2d1a', depHover: '#3a3820' },
    menuSide: '#0b1a14',
    menuField: '#08140f',
    menuLine: 'rgba(255, 255, 255, 0.08)',
    ground: { bg: '#0b1a14', grass: '#0f2219', pavement: '#2a4a3b', apron: '#223d31', runway: '#46685a', taxi: '#c9a227' },
    swatch: ['#0b1a14', '#3ddc84', '#d9f5e6'],
    light: false,
  },
  {
    id: 'amber',
    name: 'Amber phosphor',
    blurb: 'Classic radar-scope amber on near-black. IBM Plex Mono throughout.',
    fonts: { head: "'IBM Plex Mono'", body: "'IBM Plex Mono'", mono: "'IBM Plex Mono'" },
    scope: '#1a1208',
    edge: '#120d05',
    line: '#3d2d10',
    text: '#ffe9bf',
    dim: '#a68a52',
    faint: '#6b5630',
    accent: '#ffb000',
    onAccent: '#1a1000',
    arrival: '#ffe29a',
    departure: '#7fd1ff',
    cleared: '#a8e6c1',
    conflict: '#ff6b4a',
    warning: '#ff9f1c',
    runway: '#f3dfae',
    runwayIdle: '#8a7340',
    centreline: '#5a4720',
    boundary: '#4a3a18',
    grid: '#261b0a',
    panel: '#1d1507',
    panelLine: '#3d2d10',
    ink: '#ffe9bf',
    inkQuiet: '#a68a52',
    ok: '#a8e06c',
    warn: '#ffb000',
    bad: '#ff6b4a',
    solid: '#3d2d10',
    onSolid: '#ffe9bf',
    solidDim: '#c4a768',
    strips: { arr: '#c9a227', arrBg: '#26190a', arrHover: '#30200c', dep: '#7fd1ff', depBg: '#1a1f22', depHover: '#222a2e' },
    menuSide: '#120d05',
    menuField: '#0c0903',
    menuLine: 'rgba(255, 224, 160, 0.1)',
    ground: { bg: '#120d05', grass: '#1a1208', pavement: '#33260f', apron: '#2b200c', runway: '#5a4720', taxi: '#c9a227' },
    swatch: ['#120d05', '#ffb000', '#ffe9bf'],
    light: false,
  },
  {
    id: 'daylight',
    name: 'Daylight tower',
    blurb: 'Light scope and panels for bright rooms. Manrope and Inter.',
    fonts: { head: "'Manrope'", body: "'Inter'", mono: "'JetBrains Mono'" },
    scope: '#f2f6f9',
    edge: '#e1e8ee',
    line: '#c3cfd8',
    text: '#14232e',
    dim: '#5b6e7c',
    faint: '#8a9aa6',
    accent: '#0b6fb8',
    onAccent: '#ffffff',
    arrival: '#1b7a4a',
    departure: '#b86e00',
    cleared: '#0b6fb8',
    conflict: '#c62828',
    warning: '#d97706',
    runway: '#44525c',
    runwayIdle: '#9aa8b2',
    centreline: '#b5c2cb',
    boundary: '#b7c4ce',
    grid: '#e3eaf0',
    panel: '#f7f9fb',
    panelLine: '#cfd8df',
    ink: '#14232e',
    inkQuiet: '#5b6e7c',
    ok: '#1b7a4a',
    warn: '#8a5a00',
    bad: '#c62828',
    solid: '#14232e',
    onSolid: '#ffffff',
    solidDim: '#c9d4da',
    strips: { arr: '#0b6fb8', arrBg: '#e6eff7', arrHover: '#dbe8f3', dep: '#b86e00', depBg: '#f7ecd9', depHover: '#f3e3c6' },
    menuSide: '#e1e8ee',
    menuField: '#ffffff',
    menuLine: 'rgba(0, 0, 0, 0.09)',
    ground: { bg: '#e6edf2', grass: '#e9f0ea', pavement: '#c9d3da', apron: '#d6dee4', runway: '#8f9ea8', taxi: '#a8800c' },
    swatch: ['#eef2f5', '#0b6fb8', '#14232e'],
    light: true,
  },
];

export const THEME_IDS: readonly ThemeId[] = SPECS.map((s) => s.id);
export const DEFAULT_THEME: ThemeId = 'midnight';

export interface ThemeInfo {
  id: ThemeId;
  name: string;
  /** One word for the menu picker. */
  short: string;
  blurb: string;
  swatch: [string, string, string];
}

const SHORT: Record<ThemeId, string> = { midnight: 'Midnight', green: 'Green', amber: 'Amber', daylight: 'Daylight' };
export const THEMES: readonly ThemeInfo[] = SPECS.map(({ id, name, blurb, swatch }) => ({ id, name, short: SHORT[id], blurb, swatch }));

export function isThemeId(v: unknown): v is ThemeId {
  return typeof v === 'string' && (THEME_IDS as readonly string[]).includes(v);
}

function specFor(id: ThemeId): Spec {
  return SPECS.find((s) => s.id === id) ?? SPECS[0];
}

/** Black or white overlay colour with the theme's scope colour and the given alpha. */
function veil(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** CSS custom properties for a theme (exported for tests). */
export function cssVarsFor(id: ThemeId): Record<string, string> {
  const t = specFor(id);
  const fallback = (f: string, generic: string) => `${f}, ${generic}`;
  return {
    '--scope': t.scope,
    '--scope-edge': t.edge,
    '--scope-line': t.line,
    '--scope-text': t.text,
    '--scope-dim': t.dim,
    '--scope-faint': t.faint,
    '--scope-veil': veil(t.edge, 0.88),
    '--backdrop': veil(t.light ? '#14232e' : '#000000', 0.55),
    '--bezel': t.panel,
    '--bezel-dark': t.panelLine,
    '--ink': t.ink,
    '--ink-quiet': t.inkQuiet,
    '--ok': t.ok,
    '--warn': t.warn,
    '--bad': t.bad,
    '--accent': t.accent,
    '--on-accent': t.onAccent,
    '--arrival': t.arrival,
    '--solid': t.solid,
    '--on-solid': t.onSolid,
    '--solid-dim': t.solidDim,
    '--strip-arr': t.strips.arr,
    '--strip-arr-bg': t.strips.arrBg,
    '--strip-arr-hover': t.strips.arrHover,
    '--strip-dep': t.strips.dep,
    '--strip-dep-bg': t.strips.depBg,
    '--strip-dep-hover': t.strips.depHover,
    '--rail-hover': t.light ? '#d3dde5' : veil(t.text, 0.1),
    '--m-ink': t.text,
    '--m-quiet': t.dim,
    '--m-faint': t.faint,
    '--m-line': t.menuLine,
    '--m-edge': t.line,
    '--m-side': t.menuSide,
    '--m-field': t.menuField,
    '--sans': fallback(t.fonts.body, "'Segoe UI', system-ui, sans-serif"),
    '--head': fallback(t.fonts.head, "'Segoe UI', system-ui, sans-serif"),
    '--mono': fallback(t.fonts.mono, "ui-monospace, 'SF Mono', Menlo, Consolas, monospace"),
  };
}

let current: ThemeId | null = null;

export function currentTheme(): ThemeId {
  return current ?? DEFAULT_THEME;
}

export function applyTheme(id: ThemeId): void {
  const t = specFor(id);
  current = t.id;
  const root = document.documentElement;
  for (const [k, v] of Object.entries(cssVarsFor(t.id))) root.style.setProperty(k, v);
  root.dataset.theme = t.id;
  root.style.colorScheme = t.light ? 'light' : 'dark';

  setRadarPalette({
    outside: t.edge,
    scope: t.scope,
    boundary: t.boundary,
    grid: t.grid,
    runway: t.runway,
    runwayIdle: t.runwayIdle,
    centreline: t.centreline,
    fix: t.dim,
    exit: t.light ? '#44566a' : t.dim,
    blip: t.text,
    dataBlock: t.arrival,
    departure: t.departure,
    cleared: t.cleared,
    selected: t.accent,
    conflict: t.conflict,
    warning: t.warning,
    trail: t.runwayIdle,
    scale: t.dim,
    labelBack: veil(t.edge, 0.85),
    labelBackDim: veil(t.scope, 0.7),
  });
  setGroundPalette({
    bg: t.ground.bg,
    grass: t.ground.grass,
    pavement: t.ground.pavement,
    apron: t.ground.apron,
    runway: t.ground.runway,
    runwayEdge: t.light ? '#44525c' : t.runway,
    centre: t.text,
    taxiLine: t.ground.taxi,
    hold: t.departure,
    label: t.dim,
    stand: t.dim,
    building: t.ground.runway,
    buildingEdge: t.dim,
    aircraft: t.text,
    departure: t.departure,
    arrival: t.arrival,
    selected: t.accent,
    conflict: t.conflict,
    route: t.cleared,
    preview: t.accent,
    veil: veil(t.ground.bg, 0.85),
    veilStrong: veil(t.ground.bg, 0.8),
  });
}
