// Shared route construction: no generic URL or producer-supplied host.
export const FORGEJO_ORIGIN = "https://forgejo.creatidy.com";
export const MAX_FORGEJO_SUBJECTS = 20;

export type ForgejoSubject = {
  repository: string;
  issue: string;
  base: string | null;
};

export function forgejoSubjectRoutes(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const { repository, issue, base } = value as Partial<ForgejoSubject>;
  if (
    typeof repository !== "string" ||
    !/^[A-Za-z0-9_-][A-Za-z0-9._-]{0,99}\/[A-Za-z0-9_-][A-Za-z0-9._-]{0,99}$/.test(
      repository,
    ) ||
    typeof issue !== "string" ||
    !/^[1-9][0-9]{0,18}$/.test(issue) ||
    BigInt(issue) > 9223372036854775807n
  )
    return null;
  const root = `${FORGEJO_ORIGIN}/${repository}`;
  return {
    repository,
    issue,
    issueHref: `${root}/issues/${issue}`,
    baseHref:
      typeof base === "string" && /^[0-9a-f]{40}$/.test(base)
        ? `${root}/commit/${base}`
        : null,
  };
}
