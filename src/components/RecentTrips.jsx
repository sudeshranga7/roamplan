import { fmtDate } from "../lib.js";

// Trips planned in this browser (kept in localStorage, so they also open offline).
export default function RecentTrips({ trips, onOpen }) {
  if (!trips.length) return null;
  return (
    <section className="recent" aria-labelledby="recent-h">
      <h3 id="recent-h">Your recent trips</h3>
      <div className="recent-list">
        {trips.map((t) => (
          <button key={t.key} type="button" className="recent-item" onClick={() => onOpen(t)}>
            <b>{t.plan.destination}</b>
            <span className="muted small">{fmtDate(t.input.startDate)} · {t.input.days} {t.input.days == 1 ? "day" : "days"} · {t.input.travellers} {t.input.travellers == 1 ? "person" : "people"}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
