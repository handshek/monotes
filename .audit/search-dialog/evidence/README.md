# In-place search evidence

The before captures show baseline 4e3e434 after sidebar Search navigates away from the note. The new unchanged-URL assertion fails on both browsers. See ../before/report.json.

The after captures come from the passing focused run. The input contains an uppercase query, and the test waits for the matching highlighted text before capture. The original note remains behind the modal and its URL is unchanged.

- [Desktop before](before-desktop.png) and [after](after-desktop.png).
- [Mobile before](before-mobile.png) and [after](after-mobile.png).

The focused run passes 6 checks. It covers open/cancel/reopen, exact stored text, focus restoration, same-note selection, offline no-result/case-insensitive/whitespace filtering, and choosing another note with keyboard or touch.

The first development run's mobile Tab assertion was a test assumption. Native mobile WebKit skips ordinary links in that Tab sequence. The corrected test uses touch on mobile and retains Tab/Enter on desktop. The first production run was deliberately interrupted to settle that test before final verification. Those exploratory reports are retained separately, not presented as final verification.
