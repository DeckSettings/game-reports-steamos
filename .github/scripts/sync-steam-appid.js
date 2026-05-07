/**
 * File: sync-steam-appid.js
 * Project: scripts
 * File Created: Thursday, 7th May 2026 7:25:32 pm
 * Author: Josh.5 (jsunnex@gmail.com)
 * -----
 * Last Modified: Thursday, 7th May 2026 7:43:20 pm
 * Modified By: Josh.5 (jsunnex@gmail.com)
 */

import * as core from "@actions/core";
import { Octokit } from "@octokit/rest";
import dotenv from "dotenv";
import { extractHeadingValue } from "./common.js";

dotenv.config();

const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN,
});

const invalidAppIdLabel = "invalid:report-inaccurate";
const appIdCommentMarker = "<!-- report-appid-validation -->";

function isBlankAppId(appIdRaw) {
  return !appIdRaw || appIdRaw === "_No response_";
}

function isPositiveIntegerString(value) {
  return /^\d+$/.test(value) && Number(value) > 0;
}

function replaceHeadingContent(body, heading, newValue) {
  const lines = body.split(/\r?\n/);
  const headingToFind = `### ${heading}`.toLowerCase();
  const headingIndex = lines.findIndex(
    (line) => line.trim().toLowerCase() === headingToFind,
  );

  if (headingIndex === -1) {
    return body;
  }

  let sectionEnd = lines.length;
  for (let i = headingIndex + 1; i < lines.length; i += 1) {
    if (lines[i].trim().toLowerCase().startsWith("### ")) {
      sectionEnd = i;
      break;
    }
  }

  const replacementLines = String(newValue).split(/\r?\n/);
  const nextLines = [
    ...lines.slice(0, headingIndex + 1),
    "",
    ...replacementLines,
    "",
    ...lines.slice(sectionEnd),
  ];

  return nextLines.join("\n").replace(/\n{3,}/g, "\n\n");
}

async function fetchSteamAppDetails(appId) {
  const url = `https://store.steampowered.com/api/appdetails?appids=${appId}&filters=basic`;
  const response = await fetch(url);

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `Steam appdetails request failed with status ${response.status}: ${errorBody}`,
    );
  }

  const data = await response.json();
  const appEntry = data?.[appId];

  if (!appEntry?.success || !appEntry?.data?.name) {
    return null;
  }

  return appEntry.data;
}

async function removeExistingValidationComments(owner, repo, issueNumber) {
  const comments = await octokit.paginate(octokit.issues.listComments, {
    owner,
    repo,
    issue_number: issueNumber,
    per_page: 100,
  });

  for (const comment of comments) {
    if (
      typeof comment.body === "string" &&
      comment.body.includes(appIdCommentMarker)
    ) {
      await octokit.issues.deleteComment({
        owner,
        repo,
        comment_id: comment.id,
      });
    }
  }
}

async function removeInvalidLabel(owner, repo, issueNumber) {
  try {
    await octokit.issues.removeLabel({
      owner,
      repo,
      issue_number: issueNumber,
      name: invalidAppIdLabel,
    });
  } catch (error) {
    if (error.status !== 404) {
      throw error;
    }
  }
}

async function cleanupInvalidState(owner, repo, issueNumber) {
  await removeExistingValidationComments(owner, repo, issueNumber);
  await removeInvalidLabel(owner, repo, issueNumber);
}

async function markInvalidAppId(owner, repo, issue, appIdRaw) {
  const issueNumber = issue.number;

  await octokit.issues.addLabels({
    owner,
    repo,
    issue_number: issueNumber,
    labels: [invalidAppIdLabel],
  });

  await removeExistingValidationComments(owner, repo, issueNumber);

  const commentBody = [
    appIdCommentMarker,
    "**Invalid Steam App ID:** The provided App ID could not be resolved to a valid Steam store application.",
    "",
    `Provided App ID: \`${appIdRaw}\``,
    "",
    "This report has been automatically closed.",
    "",
    "### How to fix this",
    "- If this is a Steam game or Steam demo, edit the report and provide a valid Steam App ID.",
    "- If this is a non-Steam game or demo, remove the App ID and keep the correct game name.",
    "",
    "After updating the report body, the automation will check it again and reopen the issue if it is valid.",
  ].join("\n");

  await octokit.issues.createComment({
    owner,
    repo,
    issue_number: issueNumber,
    body: commentBody,
  });

  if (issue.state !== "closed") {
    await octokit.issues.update({
      owner,
      repo,
      issue_number: issueNumber,
      state: "closed",
    });
  }

  core.setOutput("invalid_appid", "true");
}

async function run() {
  const issueNumber = parseInt(process.env.ISSUE_NUMBER, 10);
  const owner = process.env.REPO_OWNER;
  const repo = process.env.REPO_NAME;

  if (!issueNumber || !owner || !repo) {
    console.error("Missing environment variables.");
    process.exit(1);
  }

  core.setOutput("invalid_appid", "false");

  const { data: issue } = await octokit.issues.get({
    owner,
    repo,
    issue_number: issueNumber,
  });

  const body = issue.body || "";
  const lines = body.split(/\r?\n/);
  const gameName = extractHeadingValue(lines, "Game Name");
  const appIdRaw = extractHeadingValue(lines, "App ID");

  if (isBlankAppId(appIdRaw)) {
    console.log("No App ID provided; leaving submitted game name unchanged.");
    await cleanupInvalidState(owner, repo, issueNumber);
    return;
  }

  if (!isPositiveIntegerString(appIdRaw)) {
    console.log(`App ID "${appIdRaw}" is not a valid positive integer.`);
    await markInvalidAppId(owner, repo, issue, appIdRaw);
    return;
  }

  const steamApp = await fetchSteamAppDetails(appIdRaw);
  if (!steamApp) {
    console.log(`Steam App ID ${appIdRaw} did not resolve to a valid app.`);
    await markInvalidAppId(owner, repo, issue, appIdRaw);
    return;
  }

  await cleanupInvalidState(owner, repo, issueNumber);

  const authoritativeGameName = steamApp.name.trim();
  if (!gameName || gameName.trim() !== authoritativeGameName) {
    const updatedBody = replaceHeadingContent(
      body,
      "Game Name",
      authoritativeGameName,
    );

    await octokit.issues.update({
      owner,
      repo,
      issue_number: issueNumber,
      body: updatedBody,
      state: issue.state,
    });

    console.log(
      `Updated Game Name from "${gameName}" to "${authoritativeGameName}" using Steam App ID ${appIdRaw}.`,
    );
  } else {
    console.log(
      `Game Name already matches authoritative Steam name "${authoritativeGameName}".`,
    );
  }
}

run().catch((error) => {
  console.error("Error in script execution:", error);
  process.exit(1);
});
