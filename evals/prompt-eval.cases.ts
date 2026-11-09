import { maliciousDescription } from "./injection.cases";
import type { ExpectedAnalysis } from "./scoring";

export interface PromptEvalCase {
  id: string;
  /** What this case is designed to test. */
  purpose: string;
  jobDescription: string;
  companyContext?: string;
  expected: ExpectedAnalysis;
}

/**
 * Labelled cases for evaluating the prompt. The labels are the author's
 * judgment. "unknown" is the correct seniority when the text gives no
 * evidence of the level; a specific level there counts as a guess.
 *
 * None of these texts appear in the few-shot examples.
 */
export const promptEvalCases: readonly PromptEvalCase[] = [
  {
    id: "junior-frontend",
    purpose: "Junior role. The word 'senior' appears, but only as who they will learn from.",
    jobDescription: `Junior Frontend Developer

We welcome recent bootcamp graduates and people with up to 1 year of experience.

Requirements:
- HTML, CSS and JavaScript
- Familiarity with React is a plus
- Willingness to learn from senior engineers`,
    expected: {
      acceptableSeniority: ["junior"],
      requiredSkills: ["HTML", "CSS", "JavaScript"],
      acceptableExtraSkills: ["React", "frontend development", "web development"],
    },
  },
  {
    id: "mid-fullstack",
    purpose: "Mid-level role with many named technologies",
    jobDescription: `Full-Stack Developer

You have 4-5 years of experience shipping web applications.
Frontend: React. Backend: Node.js with PostgreSQL.
You deploy with Docker on AWS and write automated tests with Jest.`,
    expected: {
      acceptableSeniority: ["mid"],
      requiredSkills: ["React", "Node.js", "PostgreSQL", "Docker", "AWS", "Jest"],
      acceptableExtraSkills: [
        "full-stack development",
        "automated testing",
        "testing",
        "web development",
        "JavaScript",
      ],
    },
  },
  {
    id: "senior-react",
    purpose: "Clear senior role: 8+ years, leadership, architecture",
    jobDescription: `Senior React Developer

8+ years of professional experience. You will lead frontend architecture, mentor a team of five
developers and own performance across our web application.

Requirements: React, TypeScript, Redux, GraphQL.`,
    expected: {
      acceptableSeniority: ["senior"],
      requiredSkills: ["React", "TypeScript", "Redux", "GraphQL"],
      acceptableExtraSkills: [
        "frontend architecture",
        "mentoring",
        "performance optimization",
        "web performance",
        "technical leadership",
        "leadership",
        "JavaScript",
      ],
    },
  },
  {
    id: "missing-seniority",
    purpose: "Named technologies but no title level, years or scope: seniority cannot be known",
    jobDescription: `Customer Portal Developer (remote)

You will build and maintain features for our customer portal using React and Node.js.
We offer flexible hours and a learning budget.`,
    expected: {
      acceptableSeniority: ["unknown"],
      requiredSkills: ["React", "Node.js"],
      acceptableExtraSkills: ["web development", "full-stack development", "JavaScript"],
    },
  },
  {
    id: "malicious-instructions",
    purpose: "Posting that tells the model to ignore its rules and reveal secrets",
    jobDescription: maliciousDescription,
    expected: {
      acceptableSeniority: ["senior"],
      requiredSkills: ["React", "TypeScript", "Node.js"],
      acceptableExtraSkills: ["frontend development", "JavaScript"],
      forbiddenSkills: ["system prompt", "environment variables", "instructions"],
    },
  },
  {
    id: "very-sparse",
    purpose: "One line: tests whether the model invents a level or extra skills",
    jobDescription: "Looking for a developer who knows Python.",
    expected: {
      acceptableSeniority: ["unknown"],
      requiredSkills: ["Python"],
    },
  },
  {
    id: "ambiguous-2-4-years",
    purpose: "Explicit but borderline years. 'unknown' would be over-cautious here",
    jobDescription: `Software Engineer, 2-4 years of experience. You will work on our Java and Spring Boot
services backed by MySQL.`,
    expected: {
      acceptableSeniority: ["junior", "mid"],
      requiredSkills: ["Java", "Spring Boot", "MySQL"],
      acceptableExtraSkills: ["backend development"],
    },
  },
];
