/** Input caps. The prompts only read the first part of the CV and the vacancy, so longer text only costs tokens. */
export const LIMITS = {
  cv: 6_000,
  jobDescription: 3_000,
  targetRole: 120,
  answer: 4_000,
  minQuestions: 2,
  maxQuestions: 5,
  maxBodyBytes: 100_000,
  // Session token carries the CV and every turn, so it gets a larger cap.
  maxTokenChars: 160_000,
} as const
