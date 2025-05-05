/**
 * File: close-stale-incomplete-reports.js
 * Project: scripts
 * File Created: Monday, 5th May 2025 11:57:32 am
 * Author: Josh.5 (jsunnex@gmail.com)
 * -----
 * Last Modified: Monday, 5th May 2025 12:28:11 pm
 * Modified By: Josh.5 (jsunnex@gmail.com)
 */

import { Octokit } from "@octokit/rest";
import dotenv from "dotenv";

dotenv.config();

const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN,
});

const SIX_DAYS_IN_MS = 6 * 24 * 60 * 60 * 1000;
const now = new Date();

async function closeOldIncompleteIssues(owner, repo) {
  let page = 1;
  const perPage = 50;
  let allIssues = [];

  console.log(`Fetching open issues from ${owner}/${repo}...`);

  while (true) {
    const { data: issues } = await octokit.issues.listForRepo({
      owner,
      repo,
      state: "open",
      per_page: perPage,
      page,
    });
    if (issues.length === 0) break;
    allIssues = allIssues.concat(issues);
    page++;
  }

  for (const issue of allIssues) {
    if (
      issue.pull_request ||
      !issue.labels.some((l) => l.name === "invalid:template-incomplete")
    )
      continue;

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
      (e) =>
        e.event === "labeled" && e.label?.name === "invalid:template-incomplete"
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
