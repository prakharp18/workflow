import { BaseCrawler } from "./baseCrawler";
import { CrawlerJob } from "./types";
import { crawlLever } from "./atsCrawlers";

export class LeverCrawler extends BaseCrawler {
  async crawl(): Promise<CrawlerJob[]> {
    return crawlLever({ boardToken: this.boardToken, companyName: this.companyName });
  }
}
