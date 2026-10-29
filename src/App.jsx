import { useEffect, useRef, useState } from "react";
import TripForm from "./components/TripForm.jsx";
import Weather from "./components/Weather.jsx";
import Itinerary from "./components/Itinerary.jsx";
import HeroArt from "./components/HeroArt.jsx";
import Ideas, { ideaForm } from "./components/Ideas.jsx";
import RecentTrips from "./components/RecentTrips.jsx";
import Progress from "./components/Progress.jsx";
import { buildIcs, fetchItinerary, findTrip, fmtDate, loadTrips, readUrl, saveTrip, writeUrl } from "./lib.js";

// The landing page starts empty; the inputs show greyed-out examples instead.
const EMPTY = { places: [], startDate: "", days: "", travellers: "", interests: "", prefs: [] };
const PACE_LABEL = { relaxed: "Relaxed", mid: "Balanced", hectic: "Packed" };

// A shared link (?p=...) opens that exact trip, including any reordered, swapped or removed stops.
const fromUrl = readUrl();

export default function App() {
  const [form, setForm] = useState(() => fromUrl?.form || EMPTY);
  const [result, setResult] = useState(null); // { plan, input }
  const [pace, setPace] = useState(fromUrl?.pace || "mid");
  const [edits, setEdits] = useState(fromUrl?.edits || {}); // { pace: { dayIndex: positions } }
  const [busy, setBusy] = useState(false);
  const [steps, setSteps] = useState([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [shareMsg, setShareMsg] = useState("");
  const [trips, setTrips] = useState(loadTrips);
  const resultsRef = useRef(null);
  const scrollToResults = () => setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: "smooth" }), 50);

  async function run(input, { shared = false } = {}) {
    const payload = { ...input, days: +input.days, travellers: +input.travellers, prefs: input.prefs || [] };
    setForm(input);
    setBusy(true); setError(""); setNotice(""); setSteps([]);
    if (!shared) { setEdits({}); scrollToResults(); } // a new plan starts unedited; a shared link keeps its edits
    // Show a saved copy straight away if we have one, then refresh it.
    const saved = findTrip(payload);
    if (saved) setResult({ plan: saved.plan, input: payload });
    try {
      const plan = await fetchItinerary(payload, (msg) => setSteps((s) => [...s, msg]));
      setResult({ plan, input: payload });
      saveTrip(payload, plan);
      setTrips(loadTrips());
    } catch (e) {
      if (saved) setNotice(navigator.onLine ? "Couldn't refresh this plan, so you're seeing your saved copy." : "You're offline, so this is your saved copy.");
      else setError(navigator.onLine ? e.message : "You're offline. Plans you've opened before still work; new ones need a connection.");
    } finally {
      setBusy(false);
    }
  }
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

  const openSaved = (t) => {
    setForm(t.input); setResult({ plan: t.plan, input: t.input });
    setEdits({}); setPace("mid"); setError(""); setNotice("");
    scrollToResults();
  };

  const exportPdf = () => {
    const old = document.title;
    document.title = `RoamPlan - ${result.plan.destination}`;
    window.print();
    document.title = old;
  };

  const exportIcs = () => {
    const blob = new Blob([buildIcs(result.plan, pace, edits[pace])], { type: "text/calendar;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `roamplan-${result.plan.destination.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "trip"}.ics`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
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
  const lastDay = plan?.plans[pace]?.days.at(-1)?.date;

  return (
    <>
      <header className="top">
        <div className="wrap bar">
          <a className="logo" href="/"><span className="mark" aria-hidden="true" />RoamPlan</a>
          <span className="small hide-sm tagline-top">Trips planned from open data</span>
        </div>
      </header>

      <section className="hero">
        <HeroArt />
        <div className="wrap hero-copy">
          <p className="eyebrow">Your next getaway</p>
          <h1>Where to, and <em>when?</em></h1>
          <p className="hero-sub">Add your places and dates. Get relaxed, balanced and packed itineraries built from real places, with the weather.</p>
        </div>
      </section>

      <main className="wrap">
        <TripForm value={form} onChange={setForm} onSubmit={run} busy={busy} error={error} status="" />

        {!plan && !busy && (
          <>
            <Ideas disabled={busy} onPick={(idea) => run(ideaForm(idea))} />
            <RecentTrips trips={trips} onOpen={openSaved} />
          </>
        )}

        <section ref={resultsRef} className="results" aria-live="polite">
          {busy && <Progress steps={steps.length ? steps : ["Getting started"]} />}
          {plan && (
            <div className={busy ? "dim" : ""}>
              <div className="print-only print-head">
                <b>RoamPlan</b> · {PACE_LABEL[pace]} pace · {fmtDate(result.input.startDate)}{lastDay && lastDay !== result.input.startDate ? ` to ${fmtDate(lastDay)}` : ""} · {result.input.travellers} {result.input.travellers == 1 ? "traveller" : "travellers"}
              </div>
              {notice && <p className="notice">{notice}</p>}
              <div className="head">
                <div>
                  <h2>{plan.destination}</h2>
                  <p className="muted">{plan.summary}</p>
                </div>
                <div className="head-tools">
                  <button type="button" className="ghost" onClick={share}>{shareMsg || "Share link"}</button>
                  <button type="button" className="ghost" onClick={exportIcs}>Add to calendar</button>
                  <button type="button" className="ghost" onClick={exportPdf}>PDF</button>
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
