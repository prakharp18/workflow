import { BaseCrawler } from "./baseCrawler";
import { GreenhouseCrawler } from "./greenhouseCrawler";
import { LeverCrawler } from "./leverCrawler";
import { AshbyCrawler } from "./ashbyCrawler";
import { WorkdayCrawler } from "./workdayCrawler";
import { CompanyCrawler } from "./companyCrawler";

export function getCrawler(atsType: string, boardToken: string, companyName: string): BaseCrawler {
  const type = atsType ? atsType.toLowerCase() : "custom";
  
  switch (type) {
    case "greenhouse":
      return new GreenhouseCrawler(boardToken, companyName);
    case "lever":
      return new LeverCrawler(boardToken, companyName);
    case "ashby":
      return new AshbyCrawler(boardToken, companyName);
    case "workday":
      return new WorkdayCrawler(boardToken, companyName);
    case "custom":
    default:
      console.log(`[Registry] ATS type "${atsType}" not native. Initializing generic CompanyCrawler plugin for ${companyName}`);
      return new CompanyCrawler(boardToken, companyName); // falls back to loading career URL
  }
}
export { BaseCrawler };
