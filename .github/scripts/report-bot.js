/**
 * File: report-bot.js
 * Project: scripts
 * File Created: Tuesday, 4th March 2025 3:53:38 pm
 * Author: Josh.5 (jsunnex@gmail.com)
 * -----
 * Last Modified: Thursday, 23rd October 2025 6:50:00 pm
 * Modified By: Josh.5 (jsunnex@gmail.com)
 */

import { Octokit } from "@octokit/rest";
import { graphql as rawGraphql } from "@octokit/graphql";
import https from "https";
import dotenv from "dotenv";

dotenv.config();

// Initialize Octokit (REST) and GraphQL with provided GITHUB_TOKEN
const token = process.env.GITHUB_TOKEN;
const octokit = new Octokit({ auth: token });
const graphql = rawGraphql.defaults({
  headers: { authorization: `token ${token}` },
});

const ghActionsBotUser =
  process.env.GH_ACTIONS_BOT_USER ?? "github-actions[bot]";
console.log(`GH_ACTIONS_BOT_USER ${ghActionsBotUser}`);

const args = process.argv.slice(2);

const BOT_COMMENT_HEADER = "[ReportBot Managed Comment]";

const WEBHOOK_IGNORED_COMMANDS = new Set(["help", "resolve", "delete"]);

// Global holder for parsed comment data
let REPORT_BOT_COMMAND_DATA = null;

// Determine whether we should send an external webhook for the current action.
function shouldSendWebhook() {
  try {
    const cd = REPORT_BOT_COMMAND_DATA;
    if (!cd) return false;

    const cmd = (cd.command || "").toString().toLowerCase();
    if (!cmd) return false;

    if (WEBHOOK_IGNORED_COMMANDS.has(cmd)) return false;

    const cfg = validCommands[cmd];
    if (cfg && cfg.role === "author") return false;

    const issueAuthorId = parseInt(process.env.ISSUE_AUTHOR_ID, 10);
    const commentUserId = parseInt(process.env.COMMENT_USER_ID, 10);
    if (issueAuthorId === commentUserId) {
      // commenter is the issue author — skip
      return false;
    }

    return true;
  } catch (e) {
    // On error, be conservative and skip sending
    console.log(
      "shouldSendWebhook: error while deciding; skipping webhook:",
      e && e.message
    );
    return false;
  }
}

// Send a webhook with the given action log
async function sendHook(actionLog) {
  if (!shouldSendWebhook()) {
    console.log(
      "sendHook: shouldSendWebhook returned false; not dispatching webhook."
    );
    return;
  }

  const webhookUrl = process.env.DV_WEBHOOK_URL;
  const webhookSecret = process.env.DV_WEBHOOK_SECRET;
  if (!webhookUrl || !webhookSecret) {
    console.log(
      "sendHook: DV_WEBHOOK_URL or DV_WEBHOOK_SECRET not set; skipping webhook dispatch."
    );
    return;
  }

  const cd = REPORT_BOT_COMMAND_DATA || {};
  const payload = {
    type: "reportbot",
    issueNumber: parseInt(process.env.ISSUE_NUMBER, 10),
    issueAuthorId: parseInt(process.env.ISSUE_AUTHOR_ID, 10),
    commentId: parseInt(process.env.COMMENT_ID, 10),
    commentBody: (process.env.COMMENT_BODY || "").trim(),
    commentUserId: parseInt(process.env.COMMENT_USER_ID, 10),
    commentUrl: process.env.COMMENT_URL || undefined,
    commentCreatedAt: process.env.COMMENT_CREATED_AT || undefined,
    actionedAt: process.env.COMMENT_CREATED_AT || undefined,
    performedBy: process.env.COMMENTER || undefined,
    command: cd.command || undefined,
    description: cd.description || undefined,
    actionLog: actionLog || undefined,
  };

  // If actionLog contains label info, surface it as labels array/label.
  if (actionLog) {
    const labelsMatch = String(actionLog).match(/LABELS?=([^\s,]+)/);
    if (labelsMatch) {
      payload.labels = String(labelsMatch[1])
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }
    const actionMatch = String(actionLog).match(/ACTION=(\w+)/);
    if (actionMatch) payload.action = actionMatch[1];
  }

  // try to extract a report title like the python sender does (logfmt)
  try {
    const issueTitleRaw = process.env.ISSUE_TITLE || null;
    if (issueTitleRaw) {
      const m = /\btitle="([^"]*)"/.exec(issueTitleRaw);
      if (m) payload.reportTitle = m[1];
    }
  } catch (e) {
    // not critical
  }

  // strip undefined/null values
  for (const k of Object.keys(payload)) {
    if (payload[k] === null || payload[k] === undefined) delete payload[k];
  }

  const data = JSON.stringify(payload);
  console.log("sendHook: dispatching payload:", JSON.stringify(payload));

  try {
    const url = new URL(webhookUrl);
    const options = {
      hostname: url.hostname,
      port: url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80,
      path: `${url.pathname || "/"}${url.search || ""}`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-github-workflow-secret": webhookSecret,
        "Content-Length": Buffer.byteLength(data),
      },
    };

    await new Promise((resolve, reject) => {
      const req = https.request(options, (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            console.log("sendHook: webhook dispatched successfully.");
            resolve(undefined);
          } else {
            reject(
              new Error(
                `Webhook HTTP error: ${res.statusCode} - ${res.statusMessage} - ${body}`
              )
            );
          }
        });
      });
      req.on("error", (err) => reject(err));
      req.write(data);
      req.end();
    });
  } catch (err) {
    console.error("sendHook: failed to send webhook:", err && err.message);
  }
}

const REPORT_BOT_INTRO_MESSAGE = `*${BOT_COMMENT_HEADER}*

Hi! I'm **ReportBot**, here to help the community collaborate on this game report.

<details>
<summary><strong>▶️ How to use ReportBot (click to expand)</strong></summary>

---

Start a comment with \`/reportbot <command> ...details...\`. Always add a short explanation **after** the command so the reporter knows what to do next.

## Examples

### Community commands

> ["help"] See everything I can do.
\`\`\`
/reportbot help
\`\`\`

> ["request-clarification"] Ask for more details. Usually to be added to the "Additional Notes" section.
\`\`\`
/reportbot request-clarification
Could you clarify where the FPS was measured? For example, was the minimum FPS captured when entering the open world after the second village (where stutters and drops are most common)?
\`\`\`

> ["suggest-config-review"] Suggest re-checking configuration details. Often used when a game or driver update may have changed results.
\`\`\`
/reportbot suggest-config-review
This game was recently updated with performance fixes. The performance targets in your report may now be out of date and worth re-testing.
\`\`\`

> ["suggest-improvements"] Propose adding extra information or media.
\`\`\`
/reportbot suggest-improvements
You left the "Average Battery Power Draw" field blank. Please add it so the report can include an estimated battery life calculation.
\`\`\`

> ["suggest-spelling-check"] Point out typos or grammar issues.
\`\`\`
/reportbot suggest-spelling-check
A few headings (e.g. "Graphcis") look misspelled.
\`\`\`

> ["suggest-verification"] Recommend double-checking accuracy. Use this to point out potential mistakes or inconsistencies.
\`\`\`
/reportbot suggest-verification
The max power draw was listed as 5 W when it looks like you meant 15 W. The report shows a very long battery life, but at 15 W it should probably only have a few hours.
\`\`\`

> ["mark-duplicate"] Flag this report as a duplicate of an existing submission so the author can consolidate updates.
\`\`\`
/reportbot mark-duplicate
This looks like the same configuration and results as your report in #123. Let's keep the discussion there to avoid splitting feedback.
\`\`\`

### Author-only commands

> ["resolve"] Remove a specific label after addressing it.
\`\`\`
/reportbot resolve community:clarification-requested
\`\`\`

> ["resolve"] Remove several labels at once.
\`\`\`
/reportbot resolve community:clarification-requested community:verification-suggested
\`\`\`

> ["resolve"] Remove **all** managed community labels from this report.
\`\`\`
/reportbot resolve all
\`\`\`

> ["delete"] **Permanently delete this report** (Requires confirmation).
\`\`\`
/reportbot delete
\`\`\`
This irreversibly removes the issue and all comments.

</details>

<details>
<summary><strong>▶️ Notes on Community Labels (click to expand)</strong></summary>

---

## What labels are (and when to use them)
Labels are **community signals** attached to the report so the author can quickly see what needs attention. They are not votes and they are not punishments. They are prompts to improve clarity and usefulness.

Use a label when your feedback is:
- **Actionable** (the author can do something specific), and
- **Specific** (points to a setting, a metric, a claim, or evidence).

Good uses:
- Ask for missing details (\`community:clarification-requested\`).
- Suggest a focused settings review (\`community:config-review-suggested\`).
- Propose concrete upgrades like screenshots or short clips (\`community:improvements-suggested\`).
- Flag a duplicate submission so discussion stays on the original report (\`community:duplicate-report\`).
- Flag typos that reduce readability (\`community:spelling-check-suggested\`).
- Request a double-check of a claim or metric (\`community:verification-suggested\`).
- The report appears to be a duplicate of another report by the same author (\`community:duplicate-report\`).

Less ideal:
- General disagreement without details (use a regular comment and explain).
- Piling on multiple labels for the same point (pick the most relevant single label).

</details>


<details>
<summary><strong>▶️ Resolving feedback (click to expand)</strong></summary>

---

If you posted a feedback comment with \`/reportbot\` and it has been addressed, you have two ways to resolve the labels it created:

1. **Edit your original comment** and append **\`[RESOLVED]\`** on its own line. ReportBot will remove the label or labels created from that comment and mark its bot reply as resolved.  
2. **Delete your original comment.** ReportBot will automatically remove the associated labels and its reply.

The author can also manually remove labels using the \`/reportbot resolve <label>\` command if they feel it is invalid or they have addressed the issue that was raised.

</details>

---

## A note to the report author (you own this report)
You can **edit your report at any time**. Games evolve — patches improve performance, drivers change, settings meta shifts. If your results change, please **update your report** so others benefit from the freshest info.

Prefer to withdraw it? That is okay too. You can **permanently delete your report** with \`/reportbot delete confirm\`. (This is irreversible.)

Community members may post comments or add the labels below to highlight something they think needs attention. If you see such a label on your report, please review it and consider updating to avoid the report getting voted down. When you have addressed it, you can clear labels yourself using the author-only \`resolve\` command shown above.

---

## Be excellent to each other
Keep discussion **civil, specific, and constructive**. We are here to help one another find good settings and accurate expectations.

---

> [!TIP]
> Post a comment \`/reportbot help\` any time to see the full list of commands that can be used in comments below.

> [!NOTE]
> You can also react 👍 or 👎 to the report to express an overall opinion.
> These reactions will affect the placement of this review in search results.
`;

// Define valid bot commands and optionally associated labels
const validCommands = {
  help: {
    description: "Displays a list of available ReportBot commands.",
  },
  resolve: {
    role: "author",
    description:
      "Report author only. Remove one or more community labels that have been addressed. Usage: `/reportbot resolve <label|label2|...>` or `/reportbot resolve all`",
  },
  delete: {
    role: "author",
    description:
      "Report author only. Permanently delete this report. Usage: `/reportbot delete confirm`",
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
      "Applies a label to let the reporter know you are suggesting verification of the report's information. Usually things to be added to the 'Additional Notes' section.",
  },
  "suggest-improvements": {
    label: "community:improvements-suggested",
    description:
      "Applies a label to let the reporter know you are proposing potential improvements to the report.",
  },
  "mark-duplicate": {
    label: "community:duplicate-report",
    description:
      "Applies a label to indicate this report duplicates an existing submission and should be consolidated.",
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
  const commentBody = (process.env.COMMENT_BODY || "").trim();
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
  const commandMatch = commentBody.match(/^\s*@?\/reportbot\s+([a-z-]+)/i);
  if (!commandMatch) {
    if (action === "deleted") {
      console.log(
        "Comment deleted without detectable command; attempting cleanup of bot replies."
      );
      await removeReplyComments(owner, repo, issueNumber, commentId);
    }
    console.log("No valid /reportbot command found.");
    return;
  }

  const command = commandMatch[1].toLowerCase();
  const commandConfig = validCommands[command];

  const parsedDescription = commentBody
    .replace(/^\s*@?\/reportbot\s+[a-z-]+\s*/i, "")
    .trim();

  REPORT_BOT_COMMAND_DATA = {
    command,
    description: parsedDescription || null,
  };

  try {
    if (!commandConfig) {
      console.log(`Invalid command '${command}' provided.`);
      await postComment(
        owner,
        repo,
        issueNumber,
        commentId,
        `@${commenter} Invalid command provided. Use a recognized /reportbot command.`
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
      const additionalContent = REPORT_BOT_COMMAND_DATA.description || "";

      // Handle author resolve messages
      if (command === "resolve") {
        // Only issue author can resolve
        const issueAuthor = await getIssueAuthorLogin(owner, repo, issueNumber);
        if (commenter !== issueAuthor) {
          await postComment(
            owner,
            repo,
            issueNumber,
            commentId,
            `@${commenter} Only the report author (@${issueAuthor}) can resolve labels on this issue.`
          );
          return;
        }

        if (!additionalContent) {
          await postComment(
            owner,
            repo,
            issueNumber,
            commentId,
            `@${commenter} Please specify which label(s) to resolve, e.g. \`/reportbot resolve community:clarification-requested\` or \`/reportbot resolve all\`.`
          );
          return;
        }

        const managed = getManagedCommunityLabels();

        let toRemove = [];
        if (/^all$/i.test(additionalContent)) {
          toRemove = managed;
        } else {
          toRemove = normalizeRequestedLabels(additionalContent, managed);
          if (toRemove.length === 0) {
            await postComment(
              owner,
              repo,
              issueNumber,
              commentId,
              `@${commenter} No valid managed labels found in your request. Managed labels are: \`${managed.join(
                ", "
              )}\`.`
            );
            return;
          }
        }

        const { removed, missing } = await resolveLabels(
          owner,
          repo,
          issueNumber,
          toRemove
        );

        const parts = [];
        if (removed.length) {
          parts.push(`✅ Removed: \`${removed.join("`, `")}\``);
        }
        if (missing.length) {
          parts.push(`ℹ️ Not present: \`${missing.join("`, `")}\``);
        }

        await postComment(
          owner,
          repo,
          issueNumber,
          commentId,
          parts.length ? parts.join("\n") : "No changes were made.",
          `ACTION=resolve LABELS=${toRemove.join(",")}`
        );

        return;
      }

      if (command === "delete") {
        const issueAuthor = await getIssueAuthorLogin(owner, repo, issueNumber);
        if (commenter !== issueAuthor) {
          await postComment(
            owner,
            repo,
            issueNumber,
            commentId,
            `@${commenter} Only the report author (@${issueAuthor}) can delete this report.`
          );
          return;
        }

        if (additionalContent.toLowerCase() !== "confirm") {
          await postComment(
            owner,
            repo,
            issueNumber,
            commentId,
            `@${commenter} This will permanently delete the report and all comments. If you're sure, run:\n\n\`/reportbot delete confirm\``
          );
          return;
        }

        const { data: issueData } = await octokit.issues.get({
          owner,
          repo,
          issue_number: issueNumber,
        });

        if ((issueData.state || "").toLowerCase() !== "closed") {
          await postComment(
            owner,
            repo,
            issueNumber,
            commentId,
            `@${commenter} This report must be closed before it can be permanently deleted. Please close the issue, then run \`/reportbot delete confirm\` to proceed. Deleting is permanent and the report cannot be recovered afterwards.`
          );
          return;
        }

        // Perform hard delete (no follow-up comment after this point)
        await hardDeleteIssue({
          owner,
          repo,
          issueNumber,
          actor: commenter,
          originalCommentId: commentId,
          issueData,
        });
        return;
      }

      // For label-adding commands, additional content is required
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
    } else if (action === "edited") {
      if (commentBody.includes("[RESOLVED]")) {
        console.log(
          `Detected [RESOLVED] marker in edited comment ID ${commentId}. Removing related labels.`
        );
        await removeReplyComments(owner, repo, issueNumber, commentId, {
          keepComment: true,
        });
      }
    }
  } catch (err) {
    console.error("run() error:", err && err.message);
  } finally {
    // Ensure we always clear the global comment data to avoid leaking state
    REPORT_BOT_COMMAND_DATA = null;
  }
}

// Function to generate and post help text
async function postHelpComment(owner, repo, issueNumber, commentId) {
  const helpText = Object.entries(validCommands)
    .filter(([_, config]) => config.role !== "maintainer") // Exclude maintainer-only commands
    .map(
      ([command, config]) =>
        `- \`/reportbot ${command}\`\n  - ${
          config.description || "No description available."
        }`
    )
    .join("\n");

  const helpMessage = `Here are the available commands for ReportBot:\n\n${helpText}`;
  const helpFooter = `***Important:*** You cannot submit a command without providing additional information. Always include specific details to help the reporter address your suggestion.\n\n- You can start commands with \`/reportbot\`.\n- Note: \`resolve\` and \`delete\` can only be used by the **report author**.`;

  await postComment(
    owner,
    repo,
    issueNumber,
    commentId,
    `${helpMessage}\n\n\n${helpFooter}`
  );
}

// Function to post a default help message on new issues
async function postIssueHelpComment(owner, repo, issueNumber) {
  if (!issueNumber || !owner || !repo) {
    console.error(
      "Missing ISSUE_NUMBER, REPO_OWNER, or REPO_NAME environment variables."
    );
    process.exit(1);
  }

  try {
    console.log(
      `Posting default help message on issue #${issueNumber} in ${owner}/${repo}`
    );
    await octokit.issues.createComment({
      owner,
      repo,
      issue_number: issueNumber,
      body: REPORT_BOT_INTRO_MESSAGE,
    });
  } catch (error) {
    console.error(`Error posting help message: ${error.message}`);
  }
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

    try {
      await sendHook(`ACTION=add_label LABEL=${label}`);
    } catch (e) {
      console.error("applyLabel: sendHook failed:", e && e.message);
    }
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

    try {
      await sendHook(`ACTION=remove_label LABEL=${label}`);
    } catch (e) {
      console.error("removeLabel: sendHook failed:", e && e.message);
    }
  } catch (error) {
    console.log(`Label not present on issue #${issueNumber}`);
  }
}

// Remove bot comments associated with a deleted original comment
async function removeReplyComments(
  owner,
  repo,
  issueNumber,
  originalCommentId,
  options = {}
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

    if (!options.keepComment) {
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
    } else {
      // Instead of deleting, maybe add a note that it was resolved
      try {
        await octokit.issues.updateComment({
          owner,
          repo,
          comment_id: comment.id,
          body: `${comment.body}\n\n✅ *This feedback has been marked as RESOLVED by the commenter.*`,
        });
        console.log(
          `Marked bot comment (ID: ${comment.id}) as resolved on issue #${issueNumber}`
        );
      } catch (error) {
        console.error(
          `Error updating comment (ID: ${comment.id}) on issue #${issueNumber}: ${error.message}`
        );
      }
    }
  }
}

// Fetch the issue and return the login of the author
async function getIssueAuthorLogin(owner, repo, issueNumber) {
  const { data: issue } = await octokit.issues.get({
    owner,
    repo,
    issue_number: issueNumber,
  });
  return issue.user?.login;
}

// Returns an array of community labels that are "managed" by this bot
function getManagedCommunityLabels() {
  return Object.values(validCommands)
    .map((c) => c.label)
    .filter(Boolean); // only entries that have a label
}

// Normalize label input (trim & preserve case of real labels, but match case-insensitively)
function normalizeRequestedLabels(input, managedLabels) {
  const requested = input
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const byLower = new Map(managedLabels.map((L) => [L.toLowerCase(), L]));

  const resolved = [];
  for (const req of requested) {
    const exact = byLower.get(req.toLowerCase());
    if (exact) resolved.push(exact);
  }
  return Array.from(new Set(resolved)); // unique
}

// Remove one or many labels; returns {removed:[], missing:[]}
async function resolveLabels(owner, repo, issueNumber, labels) {
  const { data: current } = await octokit.issues.listLabelsOnIssue({
    owner,
    repo,
    issue_number: issueNumber,
  });
  const present = new Set(current.map((l) => l.name));
  const removed = [];
  const missing = [];

  for (const label of labels) {
    if (present.has(label)) {
      try {
        await octokit.issues.removeLabel({
          owner,
          repo,
          issue_number: issueNumber,
          name: label,
        });
        removed.push(label);
      } catch (e) {
        // If racing or lacking, treat as missing
        missing.push(label);
      }
    } else {
      missing.push(label);
    }
  }

  return { removed, missing };
}

// Hard delete via GraphQL mutation
async function hardDeleteIssue({
  owner,
  repo,
  issueNumber,
  actor,
  originalCommentId,
  issueData,
}) {
  try {
    if (!issueData) {
      throw new Error("Issue data required to perform hard delete.");
    }

    // Log report details for record-keeping before deletion
    console.log("=== Report deletion record ===");
    console.log(`Title: ${issueData.title}`);
    console.log(`Author: @${issueData.user?.login}`);
    console.log(
      "Labels:",
      issueData.labels.map((l) => l.name).join(", ") || "(none)"
    );
    console.log("Body:\n", issueData.body || "(no body content)");
    console.log("=== End of record ===");

    const issueId = issueData.node_id; // This is the GraphQL global node ID. Not the issue number.

    // 2) Perform the hard delete
    await graphql(
      `
        mutation ($input: DeleteIssueInput!) {
          deleteIssue(input: $input) {
            clientMutationId
          }
        }
      `,
      { input: { issueId } }
    );

    console.log(`Issue #${issueNumber} permanently deleted by @${actor}.`);

    // NOTE: Do NOT post a follow-up comment here; the issue no longer exists.
  } catch (error) {
    console.error(`Hard delete failed: ${error.message}`);
    // Best-effort feedback if still possible
    try {
      await postComment(
        owner,
        repo,
        issueNumber,
        originalCommentId,
        `@${actor} Sorry, I couldn't delete this report automatically. A maintainer may need to assist.`
      );
    } catch (_e) {
      // If the issue *was* deleted before we tried to comment, ignore.
    }
  }
}

async function main() {
  if (args.includes("--intro")) {
    const issueNumber = parseInt(process.env.ISSUE_NUMBER, 10);
    const owner = process.env.REPO_OWNER;
    const repo = process.env.REPO_NAME;
    await postIssueHelpComment(owner, repo, issueNumber);
    return;
  }

  await run();
}

main().catch((error) => {
  console.error("An error occurred:", error);
  process.exit(1);
});
