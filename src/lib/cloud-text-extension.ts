import { EditorState } from "@codemirror/state";
import { ExternalChange } from "@uiw/react-codemirror";

/*
 * The editor's value prop replaces the whole document when it changes, which
 * would throw the cursor away. Narrow that to the text that actually differs,
 * so a pull from the cloud leaves the cursor, selection and Vim mode alone.
 */
export const keepCursorOnCloudText = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged || !tr.annotation(ExternalChange)) return tr;
  const before = tr.startState.doc.toString();
  const after = tr.newDoc.toString();
  const limit = Math.min(before.length, after.length);
  let start = 0;
  while (start < limit && before[start] === after[start]) start++;
  let end = 0;
  while (end < limit - start && before[before.length - 1 - end] === after[after.length - 1 - end]) end++;
  return {
    changes: { from: start, to: before.length - end, insert: after.slice(start, after.length - end) },
    annotations: ExternalChange.of(true),
  };
});
