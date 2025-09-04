/**
 * File: report-bot.js
 * Project: scripts
 * File Created: Tuesday, 4th March 2025 3:53:38 pm
 * Author: Josh.5 (jsunnex@gmail.com)
 * -----
 * Last Modified: Friday, 5th September 2025 7:21:54 am
 * Modified By: Josh.5 (jsunnex@gmail.com)
 */

import { Octokit } from "@octokit/rest";
import dotenv from "dotenv";

dotenv.config();

// Initialize Octokit with the provided GITHUB_TOKEN
const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN,
});

const ghActionsBotUser =
  process.env.GH_ACTIONS_BOT_USER ?? "github-actions[bot]";
console.log(`GH_ACTIONS_BOT_USER ${ghActionsBotUser}`);

const BOT_COMMENT_HEADER = "[ReportBot Managed Comment]";

// Define valid bot commands and optionally associated labels
const validCommands = {
  help: {
    description: "Displays a list of available ReportBot commands.",
  },
  "suggest-spelling-check": {
    label: "community:spelling-check-suggested",
    description:
      "Applies a label to let the reporter know you are suggesting a spelling check on the report.",
  },
  "suggest-config-review": {
    label: "community:config-review-suggested",
    description:
      "Applies a label to indicate a review of the configuration options in the report is suggested.",
  },
  "request-clarification": {
    label: "community:clarification-requested",
    description:
      "Applies a label to let the reporter know you are requesting clarification on specific parts of the report.",
  },
  "suggest-verification": {
    label: "community:verification-suggested",
    description:
      "Applies a label to let the reporter know you are suggesting verification of the report's information.",
  },
  "suggest-improvements": {
    label: "community:improvements-suggested",
    description:
      "Applies a label to let the reporter know you are proposing potential improvements to the report.",
  },
  "mark-invalid": {
    label: "invalid:report-inaccurate",
    role: "maintainer",
    description: "Marks the report as invalid if inaccurate. (Maintainer only)",
  },
};

// Main function to process the comment and apply or remove labels
async function run() {
  const issueNumber = parseInt(process.env.ISSUE_NUMBER, 10);
  const owner = process.env.REPO_OWNER;
  const repo = process.env.REPO_NAME;
  const commentBody = process.env.COMMENT_BODY.trim();
  const commenter = process.env.COMMENTER;
  const commentId = parseInt(process.env.COMMENT_ID, 10);
  const action = process.env.ACTION_TYPE;

  if (
    !issueNumber ||
    !owner ||
    !repo ||
    !commentBody ||
    !commentId ||
    !action
  ) {
    console.error("Missing required environment variables.");
    process.exit(1);
  }

  // Prevent processing of bot's own comments
  if (commentBody.includes(BOT_COMMENT_HEADER)) {
    console.log("Ignoring comment containing bot header to avoid loop.");
    return;
  }

  console.log(`Action type: ${action}`);

  // Extract command from the comment body
  const commandMatch = commentBody.match(/@\/reportbot\s+([a-z-]+)/);
  if (!commandMatch) {
    console.log("No valid @/reportbot command found.");
    return;
  }

  const command = commandMatch[1];
  const commandConfig = validCommands[command];

  if (!commandConfig) {
    console.log(`Invalid command '${command}' provided.`);
    await postComment(
      owner,
      repo,
      issueNumber,
      commentId,
      `@${commenter} Invalid command provided. Use a recognized @/reportbot command.`
    );
    return;
  }

  if (action === "created") {
    // Action help messages
    if (command === "help") {
      await postHelpComment(owner, repo, issueNumber, commentId);
      return;
    }

    // Check for additional content beyond the command
    const additionalContent = commentBody
      .replace(/@\/reportbot\s+[a-z-]+\s*/, "")
      .trim();
    if (!additionalContent) {
      await postComment(
        owner,
        repo,
        issueNumber,
        commentId,
        `@${commenter} you cannot instantiate a bot command without providing details for the reporter to action.`
      );
      return;
    }

    // Apply the label to the issue if applicable
    if (commandConfig.label) {
      await applyLabel(
        owner,
        repo,
        issueNumber,
        commentId,
        commandConfig.label
      );
    }

    // Execute special actions if defined (WIP)
    if (
      commandConfig.action &&
      typeof global[commandConfig.action] === "function"
    ) {
      await global[commandConfig.action](issueNumber, commentId);
    }

    // React to the comment with the eyes emoji
    // TODO: Fix this.. This is not working for some reason
    //await addReaction(owner, repo, commentId);
  } else if (action === "deleted") {
    await removeReplyComments(owner, repo, issueNumber, commentId);
  }
}

// Function to generate and post help text
async function postHelpComment(owner, repo, issueNumber, commentId) {
  const helpText = Object.entries(validCommands)
    .filter(([_, config]) => config.role != "maintainer") // Exclude maintainer-only commands
    .map(
      ([command, config]) =>
        `- \`@/reportbot ${command}\`\n  - ${
          config.description || "No description available."
        }`
    )
    .join("\n");

  const helpMessage = `Here are the available commands for ReportBot:\n\n${helpText}`;
  const helpFooter = `***Important:*** You cannot submit a command without providing additional information. Always include specific details to help the reporter address your suggestion.`;

  await postComment(
    owner,
    repo,
    issueNumber,
    commentId,
    `${helpMessage}\n\n\n${helpFooter}`
  );
}

// Function to post a comment on the issue
async function postComment(
  owner,
  repo,
  issueNumber,
  originalCommentId,
  body,
  actionLog
) {
  const header = `*${BOT_COMMENT_HEADER}*\n\n---\n\n`;
  const commentLink = `https://github.com/${owner}/${repo}/issues/${issueNumber}#issuecomment-${originalCommentId}`;
  let footer = `\n\n---\n\n*This comment was triggered by comment ID: ${originalCommentId} ([link](${commentLink})).*\n*When you are done with this information, delete your original comment to clean up my messages.*`;
  if (actionLog) {
    footer = `${footer}\n\n---\n\n> ${actionLog}`;
  }

  try {
    console.log(`Posting comment: ${body}`);
    await octokit.issues.createComment({
      owner,
      repo,
      issue_number: issueNumber,
      body: `${header}\n${body}\n${footer}`,
    });
  } catch (error) {
    console.error(`Error posting comment: ${error.message}`);
  }
}

// Function to add a reaction to a comment
async function addReaction(owner, repo, commentId) {
  try {
    console.log(`Adding 👀 reaction to comment ID: ${commentId}`);
    await octokit.reactions.createForIssueComment({
      owner,
      repo,
      comment_id: commentId,
      content: "eyes",
    });
  } catch (error) {
    console.error(`Error adding reaction: ${error.message}`);
  }
}

// Add bot label
async function applyLabel(owner, repo, issueNumber, commentId, label) {
  try {
    await octokit.issues.addLabels({
      owner,
      repo,
      issue_number: issueNumber,
      labels: [label],
    });
    console.log(`Added label "${label}" to issue #${issueNumber}`);
    await postComment(
      owner,
      repo,
      issueNumber,
      commentId,
      `Label "${label}" applied`,
      `ACTION=add_label LABEL=${label}`
    );
  } catch (error) {
    console.error(`Error adding label: ${error.message}`);
  }
}

// Remove bot label
async function removeLabel(owner, repo, issueNumber, label) {
  try {
    await octokit.issues.removeLabel({
      owner,
      repo,
      issue_number: issueNumber,
      name: label,
    });
    console.log(`Removed label "${label}" from issue #${issueNumber}`);
  } catch (error) {
    console.log(`Label not present on issue #${issueNumber}`);
  }
}

// Remove bot comments associated with a deleted original comment
async function removeReplyComments(
  owner,
  repo,
  issueNumber,
  originalCommentId
) {
  const comments = await octokit.issues.listComments({
    owner,
    repo,
    issue_number: issueNumber,
  });

  const botComments = comments.data.filter(
    (comment) =>
      comment.user.login === ghActionsBotUser &&
      comment.body.includes(
        `*This comment was triggered by comment ID: ${originalCommentId}`
      )
  );

  for (const comment of botComments) {
    // Parse action log to undo anything
    const actionMatch = comment.body.match(/> ACTION=(\w+) LABEL=(\S+)/);
    if (actionMatch) {
      console.log(`Found action log in comment body`);
      const action = actionMatch[1];
      const label = actionMatch[2];

      if (action === "add_label") {
        console.log(
          `Undoing "add_label" action: Removing label "${label}" from issue #${issueNumber}`
        );
        await removeLabel(owner, repo, issueNumber, label);
      }
    }

    try {
      await octokit.issues.deleteComment({
        owner,
        repo,
        comment_id: comment.id,
      });
      console.log(
        `Deleted validation comment (ID: ${comment.id}) on issue #${issueNumber}`
      );
    } catch (error) {
      console.error(
        `Error deleting comment (ID: ${comment.id}) on issue #${issueNumber}: ${error.message}`
      );
    }
  }
}

run().catch((error) => {
  console.error("An error occurred:", error);
  process.exit(1);
});
