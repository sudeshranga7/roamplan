// Pre-fetches popular destinations into .seed/ (committed), so they plan instantly even after
// Render wipes .cache/. Run occasionally: `npm run seed`. Respects Nominatim's 1 request/second,
// so a full run takes 15 to 30 minutes. Already-seeded places are skipped unless older than 180 days.
process.env.ROAMPLAN_SEED = "1";
const { geocode, fetchPois, blurb, CATS } = require("../planner");

const PLACES = [
  // India
  "Goa", "Mumbai", "Delhi", "Jaipur", "Udaipur", "Agra", "Varanasi", "Rishikesh", "Manali", "Bengaluru", "Kochi", "Pondicherry", "Hampi",
  // Abroad
  "Dubai", "Bangkok", "Phuket", "Singapore", "Ubud", "Seminyak", "Tokyo", "Kyoto", "Osaka",
  "Paris", "London", "Rome", "Barcelona", "Amsterdam", "Istanbul", "New York",
];

(async () => {
  const only = process.argv.slice(2);
  for (const name of only.length ? only : PLACES) {
    const t = Date.now();
    try {
      const geo = await geocode(name);
      if (!geo) { console.log(`✗ ${name}: not found`); continue; }
      const { pois, failed } = await fetchPois(geo, Object.keys(CATS));
      await blurb(name);
      console.log(`${failed.length ? "~" : "✓"} ${name}: ${pois.length} places${failed.length ? `, failed: ${failed.join(", ")}` : ""} (${Math.round((Date.now() - t) / 1000)}s)`);
    } catch (e) {
      console.log(`✗ ${name}: ${e.message}`);
    }
  }
})();
