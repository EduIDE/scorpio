import { Exercise } from "./exercise.model";
import { Result } from "./result.model";
import { ProgrammingSubmission } from "./submission.model";

export class StudentParticipation {
  public id?: number;

  public individualDueDate?: Date;
  public submissions?: ProgrammingSubmission[];
  public exercise?: Exercise;

  // workaround for strict template here, only used in case of StudentParticipation
  public participantName?: string;
  public participantIdentifier?: string;

  public repositoryUri?: string;
  public buildPlanId?: string;
  public branch?: string;

  constructor() {}
}

export function getLatestSubmission(
  participation: StudentParticipation | undefined,
): ProgrammingSubmission | undefined {
  if (!participation || !participation.submissions || participation.submissions.length === 0) {
    return undefined;
  }

  return participation?.submissions?.reduce((latestSubmission, currentSubmission) => {
    return latestSubmission.id! > currentSubmission.id! ? latestSubmission : currentSubmission;
  });
}

export function getLatestResultBySubmission(
  submission: ProgrammingSubmission | undefined,
): Result | undefined {
  if (!submission || !submission.results || submission.results.length === 0) {
    return undefined;
  }

  return submission?.results?.reduce((latestResult, currentResult) => {
    return latestResult.id! > currentResult.id! ? latestResult : currentResult;
  });
}

export function getLatestResult(
  participation: StudentParticipation | undefined,
): Result | undefined {
  return getLatestResultBySubmission(getLatestSubmission(participation));
}

export function getProjectKeyFromRepoUrl(repoUrl: string): string {
  // extract projectKey {protocol}://{username}@{host}:{port}/git/{PROJECT_KEY}/{project_key}-{username}.git
  const parts = repoUrl.split("/");
  if (parts.length < 5) {
    throw new Error("Invalid artemis repository URL does not contain project key");
  }

  const projectKey = parts[4];
  return projectKey;
}
