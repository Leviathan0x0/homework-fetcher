import * as React from 'react';
import { cn } from '../../../utils/cn';
import type { ReiconName, ReiconGlassProps } from './types';
import { REICON_MAP } from './map';

export interface GlassPalette {
  gradient: [string, string, string];
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  let clean = hex.replace('#', '');
  if (clean.length === 3) {
    clean = clean
      .split('')
      .map((c) => c + c)
      .join('');
  }
  const num = parseInt(clean, 16);
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
}

export function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (c: number) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h /= 6;
  }
  return { h: h * 360, s, l };
}

export function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  h /= 360;
  let r: number;
  let g: number;
  let b: number;
  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  return { r: r * 255, g: g * 255, b: b * 255 };
}

export function createPalette(baseHex?: string): GlassPalette {
  const rgb = hexToRgb(baseHex || '#9B8AFB');
  const { h, s, l } = rgbToHsl(rgb.r, rgb.g, rgb.b);

  const lLight = Math.min(0.96, l + (1.0 - l) * 0.65);
  const sLight = Math.max(0.15, s * 0.75);
  const rgbLight = hslToRgb(h, sLight, lLight);

  const lMid = Math.max(0.25, Math.min(0.85, l * 1.02));
  const rgbMid = hslToRgb(h, s, lMid);

  const lDark = Math.max(0.1, l * 0.45);
  const sDark = Math.min(1.0, s * 1.25);
  const rgbDark = hslToRgb(h, sDark, lDark);

  return {
    gradient: [
      rgbToHex(rgbLight.r, rgbLight.g, rgbLight.b),
      rgbToHex(rgbMid.r, rgbMid.g, rgbMid.b),
      rgbToHex(rgbDark.r, rgbDark.g, rgbDark.b),
    ],
  };
}

export function normalizeColor(color: string | undefined): string {
  if (color && /^#[0-9a-fA-F]{3,8}$/.test(color)) return color;
  return '#9B8AFB';
}

export function hashStr(s: string): string {
  let h = 5381;
  const str = String(s || '');
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

export function toMaskMarkup(src: string): string {
  const input = String(src || '').trim();
  if (!input) return '';
  if (!/<(path|circle|ellipse|rect|line|polyline|polygon|g)\b/i.test(input)) {
    return `<path d="${input}" fill="white"/>`;
  }
  return input.replace(/<[a-zA-Z][^<>]*\/?>/g, (tag) => {
    const name = (/^<([a-zA-Z][a-zA-Z0-9]*)/.exec(tag) || [])[1] || '';
    const isShape = /^(path|circle|ellipse|rect|line|polyline|polygon)$/i.test(name);
    let out = tag
      .replace(/stroke\s*=\s*(['"])[^'"]*\1/gi, 'stroke="white"')
      .replace(/(fill|stroke)-opacity\s*=\s*(['"])[^'"]*\2/gi, '$1-opacity="1"')
      .replace(/fill\s*=\s*(['"])([^'"]*)\1/gi, (m, _q, v) =>
        /^none$/i.test(v.trim()) ? m : 'fill="white"'
      );
    if (isShape && /stroke(\s|=|\/|>)/i.test(out) && !/fill\s*=/i.test(out)) {
      out = out.replace(/^<([a-zA-Z][a-zA-Z0-9]*)/, '<$1 fill="none"');
    }
    return out;
  });
}

const rawMarkupCache = new Map<string, string>();

export function getIconRawMarkup(name: ReiconName, preferFilled = true): string {
  const cacheKey = `${name}_${preferFilled ? 'F' : 'O'}`;
  const hit = rawMarkupCache.get(cacheKey);
  if (hit !== undefined) return hit;

  const Comp = REICON_MAP[name];
  if (Comp && typeof (Comp as any).render === 'function') {
    try {
      if (preferFilled) {
        const elFilled = (Comp as any).render({ weight: 'Filled' }, null);
        const html = elFilled?.props?.dangerouslySetInnerHTML?.__html;
        if (typeof html === 'string' && html.trim().length > 0) {
          rawMarkupCache.set(cacheKey, html);
          return html;
        }
      }
      const elOutline = (Comp as any).render({ weight: 'Outline' }, null);
      const html = elOutline?.props?.dangerouslySetInnerHTML?.__html;
      if (typeof html === 'string' && html.trim().length > 0) {
        rawMarkupCache.set(cacheKey, html);
        return html;
      }
    } catch {
      // Ignore
    }
  }

  rawMarkupCache.set(cacheKey, '');
  return '';
}

export function convertGlassSvg(
  input: string,
  options: { color?: string; size?: number | string; id?: string } = {}
): string {
  if (!input) return '';
  const cleanPath = toMaskMarkup(input);
  const safeColor = normalizeColor(options.color);
  const palette = createPalette(safeColor);
  const uid = options.id || `rg_${hashStr(input + safeColor)}`;
  const size = options.size || 24;
  const colors = palette.gradient;

  return `<svg width="${size}" height="${size}" viewBox="0 0 240 240" fill="none" xmlns="http://www.w3.org/2000/svg" class="reicon reicon-glass">
  <mask id="glyph_${uid}" maskUnits="userSpaceOnUse" x="0" y="0" width="240" height="240" style="mask-type: alpha;">
    <g transform="scale(10)">
      <g fill="white" color="white">
        <g>${cleanPath}</g>
      </g>
    </g>
  </mask>
  <g mask="url(#glyph_${uid})">
    <g filter="url(#engrave_${uid})">
      <g mask="url(#glyph_${uid})">
        <rect x="0" y="0" width="240" height="240" fill="url(#ink_${uid})"></rect>
      </g>
    </g>
  </g>
  <defs>
    <filter id="engrave_${uid}" x="-50%" y="-50%" width="200%" height="200%" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">
      <feFlood flood-opacity="0" result="bg"></feFlood>
      <feColorMatrix in="SourceAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"></feColorMatrix>
      <feMorphology radius="24.2857" operator="erode" in="SourceAlpha"></feMorphology>
      <feOffset dx="14.5714" dy="17"></feOffset>
      <feGaussianBlur stdDeviation="9.71429"></feGaussianBlur>
      <feColorMatrix type="matrix" values="0 0 0 0 0.270757 0 0 0 0 0.230207 0 0 0 0 0.53433 0 0 0 0.35 0"></feColorMatrix>
      <feBlend mode="multiply" in2="bg" result="d1"></feBlend>
      <feColorMatrix in="SourceAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"></feColorMatrix>
      <feMorphology radius="24.2857" operator="erode" in="SourceAlpha"></feMorphology>
      <feOffset dx="4.85714" dy="4.85714"></feOffset>
      <feGaussianBlur stdDeviation="2.42857"></feGaussianBlur>
      <feColorMatrix type="matrix" values="0 0 0 0 0.0469801 0 0 0 0 0 0 0 0 0 0.352351 0 0 0 0.25 0"></feColorMatrix>
      <feBlend mode="multiply" in2="d1" result="d2"></feBlend>
      <feBlend mode="normal" in="SourceGraphic" in2="d2" result="shape"></feBlend>
      <feColorMatrix in="SourceAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0" result="softTL"></feColorMatrix>
      <feOffset dx="-2.42857" dy="-2.42857"></feOffset>
      <feGaussianBlur stdDeviation="1.21429"></feGaussianBlur>
      <feComposite in2="softTL" operator="arithmetic" k2="-1" k3="1"></feComposite>
      <feColorMatrix type="matrix" values="0 0 0 0 0.130195 0 0 0 0 0.188321 0 0 0 0 0.420823 0 0 0 0.3 0"></feColorMatrix>
      <feBlend mode="normal" in2="shape" result="i1"></feBlend>
      <feColorMatrix in="SourceAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0" result="softBR"></feColorMatrix>
      <feOffset dx="2.42857" dy="2.42857"></feOffset>
      <feGaussianBlur stdDeviation="1.21429"></feGaussianBlur>
      <feComposite in2="softBR" operator="arithmetic" k2="-1" k3="1"></feComposite>
      <feColorMatrix type="matrix" values="0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0.9 0"></feColorMatrix>
      <feBlend mode="normal" in2="i1" result="i2"></feBlend>
    </filter>

    <radialGradient id="ink_${uid}" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(120 80) rotate(70) scale(180 360)">
      <stop stop-color="${colors[0]}"></stop>
      <stop offset="0.5" stop-color="${colors[1]}"></stop>
      <stop offset="1" stop-color="${colors[2]}"></stop>
    </radialGradient>
  </defs>
</svg>`;
}

export const ReiconGlass = React.forwardRef<SVGSVGElement, ReiconGlassProps>(
  ({ name, size = 20, color, className, ...props }, ref) => {
    const rawCode = getIconRawMarkup(name, true);
    const cleanPath = toMaskMarkup(rawCode);
    const safeColor = normalizeColor(color);
    const palette = createPalette(safeColor);
    const colors = palette.gradient;

    const baseId = `rg_${name.replace(/[^a-zA-Z0-9_-]/g, '_')}_${safeColor.replace('#', '')}`;
    const reactId = React.useId().replace(/[^a-zA-Z0-9_-]/g, '_');
    const uid = `${baseId}_${reactId}`;

    const numSize = typeof size === 'number' ? size : parseInt(String(size), 10) || 20;

    return (
      <svg
        ref={ref}
        width={numSize}
        height={numSize}
        viewBox="0 0 240 240"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={cn('reicon reicon-glass shrink-0', className)}
        {...props}
      >
        <mask
          id={`glyph_${uid}`}
          maskUnits="userSpaceOnUse"
          x="0"
          y="0"
          width="240"
          height="240"
          style={{ maskType: 'alpha' }}
        >
          <g transform="scale(10)">
            <g fill="white" color="white">
              <g dangerouslySetInnerHTML={{ __html: cleanPath }} />
            </g>
          </g>
        </mask>
        <g mask={`url(#glyph_${uid})`}>
          <g filter={`url(#engrave_${uid})`}>
            <g mask={`url(#glyph_${uid})`}>
              <rect x="0" y="0" width="240" height="240" fill={`url(#ink_${uid})`} />
            </g>
          </g>
        </g>
        <defs>
          <filter
            id={`engrave_${uid}`}
            x="-50%"
            y="-50%"
            width="200%"
            height="200%"
            filterUnits="userSpaceOnUse"
            colorInterpolationFilters="sRGB"
          >
            <feFlood floodOpacity="0" result="bg" />
            <feColorMatrix in="SourceAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" />
            <feMorphology radius="24.2857" operator="erode" in="SourceAlpha" />
            <feOffset dx="14.5714" dy="17" />
            <feGaussianBlur stdDeviation="9.71429" />
            <feColorMatrix
              type="matrix"
              values="0 0 0 0 0.270757 0 0 0 0 0.230207 0 0 0 0 0.53433 0 0 0 0.35 0"
            />
            <feBlend mode="multiply" in2="bg" result="d1" />
            <feColorMatrix in="SourceAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" />
            <feMorphology radius="24.2857" operator="erode" in="SourceAlpha" />
            <feOffset dx="4.85714" dy="4.85714" />
            <feGaussianBlur stdDeviation="2.42857" />
            <feColorMatrix
              type="matrix"
              values="0 0 0 0 0.0469801 0 0 0 0 0 0 0 0 0 0.352351 0 0 0 0.25 0"
            />
            <feBlend mode="multiply" in2="d1" result="d2" />
            <feBlend mode="normal" in="SourceGraphic" in2="d2" result="shape" />
            <feColorMatrix
              in="SourceAlpha"
              type="matrix"
              values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0"
              result="softTL"
            />
            <feOffset dx="-2.42857" dy="-2.42857" />
            <feGaussianBlur stdDeviation="1.21429" />
            <feComposite in2="softTL" operator="arithmetic" k2="-1" k3="1" />
            <feColorMatrix
              type="matrix"
              values="0 0 0 0 0.130195 0 0 0 0 0.188321 0 0 0 0 0.420823 0 0 0 0.3 0"
            />
            <feBlend mode="normal" in2="shape" result="i1" />
            <feColorMatrix
              in="SourceAlpha"
              type="matrix"
              values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0"
              result="softBR"
            />
            <feOffset dx="2.42857" dy="2.42857" />
            <feGaussianBlur stdDeviation="1.21429" />
            <feComposite in2="softBR" operator="arithmetic" k2="-1" k3="1" />
            <feColorMatrix
              type="matrix"
              values="0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0.9 0"
            />
            <feBlend mode="normal" in2="i1" result="i2" />
          </filter>

          <radialGradient
            id={`ink_${uid}`}
            cx="0"
            cy="0"
            r="1"
            gradientUnits="userSpaceOnUse"
            gradientTransform="translate(120 80) rotate(70) scale(180 360)"
          >
            <stop stopColor={colors[0]} />
            <stop offset="0.5" stopColor={colors[1]} />
            <stop offset="1" stopColor={colors[2]} />
          </radialGradient>
        </defs>
      </svg>
    );
  }
);

ReiconGlass.displayName = 'ReiconGlass';
