import { db } from "../db/db";
import { companies, eventsTimeline } from "../db/schema";
import { eq } from "drizzle-orm";
import { detectATS } from "./intelligenceAgent";

interface DiscoveredInfo {
  name: string;
  website: string;
  source: string;
  description?: string;
}

export async function discoverFromHNWhoIsHiring(): Promise<DiscoveredInfo[]> {
  console.log("[Discovery Agent] Finding the latest Hacker News 'Who is hiring' thread...");
  const searchStoryUrl = "https://hn.algolia.com/api/v1/search?query=Ask HN: Who is hiring&tags=story&hitsPerPage=1";
  const discovered: DiscoveredInfo[] = [];

  try {
    const resStory = await fetch(searchStoryUrl);
    if (!resStory.ok) throw new Error(`HTTP error ${resStory.status}`);
    const dataStory = (await resStory.json()) as { hits: any[] };
    
    if (dataStory.hits.length === 0) {
      console.log("[Discovery Agent] No 'Who is hiring' story found.");
      return [];
    }

    const storyId = dataStory.hits[0].objectID;
    console.log(`[Discovery Agent] Found thread ID: ${storyId}. Fetching hiring comments...`);

    const commentsUrl = `https://hn.algolia.com/api/v1/search?tags=comment,story_${storyId}&hitsPerPage=50`;
    const resComments = await fetch(commentsUrl);
    if (!resComments.ok) throw new Error(`HTTP error ${resComments.status}`);
    const dataComments = (await resComments.json()) as { hits: any[] };

    for (const hit of dataComments.hits) {
      const commentText = hit.comment_text || "";
      if (!commentText) continue;

      const match = commentText.match(/^(?:<p>)?<b>(.*?)<\/b>/i) || commentText.match(/^(?:<p>)?<strong>(.*?)<\/strong>/i);
      
      if (match) {
        const rawName = match[1].replace(/<[^>]*>/g, "").split("|")[0].trim();
        const name = rawName.replace(/\(.*?\)/g, "").trim();
        
        const urlMatch = commentText.match(/href="(https?:\/\/[^"]+)"/i);
        const website = urlMatch ? urlMatch[1] : `https://news.ycombinator.com/item?id=${hit.story_id}`;

        if (name && name.length > 1 && name.length < 30 && !name.toLowerCase().includes("hiring")) {
          discovered.push({
            name,
            website,
            source: `HN WhoIsHiring Thread #${storyId}`,
            description: commentText.substring(0, 200).replace(/<[^>]*>/g, ""),
          });
        }
      }
    }
  } catch (err) {
    console.error("[Discovery Agent] HN WhoIsHiring discovery failed:", err);
  }

  return discovered;
}

export async function discoverFromYCPortfolio(): Promise<DiscoveredInfo[]> {
  console.log("[Discovery Agent] Fetching new startup signals from Hacker News Show HN feed...");
  const feedUrl = "https://news.ycombinator.com/showrss";
  const discovered: DiscoveredInfo[] = [];

  try {
    const res = await fetch(feedUrl);
    if (!res.ok) throw new Error(`HTTP error ${res.status}`);
    const xml = await res.text();
    const items = xml.split("<item>");

    for (const item of items.slice(1)) {
      const titleMatch = item.match(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/i);
      const linkMatch = item.match(/<link>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/link>/i);

      if (titleMatch && linkMatch) {
        const rawTitle = titleMatch[1].replace("Show HN: ", "").trim();
        const name = rawTitle.split("-")[0].split(":")[0].split("—")[0].trim();
        const website = linkMatch[1].trim();
        
        if (name && name.length > 1 && name.length < 30) {
          discovered.push({
            name,
            website,
            source: "HN Show RSS",
          });
        }
      }
    }
  } catch (err) {
    console.error("[Discovery Agent] HN Show RSS discovery failed:", err);
  }

  return discovered;
}

export async function runCompanyDiscovery() {
  console.log("[Discovery Agent] Running discovery cycle...");
  
  const hnList = await discoverFromHNWhoIsHiring();
  const ycList = await discoverFromYCPortfolio();
  const allDiscovered = [...hnList, ...ycList];

  console.log(`[Discovery Agent] Discovered ${allDiscovered.length} company signals. Processing...`);

  let newlyMonitored = 0;

  for (const c of allDiscovered) {
    try {
      const existing = await db.query.companies.findFirst({
        where: eq(companies.name, c.name),
      });

      if (!existing) {
        console.log(`[Discovery Agent] New company detected: "${c.name}". Running ATS detection...`);
        const { atsType, atsUrl } = await detectATS(c.website);

        // Register company
        const [insertedCompany] = await db.insert(companies).values({
          name: c.name,
          website: c.website,
          atsType: atsType || "custom",
          atsUrl: atsUrl || c.website,
          isMonitored: true,
          sector: "AI & Startups",
          priority: 7, // default priority for newly discovered tech startups
          country: "India", // default monitor hub
          hiringMomentum: 60, // base momentum
          healthScore: 70, // base health
        }).returning();

        if (insertedCompany) {
          // Log Event Timeline
          await db.insert(eventsTimeline).values({
            companyId: insertedCompany.id,
            eventType: "discovered",
            description: `Company discovered via ${c.source}. Automatically detected ATS type: ${atsType || "custom"}.`,
          });

          newlyMonitored++;
        }
      }
    } catch (err) {
      console.error(`[Discovery Agent] Failed to process discovered company "${c.name}":`, err);
    }
  }

  console.log(`[Discovery Agent] Discovery cycle completed. Monitoring ${newlyMonitored} new companies.`);
}
