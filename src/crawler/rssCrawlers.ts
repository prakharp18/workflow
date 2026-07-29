import { CrawlerJob } from "./types";

export async function crawlRemoteOK(): Promise<CrawlerJob[]> {
  console.log("[RemoteOK] Fetching jobs from RemoteOK API...");
  const url = "https://remoteok.com/api";
  
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });
    
    if (!res.ok) {
      throw new Error(`HTTP error ${res.status}`);
    }
    
    const data = (await res.json()) as any[];
    if (!Array.isArray(data)) return [];

    // The first item in RemoteOK response is a legal disclaimer/info, skip it
    const jobs = data.slice(1);

    return jobs.map((job: any) => ({
      title: job.position,
      companyName: job.company,
      url: job.url,
      description: job.description || "",
      location: job.location || "Remote",
      salary: job.salary_min && job.salary_max ? `$${job.salary_min} - $${job.salary_max}` : undefined,
      postedAt: job.date ? new Date(job.date) : new Date(),
      rawJson: job,
    }));
  } catch (error) {
    console.error("[RemoteOK] Error crawling:", error);
    return [];
  }
}

export async function crawlYCJobs(): Promise<CrawlerJob[]> {
  console.log("[YC Jobs] Fetching YC Jobs RSS feed...");
  const url = "https://www.ycombinator.com/jobs/feed";

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0",
      },
    });

    if (!res.ok) {
      throw new Error(`HTTP error ${res.status}`);
    }

    const xml = await res.text();
    const items = xml.split("<item>");
    const parsedJobs: CrawlerJob[] = [];

    for (const item of items.slice(1)) {
      try {
        const titleMatch = item.match(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/i);
        const linkMatch = item.match(/<link>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/link>/i);
        const descMatch = item.match(/<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/i);
        const pubDateMatch = item.match(/<pubDate>(.*?)<\/pubDate>/i);

        if (titleMatch && linkMatch) {
          const rawTitle = titleMatch[1].trim();
          const url = linkMatch[1].trim();
          const description = descMatch ? descMatch[1].trim() : "";
          const postedAt = pubDateMatch ? new Date(pubDateMatch[1]) : new Date();

          // Title formatting in YC feed is typically: "Software Engineer at Stripe" or similar.
          // Let's extract role title and company name
          let title = rawTitle;
          let companyName = "YC Startup";
          const atIndex = rawTitle.toLowerCase().lastIndexOf(" at ");
          if (atIndex > 0) {
            title = rawTitle.substring(0, atIndex).trim();
            companyName = rawTitle.substring(atIndex + 4).trim();
          }

          parsedJobs.push({
            title,
            companyName,
            url,
            description,
            location: "Remote/Hybrid",
            postedAt,
          });
        }
      } catch (itemErr) {
        console.error("[YC Jobs] Error parsing feed item:", itemErr);
      }
    }

    return parsedJobs;
  } catch (error) {
    console.error("[YC Jobs] Error crawling YC RSS:", error);
    return [];
  }
}
