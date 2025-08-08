/**
 * File: check-report-for-missing-data.js
 * Project: scripts
 * File Created: Thursday, 26th December 2024 10:12:11 pm
 * Author: Josh5 (jsunnex@gmail.com)
 * -----
 * Last Modified: Friday, 8th August 2025 12:50:53 pm
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
    "config/game-report-validation.json"
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

// Validate and label issue
async function processIssue(owner, repo, issue) {
  const body = issue.body || "";

  // Build object based on extracted values
  const reportData = buildReportData(body, validate.schema.properties)

  // Build a list of errors
  const errors = [];

  // Check the in-game settings markdown formatting
  ["Game Display Settings", "Game Graphics Settings"].forEach((section) => {
    const sectionContent = reportData[section];
    if (sectionContent) {
      const invalidLines = validateGameSettingsMarkdownSection(
        sectionContent.split(/\r?\n/)
      );
      if (invalidLines.length > 0) {
        invalidLines.forEach(({ line, lineNumber }) => {
          errors.push(
            `Invalid markdown for in-game settings in section '${section}' (Line ${lineNumber}): \`${line}\``
          );
          // if it’s an <img> tag, add the extra hint
          if (/^<img\s+/.test(line.trim())) {
            errors.push(
              "Images can be placed in the 'Additional Notes' section."
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
    await octokit.issues.get({ owner, repo, issue_number: issueNumber })
  ).data.labels.map((label) => label.name);

  if (!existingLabels.includes(incompleteLabel)) {
    await addIncompleteLabel(owner, repo, issueNumber);
  }

  await postValidationComment(owner, repo, issueNumber, errors);
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
    ...errors.map((error) => `- ${error}\n`),
    "Please edit the issue to include all required sections with the correct formatting.",
  ].join("\n");

  await octokit.issues.createComment({
    owner,
    repo,
    issue_number: issueNumber,
    body: commentBody,
  });
  console.log(`Posted validation comment on issue #${issueNumber}:`);
  console.log(commentBody);
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
      comment.body.includes("**Validation Failed:**")
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
  try {
    await octokit.issues.removeLabel({
      owner,
      repo,
      issue_number: issueNumber,
      name: incompleteLabel,
    });
    console.log(
      `Removed label "${incompleteLabel}" from issue #${issueNumber}`
    );
  } catch (error) {
    console.error(`Label not present on issue #${issueNumber}`);
  }
}

// Re-open previously closed issue
async function openPreviouslyClosedIssue(owner, repo, issueNumber) {
  try {
    console.log(`Reopening issue #${issue.number} — now valid.`);
    await octokit.issues.update({
      owner,
      repo,
      issue_number: issue.number,
      state: "open",
    });

    await octokit.issues.createComment({
      owner,
      repo,
      issue_number: issue.number,
      body:
        "Thanks for updating the report — this issue has now been reopened because all required sections appear to be complete. 🙌\n\n" +
        "If you have further questions or want help improving your report, feel free to reply here or reach out on Discord: **https://streamingtech.co.nz/discord**",
    });
  } catch (error) {
    console.error(
      `Error when re-opening issue #${issueNumber}: ${error.message}`
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
