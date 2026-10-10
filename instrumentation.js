// Next.js roept register() één keer aan bij het starten van de server. De
// Node.js-specifieke achtergrondtaken staan in instrumentation-node.js, zodat de
// Edge-runtime die code nooit hoeft te analyseren.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.DISABLE_BACKGROUND_JOBS === "true") return;
  // Tijdens `next build` geen timers of databaseverbindingen.
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  await import("./instrumentation-node");
}
