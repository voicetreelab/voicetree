import { HighlightStyle } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

// Combined highlight style: code syntax colors from defaultHighlightStyle + custom heading styles (no underlines)
// We can't use defaultHighlightStyle directly because it has heading underlines we don't want
export const combinedHighlightStyle: HighlightStyle = HighlightStyle.define([
  // Heading styles (no underlines, proper size hierarchy)
  { tag: t.heading, fontWeight: 'bold', fontFamily: 'sans-serif', textDecoration: 'none' },
  { tag: t.heading1, fontWeight: 'bold', fontFamily: 'sans-serif', fontSize: '24px', textDecoration: 'none' },
  { tag: t.heading2, fontWeight: 'bold', fontFamily: 'sans-serif', fontSize: '21px', textDecoration: 'none' },
  { tag: t.heading3, fontWeight: 'bold', fontFamily: 'sans-serif', fontSize: '18px', textDecoration: 'none' },
  { tag: t.heading4, fontWeight: 'bold', fontFamily: 'sans-serif', fontSize: '16px', textDecoration: 'none' },
  // Code syntax highlighting (from defaultHighlightStyle)
  { tag: t.meta, color: '#404740' },
  { tag: t.link, textDecoration: 'underline' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strong, fontWeight: 'bold' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.keyword, color: '#708' },
  { tag: [t.atom, t.bool, t.url, t.contentSeparator, t.labelName], color: '#219' },
  { tag: [t.literal, t.inserted], color: '#164' },
  { tag: [t.string, t.deleted], color: '#a11' },
  { tag: [t.regexp, t.escape, t.special(t.string)], color: '#e40' },
  { tag: t.definition(t.variableName), color: '#00f' },
  { tag: t.local(t.variableName), color: '#30a' },
  { tag: [t.typeName, t.namespace], color: '#085' },
  { tag: t.className, color: '#167' },
  { tag: [t.special(t.variableName), t.macroName], color: '#256' },
  { tag: t.definition(t.propertyName), color: '#00c' },
  { tag: t.comment, color: '#940' },
  { tag: t.invalid, color: '#f00' },
]);
