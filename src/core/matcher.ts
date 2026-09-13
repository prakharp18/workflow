import { ParsedResume, JobMatchResult, matchJob } from "./geminiService";

const IGNORE_TITLE_KEYWORDS = [
  "senior",
  "staff",
  "principal",
  "lead",
  "manager",
  "director",
  "vp",
  "head of",
  "architect",
  "sr.",
  "sr ",
  "sde 3",
  "sde-3",
  "sde iii",
  "sde-iii",
  "sde 2",
  "sde-2",
  "sde ii",
  "sde-ii",
  "lead engineer",
  "engineering manager",
];

const IGNORE_HIFI_COMPANIES = [
  "stripe",
  "google",
  "microsoft",
  "amazon",
  "meta",
  "apple",
  "netflix",
  "salesforce",
  "uber",
  "airbnb",
  "adobe",
  "oracle",
  "cisco",
  "intel",
  "nvidia",
  "goldman sachs",
  "morgan stanley",
  "jpmorgan",
];

const TARGET_TITLE_KEYWORDS = [
  "software engineer",
  "software developer",
  "full stack",
  "frontend",
  "backend",
  "platform engineer",
  "web developer",
  "ai engineer",
  "developer",
  "graduate engineer",
  "associate software engineer",
  "sde",
  "sde-1",
  "sde 1",
  "sde i",
  "new grad",
  "intern",
  "trainee",
  "junior",
  "product designer",
  "ux designer",
  "ui designer",
  "ux/ui designer",
  "visual designer",
  "interaction designer",
  "product manager",
  "associate product manager",
  "apm",
  "product analyst",
  "product operations",
  "operations associate",
  "business analyst",
  "data analyst",
  "non-voice",
  "non voice",
  "process associate",
  "operations specialist",
  "content specialist",
  "data annotator",
  "ai tutor",
  "ai trainer",
  "research associate",
  "support associate",
  "process executive",
];

export function preFilterJob(title: string, description: string, companyName?: string): { pass: boolean; reason?: string } {
  const cleanTitle = title.toLowerCase();
  const cleanCompany = (companyName || "").toLowerCase();

  // Exclude hi-fi / big tech companies
  for (const hifi of IGNORE_HIFI_COMPANIES) {
    if (cleanCompany.includes(hifi)) {
      return { pass: false, reason: `Excluded hi-fi / big tech company: ${hifi}` };
    }
  }
  
  // Check ignore keywords
  for (const keyword of IGNORE_TITLE_KEYWORDS) {
    if (cleanTitle.includes(keyword)) {
      // Exception: e.g. "lead" but also explicitly contains "intern"
      if (!cleanTitle.includes("intern")) {
        return { pass: false, reason: `Title contains ignored senior/lead keyword: ${keyword}` };
      }
    }
  }

  // Check target keywords
  let matchesTarget = false;
  for (const keyword of TARGET_TITLE_KEYWORDS) {
    if (cleanTitle.includes(keyword)) {
      matchesTarget = true;
      break;
    }
  }

  if (!matchesTarget) {
    return { pass: false, reason: "Title does not match targeted roles" };
  }

  // Check experience requirements in description
  const expRegex = /([0-9]+|one|two|three|four|five|six|seven|eight|nine|ten)\s*(?:-|to)?\s*([0-9]+|one|two|three|four|five|six|seven|eight|nine|ten)?\s*\+?\s*years?/gi;
  const wordToNum: Record<string, number> = {
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10
  };
  
  let match;
  while ((match = expRegex.exec(description)) !== null) {
    const rawMin = match[1].toLowerCase();
    const minYears = parseInt(rawMin, 10) || wordToNum[rawMin] || 0;
    
    if (minYears >= 3) {
      if (!cleanTitle.includes("intern") && !cleanTitle.includes("associate") && !cleanTitle.includes("graduate") && !cleanTitle.includes("trainee")) {
        return { pass: false, reason: `Description requests ${minYears}+ years of experience (candidate is 0-2 YOE entry level)` };
      }
    }
  }

  return { pass: true };
}

export async function evaluateJob(
  jobDescription: string,
  jobTitle: string,
  companyName: string,
  resume: ParsedResume
): Promise<{ matched: boolean; evaluation?: JobMatchResult; reason?: string }> {
  // 1. Run Pre-Filter
  const filterResult = preFilterJob(jobTitle, jobDescription, companyName);
  if (!filterResult.pass) {
    return { matched: false, reason: filterResult.reason };
  }

  // 2. Call Gemini
  try {
    const result = await matchJob(jobDescription, jobTitle, companyName, resume);
    const isGoodMatch = result.score >= 50 && result.applyRecommendation.toLowerCase() === "apply";
    return {
      matched: isGoodMatch,
      evaluation: result,
    };
  } catch (error: any) {
    return {
      matched: false,
      reason: `Gemini matching failed: ${error.message || error}`,
    };
  }
}
