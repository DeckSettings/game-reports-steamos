/**
 * File: update-issue-labels.js
 * Project: scripts
 * File Created: Thursday, 26th December 2024 10:04:20 pm
 * Author: Josh5 (jsunnex@gmail.com)
 * -----
 * Last Modified: Tuesday, 23rd September 2025 12:56:47 pm
 * Modified By: Josh.5 (jsunnex@gmail.com)
 */

import { Octokit } from "@octokit/rest";
import { extractHeadingValue } from "./common.js";
import dotenv from "dotenv";

dotenv.config(); // Load environment variables from .env for local testing

// Initialize Octokit with the provided GITHUB_TOKEN
const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN,
});

const DEFAULT_LAUNCHER_LABEL = "LAUNCHER: Other";

async function fetchLabels(owner, repo) {
  try {
    const { data: labels } = await octokit.issues.listLabelsForRepo({
      owner,
      repo,
    });
    return labels.map((label) => ({
      name: label.name,
      description: label.description || "",
    }));
  } catch (error) {
    console.error(`Error fetching labels: ${error.message}`);
    throw error;
  }
}

// Function to apply a label to an issue, removing outdated labels of the same type
async function applyLabel(
  octokit,
  owner,
  repo,
  issueNumber,
  labelType,
  newLabel
) {
  try {
    // Fetch existing labels on the issue
    const { data: issue } = await octokit.issues.get({
      owner,
      repo,
      issue_number: issueNumber,
    });

    const existingLabelNames = issue.labels.map((l) => l.name);

    // Determine which labels to remove (same type but different value)
    const prefix = (labelType + ":").toLowerCase();

    // Remove labels of this type that aren't the new one
    const labelsToRemove = existingLabelNames.filter((name) => {
      const isSameType = name.toLowerCase().startsWith(prefix);
      const isDifferent = !newLabel || name !== newLabel;
      return isSameType && isDifferent;
    });

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
    if (newLabel && !existingLabelNames.includes(newLabel)) {
      console.log(`Adding label: ${newLabel} to issue #${issueNumber}.`);
      await octokit.issues.addLabels({
        owner,
        repo,
        issue_number: issueNumber,
        labels: [newLabel],
      });
    } else if (!newLabel) {
      console.log("No matching label found. Not adding any label.");
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

    // Fetch all labels
    const labels = await fetchLabels(owner, repo);

    // Extract "Device" label value
    const deviceValue = extractHeadingValue(lines, "Device");
    if (deviceValue) {
      const deviceText = (deviceValue || "").trim();
      let matchingDeviceName = null;
      for (const label of labels) {
        const pattern = (label.description || "").trim();
        if (!pattern) continue;

        try {
          const re = new RegExp(pattern);
          if (re.test(deviceText)) {
            matchingDeviceName = label.name;
            break;
          }
        } catch (e) {
          console.warn(`Invalid regex in label "${label.name}": ${pattern}`);
        }
      }
      if (matchingDeviceName) {
        // Remove legacy lower-case labels
        await applyLabel(octokit, owner, repo, issueNumber, "device", null);
        // Add/Update labels
        await applyLabel(
          octokit,
          owner,
          repo,
          issueNumber,
          "DEVICE",
          matchingDeviceName
        );
      } else {
        console.log(`No device label found matching via regex: ${deviceText}`);
      }
    }

    // Extract "Launcher" label value
    const launcherValue = extractHeadingValue(lines, "Launcher");
    if (launcherValue) {
      const launcherText = launcherValue.trim();
      let matchingLauncherName = null;

      for (const label of labels) {
        const pattern = (label.description || "").trim();
        if (!pattern) continue;
        try {
          const re = new RegExp(pattern);
          if (re.test(launcherText)) {
            matchingLauncherName = label.name;
            break;
          }
        } catch (e) {
          console.warn(`Invalid regex in label "${label.name}": ${pattern}`);
        }
      }
      if (!matchingLauncherName) {
        console.log(
          `No launcher label found matching via regex: ${launcherText}. Defaulting to ${DEFAULT_LAUNCHER_LABEL}`
        );
        matchingLauncherName = DEFAULT_LAUNCHER_LABEL;
      }
      // Remove legacy lower-case labels
      await applyLabel(octokit, owner, repo, issueNumber, "launcher", null);
      // Add/Update labels
      await applyLabel(
        octokit,
        owner,
        repo,
        issueNumber,
        "LAUNCHER",
        matchingLauncherName
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
