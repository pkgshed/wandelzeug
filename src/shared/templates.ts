/**
 * Mustache templates without HTML escaping. This is the only module that
 * imports mustache.js, so the rest of wandelzeug does not depend on it.
 */

import Mustache from "mustache";
import { withContext } from "./foundations.ts";

/** A Mustache template whose syntax parsed, with the names it uses. */
export type Template = {
  readonly source: string;
  /** The names of values and sections, such as "body" in {{body}}. */
  readonly names: readonly string[];
  /** The names of partials, such as "change" in {{> change}}. */
  readonly partials: readonly string[];
  /** The literal text outside the tags, joined together. */
  readonly literalText: string;
};

/** Values for a template. A section repeats for an array and skips a falsy value. */
export type TemplateView = Readonly<Record<string, unknown>>;

/** Templates for {{> name}} partial tags, by name. */
export type TemplatePartials = Readonly<Record<string, string>>;

const FIELD_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Reports whether text can serve as a value name in templates. */
export const isFieldName = (text: string): boolean => FIELD_NAME.test(text);

type Tag = {
  readonly type: string;
  readonly value: string;
};

/**
 * Lists the parsed Mustache tokens, including those inside sections. Text
 * between the tags comes as tokens of type "text".
 */
function collectTags(tokens: readonly (readonly unknown[])[]): Tag[] {
  return tokens.flatMap((token) => {
    const [type, value, , , children] = token;
    const nested = Array.isArray(children) ? collectTags(children) : [];
    return [{ type: String(type), value: String(value) }, ...nested];
  });
}

const VALUE_TAGS = ["name", "&", "#", "^"];

const unique = (values: readonly string[]): string[] => [...new Set(values)];

/** Parses a template, so a syntax error surfaces before anything renders. */
export function parseTemplate(source: string): Template {
  const tokens = withContext(`template ${JSON.stringify(source)}`, () =>
    Mustache.parse(source),
  );
  const tags = collectTags(tokens);
  return {
    source,
    names: unique(
      tags
        .filter((tag) => VALUE_TAGS.includes(tag.type))
        .map((tag) => tag.value),
    ),
    partials: unique(
      tags.filter((tag) => tag.type === ">").map((tag) => tag.value),
    ),
    literalText: tags
      .filter((tag) => tag.type === "text")
      .map((tag) => tag.value)
      .join(""),
  };
}

/** Keeps values as they are, because the output is Markdown and not HTML. */
const keepText = (text: string): string => text;

/** Renders a template. A missing value renders empty, as Mustache defines. */
export const renderTemplate = (
  template: Template,
  view: TemplateView,
  partials: TemplatePartials = {},
): string =>
  Mustache.render(template.source, view, partials, { escape: keepText });
