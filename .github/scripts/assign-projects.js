/**
 * File: assign-projects.js
 * Project: scripts
 * File Created: Thursday, 26th December 2024 3:10:59 pm
 * Author: Josh5 (jsunnex@gmail.com)
 * -----
 * Last Modified: Sunday, 29th December 2024 12:13:05 pm
 * Modified By: Josh5 (jsunnex@gmail.com)
 */

import { Octokit } from "@octokit/rest";
import { graphql } from "@octokit/graphql";
import { extractHeadingValue } from "./common.js";
import dotenv from "dotenv";

dotenv.config(); // Load environment variables from .env for local testing

// Configuration
const ORG_LOGIN = process.env.ORG_LOGIN || "DeckSettings";

// Initialize Octokit with the provided GITHUB_TOKEN
const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN,
});

// Initialize Octokit GraphQL with the same token
const graphqlWithAuth = graphql.defaults({
  headers: {
    authorization: `token ${process.env.GITHUB_TOKEN}`,
  },
});

/**
 * Check if a Project V2 with the given app ID or game name already exists in the org.
 * @param {string} orgNodeId - The Node ID of the organization.
 * @param {number} [appIdNum] - The App ID as a number (optional).
 * @param {string} [gameName] - The name of the game (optional).
 * @returns {object|null} - The existing project object or null.
 */
async function checkForExistingProject(orgNodeId, appIdNum, gameName) {
  const query = `
      query fetchOrgProjects($orgId: ID!, $cursor: String) {
        node(id: $orgId) {
          ... on Organization {
            projectsV2(first: 100, after: $cursor) {
              nodes {
                id
                title
                url
              }
              pageInfo {
                endCursor
                hasNextPage
              }
            }
          }
        }
      }
    `;

  try {
    let hasNextPage = true;
    let endCursor = null;
    let existing = null;

    while (hasNextPage && !existing) {
      // Exit loop if project is found
      const resp = await graphqlWithAuth(query, {
        orgId: orgNodeId,
        cursor: endCursor,
      });

      if (!resp.node || !resp.node.projectsV2) {
        console.log("No project data returned from org node.");
        return null;
      }

      // Look for a project whose 'title' includes appid OR name
      existing = resp.node.projectsV2.nodes.find((proj) => {
        if (appIdNum !== "" && proj.title.includes(`appid="${appIdNum}"`)) {
          return true; // Found by appid
        }
        if (gameName && proj.title.includes(`name="${gameName}"`)) {
          return true; // Found by gameName
        }
        return false; // Not found
      });

      hasNextPage = resp.node.projectsV2.pageInfo.hasNextPage;
      endCursor = resp.node.projectsV2.pageInfo.endCursor;
    }

    return existing; // No matching project found
  } catch (error) {
    console.error("Error fetching organization projects:", error);
    throw error;
  }
}

/**
 * Create a new Project V2 in the organization with the given projectTitle
 * @param {string} orgNodeId - The Node ID of the organization.
 * @param {string} projectTitle - The App ID as a string.
 * @returns {object} - The newly created project object.
 */
async function createProjectV2(orgNodeId, projectTitle) {
  // Mutation to create Project V2
  const createProjectMutation = `
    mutation createOrgProject($orgId: ID!, $title: String!) {
      createProjectV2(input: {title: $title, ownerId: $orgId}) {
        projectV2 {
          id
          title
          url
        }
      }
    }
  `;

  const createVars = {
    orgId: orgNodeId,
    title: projectTitle,
  };

  try {
    const createResult = await graphqlWithAuth(
      createProjectMutation,
      createVars
    );
    const newProj = createResult.createProjectV2.projectV2;
    console.log(
      `Created new Project V2 (#${newProj.id}) titled "${newProj.title}".`
    );
    console.log(`URL: ${newProj.url}`);

    return newProj;
  } catch (error) {
    console.error("Error creating Project V2:", error);
    throw error;
  }
}

/**
 * TODD... This function does nothing ATM
 * Uses "( Unknown Game Name )" if gameName is not provided.
 * @param {string} projectId - The Node ID of the project.
 */
async function setProjectCustomFields(projectId) {
  // Get the ID of the "Status" field
  const searchQuery = `
    query($projectId: ID!) {
      node(id: $projectId) {
        ... on ProjectV2 {
          fields(first: 20) {
            nodes {
              ... on ProjectV2SingleSelectField {
                id
                name
                options {
                  id
                  name
                }
              }
            }
          }
        }
      }
    }
  `;
  const response = await graphqlWithAuth(searchQuery, { projectId });
  const fields = response.node.fields.nodes;
  const statusField = fields.find((field) => field.name === "Status");
  if (!statusField) {
    throw new Error("Status field not found");
  }
  console.log(`Status Field ID: ${statusField.id}`);

  // Ensure it's a Single Select Field
  if (!statusField.options) {
    throw new Error("Status field is not a Single Select Field");
  }

  // Define the desired updates
  const updates = {
    Todo: {
      newName: "Active",
      description: "This report is active",
    },
    "In Progress": {
      newName: "Pending",
      description: "This report is pending review",
    },
    Done: {
      newName: "Closed",
      description: "This report is inactive",
    },
  };
  // TODO: Apply this
}

/**
 * Set a "Short description" to the Project V2.
 * @param {string} projectId - The Node ID of the project.
 * @param {string} projectTitle - The App ID as a string.
 * @param {string} gameName - The Game Name as a string.
 */
async function configureProjectData(projectId, projectTitle, gameName) {
  try {
    // Mutation to set the field value
    const setFieldMutation = `
      mutation setProjectField($projectId: ID!, $title: String!, $readme: String!, $description: String!) {
        updateProjectV2(
            input: {
            projectId: $projectId, 
            title: $title,
            public: true,
            readme:  $readme,
            shortDescription: $description
            }
        ) {
            projectV2 {
            id
            title
            readme
            shortDescription
            }
        }
      }
    `;
    const setFieldVars = {
      projectId,
      title: projectTitle,
      readme: `# [${projectTitle}] \n\nThis GitHub project contains a list of all game reports matching this App ID.`,
      description: gameName,
    };

    await graphqlWithAuth(setFieldMutation, setFieldVars);
    console.log(
      `Set "Short description" for Project V2 (#${projectId}) to "${gameName}".`
    );
  } catch (error) {
    console.error("Error setting 'Short description' field:", error);
    throw error;
  }
}

/**
 * Removes an issue from a specific GitHub Project V2 using the item's ID.
 *
 * @param {string} itemId - The ID of the project item to remove.
 * @param {string} projectId - The ID of the project.
 */
async function removeIssueFromProjectV2(itemId, projectId) {
  try {
    const removeItemMutation = `
      mutation($itemId: ID!, $projectId: ID!) {
        deleteProjectV2Item(input: { itemId: $itemId, projectId: $projectId }) {
          clientMutationId
        }
      }
    `;

    await graphqlWithAuth(removeItemMutation, { itemId, projectId });
    console.log(`Removed issue from project item ID: ${itemId}`);
  } catch (error) {
    console.error(`Error removing issue from project: ${error.message}`);
    throw error;
  }
}

/**
 * Fetches the project item ID for a given project and content (issue) ID.
 *
 * @param {string} projectId - The ID of the project.
 * @param {string} contentId - The ID of the content (issue) to find in the project.
 * @returns {string|null} - The ID of the project item if found, otherwise null.
 */
async function getProjectItemId(projectId, contentId) {
  const projectItemsQuery = `
      query($projectId: ID!, $cursor: String) {
        node(id: $projectId) {
          ... on ProjectV2 {
            items(first: 100, after: $cursor) {
              pageInfo {
                hasNextPage
                endCursor
              }
              nodes {
                id
                content {
                  ... on Issue {
                    id
                  }
                  ... on PullRequest {
                    id
                  }
                }
              }
            }
          }
        }
      }
    `;

  let cursor = null;
  let foundItemId = null;

  try {
    do {
      const variables = { projectId, cursor };
      const response = await graphqlWithAuth(projectItemsQuery, variables);

      const project = response.node;
      if (!project || !project.items) {
        break;
      }

      for (const item of project.items.nodes) {
        if (item.content && item.content.id === contentId) {
          foundItemId = item.id;
          break;
        }
      }

      if (foundItemId) {
        break;
      }

      cursor = project.items.pageInfo.hasNextPage
        ? project.items.pageInfo.endCursor
        : null;
    } while (cursor);
  } catch (error) {
    console.error(`Error fetching project items: ${error.message}`);
    throw error;
  }

  return foundItemId;
}

/**
 * Ensures that a GitHub issue is assigned to a specific project.
 * If it's not assigned, it assigns the issue to the project.
 * Additionally, it removes the issue from any other projects it's currently assigned to.
 *
 * @param {string} owner - Owner of the repository (username or organization).
 * @param {string} repo - Name of the repository.
 * @param {number} issueNumber - Number of the issue to check.
 * @param {string} projectId - ID of the project to assign the issue to.
 */
async function ensureIssueHasProject(owner, repo, issueNumber, projectId) {
  try {
    // Fetch the issue's node ID and all project associations
    const issueQuery = `
      query($owner: String!, $repo: String!, $issueNumber: Int!) {
        repository(owner: $owner, name: $repo) {
          issue(number: $issueNumber) {
            id
            projectsV2(first: 100) {
              nodes {
                id
                title
              }
            }
          }
        }
      }
    `;

    const issueData = await graphqlWithAuth(issueQuery, {
      owner,
      repo,
      issueNumber,
    });

    const issue = issueData.repository.issue;
    if (!issue) {
      throw new Error(`Issue #${issueNumber} not found in ${owner}/${repo}.`);
    }

    const issueId = issue.id;
    const issueProjects = issue.projectsV2.nodes;
    // console.log(`Current projects for issue #${issueNumber}:`, issueProjects);

    // Track if the issue is already assigned to the target project
    let alreadyAssigned = false;
    // Remove the issue from all projects except the target project
    for (const project of issueProjects) {
      // Remove the issue from all projects except the target project
      if (project.id !== projectId) {
        // Fetch the project item ID for this issue in the current project
        const itemId = await getProjectItemId(project.id, issueId);
        await removeIssueFromProjectV2(itemId, project.id);
        console.log(
          `Removed issue #${issueNumber} from project "${project.title}" (ID: ${project.id})`
        );
      } else {
        // Found the desired project is already assigned
        alreadyAssigned = true;
      }
    }

    // If already assigned to the target project, no further action is needed
    if (alreadyAssigned) {
      console.log(
        `Issue #${issueNumber} is already in the target project with ID: ${projectId}.`
      );
      return;
    }

    // Add the issue to the target project
    const addItemMutation = `
      mutation($projectId: ID!, $contentId: ID!) {
        addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) {
          item {
            id
          }
        }
      }
    `;

    const addItemResponse = await graphqlWithAuth(addItemMutation, {
      projectId,
      contentId: issueId,
    });

    const newItemId = addItemResponse.addProjectV2ItemById.item.id;
    console.log(
      `Added issue #${issueNumber} to project ID ${projectId} (Item ID: ${newItemId}).`
    );
  } catch (error) {
    console.error(`Error in ensureIssueHasProject: ${error.message}`);
    throw error;
  }
}

/**
 * Main function to check/create project and add issue to it.
 */
async function run() {
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

  // Parse "Game Name" and "App ID"
  const gameName = extractHeadingValue(lines, "Game Name");
  const appIdRaw = extractHeadingValue(lines, "App ID");

  let appIdNum = Number(appIdRaw);
  if (!appIdRaw || Number.isNaN(appIdNum)) {
    console.log("No App ID provided in issue body");
    appIdNum = ""; // Set appIdNum to an empty string
    if (!gameName) {
      console.log("No game name provided in issue body either");
      return; // End script here
    }
  }

  console.log(`App ID detected: ${appIdNum}`);
  console.log(`Game Name: ${gameName}`);

  // Fetch the Organization Node ID
  const orgQuery = `
    query getOrgId($login: String!) {
      organization(login: $login) {
        id
      }
    }
  `;
  let orgData;
  try {
    orgData = await graphqlWithAuth(orgQuery, { login: ORG_LOGIN });
  } catch (error) {
    console.error(`Error fetching organization "${ORG_LOGIN}":`, error);
    throw error;
  }

  if (!orgData.organization) {
    console.log(`Organization "${ORG_LOGIN}" not found or inaccessible.`);
    return;
  }

  const orgNodeId = orgData.organization.id;
  console.log(`Org Node ID for "${ORG_LOGIN}": ${orgNodeId}`);

  // Set the project title
  let projectTitle = `appid="${appIdNum}" name="${gameName}"`;

  // Check if a Project V2 named "projectTitle" exists
  let project = await checkForExistingProject(orgNodeId, appIdNum, gameName);

  if (project) {
    console.log(
      `Project V2 '${projectTitle}' (ID: ${project.id}) already exists at: ${project.url}`
    );

    // Extract appid from the existing project title if it exists
    const appIdMatch = project.title.match(/appid="(\d+)"/);
    const existingAppId = appIdMatch ? appIdMatch[1] : null;

    // If an existing appid is found, use it instead of the one from the issue body
    if (existingAppId) {
      console.log(
        `Ensure we keep the existing appid found in current project title: ${existingAppId}`
      );
      appIdNum = existingAppId;
    }
    projectTitle = `appid="${appIdNum}" name="${gameName}"`;

    // Update project data
    await configureProjectData(project.id, projectTitle, gameName);
  } else {
    console.log(
      `No existing Project V2 named "${projectTitle}". Creating new project...`
    );
    project = await createProjectV2(orgNodeId, projectTitle);
    // Set project data
    await configureProjectData(project.id, projectTitle, gameName);
    // Configure the project's status fields
    await setProjectCustomFields(project.id);
  }

  // Add the issue to the project and remove from others
  if (project) {
    await ensureIssueHasProject(owner, repo, issueNumber, project.id);
  }
}

// Execute the main function
run().catch((error) => {
  console.error("An error occurred:", error);
  process.exit(1);
});
