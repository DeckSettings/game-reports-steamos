/**
 * File: check-report-for-missing-data.js
 * Project: scripts
 * File Created: Thursday, 26th December 2024 10:12:11 pm
 * Author: Josh5 (jsunnex@gmail.com)
 * -----
 * Last Modified: Sunday, 29th December 2024 12:57:13 am
 * Modified By: Josh5 (jsunnex@gmail.com)
 */

import { Octokit } from "@octokit/rest";
import { extractHeadingValue } from "./common.js";
import dotenv from "dotenv";

dotenv.config(); // Load environment variables from .env for local testing

// Initialize Octokit with the provided GITHUB_TOKEN
const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN,
});

// Required sections for issue validation
const requiredSections = [
  {
    heading: "Game Name",
    required: true,
    type: "string",
    minLength: 2,
  },
  {
    heading: "App ID",
    required: false,
    type: "number",
    minLength: 1,
  },
  {
    heading: "Launcher",
    required: true,
    type: "string",
    minLength: 3,
  },
  {
    heading: "Device Compatibility",
    required: true,
    type: "string",
    minLength: 1,
  },
  {
    heading: "Target Framerate",
    required: true,
    type: "string",
    minLength: 1,
  },
  {
    heading: "Device",
    required: true,
    type: "string",
    minLength: 1,
  },
  {
    heading: "OS Version",
    required: true,
    type: "string",
    minLength: 1,
  },
  {
    heading: "Undervolt Applied",
    required: false,
    type: "string",
    minLength: 1,
  },
  {
    heading: "Steam Play Compatibility Tool Used",
    required: true,
    type: "string",
    minLength: 1,
  },
  {
    heading: "Compatibility Tool Version",
    required: true,
    type: "string",
    minLength: 1,
  },
  {
    heading: "Custom Launch Options",
    required: false,
    type: "string",
    minLength: 1,
  },
  {
    heading: "Frame Limit",
    required: false,
    type: "string",
    minLength: 1,
  },
  {
    heading: "Allow Tearing",
    required: false,
    type: "string",
    minLength: 1,
  },
  {
    heading: "Half Rate Shading",
    required: false,
    type: "string",
    minLength: 1,
  },
  {
    heading: "TDP Limit",
    required: false,
    type: "string",
    minLength: 1,
  },
  {
    heading: "Manual GPU Clock",
    required: false,
    type: "string",
    minLength: 1,
  },
  {
    heading: "Scaling Mode",
    required: true,
    type: "string",
    minLength: 1,
  },
  {
    heading: "Scaling Filter",
    required: true,
    type: "string",
    minLength: 1,
  },
  {
    heading: "Game Display Settings",
    required: true,
    type: "string",
    minLength: 1,
  },
  {
    heading: "Game Graphics Settings",
    required: false,
    type: "string",
    minLength: 1,
  },
  {
    heading: "Additional Notes",
    required: false,
    type: "string",
    minLength: 1,
  },
];

// Label for incomplete templates
const incompleteLabel = "invalid:template-incomplete";

// Validate and label issue
async function processIssue(owner, repo, issue) {
  const body = issue.body || "";
  const lines = body.split(/\r?\n/);

  const errors = [];
  for (const section of requiredSections) {
    const extractedValue = extractHeadingValue(lines, section.heading);
    if (extractedValue === null || extractedValue === "_No response_") {
      if (section.required) {
        console.error(`❌ Missing: "${section.heading}"`);
        errors.push(section.heading);
      } else {
        console.warn(
          `❕ Missing: "${section.heading}" but it is not required.`
        );
      }
    } else if (extractedValue.length < section.minLength) {
      console.error(
        `❌ "${section.heading}" is too short. Found: "${extractedValue}"`
      );
      errors.push(section.heading);
    } else if (section.type === "number" && isNaN(Number(extractedValue))) {
      console.error(
        `❌ "${section.heading}" should be a number. Found: "${extractedValue}"`
      );
      errors.push(section.heading);
    } else {
      console.log(`✔ "${section.heading}" OK: "${extractedValue}"`);
    }
  }

  const existingLabels = issue.labels.map((label) => label.name);
  const hasLabel = existingLabels.includes(incompleteLabel);

  if (errors.length > 0) {
    // If errors are present, label and comment
    if (!hasLabel) {
      await addIncompleteLabel(owner, repo, issue.number);
      await postValidationComment(owner, repo, issue.number, errors);
    } else {
      console.log(`Issue #${issue.number} already labeled. Skipping.`);
    }
  } else {
    // Remove labels and validation comments if issue is valid
    if (hasLabel) {
      await removeIncompleteLabel(owner, repo, issue.number);
    }
    await removeValidationComments(owner, repo, issue.number);
    console.log("All sections are valid.");
  }
}

// Add the "template-incomplete" label
async function addIncompleteLabel(owner, repo, issueNumber) {
  await octokit.issues.addLabels({
    owner,
    repo,
    issue_number: issueNumber,
    labels: [incompleteLabel],
  });
  console.log(`Added label "${incompleteLabel}" to issue #${issueNumber}`);
}

// Post comment prompting user to fix issue
async function postValidationComment(owner, repo, issueNumber, errors) {
  const commentBody = [
    "**Validation Failed:** Some required sections are missing or incomplete.\n",
    "### Sections to fix:",
    ...errors.map(
      (heading) =>
        `- Add/Update **${heading}** section:\n\`\`\`\n### ${heading}\n<${heading} data here>\n\`\`\`\n`
    ),
    "Please edit the issue to include all required sections.",
  ].join("\n");

  await octokit.issues.createComment({
    owner,
    repo,
    issue_number: issueNumber,
    body: commentBody,
  });
  console.log(`Posted validation comment on issue #${issueNumber}`);
}

// Remove validation comments from the issue
async function removeValidationComments(owner, repo, issueNumber) {
  const comments = await octokit.issues.listComments({
    owner,
    repo,
    issue_number: issueNumber,
  });

  const botComments = comments.data.filter(
    (comment) =>
      comment.user.login === "github-actions[bot]" &&
      comment.body.includes(
        "**Validation Failed:** Some required sections are missing or incomplete."
      )
  );

  for (const comment of botComments) {
    await octokit.issues.deleteComment({
      owner,
      repo,
      comment_id: comment.id,
    });
    console.log(
      `Deleted validation comment (ID: ${comment.id}) on issue #${issueNumber}`
    );
  }
}

// Remove the "template-incomplete" label
async function removeIncompleteLabel(owner, repo, issueNumber) {
  await octokit.issues.removeLabel({
    owner,
    repo,
    issue_number: issueNumber,
    name: incompleteLabel,
  });
  console.log(`Removed label "${incompleteLabel}" from issue #${issueNumber}`);
}

// Main entry point
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

  if (!issue.body) {
    console.log("Issue body is empty.");
    process.exit(0);
  }

  await processIssue(owner, repo, issue);
}

run().catch((error) => {
  console.error("Error in script execution:", error);
  process.exit(1);
});
