/**
 * File: common.js
 * Project: scripts
 * File Created: Thursday, 26th December 2024 2:54:03 pm
 * Author: Josh5 (jsunnex@gmail.com)
 * -----
 * Last Modified: Thursday, 26th December 2024 10:26:23 pm
 * Modified By: Josh5 (jsunnex@gmail.com)
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

  for (let i = headingIndex + 1; i < lines.length; i++) {
    const currentLine = lines[i].trim();

    if (currentLine.toLowerCase().startsWith("### ")) {
      return null;
    }
    if (!currentLine) {
      continue;
    }
    return currentLine;
  }
  return null;
}
