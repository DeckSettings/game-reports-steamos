/**
 * File: update-issue-title.js
 * Project: scripts
 * File Created: Thursday, 26th December 2024 2:56:33 pm
 * Author: Josh5 (jsunnex@gmail.com)
 * -----
 * Last Modified: Sunday, 29th December 2024 12:53:56 am
 * Modified By: Josh5 (jsunnex@gmail.com)
 */

import { Octokit } from "@octokit/rest";
import { extractHeadingValue } from "./common.js";
import dotenv from "dotenv";

dotenv.config(); // Load environment variables from .env for local testing

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
    // Extract values for "Game Name" and "Target Framerate"
    const gameName = extractHeadingValue(lines, "Game Name");
    const targetFramerate = extractHeadingValue(lines, "Target Framerate");
    const appIdRaw = extractHeadingValue(lines, "App ID");

    // Check that gameName and targetFramerate exists. If not, then the issue will be marked as having an error. Lets quit this job
    if (!gameName) {
      console.log("No Game Name provided in issue body");
      return;
    }
    if (!targetFramerate) {
      console.log("No Target Framerate provided in issue body");
      return;
    }

    // If we have an appId and it is a number (will be '_No response_' if nothing was submitted) then we will add it, otherwise this will be an empty value
    if (appIdRaw == "_No response_") {
      appIdRaw = "";
    }
    const appIdNum = Number(appIdRaw);
    if (!appIdRaw || Number.isNaN(appIdNum)) {
      console.log(
        "No App ID provided in issue body, or App ID provided is not a number"
      );
      appIdNum = ""; // Set appIdNum to and empty string
    }

    // Construct the new title
    const newTitle = `name="${gameName}" appid="${appIdNum}" target_framerate="${targetFramerate}"`;
    console.log("Parsed from issue body:");
    console.log(`  Game Name: ${gameName}`);
    console.log(`  Target Framerate: ${targetFramerate}`);
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
