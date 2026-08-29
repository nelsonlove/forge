/**
 * One heading scanner, shared by every caller that needs to know where a note's
 * headings are.
 *
 * A `#` at the start of a line is not always a heading. Markdown says a fenced code
 * block is opaque, and Obsidian says a `%%` comment is invisible. Scanning line by line
 * with a bare regex ignores both, so a shell comment in a code block becomes an H1, and
 * Forge then treats it as a document section: it can be matched by a template node,
 * counted as an extra heading, or used as a boundary when Shape Repair decides where to
 * insert. Measured on one real vault, 59 notes had at least one heading-shaped line
 * inside a fence.
 *
 * The rules here are CommonMark's for fences and Obsidian's for comments:
 *
 *   - A fence opens on three or more backticks or tildes and closes on a run of the same
 *     character at least as long. A shorter run inside a longer fence is content, which
 *     is how a markdown example shows fenced code without ending its own block.
 *   - A closing fence carries no info string, so ```md opens and a bare ``` closes.
 *   - `%%` toggles an Obsidian comment. A line holding a complete `%% ... %%` comment
 *     stays balanced; an odd marker opens a block that runs to the next marker.
 */

export interface ScannedHeading {
  level: number;
  text: string;
  lineIndex: number;
}

const HEADING = /^(#{1,6})\s+(.+)$/;
const FENCE = /^\s{0,3}(`{3,}|~{3,})(.*)$/;

/**
 * Headings in `lines`, skipping fenced code blocks and `%%` comments.
 *
 * `lineIndex` is the index within `lines`, so a caller that has already split off
 * frontmatter gets offsets relative to the body it passed in.
 */
export function scanHeadings(lines: string[]): ScannedHeading[] {
  const headings: ScannedHeading[] = [];
  let fence: string | null = null;
  let inComment = false;

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];

    if (fence !== null) {
      // Only a run of the same character, at least as long as the opener, closes it —
      // and a closing fence carries no info string.
      const close = line.match(FENCE);
      if (
        close &&
        close[1][0] === fence[0] &&
        close[1].length >= fence.length &&
        close[2].trim() === ""
      ) {
        fence = null;
      }
      continue;
    }

    const open = line.match(FENCE);
    if (open) {
      fence = open[1];
      continue;
    }

    // Count markers before deciding, so `%% aside %%` on one line stays balanced and a
    // single trailing marker opens a block that runs to the next one.
    const markers = (line.match(/%%/g) ?? []).length;
    if (inComment) {
      if (markers % 2 === 1) inComment = false;
      continue;
    }
    if (markers > 0) {
      if (markers % 2 === 1) inComment = true;
      // A heading cannot also be a comment delimiter; skip either way.
      continue;
    }

    const match = line.match(HEADING);
    if (match) {
      headings.push({ level: match[1].length, text: match[2].trim(), lineIndex: index });
    }
  }

  return headings;
}

/** Splits leading YAML frontmatter off `lines`, returning the body and its offset. */
export function splitFrontmatterLines(
  lines: string[]
): { bodyLines: string[]; bodyStartLineIndex: number } {
  if (lines[0]?.trim() !== "---") return { bodyLines: lines, bodyStartLineIndex: 0 };
  for (let index = 1; index < lines.length; index++) {
    if (lines[index].trim() === "---") {
      return { bodyLines: lines.slice(index + 1), bodyStartLineIndex: index + 1 };
    }
  }
  // An unterminated opener is not frontmatter — treat the whole file as body rather than
  // silently dropping every heading in it.
  return { bodyLines: lines, bodyStartLineIndex: 0 };
}

/** Headings in a whole note or template, frontmatter excluded, offsets absolute. */
export function scanHeadingsInContent(content: string): ScannedHeading[] {
  const lines = content.split("\n");
  const { bodyLines, bodyStartLineIndex } = splitFrontmatterLines(lines);
  return scanHeadings(bodyLines).map((heading) => ({
    ...heading,
    lineIndex: heading.lineIndex + bodyStartLineIndex,
  }));
}
