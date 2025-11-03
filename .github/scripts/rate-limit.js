/**
 * File: rate-limit.js
 * Project: scripts
 * File Created: Monday, 3rd November 2025 10:00:00 am
 * Author: Josh.5 (jsunnex@gmail.com)
 * -----
 * Last Modified: Tuesday, 4th November 2025 12:04:02 am
 * Modified By: Josh.5 (jsunnex@gmail.com)
 */

import { Octokit } from "@octokit/rest";
import dotenv from "dotenv";

dotenv.config();

const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN,
});

async function checkForRecentSubmissions(owner, repo, issue) {
  const author = issue.user.login;
  const sixtySecondsAgo = new Date(Date.now() - 60000).toISOString();

  const {
    data: { items: issues },
  } = await octokit.search.issuesAndPullRequests({
    q: `repo:${owner}/${repo} author:${author} is:issue created:>=${sixtySecondsAgo}`,
  });

  if (issues.length <= 1) {
    console.log("No duplicate issues found.");
    return;
  }

  const sortedIssues = issues.sort(
    (a, b) => new Date(a.created_at) - new Date(b.created_at)
  );
  const oldestIssue = sortedIssues[0];

  if (issue.number === oldestIssue.number) {
    console.log(
      `This is the oldest issue (#${issue.number}), keeping it open.`
    );
    return;
  }

  console.log(
    `Closing issue #${issue.number} as a duplicate of #${oldestIssue.number}.`
  );
  await octokit.issues.addLabels({
    owner,
    repo,
    issue_number: issue.number,
    labels: ["invalid:submit-rate-limit"],
  });
  const commentBody = [
    "**Rate Limited:** This report was submitted too quickly after another.",
    "",
    "To prevent spam, we only allow one report per 60 seconds. This issue has been automatically closed.",
    "",
    "### What to do next:",
    `- **If this report is for the same game and configuration as your previous one,** please add any additional details to the original report: #${oldestIssue.number}`,
    "- **If you intended to submit a separate report for a different configuration of the same game,** you can re-open this issue and edit the report body. If no changes are needed, you can add a space to the end of the report to trigger our automation, which will remove the invalid label.",
    "",
    "> [!IMPORTANT]",
    "> To keep our repository tidy, this report will be permanently deleted within the next 24 hours if no action is taken.",
  ].join("\n");
  await octokit.issues.createComment({
    owner,
    repo,
    issue_number: issue.number,
    body: commentBody,
  });
  await octokit.issues.update({
    owner,
    repo,
    issue_number: issue.number,
    state: "closed",
  });
}

async function run() {
  const issueNumber = parseInt(process.env.ISSUE_NUMBER, 10);
  const owner = process.env.REPO_OWNER;
  const repo = process.env.REPO_NAME;

  if (!issueNumber || !owner || !repo) {
    console.error("Missing environment variables.");
    process.exit(1);
  }

  const { data: issue } = await octokit.issues.get({
    owner,
    repo,
    issue_number: issueNumber,
  });

  if (issue.pull_request) {
    console.log("Skipping pull request.");
    process.exit(0);
  }

  await checkForRecentSubmissions(owner, repo, issue);
}

run().catch((error) => {
  console.error("Error in script execution:", error);
  process.exit(1);
});
