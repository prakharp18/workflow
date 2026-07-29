import { CrawlerJob } from "./types";

export interface ATSConfig {
  boardToken: string;
  companyName: string;
}

// Greenhouse API
export async function crawlGreenhouse(config: ATSConfig): Promise<CrawlerJob[]> {
  const url = `https://boards-api.greenhouse.io/v1/boards/${config.boardToken}/jobs?content=true`;
  console.log(`[Greenhouse] Crawling ${config.companyName}...`);
  
  try {
    const res = await fetch(url);
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

// Lever API
export async function crawlLever(config: ATSConfig): Promise<CrawlerJob[]> {
  const url = `https://api.lever.co/v0/postings/${config.boardToken}?mode=json`;
  console.log(`[Lever] Crawling ${config.companyName}...`);

  try {
    const res = await fetch(url);
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

// Ashby API
export async function crawlAshby(config: ATSConfig): Promise<CrawlerJob[]> {
  const url = `https://api.ashbyhq.com/v1/iframe/${config.boardToken}/jobs`;
  console.log(`[Ashby] Crawling ${config.companyName}...`);

  try {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`HTTP error ${res.status}`);
    }
    const data = (await res.json()) as any;
    if (!data.jobs) return [];

    return data.jobs.map((job: any) => ({
      title: job.title,
      companyName: config.companyName,
      url: job.jobUrl,
      description: job.descriptionHtml || job.description || "",
      location: job.location || "Remote",
      postedAt: job.publishedAt ? new Date(job.publishedAt) : new Date(),
      rawJson: job,
    }));
  } catch (error) {
    console.error(`[Ashby] Error crawling ${config.companyName}:`, error);
    return [];
  }
}
