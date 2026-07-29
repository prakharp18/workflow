import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.warn("WARNING: GEMINI_API_KEY is not defined in your .env file.");
}

function checkApiKey() {
  if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY.trim() === "") {
    throw new Error(
      "GEMINI_API_KEY is missing or empty in your .env file.\n" +
      "👉 Get a free API key from Google AI Studio: https://aistudio.google.com/\n" +
      "👉 Paste it into your .env file like this: GEMINI_API_KEY=AIzaSyYourKeyHere"
    );
  }
}

// Pass apiKey or dummy to prevent Vertex AI fallback crashes
const ai = new GoogleGenAI({ apiKey: apiKey || "dummy_key" });

export interface ParsedResume {
  name: string;
  skills: string[];
  experience: string[];
  internships: string[];
  projects: string[];
  technologies: string[];
  productExperience: string[];
  designExperience: string[];
  achievements: string[];
}

export interface JobMatchResult {
  score: number;
  whyMatched: string;
  missingSkills: string[];
  resumeGaps: string;
  interviewProbability: string;
  salaryEstimate: string;
  applyRecommendation: string;
  estimatedCompetition: string;
  priorityScore: number;
}

export interface OutreachMessages {
  linkedinRequest: string;
  coldEmail: string;
  referralMessage: string;
}

export async function parseResume(resumeText: string): Promise<ParsedResume> {
  checkApiKey();
  const prompt = `
Analyze the following resume text and extract the details in a structured JSON format.
Include fields: name, skills, experience, internships, projects, technologies, productExperience, designExperience, achievements.
Provide a clear, high-quality extraction.

Resume Text:
${resumeText}
`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3.1-flash-lite",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            name: { type: "STRING" },
            skills: { type: "ARRAY", items: { type: "STRING" } },
            experience: { type: "ARRAY", items: { type: "STRING" } },
            internships: { type: "ARRAY", items: { type: "STRING" } },
            projects: { type: "ARRAY", items: { type: "STRING" } },
            technologies: { type: "ARRAY", items: { type: "STRING" } },
            productExperience: { type: "ARRAY", items: { type: "STRING" } },
            designExperience: { type: "ARRAY", items: { type: "STRING" } },
            achievements: { type: "ARRAY", items: { type: "STRING" } },
          },
          required: [
            "name",
            "skills",
            "experience",
            "internships",
            "projects",
            "technologies",
            "productExperience",
            "designExperience",
            "achievements",
          ],
        },
      },
    });

    const textResult = response.text || "{}";
    return JSON.parse(textResult) as ParsedResume;
  } catch (error) {
    console.error("Error calling Gemini for resume parsing:", error);
    throw error;
  }
}

export async function matchJob(
  jobDescription: string,
  jobTitle: string,
  companyName: string,
  resume: ParsedResume
): Promise<JobMatchResult> {
  checkApiKey();
  const prompt = `
Compare the job description against the candidate's resume and perform a thorough match.
Return a structured JSON output.

Candidate Resume Details:
${JSON.stringify(resume, null, 2)}

Job Details:
Company: ${companyName}
Title: ${jobTitle}
Description:
${jobDescription}
`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3.1-flash-lite",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            score: { type: "INTEGER", description: "Match score from 0 to 100" },
            whyMatched: { type: "STRING", description: "Clear explanation of how the candidate fits or doesn't fit" },
            missingSkills: { type: "ARRAY", items: { type: "STRING" }, description: "Skills requested in JD but missing in resume" },
            resumeGaps: { type: "STRING", description: "Specific missing experiences or gaps relative to this role" },
            interviewProbability: { type: "STRING", description: "Probability of getting an interview: High, Medium, or Low" },
            salaryEstimate: { type: "STRING", description: "Estimated salary if range is present or estimated based on role" },
            applyRecommendation: { type: "STRING", description: "Recommendation: Apply or Skip" },
            estimatedCompetition: { type: "STRING", description: "Estimated applicant competition level: High, Medium, Low" },
            priorityScore: { type: "INTEGER", description: "Priority score from 0 to 100 (combination of match score and freshness)" },
          },
          required: [
            "score",
            "whyMatched",
            "missingSkills",
            "resumeGaps",
            "interviewProbability",
            "salaryEstimate",
            "applyRecommendation",
            "estimatedCompetition",
            "priorityScore",
          ],
        },
      },
    });

    const textResult = response.text || "{}";
    return JSON.parse(textResult) as JobMatchResult;
  } catch (error) {
    console.error("Error calling Gemini for job matching:", error);
    throw error;
  }
}

export async function generateOutreach(
  jobTitle: string,
  companyName: string,
  resume: ParsedResume
): Promise<OutreachMessages> {
  checkApiKey();
  const prompt = `
Create outreach messages for:
Role: ${jobTitle}
Company: ${companyName}

Candidate Profile:
Name: ${resume.name}
Top Skills: ${resume.skills.slice(0, 5).join(", ")}
Top Technologies: ${resume.technologies.slice(0, 5).join(", ")}

Generate:
1. A LinkedIn connection note (strict limit: 300 characters, including spaces. Keep it professional, friendly, and concise).
2. A short cold email (impactful, clear value proposition, call to action).
3. A short referral message (suitable for asking an employee to refer the candidate).

Provide the output in JSON format.
`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3.1-flash-lite",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            linkedinRequest: { type: "STRING", description: "LinkedIn invite text (max 300 characters)" },
            coldEmail: { type: "STRING", description: "Cold email body" },
            referralMessage: { type: "STRING", description: "Referral request text" },
          },
          required: ["linkedinRequest", "coldEmail", "referralMessage"],
        },
      },
    });

    const textResult = response.text || "{}";
    return JSON.parse(textResult) as OutreachMessages;
  } catch (error) {
    console.error("Error generating outreach messages:", error);
    throw error;
  }
}
