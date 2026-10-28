import { useState } from "react";
import DayMap from "./DayMap.jsx";
import { fmtDate, isFixed, km, positionsFor } from "../lib.js";

const PACES = [["relaxed", "Relaxed"], ["mid", "Balanced"], ["hectic", "Packed"]];

function Slot({ s, time, distance, editing, canUp, canDown, onUp, onDown, onRemove }) {
  const safeSite = /^https?:\/\//.test(s.website || "") ? s.website : null;
  return (
    <div className="slot">
      <time>{time}</time>
      <div className={`dot${s.n ? " num" : ""}`} data-tag={s.tag} aria-hidden="true">{s.n}</div>
      <div className="slot-body">
        <div className="slot-title"><b>{s.title}</b>{s.tag && <span className="tag" data-tag={s.tag}>{s.tag}</span>}</div>
        <p>{s.desc}{distance}</p>
        {(s.link || safeSite) && (
          <p className="links">
            {s.link && <a href={s.link} target="_blank" rel="noopener noreferrer">Map</a>}
            {safeSite && <a href={safeSite} target="_blank" rel="noopener noreferrer">Website</a>}
          </p>
        )}
      </div>
      {editing && (
        <div className="slot-tools">
          <button type="button" onClick={onUp} disabled={!canUp} aria-label={`Move ${s.title} earlier`}>↑</button>
          <button type="button" onClick={onDown} disabled={!canDown} aria-label={`Move ${s.title} later`}>↓</button>
          <button type="button" onClick={onRemove} aria-label={`Remove ${s.title}`}>×</button>
        </div>
      )}
    </div>
  );
}

function Day({ d, edit, onEdit }) {
  const [editing, setEditing] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const pos = positionsFor(d, edit);

  // Visible rows: the activity now at each time, numbered in order for the map.
  let n = 0, prev = null;
  const rows = [];
  pos.forEach((v, k) => {
    if (v === -1) return;
    const s = { ...d.slots[v] };
    let distance = "";
    if (s.lat != null) {
      s.n = ++n;
      if (prev) { const dk = km(prev, s); if (dk >= 0.5) distance = ` About ${dk < 10 ? dk.toFixed(1) : Math.round(dk)} km from the previous stop.`; }
      prev = s;
    }
    rows.push({ k, s, time: d.slots[k].time, distance });
  });
  const movable = rows.filter((r) => !isFixed(r.s));
  const swap = (a, b) => { const next = [...pos]; [next[a], next[b]] = [next[b], next[a]]; onEdit(next); };
  const remove = (k) => { const next = [...pos]; next[k] = -1; onEdit(next); };
  const stops = rows.filter((r) => r.s.lat != null).map((r) => ({ ...r.s, time: r.time }));

  return (
    <article className="card day">
      <div className="day-head">
        <h4><small>Day {d.day}{d.date ? ` · ${fmtDate(d.date)}` : ""}</small>{d.title}</h4>
        <div className="day-tools">
          {stops.length > 0 && <button type="button" className="chip-btn" aria-pressed={showMap} onClick={() => setShowMap(!showMap)}>{showMap ? "Hide map" : "Map"}</button>}
          <button type="button" className="chip-btn" aria-pressed={editing} onClick={() => setEditing(!editing)}>{editing ? "Done" : "Edit"}</button>
          {edit && <button type="button" className="chip-btn" onClick={() => onEdit(null)}>Reset</button>}
        </div>
      </div>
      {showMap && <DayMap stops={stops} />}
      <div className="timeline">
        {rows.map((r) => {
          const i = movable.indexOf(r);
          return (
            <Slot key={r.k} s={r.s} time={r.time} distance={r.distance} editing={editing}
              canUp={i > 0} canDown={i >= 0 && i < movable.length - 1}
              onUp={() => swap(r.k, movable[i - 1].k)} onDown={() => swap(r.k, movable[i + 1].k)}
              onRemove={() => remove(r.k)} />
          );
        })}
        {!rows.length && <p className="muted small">All stops removed. Use Reset to bring them back.</p>}
      </div>
    </article>
  );
}

export default function Itinerary({ plans, pace, onPace, edits, onEdit }) {
  const plan = plans[pace];
  return (
    <>
      <div className="tabs-row">
        <h3>Itinerary</h3>
        <div className="seg" role="tablist">
          {PACES.map(([k, label]) => (
            <button key={k} role="tab" aria-selected={pace === k} onClick={() => onPace(k)}>{label}</button>
          ))}
        </div>
      </div>
      <p className="muted tagline">{plan?.tagline}</p>
      <div className="days">
        {(plan?.days || []).map((d, i) => (
          <Day key={`${pace}-${d.day}`} d={d} edit={edits?.[i]} onEdit={(pos) => onEdit(i, pos)} />
        ))}
      </div>
    </>
  );
}
