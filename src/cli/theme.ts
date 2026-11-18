/**
 * The colours of the help output, a mix of cargo and Optique. Like cargo,
 * headers are bright green and bold, literals such as the program, its
 * commands and their options are bright cyan and bold, and placeholders
 * are cyan, as cargo's style constants define them
 * (https://github.com/rust-lang/cargo/blob/master/crates/cargo-util-terminal/src/style.rs).
 * Like Optique, punctuation stays dim, positional arguments stay
 * underlined, and values stay green.
 */

import {
  defaultTerminalTheme,
  type TerminalFragment,
  type TerminalStyle,
  type TerminalTheme,
} from "@optique/core/terminal";

/** Cargo's HEADER and USAGE style, for labels such as "Usage:". */
const HEADER: TerminalStyle = { foreground: "brightGreen", bold: true };

/** Cargo's LITERAL style, for text that the user types as it is. */
const LITERAL: TerminalStyle = { foreground: "brightCyan", bold: true };

/** Cargo's PLACEHOLDER style, for text that the user replaces. */
const PLACEHOLDER: TerminalStyle = { foreground: "cyan" };

/** A positional argument keeps Optique's underline, which sets it apart from an option value. */
const ARGUMENT_PLACEHOLDER: TerminalStyle = { ...PLACEHOLDER, underline: true };

const styled = (text: string, style: TerminalStyle): TerminalFragment => ({
  type: "style",
  style,
  children: [{ type: "text", text }],
});

/** The label kinds that head a part of the help, as cargo's headers do. */
const HEADER_LABELS = ["usage", "section", "examples", "author", "bugs"];

/** The theme of the help output. Roles that it leaves out keep Optique's defaults. */
export const HELP_THEME: TerminalTheme = {
  programName: (_term, context) => styled(context.text, LITERAL),
  optionName: (_term, context) => styled(context.text, LITERAL),
  commandLine: (_term, context) => styled(context.text, LITERAL),
  metavar: (_term, context) =>
    styled(
      context.text,
      context.usage === "argument" ? ARGUMENT_PLACEHOLDER : PLACEHOLDER,
    ),
  label: (term, context) =>
    HEADER_LABELS.includes(term.kind)
      ? styled(context.text, HEADER)
      : defaultTerminalTheme.label(term, context),
};
