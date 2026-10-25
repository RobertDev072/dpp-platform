import { Article, articleMetadata, blogStaticParams } from "@/components/site/Blog";

// Artikelen worden bij de build als statische pagina's gemaakt; onbekende slugs geven 404.
export const dynamicParams = false;
export function generateStaticParams() {
  return blogStaticParams("nl");
}

export async function generateMetadata({ params }) {
  const { slug } = await params;
  return articleMetadata("nl", slug);
}

export default async function BlogArticlePage({ params }) {
  const { slug } = await params;
  return <Article lang="nl" slug={slug} />;
}
