import { fmtDate } from "../lib.js";

const PACES = [["relaxed", "Relaxed"], ["mid", "Balanced"], ["hectic", "Packed"]];

function Slot({ s }) {
  const safeSite = /^https?:\/\//.test(s.website || "") ? s.website : null;
  return (
    <div className="slot">
      <time>{s.time}</time>
      <div className="dot" data-tag={s.tag} aria-hidden="true" />
      <div className="slot-body">
        <div className="slot-title"><b>{s.title}</b>{s.tag && <span className="tag" data-tag={s.tag}>{s.tag}</span>}</div>
        <p>{s.desc}</p>
        {(s.link || safeSite) && (
          <p className="links">
            {s.link && <a href={s.link} target="_blank" rel="noopener noreferrer">Map</a>}
            {safeSite && <a href={safeSite} target="_blank" rel="noopener noreferrer">Website</a>}
          </p>
        )}
      </div>
    </div>
  );
}

export default function Itinerary({ plans, pace, onPace }) {
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
        {(plan?.days || []).map((d) => (
          <article className="card day" key={d.day}>
            <h4><small>Day {d.day}{d.date ? ` · ${fmtDate(d.date)}` : ""}</small>{d.title}</h4>
            <div className="timeline">{d.slots.map((s, i) => <Slot s={s} key={i} />)}</div>
          </article>
        ))}
      </div>
    </>
  );
}
