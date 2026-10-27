import { useEffect, useState } from "react";
import { getWeather } from "../lib.js";

export default function Weather({ places, startDate, days }) {
  const [list, setList] = useState(null);

  useEffect(() => {
    let off = false;
    setList(null);
    Promise.all(places.map((p) => getWeather(p, startDate, days).catch(() => ({ place: p, error: "Unavailable" }))))
      .then((r) => !off && setList(r));
    return () => { off = true; };
  }, [places.join("|"), startDate, days]);

  if (!list) return <div className="weather">{places.map((p) => <div key={p} className="card wcard skeleton" />)}</div>;

  const wet = list.filter((w) => !w.error && (w.rain >= 60 || w.mm >= 40)).map((w) => w.place);
  return (
    <>
      {wet.length > 0 && <p className="notice">Rain is likely in {wet.join(", ")}. Keep indoor backups (cafés, museums) handy.</p>}
      <div className="weather">
        {list.map((w) => w.error ? (
          <div className="card wcard" key={w.place}><div className="place">{w.place}</div><div className="row">{w.error}</div></div>
        ) : (
          <div className="card wcard" key={w.place}>
            <div className="place">{w.place}</div>
            <div className="temp">{w.hi}°<span> / {w.lo}°C</span></div>
            <div className="row">{w.desc} · {w.rain != null ? `${w.rain}% rain chance` : `${w.mm} mm rain`}</div>
            <div className="row faint">{w.typical ? "Typical for these dates (last year)" : "Forecast"}</div>
          </div>
        ))}
      </div>
    </>
  );
}
