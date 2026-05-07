/**
 * File: check-report-for-missing-data.js
 * Project: scripts
 * File Created: Thursday, 26th December 2024 10:12:11 pm
 * Author: Josh5 (jsunnex@gmail.com)
 * -----
 * Last Modified: Thursday, 7th May 2026 12:49:37 pm
 * Modified By: Josh.5 (jsunnex@gmail.com)
 */

import { Octokit } from "@octokit/rest";
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { buildReportData } from "./common.js";

dotenv.config(); // Load environment variables from .env for local testing

// Initialize Octokit with the provided GITHUB_TOKEN
const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN,
});

// Initialize AJV for schema validation
const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

// Read JSON schema
let validate;
try {
  const configPath = path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    "config/game-report-validation.json",
  );
  const schema = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  validate = ajv.compile(schema); // Compile schema for validation
  console.log("Loaded validation schema from JSON.");
} catch (error) {
  console.error("Failed to load validation schema:", error);
  process.exit(1);
}

// Label for incomplete templates
const incompleteLabel = "invalid:template-incomplete";
const maxGitHubRetries = 3;
const retryDelayMs = 1000;

// Validate and label issue
async function processIssue(owner, repo, issue) {
  const body = typeof issue.body === "string" ? issue.body : "";

  if (body.trim() === "") {
    await handleValidationFailure(owner, repo, issue.number, [
      "Issue body is empty.",
    ]);
    return;
  }

  // Build object based on extracted values
  let reportData;
  try {
    reportData = buildReportData(body, validate.schema.properties);
  } catch (error) {
    await handleValidationFailure(owner, repo, issue.number, [
      `Unable to parse issue body: ${error.message}`,
    ]);
    return;
  }

  // Build a list of errors
  const errors = [];

  // Check the in-game settings markdown formatting
  ["Game Display Settings", "Game Graphics Settings"].forEach((section) => {
    const sectionContent = reportData[section];
    if (sectionContent) {
      const invalidLines = validateGameSettingsMarkdownSection(
        sectionContent.split(/\r?\n/),
      );
      if (invalidLines.length > 0) {
        invalidLines.forEach(({ line, lineNumber }) => {
          errors.push(
            `Invalid markdown for in-game settings in section '${section}' (Line ${lineNumber}): \`${line}\``,
          );
          // if it’s an <img> tag, add the extra hint
          if (/^<img\s+/.test(line.trim())) {
            errors.push(
              "Images can be placed in the 'Additional Notes' section.",
            );
          }
        });
      }
    }
  });

  // Perform schema validation
  const valid = validate(reportData);
  if (!valid || errors.length > 0) {
    const schemaErrors = valid
      ? []
      : validate.errors.map((err) => {
          const field = err.instancePath.slice(1) || err.params.missingProperty;

          // Include allowed values in the error message if available
          let errorMessage = `${field}: ${err.message}`;
          if (err.keyword === "enum" && err.params.allowedValues) {
            errorMessage += ` (${err.params.allowedValues.join(", ")})`;
          }

          return errorMessage;
        });
    const allErrors = [...schemaErrors, ...errors];
    console.error("❌ Validation errors:", allErrors);
    await handleValidationFailure(owner, repo, issue.number, allErrors);
  } else {
    console.log("✔ Issue passes schema validation.");
    await removeValidationComments(owner, repo, issue.number);
    await removeIncompleteLabel(owner, repo, issue.number);
    if (issue.state === "closed") {
      await openPreviouslyClosedIssue(owner, repo, issue.number);
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableGitHubError(error) {
  const status = error?.status;
  const causeCode = error?.cause?.code;
  const message = error?.message || "";

  return (
    status === 429 ||
    status >= 500 ||
    causeCode === "UND_ERR_SOCKET" ||
    message.includes("fetch failed") ||
    message.includes("other side closed")
  );
}

async function withGitHubRetry(operationName, fn) {
  let lastError;

  for (let attempt = 1; attempt <= maxGitHubRetries; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (!isRetryableGitHubError(error) || attempt === maxGitHubRetries) {
        throw error;
      }

      console.warn(
        `${operationName} failed on attempt ${attempt}/${maxGitHubRetries}: ${error.message}`,
      );
      await sleep(retryDelayMs * attempt);
    }
  }

  throw lastError;
}

// Additional checks for in-game settings markdown sections
function validateGameSettingsMarkdownSection(lines) {
  // Allow only:
  //  • level-4 headings (#### …)
  //  • list items (- **Label:** value)
  const validLineRegex = /^((####\s.*)|(-\s\*\*[^:]+:\*\*\s.*))$/;
  const invalidLines = [];

  lines.forEach((line, index) => {
    const trimmedLine = line.trim();
    if (trimmedLine === "" || validLineRegex.test(trimmedLine)) {
      return;
    }
    invalidLines.push({ line: trimmedLine, lineNumber: index + 1 });
  });

  return invalidLines;
}

// Handle validation failures (add label and comment)
async function handleValidationFailure(owner, repo, issueNumber, errors) {
  const existingLabels = (
    await withGitHubRetry(
      "Fetch issue before validation failure handling",
      () => octokit.issues.get({ owner, repo, issue_number: issueNumber }),
    )
  ).data.labels.map((label) => label.name);

  if (!existingLabels.includes(incompleteLabel)) {
    await addIncompleteLabel(owner, repo, issueNumber);
  }

  await postValidationComment(owner, repo, issueNumber, errors);
}

// Add the "template-incomplete" label
async function addIncompleteLabel(owner, repo, issueNumber) {
  await withGitHubRetry(`Add incomplete label to issue #${issueNumber}`, () =>
    octokit.issues.addLabels({
      owner,
      repo,
      issue_number: issueNumber,
      labels: [incompleteLabel],
    }),
  );
  console.log(`Added label "${incompleteLabel}" to issue #${issueNumber}`);
}

// Post comment prompting user to fix issue
async function postValidationComment(owner, repo, issueNumber, errors) {
  const commentBody = [
    "**Validation Failed:** Some required sections are missing or incomplete.\n",
    "### Sections to fix:",
    ...errors.map((error) => `- ${error}\n`),
    "Please edit the issue to include all required sections with the correct formatting.",
  ].join("\n");

  await withGitHubRetry(
    `Post validation comment on issue #${issueNumber}`,
    () =>
      octokit.issues.createComment({
        owner,
        repo,
        issue_number: issueNumber,
        body: commentBody,
      }),
  );
  console.log(`Posted validation comment on issue #${issueNumber}:`);
  console.log(commentBody);
}

// Remove validation comments from the issue
async function removeValidationComments(owner, repo, issueNumber) {
  let comments;
  try {
    comments = await withGitHubRetry(
      `List validation comments for issue #${issueNumber}`,
      () =>
        octokit.issues.listComments({
          owner,
          repo,
          issue_number: issueNumber,
        }),
    );
  } catch (error) {
    console.warn(
      `Unable to fetch comments for issue #${issueNumber}; continuing without comment cleanup: ${error.message}`,
    );
    return;
  }

  const botComments = comments.data.filter(
    (comment) =>
      comment.user.login === "github-actions[bot]" &&
      comment.body.includes("**Validation Failed:**"),
  );

  for (const comment of botComments) {
    await withGitHubRetry(
      `Delete validation comment ${comment.id} on issue #${issueNumber}`,
      () =>
        octokit.issues.deleteComment({
          owner,
          repo,
          comment_id: comment.id,
        }),
    );
    console.log(
      `Deleted validation comment (ID: ${comment.id}) on issue #${issueNumber}`,
    );
  }
}

// Remove the "template-incomplete" label
async function removeIncompleteLabel(owner, repo, issueNumber) {
  try {
    await withGitHubRetry(
      `Remove incomplete label from issue #${issueNumber}`,
      () =>
        octokit.issues.removeLabel({
          owner,
          repo,
          issue_number: issueNumber,
          name: incompleteLabel,
        }),
    );
    console.log(
      `Removed label "${incompleteLabel}" from issue #${issueNumber}`,
    );
  } catch (error) {
    console.error(`Label not present on issue #${issueNumber}`);
  }
}

// Re-open previously closed issue
async function openPreviouslyClosedIssue(owner, repo, issueNumber) {
  try {
    console.log(`Reopening issue #${issueNumber} — now valid.`);
    await withGitHubRetry(`Reopen issue #${issueNumber}`, () =>
      octokit.issues.update({
        owner,
        repo,
        issue_number: issueNumber,
        state: "open",
      }),
    );

    await withGitHubRetry(`Post reopen comment on issue #${issueNumber}`, () =>
      octokit.issues.createComment({
        owner,
        repo,
        issue_number: issueNumber,
        body:
          "Thanks for updating the report — this issue has now been reopened because all required sections appear to be complete. 🙌\n\n" +
          "If you have further questions or want help improving your report, feel free to reply here or reach out on Discord: **https://streamingtech.co.nz/discord**",
      }),
    );
  } catch (error) {
    console.error(
      `Error when re-opening issue #${issueNumber}: ${error.message}`,
    );
  }
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

  const { data: issue } = await withGitHubRetry(
    `Fetch issue #${issueNumber}`,
    () =>
      octokit.issues.get({
        owner,
        repo,
        issue_number: issueNumber,
      }),
  );

  if (issue.pull_request) {
    console.log("Skipping pull request.");
    process.exit(0);
  }

  await processIssue(owner, repo, issue);
}

run().catch((error) => {
  console.error("Error in script execution:", error);
  process.exit(1);
});
