import { BaseCrawler } from "./baseCrawler";
import { CrawlerJob } from "./types";
import { crawlGreenhouse } from "./atsCrawlers";

export class GreenhouseCrawler extends BaseCrawler {
  async crawl(): Promise<CrawlerJob[]> {
    return crawlGreenhouse({ boardToken: this.boardToken, companyName: this.companyName });
  }
}
