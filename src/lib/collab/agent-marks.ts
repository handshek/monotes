import { StateEffect, StateField, type Extension } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";

/* Briefly highlight text an agent just changed, labelled with its name. */

interface MarkSpec {
  id: number;
  from: number;
  to: number;
  name: string;
}

export const addAgentMarks = StateEffect.define<MarkSpec[]>();
export const clearAgentMarks = StateEffect.define<number>();

const agentMarkField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(marks, tr) {
    marks = marks.map(tr.changes);
    for (const effect of tr.effects) {
      if (effect.is(addAgentMarks)) {
        marks = marks.update({
          add: effect.value
            .filter((mark) => mark.to > mark.from)
            .map((mark) =>
              Decoration.mark({
                class: "cm-agent-edit",
                attributes: { title: `Edited by ${mark.name}`, "data-agent": mark.name },
                id: mark.id,
              }).range(mark.from, mark.to),
            ),
          sort: true,
        });
      } else if (effect.is(clearAgentMarks)) {
        const id = effect.value;
        marks = marks.update({ filter: (_from, _to, value) => value.spec.id !== id });
      }
    }
    return marks;
  },
  provide: (field) => EditorView.decorations.from(field),
});

const agentMarkTheme = EditorView.baseTheme({
  ".cm-agent-edit": {
    // Sodium's selection wash marks what an agent just changed.
    backgroundColor: "var(--selected)",
  },
});

export function agentMarks(): Extension {
  return [agentMarkField, agentMarkTheme];
}

let nextId = 1;
export function agentMarkId() {
  return nextId++;
}
