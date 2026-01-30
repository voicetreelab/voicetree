import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';
import { RangeSet, StateField, type EditorState, type Range } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';

/**
 * Line decoration for added lines (starting with +)
 */
const addedLineDecoration: Decoration = Decoration.line({ class: 'cm-diff-added' });

/**
 * Line decoration for removed lines (starting with -)
 */
const removedLineDecoration: Decoration = Decoration.line({ class: 'cm-diff-removed' });

/**
 * Find lines in code blocks that start with + or - and add decorations
 * Only matches when +/- is the first non-whitespace character on the line
 */
function findDiffLines(state: EditorState): Range<Decoration>[] {
  const decorations: Range<Decoration>[] = [];

  syntaxTree(state).iterate({
    enter(node) {
      // Only process FencedCode nodes (code blocks)
      if (node.name !== 'FencedCode') {
        return;
      }

      // Get line range for this code block
      const startLine: { from: number; to: number; number: number; text: string } = state.doc.lineAt(node.from);
      const endLine: { from: number; to: number; number: number; text: string } = state.doc.lineAt(node.to);

      // Iterate through lines in the code block (skip first and last which are ```)
      for (let lineNum: number = startLine.number + 1; lineNum < endLine.number; lineNum++) {
        const line: { from: number; to: number; number: number; text: string } = state.doc.line(lineNum);
        const lineText: string = line.text;

        // Check if first non-whitespace character is + or -
        const trimmed: string = lineText.trimStart();
        if (trimmed.length === 0) continue;

        const firstChar: string = trimmed[0];
        if (firstChar === '+') {
          decorations.push(addedLineDecoration.range(line.from));
        } else if (firstChar === '-') {
          decorations.push(removedLineDecoration.range(line.from));
        }
      }
    }
  });

  // Sort decorations by position (required by RangeSet)
  decorations.sort((a, b) => a.from - b.from);

  return decorations;
}

/**
 * CodeMirror StateField extension for diff highlighting in code blocks
 *
 * Adds light green background to lines starting with +
 * Adds light red background to lines starting with -
 * Only applies when +/- is the first non-whitespace character
 */
export function diffHighlight(): StateField<DecorationSet> {
  return StateField.define<DecorationSet>({
    create(state) {
      return RangeSet.of(findDiffLines(state), true);
    },

    update(_decorations, transaction) {
      // Rebuild decorations on any change
      return RangeSet.of(findDiffLines(transaction.state), true);
    },

    provide(field) {
      return EditorView.decorations.from(field);
    },
  });
}
