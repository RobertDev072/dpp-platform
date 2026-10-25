import { BlogIndex, blogIndexMetadata } from "@/components/site/Blog";

export const metadata = blogIndexMetadata("nl");

export default function BlogPage() {
  return <BlogIndex lang="nl" />;
}
