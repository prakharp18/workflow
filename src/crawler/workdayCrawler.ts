import { BaseCrawler } from "./baseCrawler";
import { CrawlerJob } from "./types";

export class WorkdayCrawler extends BaseCrawler {
  async crawl(): Promise<CrawlerJob[]> {
    console.log(`[Workday] Crawling ${this.companyName} at token/URL: ${this.boardToken}...`);
    
    let tenant = this.boardToken;
    let careerSite = "Careers";
    let baseUrl = `https://${tenant}.myworkdayjobs.com/en-US/${careerSite}`;

    if (this.boardToken.startsWith("http://") || this.boardToken.startsWith("https://")) {
      try {
        const urlObj = new URL(this.boardToken);
        tenant = urlObj.hostname.split(".")[0];
        const pathParts = urlObj.pathname.split("/").filter(p => p && p !== "wday" && p !== "cxs");
        
        if (pathParts.length >= 2 && (pathParts[0].includes("-") || pathParts[0] === "en-US")) {
          careerSite = pathParts[1];
        } else if (pathParts.length >= 1) {
          careerSite = pathParts[0];
        }
        baseUrl = `https://${tenant}.myworkdayjobs.com/en-US/${careerSite}`;
      } catch (e) {
        console.error("[Workday] Error parsing URL:", e);
      }
    }

    const apiUrl = `https://${tenant}.myworkdayjobs.com/wday/cxs/${tenant}/${careerSite}/jobs`;
    const crawledJobs: CrawlerJob[] = [];
    
    let offset = 0;
    const limit = 20;
    let total = 1;

    try {
      while (offset < total) {
        console.log(`[Workday] Fetching jobs for ${this.companyName} (Offset: ${offset})...`);
        const response = await fetch(apiUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Accept": "application/json, text/plain, */*",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept-Language": "en-US,en;q=0.9",
          },
          body: JSON.stringify({
            appliedFacets: {},
            limit: limit,
            offset: offset,
            searchText: ""
          })
        });

        if (!response.ok) {
          console.error(`[Workday] Failed to fetch API for ${this.companyName}: HTTP ${response.status} at ${apiUrl}`);
          break;
        }

        const data = await response.json() as any;
        
        if (data.total !== undefined) {
          total = data.total;
        }

        const postings = data.jobPostings || [];
        if (postings.length === 0) break;

        for (const job of postings) {
          const externalPath = job.externalPath || "";
          const absoluteUrl = externalPath.startsWith("http") ? externalPath : `${baseUrl}${externalPath}`;
          
          crawledJobs.push({
            title: job.title || "Unknown Job",
            companyName: this.companyName,
            url: absoluteUrl,
            description: job.bulletFields ? job.bulletFields.join("\n") : "Workday Job Posting",
            location: job.locationsText || "Remote/Hybrid",
            postedAt: new Date(),
            rawJson: job
          });
        }

        offset += limit;
        if (offset > 2000) break;
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    } catch (err) {
      console.error(`[Workday] Crawl failed for ${this.companyName}:`, err);
    }

    console.log(`[Workday] Found ${crawledJobs.length} total jobs for ${this.companyName}`);
    return crawledJobs;
  }
}
