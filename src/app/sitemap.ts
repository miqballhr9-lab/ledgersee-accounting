import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = await siteUrl();
  return [
    {
      url: `${base}/`,
      changeFrequency: "weekly",
      priority: 1,
    },
  ];
}
