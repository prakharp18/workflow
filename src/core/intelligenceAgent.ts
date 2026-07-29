import { db } from "../db/db";
import { companies } from "../db/schema";
import { eq } from "drizzle-orm";

interface HNHit {
  title: string;
  url: string;
  story_text?: string;
  created_at: string;
}

export async function discoverNewCompanies(): Promise<{ name: string; url: string; source: string }[]> {
  console.log("[Company Discovery] Checking Hacker News for expansion announcements...");
  const queries = [
    "India office",
    "Bangalore engineering",
    "Hyderabad office",
    "opening team India",
    "hiring in India",
  ];
  
  const discovered: { name: string; url: string; source: string }[] = [];

  for (const query of queries) {
    const searchUrl = `https://hn.algolia.com/api/v1/search_by_date?query=${encodeURIComponent(query)}&tags=story`;
    try {
      const res = await fetch(searchUrl);
      if (!res.ok) continue;
      const data = (await res.json()) as { hits: HNHit[] };
      
      for (const hit of data.hits) {
        if (!hit.title) continue;
        
        // Simple heuristic to extract company name from title
        // e.g., "Stripe opens new office in India" -> Stripe
        // We'll let LLM extract it later or use a basic regex
        const nameMatch = hit.title.match(/^([A-Z][a-zA-Z0-9\s]{1,15})\b/);
        const name = nameMatch ? nameMatch[1].trim() : "Unknown";
        
        if (name && name !== "Unknown" && name !== "I" && name !== "New" && name !== "How") {
          discovered.push({
            name,
            url: hit.url || `https://news.ycombinator.com/item?id=${(hit as any).objectID}`,
            source: `HN: ${hit.title}`,
          });
        }
      }
    } catch (err) {
      console.error(`[Company Discovery] Error querying "${query}":`, err);
    }
  }

  // Deduplicate results
  const unique = new Map<string, typeof discovered[0]>();
  for (const item of discovered) {
    unique.set(item.name.toLowerCase(), item);
  }

  return Array.from(unique.values());
}

export async function detectATS(url: string): Promise<{ atsType: string; atsUrl: string }> {
  try {
    console.log(`[ATS Detection] Scanning careers URL: ${url}`);
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!res.ok) {
      return { atsType: "custom", atsUrl: url };
    }
    const html = await res.text();
    const lowerHtml = html.toLowerCase();

    if (lowerHtml.includes("greenhouse.io") || url.includes("greenhouse.io")) {
      // Extract board token
      const match = url.match(/boards\.greenhouse\.io\/([^/?]+)/) || html.match(/boards\.greenhouse\.io\/([^/?"]+)/);
      return { atsType: "greenhouse", atsUrl: match ? match[1] : "" };
    }
    
    if (lowerHtml.includes("lever.co") || url.includes("lever.co")) {
      const match = url.match(/jobs\.lever\.co\/([^/?]+)/) || html.match(/jobs\.lever\.co\/([^/?"]+)/);
      return { atsType: "lever", atsUrl: match ? match[1] : "" };
    }

    if (lowerHtml.includes("ashbyhq.com") || url.includes("ashbyhq.com")) {
      const match = url.match(/ashbyhq\.com\/([^/?]+)/) || html.match(/ashbyhq\.com\/([^/?"]+)/);
      return { atsType: "ashby", atsUrl: match ? match[1] : "" };
    }

    return { atsType: "custom", atsUrl: url };
  } catch (error) {
    console.error(`[ATS Detection] Error parsing page ${url}:`, error);
    return { atsType: "custom", atsUrl: url };
  }
}

export async function registerDiscoveredCompany(name: string, careersUrl: string) {
  const existing = await db.query.companies.findFirst({
    where: eq(companies.name, name),
  });

  if (existing) {
    console.log(`[Company Discovery] Company "${name}" already registered`);
    return existing;
  }

  const { atsType, atsUrl } = await detectATS(careersUrl);
  
  const [newCompany] = await db.insert(companies).values({
    name,
    website: careersUrl,
    atsType,
    atsUrl,
    isMonitored: true,
  }).returning();

  console.log(`[Company Discovery] Successfully registered: ${name} (ATS: ${atsType})`);
  return newCompany;
}
