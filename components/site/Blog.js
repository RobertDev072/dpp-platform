import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteHeader, SiteFooter, SITE_TEXT } from "@/components/site/SiteChrome";
import { getAllPosts, getPost, translationUrl, renderMarkdown, SITE_URL } from "@/lib/blog";

// Blogoverzicht en artikelpagina, gedeeld door /blog (Nederlands) en /en/blog (Engels).
const TEXT = {
  nl: {
    title: "Kennis en nieuws over het digitale productpaspoort",
    intro: "Wat de Europese regels betekenen voor jouw producten: uitleg, tijdlijnen en het laatste nieuws over DPP, ESPR en het EU-register.",
    guide: "Gids",
    news: "Nieuws",
    minutes: "min lezen",
    empty: "Binnenkort verschijnen hier de eerste artikelen.",
    back: "Alle artikelen",
    sources: "Bronnen",
    updated: "Bijgewerkt",
    disclaimer: "Dit artikel is algemene informatie en geen juridisch advies. Controleer voor jouw situatie altijd de officiële teksten op EUR-Lex.",
    ctaTitle: "Klaar voor het digitale productpaspoort?",
    ctaText: "Doe de gratis DPP-check of vraag een demo aan. Binnen een dag heb je je eerste paspoort met QR-code.",
    ctaCheck: "Doe de DPP-check",
    more: "Lees ook",
    locale: "nl-NL"
  },
  en: {
    title: "Digital product passport insights and news",
    intro: "What EU rules mean for your products: explainers, timelines and the latest news on DPP, ESPR and the EU registry.",
    guide: "Guide",
    news: "News",
    minutes: "min read",
    empty: "The first articles will appear here soon.",
    back: "All articles",
    sources: "Sources",
    updated: "Updated",
    disclaimer: "This article is general information, not legal advice. Always check the official texts on EUR-Lex for your situation.",
    ctaTitle: "Ready for the digital product passport?",
    ctaText: "Take the free DPP check or request a demo. Your first passport with QR code can be live within a day.",
    ctaCheck: "Take the DPP check",
    more: "Read next",
    locale: "en-GB"
  }
};

function formatDate(date, lang) {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString(TEXT[lang].locale, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

function PostCard({ post, lang }) {
  const t = TEXT[lang];
  return (
    <Link href={post.url} className="site-card flex flex-col p-6 no-underline">
      <div className="flex flex-wrap items-center gap-2 text-sm text-[var(--muted)]">
        <span className="site-chip">{post.category === "nieuws" ? t.news : t.guide}</span>
        <time dateTime={post.date}>{formatDate(post.date, lang)}</time>
        <span aria-hidden="true">·</span>
        <span>{post.readingMinutes} {t.minutes}</span>
      </div>
      <h2 className="mt-4 text-xl font-semibold leading-snug tracking-tight">{post.title}</h2>
      <p className="mt-2 text-[var(--muted)]">{post.description}</p>
    </Link>
  );
}

export function blogIndexMetadata(lang) {
  const t = TEXT[lang];
  return {
    title: lang === "nl" ? "Blog: digitaal productpaspoort (DPP)" : "Blog: digital product passport (DPP)",
    description: t.intro,
    alternates: {
      canonical: `${SITE_URL}${SITE_TEXT[lang].blog}`,
      languages: { nl: `${SITE_URL}/blog`, en: `${SITE_URL}/en/blog`, "x-default": `${SITE_URL}/blog` }
    },
    openGraph: { title: t.title, description: t.intro, url: `${SITE_URL}${SITE_TEXT[lang].blog}`, siteName: "VeriPasso", type: "website", images: [`${SITE_URL}/landing/og.png`] }
  };
}

export function BlogIndex({ lang }) {
  const t = TEXT[lang];
  const posts = getAllPosts(lang);
  return (
    <div className="site" lang={lang}>
      <div className="site-hero">
        <SiteHeader lang={lang} otherHref={lang === "nl" ? "/en/blog" : "/blog"} />
        <div className="mx-auto max-w-6xl px-4 pb-16 pt-10 sm:px-6 sm:pb-20 sm:pt-14">
          <p className="site-eyebrow text-white/85">Blog</p>
          <h1 className="mt-4 max-w-3xl text-4xl font-semibold leading-[1.05] tracking-tight sm:text-6xl">{t.title}</h1>
          <p className="mt-5 max-w-2xl text-lg text-white/75">{t.intro}</p>
        </div>
      </div>
      <main className="mx-auto max-w-6xl px-4 pt-12 sm:px-6">
        {posts.length === 0 ? (
          <p className="text-[var(--muted)]">{t.empty}</p>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {posts.map((post) => <PostCard key={post.slug} post={post} lang={lang} />)}
          </div>
        )}
      </main>
      <SiteFooter lang={lang} />
    </div>
  );
}

export function blogStaticParams(lang) {
  return getAllPosts(lang).map((p) => ({ slug: p.slug }));
}

export function articleMetadata(lang, slug) {
  const post = getPost(lang, slug);
  if (!post) return {};
  const other = translationUrl(post);
  const url = `${SITE_URL}${post.url}`;
  const languages = { [lang]: url };
  if (other) languages[lang === "nl" ? "en" : "nl"] = `${SITE_URL}${other}`;
  return {
    title: post.title,
    description: post.description,
    keywords: post.tags,
    alternates: { canonical: url, languages },
    openGraph: { title: post.title, description: post.description, url, siteName: "VeriPasso", type: "article", publishedTime: post.date, modifiedTime: post.updated || post.date, tags: post.tags, images: [`${SITE_URL}/landing/og.png`] },
    twitter: { card: "summary_large_image", title: post.title, description: post.description }
  };
}

export function Article({ lang, slug }) {
  const post = getPost(lang, slug);
  if (!post) notFound();
  const t = TEXT[lang];
  const other = translationUrl(post);
  const related = getAllPosts(lang).filter((p) => p.slug !== post.slug).slice(0, 3);
  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": post.category === "nieuws" ? "NewsArticle" : "Article",
      headline: post.title,
      description: post.description,
      datePublished: post.date,
      dateModified: post.updated || post.date,
      inLanguage: lang,
      keywords: post.tags.join(", "),
      mainEntityOfPage: `${SITE_URL}${post.url}`,
      image: `${SITE_URL}/landing/og.png`,
      author: { "@type": "Organization", name: "VeriPasso", url: SITE_URL },
      publisher: { "@type": "Organization", name: "VeriPasso", url: SITE_URL, logo: { "@type": "ImageObject", url: `${SITE_URL}/brand/veripasso-icon.svg` } },
      citation: post.sources.filter((s) => s.url).map((s) => s.url)
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "VeriPasso", item: SITE_URL },
        { "@type": "ListItem", position: 2, name: "Blog", item: `${SITE_URL}${SITE_TEXT[lang].blog}` },
        { "@type": "ListItem", position: 3, name: post.title, item: `${SITE_URL}${post.url}` }
      ]
    }
  ];
  return (
    <div className="site" lang={lang}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <div className="site-hero">
        <SiteHeader lang={lang} otherHref={other || undefined} />
        <div className="mx-auto max-w-3xl px-4 pb-14 pt-8 sm:px-6 sm:pt-12">
          <Link href={SITE_TEXT[lang].blog} className="text-sm font-semibold text-white/75 no-underline hover:text-white">← {t.back}</Link>
          <div className="mt-6 flex flex-wrap items-center gap-2 text-sm text-white/75">
            <span className="site-chip !bg-white/15 !text-white">{post.category === "nieuws" ? t.news : t.guide}</span>
            <time dateTime={post.date}>{formatDate(post.date, lang)}</time>
            {post.updated && <span>· {t.updated} {formatDate(post.updated, lang)}</span>}
            <span aria-hidden="true">·</span>
            <span>{post.readingMinutes} {t.minutes}</span>
          </div>
          <h1 className="mt-4 text-3xl font-semibold leading-[1.1] tracking-tight sm:text-5xl">{post.title}</h1>
          <p className="mt-4 text-lg text-white/75">{post.description}</p>
        </div>
      </div>
      <main className="mx-auto max-w-3xl px-4 pt-10 sm:px-6">
        <article className="article" dangerouslySetInnerHTML={{ __html: renderMarkdown(post.body) }} />
        {post.tags.length > 0 && (
          <ul className="mt-10 flex flex-wrap gap-2" aria-label="Tags">
            {post.tags.map((tag) => <li key={tag} className="site-chip">#{tag}</li>)}
          </ul>
        )}
        {post.sources.length > 0 && (
          <section className="mt-10 rounded-2xl border border-[var(--line)] bg-white p-6">
            <h2 className="text-lg font-semibold">{t.sources}</h2>
            <ul className="mt-3 space-y-2 text-[0.95rem]">
              {post.sources.map((s) => (
                <li key={s.title + s.url}>
                  {s.url ? <a className="text-[var(--blue)] underline underline-offset-2" href={s.url} target="_blank" rel="noopener noreferrer">{s.title}</a> : s.title}
                </li>
              ))}
            </ul>
            <p className="mt-4 text-sm text-[var(--muted)]">{t.disclaimer}</p>
          </section>
        )}
        <section className="site-hero mt-12 rounded-3xl p-8 sm:p-10">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">{t.ctaTitle}</h2>
          <p className="mt-3 max-w-xl text-white/75">{t.ctaText}</p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link className="site-btn" href={SITE_TEXT[lang].check}>{t.ctaCheck}</Link>
            <a className="site-btn-ghost text-white" href="/#start">{SITE_TEXT[lang].nav.demo}</a>
          </div>
        </section>
        {related.length > 0 && (
          <section className="mt-14">
            <h2 className="text-2xl font-semibold tracking-tight">{t.more}</h2>
            <div className="mt-5 grid gap-5 sm:grid-cols-2">
              {related.slice(0, 2).map((p) => <PostCard key={p.slug} post={p} lang={lang} />)}
            </div>
          </section>
        )}
      </main>
      <SiteFooter lang={lang} />
    </div>
  );
}
