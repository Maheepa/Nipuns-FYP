import L from 'leaflet';

// All markers are divIcons with inline SVG so they work offline and can be styled with CSS.

const TOWER_SVG = `
<svg viewBox="0 0 32 32" width="22" height="22" aria-hidden="true">
  <g fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M16 11 L10 29 M16 11 L22 29 M12.2 23 H19.8 M13.4 18.5 H18.6"/>
    <circle cx="16" cy="9" r="2.2" fill="#fff"/>
    <path d="M10.5 4.5 a8 8 0 0 0 0 9 M21.5 4.5 a8 8 0 0 1 0 9"/>
  </g>
</svg>`;

const PERSON_SVG = `
<svg viewBox="0 0 32 32" width="20" height="20" aria-hidden="true">
  <g fill="#fff">
    <circle cx="16" cy="7.5" r="4"/>
    <path d="M9 14 q7 -3 14 0 l-2.5 7 h-2 l-0.5 8 h-4 l-0.5 -8 h-2 z"/>
  </g>
</svg>`;

// Quad-X like Mission Planner's vehicle icon; the nose (front arms) points up = heading 0.
const QUAD_SVG = `
<svg viewBox="0 0 64 64" width="56" height="56" aria-hidden="true">
  <g stroke="#1b1b1b" stroke-width="5" stroke-linecap="round">
    <line x1="16" y1="16" x2="48" y2="48"/><line x1="48" y1="16" x2="16" y2="48"/>
  </g>
  <g stroke="#d7e04a" stroke-width="3.2" stroke-linecap="round">
    <line x1="16" y1="16" x2="48" y2="48"/><line x1="48" y1="16" x2="16" y2="48"/>
  </g>
  <g fill="rgba(215,224,74,0.18)" stroke="#d7e04a" stroke-width="3">
    <circle cx="14" cy="14" r="9"/><circle cx="50" cy="14" r="9"/>
    <circle cx="14" cy="50" r="9"/><circle cx="50" cy="50" r="9"/>
  </g>
  <rect x="25" y="25" width="14" height="14" rx="3" fill="#e0242b" stroke="#1b1b1b" stroke-width="1.5"/>
  <path d="M32 18 L36 25 H28 Z" fill="#e0242b" stroke="#1b1b1b" stroke-width="1.2"/>
</svg>`;

export const baseIcon = L.divIcon({
  className: 'mk',
  html: `<div class="mk-base">${TOWER_SVG}</div>`,
  iconSize: [36, 36],
  iconAnchor: [18, 18],
});

export type SwimmerState = 'normal' | 'stale' | 'warning' | 'alert';

const swimmerIcons = new Map<SwimmerState, L.DivIcon>();
export function swimmerIcon(state: SwimmerState): L.DivIcon {
  let icon = swimmerIcons.get(state);
  if (!icon) {
    icon = L.divIcon({
      className: 'mk',
      html: `<div class="mk-swimmer ${state}"><span class="pulse"></span>${PERSON_SVG}</div>`,
      iconSize: [34, 34],
      iconAnchor: [17, 17],
    });
    swimmerIcons.set(state, icon);
  }
  return icon;
}

export function droneIcon(headingDeg: number, armed: boolean): L.DivIcon {
  return L.divIcon({
    className: 'mk',
    html: `<div class="mk-drone ${armed ? 'armed' : ''}" style="transform: rotate(${Math.round(headingDeg)}deg)">${QUAD_SVG}</div>`,
    iconSize: [56, 56],
    iconAnchor: [28, 28],
  });
}

export const targetIcon = L.divIcon({
  className: 'mk',
  html: '<div class="mk-target"></div>',
  iconSize: [26, 26],
  iconAnchor: [13, 13],
});
