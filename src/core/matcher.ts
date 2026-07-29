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
  "new grad",
  "intern",
  "product designer",
  "ux designer",
  "ui designer",
  "ux/ui designer",
  "visual designer",
  "interaction designer",
  "product manager",
  "product analyst",
  "product operations",
];

export function preFilterJob(title: string, description: string): { pass: boolean; reason?: string } {
  const cleanTitle = title.toLowerCase();
  
  // Check ignore keywords
  for (const keyword of IGNORE_TITLE_KEYWORDS) {
    if (cleanTitle.includes(keyword)) {
      // Small exception: e.g. "lead" but also contains "intern" or something? Usually not.
      return { pass: false, reason: `Title contains ignored keyword: ${keyword}` };
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

  // Check experience requirements in description (rough regex)
  // Look for patterns like "3+ years", "4+ years", "5+ years", "3-5 years", "3 to 5 years" etc.
  const expRegex = /(\d+)\s*\+?\s*years?/gi;
  let match;
  while ((match = expRegex.exec(description)) !== null) {
    const years = parseInt(match[1], 10);
    if (years >= 3) {
      // If it explicitly asks for 3+ years, reject it during pre-filter to save LLM tokens/costs
      // unless title contains "intern" or "associate"
      if (!cleanTitle.includes("intern") && !cleanTitle.includes("associate") && !cleanTitle.includes("graduate")) {
        return { pass: false, reason: `Description requests ${years}+ years of experience (threshold: < 3 years)` };
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
  const filterResult = preFilterJob(jobTitle, jobDescription);
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
