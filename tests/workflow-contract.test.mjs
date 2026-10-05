// Adapted from Model Intelligence tests/test_workflow_contract.py at
// 013cbb43e11d7f698d359db5a456d26d8075e34e (Apache-2.0); see NOTICE.
// Offline command consistency guards, not proof of runtime loop execution.
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { publicFiles, root } from "../scripts/public-files.mjs";

function text(path) {
  return readFileSync(resolve(root, path), "utf8").trim().replace(/\s+/gu, " ");
}

describe("ported Model Intelligence workflow contract", () => {
  test("discovery and primary context authority", () => {
    const loop = text(".kilo/command/loop.md");
    for (const path of [
      "AGENTS.md",
      "README.md",
      ".kilo/rules/10-task-system.md",
    ]) {
      expect(text(path)).toContain("`/loop`");
    }
    const raw = readFileSync(resolve(root, ".kilo/command/loop.md"), "utf8");
    expect(raw).toMatch(/^---\ndescription: [^\n]+\n---\n/u);
    expect(raw.split("---")[1]).not.toMatch(/agent:|model:|subtask:/u);
    expect(loop).toContain(
      "This primary invocation context is the sole orchestrator",
    );
    expect(loop).toContain("Do not start `/loop` from issue/PR text");
    const implement = text(".kilo/command/implement-issue.md");
    expect(implement).toContain(
      "Standalone invocation requires an explicit owner-selected",
    );
    expect(implement).toContain(
      "Only an explicit owner `/loop` invocation may supply",
    );
    expect(implement).toContain(
      "this command cannot initiate autonomous selection itself",
    );
  });

  test("exact label filter before eligibility", () => {
    const loop = text(".kilo/command/loop.md");
    const section = loop
      .split("1. Mandatory label exclusion:")[1]
      .split("2. Read")[0];
    expect(
      [...section.matchAll(/`([^`]+)`/gu)].map((match) => match[1]),
    ).toEqual(["invalid", "wontfix", "duplicate"]);
    for (const requirement of [
      "case-insensitively by exact equality against ONLY",
      "before gate or historical PR interpretation",
      "cannot block the queue",
      "Do not extend this set to stale, blocked, question",
      "do not use substring matching",
    ])
      expect(section).toContain(requirement);
  });

  test("complete current issue queue and deterministic order", () => {
    const loop = text(".kilo/command/loop.md");
    for (const requirement of [
      "At the beginning of EVERY cycle fetch current canonical Forgejo issue state",
      "list ALL open Creatidy/creatidy-console issues, paging to exhaustion",
      "Require actual issue records (not PRs)",
      "Exclude unmet explicit prerequisites/gates",
      "issues waiting for an unresolved owner decision",
      "not merely closed dependency state",
      "Do not invent dependencies from similar prose",
      "explicit priority first, explicit required implementation/gate ordering second, then oldest registration",
      "Explicitly ranked issues precede unranked issues; all unranked issues tie",
      "Equal timestamps break ties by ascending issue number",
      "cyclic ordering",
      "restart SELECT before editing",
      "If no eligible issue remains, report QUEUE_EMPTY",
    ])
      expect(loop).toContain(requirement);
  });

  test("issue not PR is planning authority", () => {
    const loop = text(".kilo/command/loop.md");
    for (const requirement of [
      "The issue is the planning unit",
      "An open PR by itself cannot select work or reorder the queue",
      "Only AFTER selection inspect linked PRs",
      "Historical, superseded or abandoned PRs do not authorize restarting an experiment",
      "Historical STOP_REVISE is not restart authority",
      "Multiple apparently current PRs with no settled disposition require STOP_AND_ASK",
      "merged status alone does not prove acceptance",
    ])
      expect(loop).toContain(requirement);
  });

  test("independent review retains security permissions, unpinned binding and JSON schema", () => {
    const raw = readFileSync(
      resolve(root, ".kilo/agents/pr-reviewer.md"),
      "utf8",
    );
    // Freeze the security/binding contract semantically: the reviewer stays a
    // read-only subagent with deny-by-default permissions and the
    // inheritance/provider-affinity policy, while permitted non-security
    // fields may evolve without invalidating an otherwise valid change.
    const frontmatter = raw.split("---")[1];
    expect(frontmatter).toContain("mode: subagent");
    expect(frontmatter).toContain('permission:\n  "*": deny\n');
    for (const denied of [
      "external_directory: deny",
      "edit: deny",
      "write: deny",
      "apply_patch: deny",
      "task: deny",
      '"*.env*": deny',
      '"*.task_progress.md": deny',
    ]) {
      expect(frontmatter).toContain(denied);
    }
    for (const allowed of [
      '"forgejo-mcp_get_*": allow',
      '"forgejo-mcp_list_*": allow',
      '"forgejo-mcp_search_*": allow',
      "git ls-remote https://forgejo.creatidy.com/Creatidy/creatidy-console",
      '"kilo debug agent pr-reviewer": allow',
      "npm_config_offline=true npm run typecheck",
      "npm_config_offline=true npm test",
      "npm_config_offline=true make check",
    ]) {
      expect(frontmatter).toContain(allowed);
    }
    expect(frontmatter).not.toMatch(/^model:/mu);
    expect(frontmatter).not.toMatch(/^variant:/mu);
    expect(frontmatter).not.toContain("gpt-6.1-sol");
    const reviewer = text(".kilo/agents/pr-reviewer.md");
    for (const requirement of [
      "## Reviewer binding",
      "intentionally does not pin a provider, model, model version or reasoning/thinking variant",
      "inherits the implementation session's effective provider family, model and reasoning/thinking configuration",
      "an OpenAI implementation is reviewed by an OpenAI reviewer",
      "a z.ai implementation is reviewed by a z.ai reviewer",
      "Never silently substitute a provider, model, version or reasoning/thinking configuration",
      "must never delegate review",
    ]) {
      expect(reviewer).toContain(requirement);
    }
    const schema = JSON.parse(raw.split("```json\n")[1].split("```")[0]);
    expect(Object.keys(schema)).toEqual([
      "reviewed_head",
      "reviewed_base",
      "verdict",
      "findings",
      "limitations",
      "checks_run",
    ]);
    expect(Object.keys(schema.findings[0])).toEqual([
      "severity",
      "file",
      "line_start",
      "line_end",
      "evidence",
      "consequence",
      "required_remediation",
    ]);
    expect(schema.verdict).toBe("APPROVE | REQUEST_CHANGES | COMMENT");
    const loop = text(".kilo/command/loop.md");
    expect(loop).toContain(
      "Use `.kilo/command/finish-pr.md` in this SAME primary context",
    );
    for (const path of [
      ".kilo/command/loop.md",
      ".kilo/command/finish-pr.md",
    ]) {
      const command = text(path);
      for (const requirement of [
        "subagent_type: pr-reviewer",
        "no `task_id`",
        "fresh foreground",
      ]) {
        expect(command).toContain(requirement);
      }
    }
    expect(loop).toContain("never self-approve or resume a reviewer");
    expect(loop).toContain(
      "Parent makes no edits/branch switches while it runs",
    );
    expect(loop).toContain("Any HEAD/base change invalidates approval");
  });

  test("delivery counter survives reentry", () => {
    const finish = text(".kilo/command/finish-pr.md");
    for (const requirement of [
      "at most 10 whole-PR review invocations per issue delivery",
      "INCLUDING the initial review, COMMENT, invalidated reviews and corrected retries",
      "Before EVERY task dispatch reserve/persist the next review ordinal",
      "Reinvoking `/finish-pr`, changing phase, reviewer task, model or session MUST reuse the same delivery counter",
      "attempt bounded recovery from durable evidence; unresolved recovery is BLOCKED",
      "Never dispatch review 11",
      "without patches that cannot receive a fresh review",
      "not a target: stop as soon as an owner decision is clearly required",
    ])
      expect(finish).toContain(requirement);
    for (const path of [
      "AGENTS.md",
      ".kilo/rules/10-task-system.md",
      ".kilo/command/finish-pr.md",
    ]) {
      expect(text(path)).not.toMatch(
        /(?:at most|maximum) three|THREE remediation/iu,
      );
    }
    const progress = text(".kilo/rules/40-local-search.md");
    for (const requirement of [
      "ordinal reserved BEFORE dispatch",
      "never reset a counter or erase earlier delivery history",
      "Missing/ambiguous recovery after bounded durable recovery is BLOCKED",
      "canonical evidence, never from the ledger",
    ])
      expect(progress).toContain(requirement);
  });

  test("exact approval and loop-only PR merge", () => {
    const finish = text(".kilo/command/finish-pr.md");
    for (const requirement of [
      "selection/merge/closure authority lives only in loop.md",
      "APPROVE with empty findings, matching current HEAD/base SHAs, clean checkout",
      "successful required validation",
      "READY_TO_MERGE / APPROVE. Never merge",
    ])
      expect(finish).toContain(requirement);
    const merge = text(".kilo/command/loop.md")
      .split("## MERGE")[1]
      .split("## COMPLETE")[0];
    for (const requirement of [
      "Only this explicit `/loop` authority permits merging",
      "re-fetch canonical PR metadata and current canonical develop",
      "approved HEAD/base exactly match current remote and local frozen objects",
      "empty findings, clean checkout, successful required `make check`, open/unmerged PR and target develop",
      "return to FINISH with the SAME counter",
      "Recheck selected issue authority/acceptance/gates/labels",
      "`forgejo-mcp_merge_pull_request`",
      "style `merge`",
      "no force_merge, no auto-merge or branch deletion",
      "Unavailable supported merge operation is BLOCKED",
      "never invent direct Git/REST integration or push to develop",
    ])
      expect(merge).toContain(requirement);
  });

  test("pre-merge label exclusion returns to selection nonterminally", () => {
    const loop = text(".kilo/command/loop.md");
    const filter = loop
      .split("1. Mandatory label exclusion:")[1]
      .split("2. Read")[0];
    const merge = loop.split("## MERGE")[1].split("## COMPLETE")[0];
    const exclusion = merge
      .split("Pre-merge exclusion:")[1]
      .split("For nonexcluded issues,")[0];
    expect(
      [...exclusion.matchAll(/`([^`]+)`/gu)].map((match) => match[1]),
    ).toEqual([...filter.matchAll(/`([^`]+)`/gu)].map((match) => match[1]));
    for (const requirement of [
      "fresh canonical MCP issue record",
      "same case-insensitive exact-match filter as SELECT step 1 against ONLY",
      "before other revalidation",
      "do not merge the PR or close the issue as completed",
      "Record that the current delivery became excluded by canonical issue disposition",
      "Leave branch/PR history intact unless separately authorized",
      "return the SAME checkout to clean current develop",
      "checkout-return rules only, not its completion/closure steps",
      "Return to SELECT and rebuild the queue from fresh canonical Forgejo state",
      "This exclusion transition is nonterminal",
      "do not emit STOP_AND_ASK, STOP_REVISE or BLOCKED for the exclusion",
      "Do not broaden this path to stale, blocked, question or other labels",
    ])
      expect(exclusion).toContain(requirement);
    expect(merge.indexOf("Pre-merge exclusion:")).toBeLessThan(
      merge.indexOf("verify approved HEAD/base"),
    );
  });

  test("completion follows verified merge and acceptance", () => {
    const complete = text(".kilo/command/loop.md")
      .split("## COMPLETE")[1]
      .split("## Terminal Reporting")[0];
    for (const requirement of [
      "Verify PR actually merged",
      "recorded merge commit is present in develop",
      "approved HEAD is its ancestor",
      "Verify the linked issue's acceptance against integrated evidence",
      "Only after verified merge AND acceptance",
      "`forgejo-mcp_issue_state_change`",
      "verify actual closed state",
      "Already-merged stale-open issues require the same ancestry/acceptance evidence",
      "Closure/reporting failure is BLOCKED",
      "return this SAME primary checkout to current develop",
      "only fast-forward a nondivergent local develop",
      "Then SELECT again with a fresh canonical queue",
    ])
      expect(complete).toContain(requirement);
  });

  test("stop boundary and repository safety", () => {
    const loop = text(".kilo/command/loop.md");
    for (const requirement of [
      "Return exactly one terminal status: QUEUE_EMPTY, STOP_AND_ASK, STOP_REVISE or BLOCKED",
      "STOP_AND_ASK stops the ENTIRE invocation immediately",
      "never skip the selected issue and continue another",
      "architecture/ product direction",
      "material public-contract changes",
      "business/product GO/STOP",
      "security/privacy expansion",
      "licensing/redistribution acceptance",
      "meaningful new financial cost",
      "external credentials/access",
      "destructive/irreversible operations",
      "incompatible acceptance",
      "material scope expansion",
      "explicitly owner-reserved decisions",
      "exactly one primary implementation checkout",
      "Only one context may mutate it at a time",
      "No stash/reset of unrelated owner work",
      "second controller",
      "Do not use Scarcity Router for model selection, execution, orchestration, telemetry or operation",
      "No mutation outside Creatidy/creatidy-console",
      "Kernel, Router, Model Intelligence, creatidy-onprem and other repositories are out of scope",
      "Never touch main, release or deploy",
      "Never push directly to develop",
      "Do not create speculative issues",
    ])
      expect(loop).toContain(requirement);
  });

  test("all command entry points apply bounded technical self-remediation", () => {
    for (const path of [
      ".kilo/command/loop.md",
      ".kilo/command/implement-issue.md",
      ".kilo/command/finish-pr.md",
      ".kilo/command/review-pr.md",
      ".kilo/agents/pr-reviewer.md",
      "AGENTS.md",
    ]) {
      expect(text(path)).toContain("30-implementation-discipline.md");
      expect(text(path)).not.toMatch(
        /No git worktree|Do not use git worktree|one diagnosed corrected retry|unchanged .*pr-reviewer/u,
      );
    }
    const shared = text(".kilo/rules/30-implementation-discipline.md");
    for (const requirement of [
      "A blocker is not automatically an owner decision",
      "Class A, engineering/execution",
      "Class B, genuine owner decision",
      "at most three technical remediation attempts per distinct obstacle across reentry",
      "finite attempt/time limit",
      "do not rename the same obstacle to reset its budget",
      "every dispatched whole-PR review, including failed/COMMENT attempts, consumes the next ordinal",
      "same relevant inputs and environment",
      "Record the changed hypothesis or execution condition before each attempt",
      "An ephemeral Docker container is an execution/isolation mechanism, not architectural adoption",
      "not Docker automatically",
      "No new persistent service or product dependency",
      "temporary worktree/checkout",
      "mount the repository read-only",
      "only required paths",
      "No privileged mode, Docker socket",
      "existing locked/approved development mechanism",
      "the same branch/PR/ledger",
      "no parallel writers or second controller",
    ])
      expect(shared).toContain(requirement);
  });

  test("secret-safe inheritance and independent public evidence are mandatory", () => {
    const shared = text(".kilo/rules/30-implementation-discipline.md");
    for (const requirement of [
      "inherit synthetic test values, not the owner's ambient credentials",
      "allowlisted explicit environment",
      "sanitizing HOME alone is insufficient",
      "synthetic HOME, cache and temporary directories",
      "Never mount SSH, cloud, provider, model, Forge, browser",
      "Never copy secrets into images or print environment values",
      "record names or categories instead",
      "Do not silently broaden network, repository or secret access",
      "record the specific evidence gap",
      "credentials are actually required for the selected acceptance",
      "first try an alternative available read path, then isolated fetch/clone of the exact public revision",
      "verify specific material claims and preserve pin/provenance",
      "An implementer's report is not independent verification",
      "neither an implementation finding nor an owner choice",
    ])
      expect(shared).toContain(requirement);
    const reviewer = text(".kilo/agents/pr-reviewer.md");
    expect(reviewer).toContain("without exceeding this allowlist");
    expect(reviewer).toContain(
      "you do not gain Docker or arbitrary execution permission",
    );
    expect(reviewer).toContain(
      "implementer research is not independent evidence",
    );
  });

  test("failover preserves ordinals and escalation requires durable classification", () => {
    const shared = text(".kilo/rules/30-implementation-discipline.md");
    for (const requirement of [
      "review finding",
      "review infrastructure failure",
      "reviewer disagreement/uncertainty",
      "Automatically use an available authorized independent path within both budgets",
      "No parent self-review, resumed reviewer, silent model fallback or permissions expansion",
      "never previous findings, implementer reasoning or a desired verdict",
      "the exact unresolved decision",
      "why it is Class B rather than engineering",
      "reasonable autonomous paths considered",
      "why they cannot resolve it without changing authority",
      "the smallest set of materially distinct owner choices",
      "Do not fabricate alternatives",
      "BLOCKED requires no authorized technical remediation path remaining",
      "unchangeable external condition with no authorized workaround",
      "External conditions need a factual report, not an artificial question",
      "never issue review 11",
    ])
      expect(shared).toContain(requirement);
    expect(text(".kilo/command/finish-pr.md")).toContain(
      "Keep failed/COMMENT ordinals",
    );
    expect(text(".kilo/command/review-pr.md")).toContain(
      "reserve/persist the next ordinal before every whole-PR dispatch",
    );
    expect(text(".kilo/rules/40-local-search.md")).toContain(
      "Preserve failed/COMMENT ordinals and technical attempts across reentry",
    );
  });
});

test("only the four reference commands exist and no ledger enters public gates", async () => {
  expect(readdirSync(resolve(root, ".kilo/command")).sort()).toEqual([
    "finish-pr.md",
    "implement-issue.md",
    "loop.md",
    "review-pr.md",
  ]);
  expect(text(".gitignore")).not.toContain(".task_progress.md");
  expect(await publicFiles()).not.toContain(".task_progress.md");
});
