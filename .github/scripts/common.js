/**
 * File: common.js
 * Project: scripts
 * File Created: Thursday, 26th December 2024 2:54:03 pm
 * Author: Josh5 (jsunnex@gmail.com)
 * -----
 * Last Modified: Friday, 8th August 2025 12:55:59 pm
 * Modified By: Josh.5 (jsunnex@gmail.com)
 */

/**
 * Extracts the value under a specific Markdown heading from an array of lines.
 * @param {string[]} lines - The lines of text to parse.
 * @param {string} heading - The heading.
 * @returns {string|null} The extracted value or null if not found.
 */
export function extractHeadingValue(lines, heading) {
  const headingToFind = `### ${heading}`.toLowerCase();
  const headingIndex = lines.findIndex(
    (line) => line.trim().toLowerCase() === headingToFind
  );
  if (headingIndex === -1) return null;

  const sectionLines = [];

  for (let i = headingIndex + 1; i < lines.length; i++) {
    const currentLine = lines[i].trim();

    if (currentLine.toLowerCase().startsWith("### ")) {
      break;
    }
    sectionLines.push(currentLine);
  }

  const content = sectionLines.join("\n").trim();
  return content.length > 0 ? content : null;
}

/**
 * Builds a reportData object from an issue body based on schema properties.
 * @param {string} body - The raw issue body.
 * @param {object} schemaProperties - The `properties` object from the schema.
 * @returns {object} The report data object.
 */
export function buildReportData(body, schemaProperties) {
  const lines = body.split(/\r?\n/);
  const reportData = {};
  for (const [key, value] of Object.entries(schemaProperties)) {
    let extractedValue = extractHeadingValue(lines, key);
    // Skip adding to reportData if "_No response_"
    if (extractedValue === "_No response_") {
      continue;
    }
    // Skip optional fields if they are missing but also not required
    if (!value.required && !extractedValue) {
      continue;
    }
    // Convert to number if schema expects a number
    if (value.type === "number" && extractedValue) {
      const parsedValue = Number(extractedValue);
      extractedValue = isNaN(parsedValue) ? extractedValue : parsedValue;
    }
    // Add to reportData object
    reportData[key] = extractedValue;
  }

  return reportData;
}
