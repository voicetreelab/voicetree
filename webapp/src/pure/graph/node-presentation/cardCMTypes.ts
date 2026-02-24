import type { Compartment } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

/** CardCM mode: read-only display vs full editing */
export type CardCMMode = 'readonly' | 'editing';

/** A mounted CardCM instance with CM6 Compartments for zero-cost mode switching */
export interface CardCMInstance {
    readonly view: EditorView;
    readonly container: HTMLElement;
    readonly editableCompartment: Compartment;
    readonly autosaveCompartment: Compartment;
    readonly nodeId: string;
    // eslint-disable-next-line functional/prefer-readonly-type -- intentionally mutable: mode transitions update this
    currentMode: CardCMMode;
}
