import { useEffect, useRef, useState } from "react";
import TripForm from "./components/TripForm.jsx";
import Weather from "./components/Weather.jsx";
import Itinerary from "./components/Itinerary.jsx";
import { fetchItinerary, readUrl, writeUrl } from "./lib.js";

// The landing page starts empty; the inputs show greyed-out examples instead.
const EMPTY = { places: [], startDate: "", days: "", travellers: "", interests: "" };

// A shared link (?p=...) opens that exact trip, including any reordered or removed stops.
const fromUrl = readUrl();

export default function App() {
  const [form, setForm] = useState(() => fromUrl?.form || EMPTY);
  const [result, setResult] = useState(null); // { plan, input }
  const [pace, setPace] = useState(fromUrl?.pace || "mid");
  const [edits, setEdits] = useState(fromUrl?.edits || {}); // { pace: { dayIndex: positions } }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [shareMsg, setShareMsg] = useState("");
  const resultsRef = useRef(null);

  async function run(input, { shared = false } = {}) {
    setForm(input);
    setBusy(true); setError("");
    try {
      const payload = { ...input, days: +input.days, travellers: +input.travellers };
      const plan = await fetchItinerary(payload);
      setResult({ plan, input: payload });
      if (!shared) {
        setEdits({}); // a new plan starts unedited; a shared link keeps its edits
        resultsRef.current?.scrollIntoView({ behavior: "smooth" });
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  // Only a shared link plans on load.
  useEffect(() => { if (fromUrl) run(fromUrl.form, { shared: true }); }, []);

  // Keep the address bar in sync, so copying it always shares what's on screen.
  useEffect(() => { if (result) writeUrl(result.input, pace, edits); }, [result, pace, edits]);

  const editDay = (i, pos) => setEdits((all) => {
    const forPace = { ...(all[pace] || {}) };
    if (pos) forPace[i] = pos; else delete forPace[i];
    const next = { ...all, [pace]: forPace };
    if (!Object.keys(forPace).length) delete next[pace];
    return next;
  });

  const exportPdf = () => {
    const old = document.title;
    document.title = `RoamPlan - ${result.plan.destination}`;
    window.print();
    document.title = old;
  };

  const share = async () => {
    const url = location.href, title = `RoamPlan: ${result.plan.destination}`;
    try {
      if (navigator.share && matchMedia("(pointer: coarse)").matches) { await navigator.share({ title, url }); return; }
      await navigator.clipboard.writeText(url);
      setShareMsg("Link copied");
    } catch (e) {
      if (e?.name === "AbortError") return; // user closed the share sheet
      setShareMsg("Copy the link from the address bar");
    }
    setTimeout(() => setShareMsg(""), 2500);
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
                <div className="head-tools">
                  <button type="button" className="ghost" onClick={share}>{shareMsg || "Share link"}</button>
                  <button type="button" className="ghost" onClick={exportPdf}>Download PDF</button>
                </div>
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

              <Itinerary plans={plan.plans} pace={pace} onPace={setPace} edits={edits[pace]} onEdit={editDay} />

              <h3>Group tips</h3>
              <ul className="tips">{tips.map((t, i) => <li key={i}>{t}</li>)}</ul>
            </div>
          )}
        </section>
      </main>

      <footer className="wrap muted small foot">
        Places © OpenStreetMap contributors · Destination text from Wikivoyage/Wikipedia · Popularity from Wikipedia pageviews · Weather by Open-Meteo. Verify timings and prices before you go.
        <br />Built by Sudesh Ranga.
      </footer>
    </>
  );
}
