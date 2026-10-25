import { Article, articleMetadata, blogStaticParams } from "@/components/site/Blog";

// Artikelen worden bij de build als statische pagina's gemaakt; onbekende slugs geven 404.
export const dynamicParams = false;
export function generateStaticParams() {
  return blogStaticParams("en");
}

export async function generateMetadata({ params }) {
  const { slug } = await params;
  return articleMetadata("en", slug);
}

export default async function BlogArticlePageEn({ params }) {
  const { slug } = await params;
  return <Article lang="en" slug={slug} />;
}
