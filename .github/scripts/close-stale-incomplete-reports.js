/**
 * File: close-stale-incomplete-reports.js
 * Project: scripts
 * File Created: Monday, 5th May 2025 11:57:32 am
 * Author: Josh.5 (jsunnex@gmail.com)
 * -----
 * Last Modified: Monday, 5th January 2026 9:11:27 am
 * Modified By: Josh.5 (jsunnex@gmail.com)
 */

import { Octokit } from "@octokit/rest";
import { graphql } from "@octokit/graphql";
import dotenv from "dotenv";

dotenv.config();

const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN,
});

const graphqlWithAuth = graphql.defaults({
  headers: {
    authorization: `token ${process.env.GITHUB_TOKEN}`,
  },
});

const SIX_DAYS_IN_MS = 6 * 24 * 60 * 60 * 1000;
const now = new Date();

const INVALID_LABELS = [
  { name: "invalid:submit-rate-limit", state: "closed" },
  { name: "invalid:template-incomplete", state: "open" },
  { name: "invalid:report-inaccurate", state: "open" },
];

const STALE_LABELS = INVALID_LABELS.filter((l) => l.state === "open").map(
  (l) => l.name
);

async function deleteRateLimitedIssue(issue) {
  console.log(`Deleting issue #${issue.number} due to rate limiting...`);

  if (issue.node_id) {
    await graphqlWithAuth(
      `
        mutation ($input: DeleteIssueInput!) {
          deleteIssue(input: $input) {
            clientMutationId
          }
        }
      `,
      { input: { issueId: issue.node_id } }
    );
    console.log(`Issue #${issue.number} deleted.`);
  } else {
    console.log(`Could not find node_id for issue #${issue.number}.`);
  }
}

async function closeOldIncompleteIssues(owner, repo) {
  const perPage = 50;
  const allIssues = new Map();

  console.log(`Fetching issues with invalid labels from ${owner}/${repo}...`);

  for (const labelInfo of INVALID_LABELS) {
    let page = 1;
    while (true) {
      const { data: issues } = await octokit.issues.listForRepo({
        owner,
        repo,
        state: labelInfo.state,
        labels: labelInfo.name,
        per_page: perPage,
        page,
      });
      if (issues.length === 0) break;
      for (const issue of issues) {
        if (!allIssues.has(issue.id)) {
          allIssues.set(issue.id, issue);
        }
      }
      page++;
    }
  }

  for (const issue of allIssues.values()) {
    if (issue.pull_request) continue;

    if (issue.labels.some((l) => l.name === "invalid:submit-rate-limit")) {
      // Note: delete on next sweep (no 24h grace). This could mean only moments after the issue was created. This is accepted.
      await deleteRateLimitedIssue(issue);
      continue;
    }

    if (
      issue.state === "open" &&
      issue.labels.some((l) => STALE_LABELS.includes(l.name))
    ) {
      const events = await octokit.paginate(
        octokit.issues.listEventsForTimeline,
        {
          owner,
          repo,
          issue_number: issue.number,
          per_page: 100,
        }
      );

      const labelEvent = events.find(
        (e) => e.event === "labeled" && STALE_LABELS.includes(e.label?.name)
      );

      if (!labelEvent) continue;

      const labelDate = new Date(labelEvent.created_at);
      const ageMs = now - labelDate;

      if (ageMs > SIX_DAYS_IN_MS) {
        console.log(
          `Closing issue #${issue.number} (label applied ${Math.floor(
            ageMs / (1000 * 60 * 60 * 24)
          )} days ago)...`
        );

        await octokit.issues.createComment({
          owner,
          repo,
          issue_number: issue.number,
          body:
            "This issue has been automatically closed because the report remained incomplete for over 6 days after being flagged.\n\n" +
            "To resolve this, simply **edit the issue body** to fix the missing or incorrectly formatted sections. Our automated checks will re-validate your report and **automatically reopen it** if everything looks correct.\n\n" +
            "If you need help or have any questions, feel free to leave a comment or reach out on our Discord support server: **https://streamingtech.co.nz/discord**\n\n" +
            "Thanks for contributing!",
        });
        await octokit.issues.update({
          owner,
          repo,
          issue_number: issue.number,
          state: "closed",
        });
      }
    }
  }

  console.log("Finished checking for stale incomplete issues.");
}

async function run() {
  const owner = process.env.REPO_OWNER;
  const repo = process.env.REPO_NAME;

  if (!owner || !repo || !process.env.GITHUB_TOKEN) {
    console.error(
      "Missing required environment variables: REPO_OWNER, REPO_NAME, or GITHUB_TOKEN"
    );
    process.exit(1);
  }

  try {
    await closeOldIncompleteIssues(owner, repo);
  } catch (err) {
    console.error("Failed to close stale issues:", err);
    process.exit(1);
  }
}

run();
