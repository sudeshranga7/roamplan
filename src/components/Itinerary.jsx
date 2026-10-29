import { lazy, Suspense, useState } from "react";
import { fmtDate, isFixed, km, legText, nextAlt, positionsFor, rowsFor } from "../lib.js";

// Leaflet is only downloaded when someone opens a map.
const DayMap = lazy(() => import("./DayMap.jsx"));

const PACES = [["relaxed", "Relaxed"], ["mid", "Balanced"], ["hectic", "Packed"]];

function Slot({ s, time, travel, editing, canUp, canDown, canSwap, onUp, onDown, onSwap, onRemove }) {
  const safeSite = /^https?:\/\//.test(s.website || "") ? s.website : null;
  return (
    <div className="slot">
      <time>{time}</time>
      <div className={`dot${s.n ? " num" : ""}`} data-tag={s.tag} aria-hidden="true">{s.n}</div>
      <div className="slot-body">
        <div className="slot-title"><b>{s.title}</b>{s.tag && <span className="tag" data-tag={s.tag}>{s.tag}</span>}</div>
        <p>{s.desc}{travel}</p>
        {(s.link || safeSite) && (
          <p className="links">
            {s.link && <a href={s.link} target="_blank" rel="noopener noreferrer">Map</a>}
            {safeSite && <a href={safeSite} target="_blank" rel="noopener noreferrer">Website</a>}
          </p>
        )}
      </div>
      {editing && (
        <div className="slot-tools">
          {canSwap && <button type="button" onClick={onSwap} aria-label={`Swap ${s.title} for another option`} title="Try another option">⇄</button>}
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

  // Number the stops that have coordinates (for the map) and work out travel from the previous one.
  let n = 0, prev = null;
  const rows = rowsFor(d, edit).map((r) => {
    const s = { ...r.s };
    let travel = "";
    if (s.lat != null) {
      s.n = ++n;
      if (prev) travel = legText(km(prev, s));
      prev = s;
    }
    return { ...r, s, travel };
  });
  const movable = rows.filter((r) => !isFixed(r.s));
  const update = (fn) => { const next = [...pos]; fn(next); onEdit(next); };
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
      {d.note && <p className="notice day-note">☂ {d.note}</p>}
      {editing && <p className="muted small edit-hint">⇄ tries a nearby alternative · ↑↓ swaps two stops' times · × removes a stop</p>}
      {showMap && (
        <Suspense fallback={<div className="daymap skeleton" />}>
          <DayMap stops={stops} />
        </Suspense>
      )}
      <div className="timeline">
        {rows.map((r) => {
          const i = movable.indexOf(r);
          return (
            <Slot key={r.k} s={r.s} time={r.time} travel={r.travel} editing={editing}
              canUp={i > 0} canDown={i >= 0 && i < movable.length - 1} canSwap={!!r.s.alts?.length}
              onUp={() => update((p) => { [p[r.k], p[movable[i - 1].k]] = [p[movable[i - 1].k], p[r.k]]; })}
              onDown={() => update((p) => { [p[r.k], p[movable[i + 1].k]] = [p[movable[i + 1].k], p[r.k]]; })}
              onSwap={() => update((p) => { p[r.k] = nextAlt(d, r.v); })}
              onRemove={() => update((p) => { p[r.k] = -1; })} />
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
        <div className="seg" role="tablist" aria-label="Pace">
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
