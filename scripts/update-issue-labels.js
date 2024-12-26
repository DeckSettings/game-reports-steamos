/**
 * File: update-issue-labels.js
 * Project: scripts
 * File Created: Thursday, 26th December 2024 10:04:20 pm
 * Author: Josh5 (jsunnex@gmail.com)
 * -----
 * Last Modified: Thursday, 26th December 2024 10:17:26 pm
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

// Function to apply a label to an issue, removing outdated labels of the same type
async function applyLabel(
  octokit,
  owner,
  repo,
  issueNumber,
  labelType,
  labelValue
) {
  const newLabel = `${labelType}:${labelValue}`;

  try {
    // Fetch existing labels on the issue
    const { data: issue } = await octokit.issues.get({
      owner,
      repo,
      issue_number: issueNumber,
    });

    const existingLabelNames = issue.labels.map((label) => label.name);

    // Determine which labels to remove (same type but different value)
    const labelsToRemove = existingLabelNames.filter(
      (name) => name.startsWith(`${labelType}:`) && name !== newLabel
    );

    // Remove outdated labels
    for (const labelName of labelsToRemove) {
      console.log(`Removing old label: ${labelName}`);
      await octokit.issues.removeLabel({
        owner,
        repo,
        issue_number: issueNumber,
        name: labelName,
      });
    }

    // Add the new label if it's not already present
    if (labelValue && !existingLabelNames.includes(newLabel)) {
      console.log(`Adding label: ${newLabel}`);
      await octokit.issues.addLabels({
        owner,
        repo,
        issue_number: issueNumber,
        labels: [newLabel],
      });
    } else if (!labelValue) {
      console.log(
        "No matching label found or specified in issue text. Not adding any label."
      );
    } else {
      console.log(
        `Label "${newLabel}" already present on issue #${issueNumber}.`
      );
    }
  } catch (error) {
    console.error(`Error in applyLabel: ${error.message}`);
    throw error;
  }
}

// Main function to execute the labeling logic
async function run() {
  // Retrieve environment variables
  const issueNumber = parseInt(process.env.ISSUE_NUMBER, 10);
  const owner = process.env.REPO_OWNER;
  const repo = process.env.REPO_NAME;
  const orgLogin = process.env.ORG_LOGIN || "DeckSettings"; // Default to "DeckSettings" if not provided

  if (!issueNumber || !owner || !repo) {
    console.error(
      "Missing required environment variables: ISSUE_NUMBER, REPO_OWNER, REPO_NAME"
    );
    process.exit(1);
  }

  try {
    // Fetch the issue details
    const { data: issue } = await octokit.issues.get({
      owner,
      repo,
      issue_number: issueNumber,
    });

    const body = issue.body || "";
    const lines = body.split(/\r?\n/);

    // Extract "Device" label value
    const deviceValue = extractHeadingValue(lines, "Device");
    let newDeviceLabel = null;
    if (deviceValue) {
      const lowerDevice = deviceValue.toLowerCase();
      if (lowerDevice.includes("steam deck")) {
        newDeviceLabel = "steamdeck";
      } else if (lowerDevice.includes("ally")) {
        newDeviceLabel = "rogally";
      }
      await applyLabel(
        octokit,
        owner,
        repo,
        issueNumber,
        "device",
        newDeviceLabel
      );
    }

    // Extract "Launcher" label value
    const launcherValue = extractHeadingValue(lines, "Launcher");
    let newLauncherLabel = null;
    if (launcherValue) {
      const lowerLauncher = launcherValue.toLowerCase();
      if (lowerLauncher.includes("steam")) {
        newLauncherLabel = "steam";
      } else if (lowerLauncher.includes("heroic")) {
        newLauncherLabel = "heroic";
      } else if (lowerLauncher.includes("lutris")) {
        newLauncherLabel = "lutris";
      } else if (lowerLauncher.includes("bottles")) {
        newLauncherLabel = "bottles";
      } else {
        newLauncherLabel = "other";
      }
      await applyLabel(
        octokit,
        owner,
        repo,
        issueNumber,
        "launcher",
        newLauncherLabel
      );
    }
  } catch (error) {
    console.error(`Error in run: ${error.message}`);
    process.exit(1);
  }
}

// Execute the main function
run().catch((error) => {
  console.error("An error occurred:", error);
  process.exit(1);
});
