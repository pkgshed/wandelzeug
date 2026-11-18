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

/** An item of a top-level Markdown list, split into its marker and its text. */
export type ListItem = {
  /** The list marker with the spaces after it, such as "* " or "1. ". */
  readonly marker: string;
  /** The item after its marker, with its continuation lines as they are. */
  readonly text: string;
  /** The whole item: the marker and the text. */
  readonly body: string;
};

const LIST_MARKER = /^\s*(?:[*+-]|\d{1,9}[.)])(?:[ \t]+|$)/;

function splitListItem(body: string): ListItem {
  const marker = LIST_MARKER.exec(body)?.[0] ?? "";
  return { marker, text: body.slice(marker.length), body };
}

/**
 * Splits Markdown into the items of its top-level lists. Markdown that
 * holds anything besides lists, such as a paragraph or a code block
 * between them, has no items.
 */
export function listItems(markdown: string): ListItem[] | undefined {
  const blocks = markdownBlocks(markdown);
  const isOnlyLists =
    blocks.length > 0 && blocks.every((block) => block.type === "list");
  if (!isOnlyLists) return undefined;
  return blocks.flatMap((block) =>
    block.type === "list" ? block.items.map(splitListItem) : [],
  );
}

/** Tokens whose text cannot hold a reference: code, links that have a target already, and escaped characters. */
const OPAQUE_TOKENS = [
  "code",
  "codespan",
  "link",
  "image",
  "html",
  "escape",
  "def",
];

/** The child tokens of a token: its inline tokens, or the items of a list. */
function childTokens(token: Token): readonly Token[] {
  const { tokens, items } = token as { tokens?: Token[]; items?: Token[] };
  return [...(tokens ?? []), ...(items ?? [])];
}

/** Collects the text of the tokens that may hold references, leaf by leaf. */
function referenceTexts(tokens: readonly Token[]): string[] {
  return tokens.flatMap((token) => {
    if (OPAQUE_TOKENS.includes(token.type)) return [];
    const children = childTokens(token);
    if (children.length > 0) return referenceTexts(children);
    return token.type === "text" ? [token.raw] : [];
  });
}

const BRACKETED = /\[([^[\]\n]+)\]/g;

/**
 * Finds the labels in square brackets that may reference a link
 * definition, such as "FOO-1" in "Fixes [FOO-1].", in the order of the
 * text. Brackets in code, in links with a target, and escaped brackets do
 * not count.
 */
export const bracketedLabels = (markdown: string): string[] =>
  referenceTexts(lexer(markdown)).flatMap((text) =>
    [...text.matchAll(BRACKETED)].map((match) => match[1] ?? ""),
  );
