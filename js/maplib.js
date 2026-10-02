// Leaflet helpers shared by the company map and the public share map.
// Leaflet and MarkerCluster are loaded as classic scripts, so L is global.
/* global L */
import { STATUS, esc } from './ui.js';

const LAYERS = () => ({
  Street: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }),
  Light: L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    maxZoom: 20, attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
  }),
  Satellite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19, attribution: 'Imagery &copy; Esri, Maxar, Earthstar Geographics',
  }),
});

export function createMap(elOrId, { center = [20.59, 78.96], zoom = 5 } = {}) {
  const map = L.map(elOrId, { zoomControl: false, preferCanvas: false }).setView(center, zoom);
  const layers = LAYERS();
  let chosen = 'Street';
  try { chosen = localStorage.getItem('hh_layer') || 'Street'; } catch { /* blocked */ }
  (layers[chosen] || layers.Street).addTo(map);
  L.control.zoom({ position: 'topright' }).addTo(map);
  L.control.layers(layers, null, { position: 'topright' }).addTo(map);
  L.control.scale({ imperial: false, position: 'bottomright' }).addTo(map);
  map.on('baselayerchange', (e) => { try { localStorage.setItem('hh_layer', e.name); } catch { /* blocked */ } });
  return map;
}

/** Teardrop pin coloured by status, with the type's two-letter glyph. */
export function pinIcon(m, { selected = false, active = false, flag = false } = {}) {
  const color = (STATUS[m.status] || STATUS.available).color;
  const abbr = m.abbr || '';
  const cls = 'pin' + (selected ? ' sel' : '') + (active ? ' hot' : '');
  const size = active ? 36 : 30;
  return L.divIcon({
    className: 'pin-wrap',
    html: '<div class="' + cls + '" style="--c:' + color + '"><span>' + esc(abbr) + '</span>' + (flag ? '<i class="flag"></i>' : '') + '</div>',
    iconSize: [size, size],
    iconAnchor: [size / 2, size + 2],
    popupAnchor: [0, -size],
  });
}

export function newPinIcon() {
  return L.divIcon({
    className: 'pin-wrap',
    html: '<div class="pin new" style="--c:#2f5bea"><span>+</span></div>',
    iconSize: [30, 30], iconAnchor: [15, 32],
  });
}

export function clusterGroup() {
  if (!L.markerClusterGroup) return L.layerGroup();
  return L.markerClusterGroup({
    showCoverageOnHover: false,
    maxClusterRadius: 44,
    disableClusteringAtZoom: 16,
    spiderfyOnMaxZoom: true,
  });
}

export function fitTo(map, items, { padding = [40, 40], maxZoom = 15 } = {}) {
  const pts = items.filter((m) => Number.isFinite(m.lat) && Number.isFinite(m.lng)).map((m) => [m.lat, m.lng]);
  if (!pts.length) return false;
  if (pts.length === 1) map.setView(pts[0], 16);
  else map.fitBounds(pts, { padding, maxZoom });
  return true;
}

/**
 * Tears a map down safely. Leaflet 1.9 finishes a zoom animation from a 250 ms
 * timer; if the map is removed before it fires (leaving a page right after it
 * zoomed), that timer moves panes that no longer exist and throws
 * "_leaflet_pos" errors. Ending the animation state first makes it a no-op.
 */
const removed = new WeakSet();

export function destroyMap(map) {
  if (!map || removed.has(map)) return;
  removed.add(map);
  map.stop();
  map._animatingZoom = false; // private, but the only switch the pending timer checks
  map.remove();
}

/** False once destroyMap() ran: for callbacks that land after the user left the page. */
export const isLive = (map) => !!map && !removed.has(map);

/** setTimeout for map work (resize, fit) that must not run on a map already torn down. */
export function later(map, fn, ms = 50) {
  setTimeout(() => { if (isLive(map)) fn(); }, ms);
}

export function legendHtml(keys = ['available', 'on_hold', 'booked', 'maintenance']) {
  return keys.map((k) => '<span><i style="background:' + STATUS[k].color + '"></i>' + STATUS[k].label + '</span>').join('');
}
