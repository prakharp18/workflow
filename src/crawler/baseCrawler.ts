import { CrawlerJob } from "./types";

export abstract class BaseCrawler {
  protected boardToken: string;
  protected companyName: string;

  constructor(boardToken: string, companyName: string) {
    this.boardToken = boardToken;
    this.companyName = companyName;
  }

  abstract crawl(): Promise<CrawlerJob[]>;
}
