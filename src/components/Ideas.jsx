import { iso, nextFriday } from "../lib.js";

// Ready-made trips to show what RoamPlan does; these places are pre-cached, so they plan instantly.
export const IDEAS = [
  { id: "goa", name: "Goa", vibe: "Office getaway", meta: "3 days · 16 people", form: { places: ["Goa"], days: 3, travellers: 16, interests: "beaches, cafés, clubs, watersports" } },
  { id: "tokyo", name: "Tokyo", vibe: "Neon & noodles", meta: "5 days · 2 people", form: { places: ["Tokyo"], days: 5, travellers: 2, interests: "food, sights, cafés, nightlife, shopping" } },
  { id: "bali", name: "Ubud → Seminyak", vibe: "Jungle to beach", meta: "6 days · 4 people", form: { places: ["Ubud", "Seminyak"], days: 6, travellers: 4, interests: "nature, beaches, cafés, watersports" } },
  { id: "paris", name: "Paris", vibe: "Art & cafés", meta: "4 days · 2 people", form: { places: ["Paris"], days: 4, travellers: 2, interests: "museums, cafés, food, sights" } },
  { id: "jaipur", name: "Jaipur", vibe: "Forts & bazaars", meta: "3 days · 4 people", form: { places: ["Jaipur"], days: 3, travellers: 4, interests: "heritage, shopping, food" } },
  { id: "kyoto", name: "Kyoto → Osaka", vibe: "Temples & street food", meta: "4 days · 2 people", form: { places: ["Kyoto", "Osaka"], days: 4, travellers: 2, interests: "temples, gardens, food, shopping" } },
];

export const ideaForm = (idea) => ({ prefs: [], ...idea.form, startDate: iso(nextFriday()) });

export default function Ideas({ onPick, disabled }) {
  return (
    <section className="ideas" aria-labelledby="ideas-h">
      <h3 id="ideas-h">Need ideas? Tap one</h3>
      <div className="idea-grid">
        {IDEAS.map((idea) => (
          <button key={idea.id} type="button" className={`idea idea-${idea.id}`} disabled={disabled} onClick={() => onPick(idea)}>
            <span className="idea-vibe">{idea.vibe}</span>
            <span className="idea-name">{idea.name}</span>
            <span className="idea-meta">{idea.meta}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
