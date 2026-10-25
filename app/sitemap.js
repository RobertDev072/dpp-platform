import { getAllPosts, SITE_URL } from "@/lib/blog";

// sitemap.xml voor zoekmachines: website, DPP-check en alle blogartikelen (NL en EN).
// Wordt bij elke build opnieuw gemaakt, dus nieuwe artikelen staan er vanzelf in.
export default function sitemap() {
  const today = new Date().toISOString().slice(0, 10);
  const pages = [
    { url: `${SITE_URL}/`, lastModified: today, changeFrequency: "monthly", priority: 1 },
    { url: `${SITE_URL}/dpp-check`, lastModified: today, changeFrequency: "monthly", priority: 0.9, alternates: { languages: { en: `${SITE_URL}/en/dpp-check` } } },
    { url: `${SITE_URL}/en/dpp-check`, lastModified: today, changeFrequency: "monthly", priority: 0.8, alternates: { languages: { nl: `${SITE_URL}/dpp-check` } } },
    { url: `${SITE_URL}/blog`, lastModified: today, changeFrequency: "daily", priority: 0.8 },
    { url: `${SITE_URL}/en/blog`, lastModified: today, changeFrequency: "daily", priority: 0.7 }
  ];
  const posts = ["nl", "en"].flatMap((lang) =>
    getAllPosts(lang).map((p) => ({
      url: `${SITE_URL}${p.url}`,
      lastModified: p.updated || p.date,
      changeFrequency: p.category === "nieuws" ? "monthly" : "weekly",
      priority: p.category === "gids" ? 0.7 : 0.6
    }))
  );
  return [...pages, ...posts];
}
