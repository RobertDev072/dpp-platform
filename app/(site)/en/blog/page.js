import { BlogIndex, blogIndexMetadata } from "@/components/site/Blog";

export const metadata = blogIndexMetadata("en");

export default function BlogPageEn() {
  return <BlogIndex lang="en" />;
}
