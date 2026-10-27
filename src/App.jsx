import { useEffect, useRef, useState } from "react";
import TripForm from "./components/TripForm.jsx";
import Weather from "./components/Weather.jsx";
import Itinerary from "./components/Itinerary.jsx";
import { fetchItinerary, iso, nextFriday } from "./lib.js";

// Default: a Goa weekend for a 16-person office group.
const DEFAULT = () => ({
  places: ["Goa"], startDate: iso(nextFriday()), days: 3, travellers: 16,
  interests: "beaches, cafés, clubs, watersports",
});

export default function App() {
  const [form, setForm] = useState(DEFAULT);
  const [result, setResult] = useState(null); // { plan, input }
  const [pace, setPace] = useState("mid");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const resultsRef = useRef(null);
  const first = useRef(true);

  async function run(input) {
    setForm(input);
    setBusy(true); setError("");
    try {
      const payload = { ...input, days: +input.days, travellers: +input.travellers };
      const plan = await fetchItinerary(payload);
      setResult({ plan, input: payload });
      if (!first.current) resultsRef.current?.scrollIntoView({ behavior: "smooth" });
    } catch (e) {
      setError(e.message);
    } finally {
      first.current = false;
      setBusy(false);
    }
  }
  useEffect(() => { run(form); }, []);

  const exportPdf = () => {
    const old = document.title;
    document.title = `RoamPlan - ${result.plan.destination}`;
    window.print();
    document.title = old;
  };

  const plan = result?.plan;
  const tips = plan ? [...(plan.groupTips || []), ...(plan.plans[pace]?.tips || [])] : [];

  return (
    <>
      <header className="top">
        <div className="wrap bar">
          <a className="logo" href="/"><span className="mark" aria-hidden="true" />RoamPlan</a>
          <span className="muted small hide-sm">Trips planned from open data</span>
        </div>
      </header>

      <main className="wrap">
        <section className="hero">
          <h1>Where to, and <em>when?</em></h1>
          <p className="muted">Add your places, dates and duration. Get three itineraries (relaxed, balanced, packed) built from real places, plus the weather.</p>
        </section>

        <TripForm value={form} onChange={setForm} onSubmit={run} busy={busy} error={error}
          status={busy ? "Gathering places and building your plans. A brand-new place can take up to a minute." : ""} />

        <section ref={resultsRef} aria-live="polite">
          {busy && !plan && <div className="card skeleton tall" />}
          {plan && (
            <div className={busy ? "dim" : ""}>
              <div className="head">
                <div>
                  <h2>{plan.destination}</h2>
                  <p className="muted">{plan.summary}</p>
                </div>
                <button type="button" className="ghost" onClick={exportPdf}>Download PDF</button>
              </div>

              <h3>Weather</h3>
              <Weather places={plan.places} startDate={result.input.startDate} days={result.input.days} />

              {plan.trends?.length > 0 && (
                <>
                  <h3>Popular right now</h3>
                  <div className="trends">
                    {plan.trends.map((t) => (
                      <div className="card trend" key={t.title}><b>{t.title}</b><span>{t.note}</span></div>
                    ))}
                  </div>
                </>
              )}

              <Itinerary plans={plan.plans} pace={pace} onPace={setPace} />

              <h3>Group tips</h3>
              <ul className="tips">{tips.map((t, i) => <li key={i}>{t}</li>)}</ul>
            </div>
          )}
        </section>
      </main>

      <footer className="wrap muted small foot">
        Places © OpenStreetMap contributors · Destination text from Wikivoyage/Wikipedia · Popularity from Wikipedia pageviews · Weather by Open-Meteo. Verify timings and prices before you go.
      </footer>
    </>
  );
}
