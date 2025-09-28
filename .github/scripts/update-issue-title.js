/**
 * File: update-issue-title.js
 * Project: scripts
 * File Created: Thursday, 26th December 2024 2:56:33 pm
 * Author: Josh5 (jsunnex@gmail.com)
 * -----
 * Last Modified: Sunday, 28th September 2025 2:23:45 pm
 * Modified By: Josh.5 (jsunnex@gmail.com)
 */

import { Octokit } from "@octokit/rest";
import { extractHeadingValue } from "./common.js";
import dotenv from "dotenv";

dotenv.config(); // Load environment variables from .env for local testing

/**
 * Return a value quoted/escaped for logfmt.
 * - Always wraps in double quotes
 * - Escapes backslashes and quotes
 * - Replaces control chars (incl. newlines/tabs) with spaces
 */
function toQuotedLogfmt(value) {
  const s = (value ?? "").toString();
  const normalized = s
    .replace(/[\r\n\t]+/g, " ") // linebreaks/tabs -> space
    .replace(/[\x00-\x1F\x7F]/g, " "); // other ASCII control -> space
  const escaped = normalized
    .replace(/\\/g, "\\\\") // backslash
    .replace(/"/g, '\\"'); // double quote
  return `"${escaped}"`;
}

/**
 * GitHub issue titles are limited (~256 chars). This keeps logfmt intact.
 */
function enforceTitleLimit(str, limit = 256) {
  if (str.length <= limit) return str;
  const ellipsis = "…";
  return str.slice(0, limit - ellipsis.length) + ellipsis;
}

/**
 * Updates the GitHub issue title based on its body content.
 */
async function run() {
  const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

  // Read Issue data
  const issueNumber = parseInt(process.env.ISSUE_NUMBER, 10);
  const owner = process.env.REPO_OWNER;
  const repo = process.env.REPO_NAME;
  if (!issueNumber || !owner || !repo) {
    console.error(
      "Missing required environment variables: ISSUE_NUMBER, REPO_OWNER, REPO_NAME"
    );
    process.exit(1);
  }

  // Fetch the current issue details
  const { data: issue } = await octokit.issues.get({
    owner,
    repo,
    issue_number: issueNumber,
  });
  const body = issue.body || "";
  const lines = body.split(/\r?\n/);

  // Process issue data
  try {
    // Extract values for "Game Name" and "Target Framerate", etc.
    const reportSummary = extractHeadingValue(lines, "Summary");
    const gameName = extractHeadingValue(lines, "Game Name");
    const targetFramerate = extractHeadingValue(lines, "Target Framerate");
    let appIdRaw = extractHeadingValue(lines, "App ID");

    // Check that gameName and targetFramerate exists. If not, then the issue will be marked as having an error. Lets quit this job
    if (!reportSummary) {
      console.log("No Summary provided in issue body");
      return;
    }
    if (!gameName) {
      console.log("No Game Name provided in issue body");
      return;
    }
    if (!targetFramerate) {
      console.log("No Target Framerate provided in issue body");
      return;
    }

    // App ID (optional, numeric only)
    if (appIdRaw === "_No response_") {
      appIdRaw = "";
    }
    if (!appIdRaw || isNaN(Number(appIdRaw))) {
      console.log(
        "No App ID provided in issue body, or App ID provided is not a number"
      );
      appIdRaw = "";
    }

    // Construct the new title
    let newTitle =
      `name=${toQuotedLogfmt(gameName)} ` +
      `appid=${toQuotedLogfmt(appIdRaw)} ` +
      `target_framerate=${toQuotedLogfmt(targetFramerate)} ` +
      `title=${toQuotedLogfmt(reportSummary)}`;

    // Enforce GitHub title limit without breaking quoting
    newTitle = enforceTitleLimit(newTitle);

    console.log("Parsed from issue body:");
    console.log(`  Game Name: ${gameName}`);
    console.log(`  App ID: ${appIdRaw}`);
    console.log(`  Target Framerate: ${targetFramerate}`);
    console.log(`  Summary: ${reportSummary}`);
    console.log("Constructed Title:");
    console.log(`  ${newTitle}`);
    console.log(`Current issue #${issue.number} title: "${issue.title}"`);

    if (issue.title !== newTitle) {
      // Update the issue title
      await octokit.issues.update({
        owner,
        repo,
        issue_number: issue.number,
        title: newTitle,
      });
      console.log(`Issue #${issue.number} title updated to: "${newTitle}"`);
    } else {
      console.log(
        `Issue #${issue.number} already has the correct title; skipping update.`
      );
    }
  } catch (error) {
    console.error("Error updating issue title:", error);
    process.exit(1);
  }
}

// Execute the main function
run().catch((error) => {
  console.error("An error occurred:", error);
  process.exit(1);
});
