// Live steps streamed from the server while a plan is built.
export default function Progress({ steps }) {
  return (
    <div className="card progress" role="status" aria-live="polite">
      <div className="progress-head">
        <span className="spinner" aria-hidden="true" />
        <b>Planning your trip</b>
      </div>
      <ol>
        {steps.map((s, i) => (
          <li key={i} className={i === steps.length - 1 ? "now" : "done"}>
            <span aria-hidden="true">{i === steps.length - 1 ? "•" : "✓"}</span> {s}
          </li>
        ))}
      </ol>
      <p className="muted small">New places can take up to a minute the first time. Popular ones are instant.</p>
    </div>
  );
}
