import type { JobAnalysis } from "../schemas/job-analysis.schema";

/**
 * A worked example shown to the model before the real input (few-shot).
 *
 * `output` is typed as JobAnalysis, so an example that drifts away from the
 * schema fails to compile, and the tests also validate it with Zod.
 */
export interface JobAnalysisExample {
  jobDescription: string;
  companyContext?: string;
  output: JobAnalysis;
}

/**
 * Examples used by prompt version 1.0.0. Do not edit: a released version
 * must keep producing the same prompt (see prompt-registry.ts).
 *
 * They cover all three seniority levels on purpose: a set that only shows
 * junior and mid roles would push the model away from "senior".
 * One example includes company context that must NOT leak into the skills.
 */
export const jobAnalysisExamples: readonly JobAnalysisExample[] = [
  {
    jobDescription: "Junior React developer.\nRequires 1 year of experience.",
    output: {
      summary: "Entry-level React developer role.",
      requiredSkills: ["React"],
      seniority: "junior",
      interviewTopics: ["React fundamentals"],
    },
  },
  {
    jobDescription:
      "Frontend developer with 5 years of React and TypeScript experience.",
    companyContext:
      "A logistics company whose backend is written in Go and deployed on Kubernetes.",
    output: {
      summary: "Mid-level frontend developer working with React and TypeScript.",
      requiredSkills: ["React", "TypeScript"],
      seniority: "mid",
      interviewTopics: ["React architecture", "TypeScript"],
    },
  },
  {
    jobDescription:
      "Staff Backend Engineer. 10+ years of experience. Lead the design of our " +
      "payments platform, mentor engineers, and own reliability. Deep knowledge " +
      "of Java and PostgreSQL required.",
    output: {
      summary:
        "Senior backend engineer leading design and reliability of a payments platform.",
      requiredSkills: ["Java", "PostgreSQL"],
      seniority: "senior",
      interviewTopics: [
        "Distributed systems design",
        "Database performance",
        "Mentoring and technical leadership",
      ],
    },
  },
];

/**
 * An example of a posting that does not say what level the role is: the
 * right answer is "unknown" and an empty skill list, not a guess and not
 * invented skills.
 */
export const unknownSeniorityExample: JobAnalysisExample = {
  jobDescription:
    "We are looking for a developer to join our team and help build our web platform. Friendly team, flexible hours.",
  output: {
    summary: "Developer role on a web platform. The posting gives few details.",
    requiredSkills: [],
    seniority: "unknown",
    interviewTopics: ["General software development experience"],
  },
};

/** Examples used by prompt version 1.1.0: the 1.0.0 set plus an "unknown" case. */
export const jobAnalysisExamplesWithUnknown: readonly JobAnalysisExample[] = [
  ...jobAnalysisExamples,
  unknownSeniorityExample,
];
