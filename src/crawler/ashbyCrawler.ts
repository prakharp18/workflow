import { BaseCrawler } from "./baseCrawler";
import { CrawlerJob } from "./types";
import { crawlAshby } from "./atsCrawlers";

export class AshbyCrawler extends BaseCrawler {
  async crawl(): Promise<CrawlerJob[]> {
    return crawlAshby({ boardToken: this.boardToken, companyName: this.companyName });
  }
}
