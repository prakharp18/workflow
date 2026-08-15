import { CrawlerJob } from "./types";

export interface ATSConfig {
  boardToken: string;
  companyName: string;
}

function extractToken(input: string): string {
  if (!input) return "";
  let clean = input.trim();
  if (clean.startsWith("http://") || clean.startsWith("https://")) {
    try {
      const url = new URL(clean);
      const parts = url.pathname.split("/").filter(p => p && p !== "embed" && p !== "job_board" && p !== "v1" && p !== "iframe");
      if (parts.length > 0) {
        return parts[0];
      }
    } catch (e) {}
  }
  return clean.replace(/\/$/, "");
}

export async function crawlGreenhouse(config: ATSConfig): Promise<CrawlerJob[]> {
  const token = extractToken(config.boardToken);
  if (!token) return [];
  
  const url = `https://boards-api.greenhouse.io/v1/boards/${token}/jobs?content=true`;
  console.log(`[Greenhouse] Crawling ${config.companyName} (Token: ${token})...`);
  
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/json",
      },
    });
    if (!res.ok) {
      throw new Error(`HTTP error ${res.status}`);
    }
    const data = (await res.json()) as any;
    if (!data.jobs) return [];

    return data.jobs.map((job: any) => ({
      title: job.title,
      companyName: config.companyName,
      url: job.absolute_url,
      description: job.content || "",
      location: job.location?.name || "Remote",
      postedAt: job.updated_at ? new Date(job.updated_at) : new Date(),
      rawJson: job,
    }));
  } catch (error) {
    console.error(`[Greenhouse] Error crawling ${config.companyName}:`, error);
    return [];
  }
}

export async function crawlLever(config: ATSConfig): Promise<CrawlerJob[]> {
  const token = extractToken(config.boardToken);
  if (!token) return [];

  const url = `https://api.lever.co/v0/postings/${token}?mode=json`;
  console.log(`[Lever] Crawling ${config.companyName} (Token: ${token})...`);

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/json",
      },
    });
    if (!res.ok) {
      throw new Error(`HTTP error ${res.status}`);
    }
    const data = (await res.json()) as any[];
    if (!Array.isArray(data)) return [];

    return data.map((job: any) => ({
      title: job.title,
      companyName: config.companyName,
      url: job.hostedUrl,
      description: `${job.description || ""}\n\n${(job.lists || []).map((l: any) => `${l.text}:\n${l.content}`).join("\n")}`,
      location: job.categories?.location || "Remote",
      postedAt: job.createdAt ? new Date(job.createdAt) : new Date(),
      rawJson: job,
    }));
  } catch (error) {
    console.error(`[Lever] Error crawling ${config.companyName}:`, error);
    return [];
  }
}

export async function crawlAshby(config: ATSConfig): Promise<CrawlerJob[]> {
  const token = extractToken(config.boardToken);
  if (!token) return [];

  console.log(`[Ashby] Crawling ${config.companyName} (Token: ${token})...`);

  const endpoints = [
    `https://api.ashbyhq.com/posting-api/job-board/${token}?includeLocation=true`,
    `https://api.ashbyhq.com/v1/iframe/${token}/jobs`,
  ];

  for (const url of endpoints) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          "Accept": "application/json",
        },
      });
      if (!res.ok) continue;

      const data = (await res.json()) as any;
      const jobList = data.jobs || data.postings || [];
      if (!Array.isArray(jobList) || jobList.length === 0) continue;

      return jobList.map((job: any) => ({
        title: job.title,
        companyName: config.companyName,
        url: job.jobUrl || job.hostedUrl || `https://jobs.ashbyhq.com/${token}/${job.id}`,
        description: job.descriptionHtml || job.description || job.summary || "",
        location: typeof job.location === "string" ? job.location : job.locationName || job.location?.name || "Remote",
        postedAt: job.publishedAt ? new Date(job.publishedAt) : new Date(),
        rawJson: job,
      }));
    } catch (error) {
      console.warn(`[Ashby] Endpoint failed for ${config.companyName} (${url}):`, error);
    }
  }

  console.error(`[Ashby] All endpoints failed for ${config.companyName}`);
  return [];
}
