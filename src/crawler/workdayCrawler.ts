import { BaseCrawler } from "./baseCrawler";
import { CrawlerJob } from "./types";

export class WorkdayCrawler extends BaseCrawler {
  async crawl(): Promise<CrawlerJob[]> {
    console.log(`[Workday] Crawling ${this.companyName} at token/URL: ${this.boardToken}...`);
    
    let tenant = this.boardToken;
    let careerSite = "Careers"; // Default Workday career site name
    let baseUrl = `https://${tenant}.myworkdayjobs.com/en-US/${careerSite}`;

    if (this.boardToken.startsWith("http")) {
      try {
        const urlObj = new URL(this.boardToken);
        tenant = urlObj.hostname.split(".")[0];
        const pathParts = urlObj.pathname.split("/").filter(p => p);
        // Workday URLs usually look like /en-US/stripe_careers
        if (pathParts.length > 1) {
            careerSite = pathParts[1];
        } else if (pathParts.length === 1) {
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
    let total = 1; // start with 1 to enter loop

    try {
        while (offset < total) {
            console.log(`[Workday] Fetching jobs for ${this.companyName} (Offset: ${offset})...`);
            const response = await fetch(apiUrl, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Accept": "application/json"
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
                const absoluteUrl = `${baseUrl}${job.externalPath}`;
                crawledJobs.push({
                    title: job.title || "Unknown Job",
                    companyName: this.companyName,
                    url: absoluteUrl,
                    description: "Workday Job - click apply link to view details",
                    location: job.locationsText || "Remote/Hybrid",
                    postedAt: new Date(), // Workday gives string like "Posted Today"
                    rawJson: job
                });
            }

            offset += limit;
            
            // Safety break to prevent infinite loops on weird API responses
            if (offset > 2000) break;
            
            // Rate limit safety
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    } catch (err) {
        console.error(`[Workday] Crawl failed for ${this.companyName}:`, err);
    }

    console.log(`[Workday] Found ${crawledJobs.length} total jobs for ${this.companyName}`);
    return crawledJobs;
  }
}
