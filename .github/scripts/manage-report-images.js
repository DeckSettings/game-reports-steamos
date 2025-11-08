/**
 * File: manage-report-images.js
 * Project: scripts
 * File Created: Friday, 8th August 2025 12:30:32 pm
 * Author: Josh.5 (jsunnex@gmail.com)
 * -----
 * Last Modified: Saturday, 8th November 2025 3:02:31 pm
 * Modified By: Josh.5 (jsunnex@gmail.com)
 */

import { Octokit } from "@octokit/rest";
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { buildReportData } from "./common.js";

dotenv.config();

const dryRun = process.env.DRY_RUN_MODE === "true" ?? false;
console.log(dryRun ? "DRY_RUN_MODE enabled" : "DRY_RUN_MODE disabled");
const ghActionsBotUser =
  process.env.GH_ACTIONS_BOT_USER ?? "github-actions[bot]";
console.log(`GH_ACTIONS_BOT_USER ${ghActionsBotUser}`);

const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN,
});

// No local AI client; OCR is handled by remote worker

// Initialise AJV for schema validation
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
  validate = ajv.compile(schema);
  console.log("Loaded validation schema from JSON.");
} catch (error) {
  console.error("Failed to load validation schema:", error);
  process.exit(1);
}

// Label for auto-extracted content
const ocrGeneratedContentLabel = "note:ocr-generated-content";

// === Helpers ===
async function extractSettingsFromImages(urls) {
  const endpoint = process.env.OCR_API_ENDPOINT;
  const apiKey = process.env.OCR_API_KEY;
  if (!endpoint || !apiKey) {
    throw new Error("Missing OCR_API_ENDPOINT or OCR_API_KEY in environment.");
  }

  const resp = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify({ image_urls: urls }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(
      `OCR service error: status ${resp.status} body: ${text?.slice(0, 500)}`
    );
  }
  const data = await resp.json();
  return {
    game_display_settings: data.game_display_settings ?? null,
    game_graphics_settings: data.game_graphics_settings ?? null,
  };
}

const htmlImgRegex = () => /<img[^>]*\bsrc=["']([^"'>\s]+)["'][^>]*>/gi;
const markdownImgRegex = () => /!\[[^\]]*]\(([^)\s]+)(?:\s+"[^"]*")?\)/gi;

function parseImages(markdown = "") {
  const images = [];
  let m;

  const htmlRegex = htmlImgRegex();
  while ((m = htmlRegex.exec(markdown)) !== null) {
    images.push({
      type: "html",
      url: m[1],
      raw: m[0],
      index: m.index ?? 0,
    });
  }

  const markdownRegex = markdownImgRegex();
  while ((m = markdownRegex.exec(markdown)) !== null) {
    images.push({
      type: "markdown",
      url: m[1],
      raw: m[0],
      index: m.index ?? 0,
    });
  }

  return images.sort((a, b) => a.index - b.index);
}

function findImageUrls(markdown = "") {
  return parseImages(markdown).map((img) => img.url);
}

function hasEmpty(text) {
  const t = (text || "").trim();
  return t.length === 0 || t === "_No response_";
}

function findSectionRange(body, heading) {
  const lines = body.split(/\r?\n/);
  const h = `### ${heading}`.toLowerCase();
  const startIdx = lines.findIndex((l) => l.trim().toLowerCase() === h);
  if (startIdx === -1) return null;

  let endIdx = lines.length; // exclusive
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (lines[i].trim().startsWith("### ")) {
      endIdx = i;
      break;
    }
  }
  return { lines, startIdx, endIdx };
}

function getSectionContent(body, heading) {
  const r = findSectionRange(body, heading);
  if (!r) return null;
  const { lines, startIdx, endIdx } = r;
  return lines
    .slice(startIdx + 1, endIdx)
    .join("\n")
    .trim();
}

function setSectionContent(body, heading, newContent) {
  const lines = body.split(/\r?\n/);
  const r = findSectionRange(body, heading);
  if (!r) {
    // create section at end
    const block = [
      `### ${heading}`,
      "",
      ...(newContent ? [newContent] : ["_No response_"]),
      "",
    ].join("\n");
    return (lines.join("\n") + "\n\n" + block).trimEnd() + "\n";
  }
  const { startIdx, endIdx } = r;
  const before = lines.slice(0, startIdx + 1); // include heading line
  const after = lines.slice(endIdx);
  const middle =
    newContent && newContent.trim().length ? newContent : "_No response_";
  return [...before, "", middle, "", ...after]
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
}

function stripImages(markdown = "") {
  if (!markdown) return { cleaned: "", images: [] };
  const images = parseImages(markdown);
  const withoutHtml = markdown.replace(htmlImgRegex(), "").trim();
  const withoutAny = withoutHtml
    .replace(markdownImgRegex(), "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { cleaned: withoutAny, images };
}

function uniqBy(arr, keyFn) {
  const seen = new Set();
  return arr.filter((item) => {
    const key = keyFn(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Generate a section body with the provided markdown content
function generateReportSectionMarkdown(content) {
  const newContent = (content || "").trim();
  if (newContent.length === 0) return "_No response_";
  return newContent;
}

// Re-write the issue body
//  - Replaces Display/Graphics sections with extracted markdown from settings (if not null)
//  - Moves any images from Display/Graphics to end of Additional Notes
function rewriteIssueBodyWithSettings(body, settings) {
  const displaySectionName = "Game Display Settings";
  const graphicsSectionName = "Game Graphics Settings";
  const notesSectionName = "Additional Notes";

  const displayCurrent = getSectionContent(body, displaySectionName) ?? "";
  const graphicsCurrent = getSectionContent(body, graphicsSectionName) ?? "";
  const notesCurrent = getSectionContent(body, notesSectionName) ?? "";

  // Strip images from Display/Graphics
  const { cleaned: displayNoImgs, images: displayImages } =
    stripImages(displayCurrent);
  const { cleaned: graphicsNoImgs, images: graphicsImages } =
    stripImages(graphicsCurrent);

  let newDisplayRaw, newGraphicsRaw;

  if (settings) {
    // Use extracted output if provided, fallback to cleaned existing text
    newDisplayRaw = settings.game_display_settings || displayNoImgs;
    newGraphicsRaw = settings.game_graphics_settings || graphicsNoImgs;
  } else {
    // No extracted output — keep cleaned existing text
    newDisplayRaw = displayNoImgs;
    newGraphicsRaw = graphicsNoImgs;
  }

  const newDisplay = generateReportSectionMarkdown(newDisplayRaw);
  const newGraphics = generateReportSectionMarkdown(newGraphicsRaw);

  // Additional Notes — preserve unless exactly "_No response_"
  const baseNotes =
    notesCurrent.trim() === "_No response_" ? "" : notesCurrent.trim();

  const movedImgs = uniqBy(
    [...displayImages, ...graphicsImages],
    (img) => img.url
  );
  const appendedImgsMd = movedImgs.length
    ? "\n\n" +
      movedImgs.map((img) => img.raw || `![Image](${img.url})`).join("\n\n")
    : "";

  const newNotesRaw = (baseNotes + appendedImgsMd).trim();
  const newNotes = generateReportSectionMarkdown(newNotesRaw);

  // Write back
  let out = body;
  out = setSectionContent(out, displaySectionName, newDisplay);
  out = setSectionContent(out, graphicsSectionName, newGraphics);
  out = setSectionContent(out, notesSectionName, newNotes);

  return { body: out, movedCount: movedImgs.length };
}

// Post comment prompting user to fix issue
async function updateIssueBody(
  owner,
  repo,
  issueNumber,
  updatedBody,
  movedCount
) {
  if (dryRun) {
    console.log(
      `DRY RUN: would update issue #${issueNumber}. Images moved: ${movedCount}`
    );
    console.log(updatedBody);
  } else {
    await octokit.issues.update({
      owner,
      repo,
      issue_number: issueNumber,
      body: updatedBody,
    });
    console.log(
      `Updated issue #${issueNumber} body. Images moved: ${movedCount}`
    );
  }
}

// Add the auto-extracted-content label
async function addOcrGeneratedContentLabel(owner, repo, issueNumber) {
  if (dryRun) {
    console.log(
      `DRY RUN: would add label "${ocrGeneratedContentLabel}" to issue #${issueNumber}`
    );
  } else {
    await octokit.issues.addLabels({
      owner,
      repo,
      issue_number: issueNumber,
      labels: [ocrGeneratedContentLabel],
    });
  }
  console.log(
    `Added label "${ocrGeneratedContentLabel}" to issue #${issueNumber}`
  );
}

// Post comment prompting user to fix issue
async function postSuggestedSettingsComment(
  owner,
  repo,
  issueNumber,
  settings
) {
  const displayContent = generateReportSectionMarkdown(
    settings.game_display_settings
  );
  const graphicsContent = generateReportSectionMarkdown(
    settings.game_graphics_settings
  );

  const commentBody =
    `**Settings Read From Screenshots**\n\n` +
    `We automatically read the text from your screenshots and filled in **Game Display Settings** and **Game Graphics Settings** below. These values were added to your report to save you time.\n\n` +
    `All uploaded images have been moved to the end of the **Additional Notes** section to keep the settings sections clean.\n\n` +
    "```markdown\n" +
    `### Game Display Settings\n\n` +
    `${displayContent}\n\n` +
    `### Game Graphics Settings\n\n` +
    `${graphicsContent}\n` +
    "```\n\n" +
    `> [!WARNING]\n` +
    `> These settings were automatically read from your screenshots using text recognition. They may contain errors or omissions.\n` +
    `> Please compare them carefully against your original images and make any necessary corrections.\n\n` +
    `> [!TIP]\n` +
    `> **To confirm or edit these values, you must make a real change to the issue body** (saving without changes does not trigger an update, and comments do not count).\n` +
    `> Recommended: open **Edit**, add an additional empty space or line under **Additional Notes** (or adjust any value), then click **Save**.\n` +
    `> After a human edit is saved, this comment and the **${ocrGeneratedContentLabel}** label will be removed automatically to indicate the report has been reviewed.\n`;

  if (dryRun) {
    console.log(
      `DRY RUN: would post suggested settings comment on issue #${issueNumber}:`
    );
    console.log(commentBody);
  } else {
    await octokit.issues.createComment({
      owner,
      repo,
      issue_number: issueNumber,
      body: commentBody,
    });
    console.log(`Posted suggested settings comment on issue #${issueNumber}`);
  }
}

// Remove validation comments from the issue
async function removeSuggestedSettingsComment(owner, repo, issueNumber) {
  const comments = await octokit.issues.listComments({
    owner,
    repo,
    issue_number: issueNumber,
  });

  const botComments = comments.data.filter(
    (comment) =>
      comment.user.login === ghActionsBotUser &&
      comment.body.includes("**Settings Read From Screenshots**")
  );

  for (const comment of botComments) {
    if (dryRun) {
      console.log(
        `DRY RUN: would have deleted suggested settings comment (ID: ${comment.id}) on issue #${issueNumber}`
      );
    } else {
      await octokit.issues.deleteComment({
        owner,
        repo,
        comment_id: comment.id,
      });
      console.log(
        `Deleted suggested settings comment (ID: ${comment.id}) on issue #${issueNumber}`
      );
    }
  }
}

// Remove the auto-extracted-content label
async function removeOcrGeneratedContentLabel(owner, repo, issueNumber) {
  try {
    if (dryRun) {
      console.log(
        `DRY RUN: would have removed label "${ocrGeneratedContentLabel}" from issue #${issueNumber}`
      );
    } else {
      await octokit.issues.removeLabel({
        owner,
        repo,
        issue_number: issueNumber,
        name: ocrGeneratedContentLabel,
      });
      console.log(
        `Removed label "${ocrGeneratedContentLabel}" from issue #${issueNumber}`
      );
    }
  } catch (error) {
    console.error(`Label not present on issue #${issueNumber}`);
  }
}

async function processIssue(owner, repo, issue) {
  const originalBody = issue.body || "";

  // Read issue labels
  const existingLabels = (
    await octokit.issues.get({ owner, repo, issue_number: issue.number })
  ).data.labels.map((label) => label.name);

  // Always normalise images to the "Additional Notes" section first (move-only pass)
  const { body: initialUpdatedBody, movedCount: initialMovedCount } =
    rewriteIssueBodyWithSettings(originalBody, null);

  // Build object based on extracted values
  const reportData = buildReportData(
    initialUpdatedBody,
    validate.schema.properties
  );

  // Fetch "Game Display Settings" content and check if it is empty after normalisation
  const displayContent = generateReportSectionMarkdown(
    reportData["Game Display Settings"]
  );
  const displayEmpty = hasEmpty(displayContent);

  // Check if the "Game Display Settings" section is empty.
  if (!displayEmpty && initialMovedCount > 0) {
    // Only save moved images - the "Game Display Settings" section already has config content
    console.log(
      `Updating issue body but skipping screenshot text extraction for issue #${issue.number} as "Game Display Settings" is already filled.`
    );
    await updateIssueBody(
      owner,
      repo,
      issue.number,
      initialUpdatedBody,
      initialMovedCount
    );
    // Clean up
    await removeSuggestedSettingsComment(owner, repo, issue.number);
    if (existingLabels.includes(ocrGeneratedContentLabel)) {
      await removeOcrGeneratedContentLabel(owner, repo, issue.number);
    }
    return;
  } else if (!displayEmpty) {
    // No images moved and Display is filled -> nothing to do
    console.log(
      `Skipping screenshot text extraction for issue #${issue.number} as "Game Display Settings" is already filled.`
    );
    // Clean up
    await removeSuggestedSettingsComment(owner, repo, issue.number);
    if (existingLabels.includes(ocrGeneratedContentLabel)) {
      await removeOcrGeneratedContentLabel(owner, repo, issue.number);
    }
    return;
  } else {
    console.log(
      `The "Game Display Settings" in issue #${issue.number} is empty after normalisation. Checking for images to parse...`
    );
  }

  // Gather images (now all under Additional Notes)
  const notesContent = reportData["Additional Notes"] || "";
  const imageUrls = findImageUrls(notesContent);
  if (imageUrls.length === 0) {
    console.log("No images found to extract from. Exiting.");
    return;
  }
  console.log(
    `Found ${imageUrls.length} image URL(s) in issue #${issue.number}`
  );

  // Use OCR service to read Game settings from the screenshots
  const settings = await extractSettingsFromImages(imageUrls);

  // Update original body with parsed settings and migrate images to end of "Additional Notes" section
  const { body: updatedBody, movedCount } = rewriteIssueBodyWithSettings(
    originalBody,
    settings
  );
  await updateIssueBody(owner, repo, issue.number, updatedBody, movedCount);

  // Add a label to indicate auto-read content that has not been reviewed
  if (!existingLabels.includes(ocrGeneratedContentLabel)) {
    await addOcrGeneratedContentLabel(owner, repo, issue.number);
  }
  // Post a comment on the issue with the suggested settings
  await postSuggestedSettingsComment(owner, repo, issue.number, settings);

  console.log(`Image management complete for issue #${issue.number}`);
}

// === Main ===
async function run() {
  const issueNumber = parseInt(process.env.ISSUE_NUMBER, 10);
  const owner = process.env.REPO_OWNER;
  const repo = process.env.REPO_NAME;

  if (!issueNumber || !owner || !repo) {
    console.error("Missing environment variables.");
    process.exit(1);
  }
  if (!process.env.GITHUB_TOKEN) {
    console.error("Missing GITHUB_TOKEN in environment.");
    process.exit(1);
  }
  if (!process.env.OCR_API_ENDPOINT || !process.env.OCR_API_KEY) {
    console.error("Missing OCR_API_ENDPOINT or OCR_API_KEY in environment.");
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

run().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
