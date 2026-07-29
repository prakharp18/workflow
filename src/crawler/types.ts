export interface CrawlerJob {
  title: string;
  companyName: string;
  url: string;
  description: string;
  location?: string;
  salary?: string;
  postedAt?: Date;
  rawJson?: any;
}
