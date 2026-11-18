/**
 * The blocks of a Markdown document with the lines they span, from the
 * lexer of marked. This is the only module that imports marked, so the
 * rest of wandelzeug does not depend on its tokens.
 */

import { lexer, type Token, type Tokens } from "marked";

/** Where a block sits in the text, as indices of its first and last line. */
type Lines = {
  readonly first: number;
  readonly last: number;
};

/** A block of a Markdown document. Blank lines between blocks are left out. */
export type MarkdownBlock = Lines &
  (
    | {
        readonly type: "heading";
        readonly depth: number;
        /** The text after the # marks, as Markdown source. */
        readonly text: string;
      }
    | {
        readonly type: "list";
        /** The Markdown source of each item, with its list marker. */
        readonly items: readonly string[];
      }
    | {
        readonly type: "definition";
        /** The label of a link reference definition, such as "1.4.2" in "[1.4.2]: ...". */
        readonly label: string;
      }
    | {
        readonly type: "other";
        /** The block type of marked, such as "paragraph" or "code". */
        readonly kind: string;
      }
  );

const countLineBreaks = (text: string): number =>
  text.match(/\n/g)?.length ?? 0;

/** Finds the lines of a token from the line where its source starts. */
function tokenLines(token: Token, start: number): Lines {
  const leading = /^\n*/.exec(token.raw)?.[0].length ?? 0;
  const body = token.raw.slice(leading).replace(/\n+$/, "");
  const first = start + leading;
  return { first, last: first + countLineBreaks(body) };
}

const DEFINITION_LABEL = /^\s*\[([^\]]*)\]:/;

/** Turns a token into a block. Tokens of blank lines yield none. */
function toBlock(token: Token, lines: Lines): MarkdownBlock | undefined {
  switch (token.type) {
    case "space":
      return undefined;
    case "heading": {
      const heading = token as Tokens.Heading;
      return {
        ...lines,
        type: "heading",
        depth: heading.depth,
        text: heading.text,
      };
    }
    case "list": {
      const list = token as Tokens.List;
      const items = list.items.map((item) => item.raw.trimEnd());
      return { ...lines, type: "list", items };
    }
    case "def": {
      const label = DEFINITION_LABEL.exec(token.raw)?.[1] ?? "";
      return { ...lines, type: "definition", label };
    }
    default:
      return { ...lines, type: "other", kind: token.type };
  }
}

/**
 * Splits Markdown into its blocks. The source of the lexer's tokens adds
 * up to the whole text, so each block knows the lines it spans.
 */
export function markdownBlocks(text: string): MarkdownBlock[] {
  const tokens = lexer(text);
  const starts = tokens.reduce<number[]>(
    (lines, token, index) => [
      ...lines,
      (lines[index] ?? 0) + countLineBreaks(token.raw),
    ],
    [0],
  );
  return tokens.flatMap((token, index) => {
    const block = toBlock(token, tokenLines(token, starts[index] ?? 0));
    return block === undefined ? [] : [block];
  });
}
