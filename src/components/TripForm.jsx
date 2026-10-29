import { useState } from "react";
import { localIso, PREFS } from "../lib.js";

export default function TripForm({ value, onChange, onSubmit, busy, status, error }) {
  const [draft, setDraft] = useState("");
  const set = (patch) => onChange({ ...value, ...patch });

  const addPlace = () => {
    const v = draft.trim().replace(/,$/, "");
    setDraft("");
    if (v && value.places.length < 6 && !value.places.some((p) => p.toLowerCase() === v.toLowerCase()))
      set({ places: [...value.places, v] });
  };
  const removePlace = (i) => set({ places: value.places.filter((_, j) => j !== i) });

  const submit = (e) => {
    e.preventDefault();
    const v = draft.trim().replace(/,$/, "");
    onSubmit(v && !value.places.includes(v) ? { ...value, places: [...value.places, v] } : value);
    setDraft("");
  };

  return (
    <form className="card form" id="plan-form" onSubmit={submit} autoComplete="off">
      <div className="field full">
        <label htmlFor="place">Places</label>
        <div className="chips">
          {value.places.map((p, i) => (
            <span className="chip" key={p}>
              {p}
              <button type="button" aria-label={`Remove ${p}`} onClick={() => removePlace(i)}>×</button>
            </span>
          ))}
          <input
            id="place" value={draft} placeholder={value.places.length ? "Add another…" : "e.g. Goa, Tokyo, Paris"}
            onChange={(e) => setDraft(e.target.value)} onBlur={addPlace}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addPlace(); }
              else if (e.key === "Backspace" && !draft && value.places.length) removePlace(value.places.length - 1);
            }}
          />
        </div>
      </div>
      <div className="field">
        <label htmlFor="start">Start date</label>
        <input id="start" type="date" required min={localIso()} value={value.startDate} onChange={(e) => set({ startDate: e.target.value })} />
      </div>
      <div className="field">
        <label htmlFor="days">Days</label>
        <input id="days" type="number" min="1" max="14" required placeholder="e.g. 3" value={value.days} onChange={(e) => set({ days: e.target.value })} />
      </div>
      <div className="field">
        <label htmlFor="trav">Travellers</label>
        <input id="trav" type="number" min="1" max="200" required placeholder="e.g. 4" value={value.travellers} onChange={(e) => set({ travellers: e.target.value })} />
      </div>
      <div className="field full">
        <label htmlFor="int">Interests</label>
        <input id="int" value={value.interests} placeholder="e.g. beaches, cafés, museums" onChange={(e) => set({ interests: e.target.value })} />
      </div>
      <fieldset className="prefs full">
        <legend className="sr-only">Preferences</legend>
        {PREFS.map(([k, label]) => {
          const on = (value.prefs || []).includes(k);
          return (
            <label key={k} className={`pref${on ? " on" : ""}`}>
              <input type="checkbox" checked={on}
                onChange={() => set({ prefs: on ? value.prefs.filter((p) => p !== k) : [...(value.prefs || []), k] })} />
              {label}
            </label>
          );
        })}
      </fieldset>
      <div className="actions full">
        <button type="submit" className="primary" disabled={busy || (!value.places.length && !draft.trim())}>
          {busy ? "Planning…" : "Plan my trip"}
        </button>
        {status && <span className="muted small" role="status">{status}</span>}
        {error && <span className="small error" role="alert">{error}</span>}
      </div>
    </form>
  );
}
