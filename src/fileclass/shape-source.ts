/**
 * Class notes as a refinement source.
 *
 * A Fileclass class definition is the same artifact as a Forge shape note: a spec
 * document a human reads, with one marked region a machine compiles. Forge marks its
 * region with a `# Structure` section; a class note marks it with a fenced code block
 * under a `## Shape` heading:
 *
 *     ## Shape
 *
 *     ```md
 *     # {{TITLE}}
 *     ## Purpose
 *     ```
 *
 * The fence is deliberate, twice over. Its content is read *verbatim* — what you write
 * is the structure, at its own levels, no promotion — because fenced content stands
 * outside the note's own heading tree, so the wrapper never joins the parent chain the
 * way a plain section would. And nothing else can be mistaken for the contract: prose,
 * examples and other fences elsewhere in the note are never read.
 *
 * Only extraction lives here. The pipeline is untouched: refinement still compiles
 * sources into templates, and lint still reads only templates, so editing a class note
 * changes nothing until refinement is deliberately run.
 */

const SHAPE_HEADING = /^##\s+Shape\s*$/i;
const ANY_HEADING = /^#{1,2}\s+\S/;
const FENCE = /^\s{0,3}(`{3,}|~{3,})(.*)$/;

/**
 * The fenced structure block of a class note body, or null when the note declares none.
 *
 * The rule, precisely: the first fenced code block that starts under a `## Shape`
 * heading, before the next H1/H2 ends the section. An unclosed fence reads to the end
 * of the section rather than swallowing the rest of the note.
 */
export function extractShapeBlock(body: string): string | null {
  const lines = body.split("\n");
  let inSection = false;
  let fence: string | null = null;
  const collected: string[] = [];

  for (const line of lines) {
    if (!inSection) {
      if (SHAPE_HEADING.test(line)) inSection = true;
      continue;
    }

    if (fence !== null) {
      const close = line.match(FENCE);
      if (
        close &&
        close[1][0] === fence[0] &&
        close[1].length >= fence.length &&
        close[2].trim() === ""
      ) {
        const text = collected.join("\n").trim();
        return text.length > 0 ? text : null;
      }
      collected.push(line);
      continue;
    }

    if (ANY_HEADING.test(line)) return null; // section ended before any fence

    const open = line.match(FENCE);
    if (open) fence = open[1];
  }

  if (fence !== null) {
    const text = collected.join("\n").trim();
    return text.length > 0 ? text : null;
  }
  return null;
}
