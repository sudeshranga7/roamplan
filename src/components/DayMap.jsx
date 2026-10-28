import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Numbered stops for one day, joined in visiting order.
export default function DayMap({ stops }) {
  const el = useRef(null);
  const map = useRef(null);

  useEffect(() => {
    map.current = L.map(el.current, { scrollWheelZoom: false });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map.current);
    return () => { map.current.remove(); map.current = null; };
  }, []);

  useEffect(() => {
    const m = map.current;
    const layer = L.layerGroup().addTo(m);
    const pts = stops.map((s) => [s.lat, s.lon]);
    stops.forEach((s) => {
      L.marker([s.lat, s.lon], {
        icon: L.divIcon({ className: "pin-wrap", html: `<span class="pin" data-tag="${s.tag || ""}">${s.n}</span>`, iconSize: [26, 26], iconAnchor: [13, 13] }),
        title: s.title,
      }).bindPopup(`<b>${s.n}. ${escapeHtml(s.title)}</b><br>${escapeHtml(s.time)}`).addTo(layer);
    });
    if (pts.length > 1) L.polyline(pts, { color: "#0f766e", weight: 3, opacity: 0.6, dashArray: "6 6" }).addTo(layer);
    if (pts.length === 1) m.setView(pts[0], 15);
    else if (pts.length) m.fitBounds(pts, { padding: [28, 28], maxZoom: 16 });
    return () => layer.remove();
  }, [stops.map((s) => `${s.n}:${s.lat},${s.lon}`).join("|")]);

  return <div className="daymap" ref={el} role="region" aria-label="Map of this day's stops" />;
}

const escapeHtml = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
