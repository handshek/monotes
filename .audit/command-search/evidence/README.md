# Command search visual evidence

The before images come from browser checks that fail on the old component. They show the clipped focus ring and borderless results. The after images come from the same geometry and visible-border checks against the cmdk command palette. The root agent also reproduced the original defects and inspected the live corrected app at desktop and short mobile sizes through the in-app browser.

- [Desktop before](before-desktop-chromium.png), [desktop after](after-desktop-chromium.png).
- [Mobile before](before-mobile-webkit.png), [mobile after](after-mobile-webkit.png).

The input is now a fixed command header; only the results scroll. Result notes have borders. Command palette semantics are combobox/listbox/option, with arrow selection, Enter activation, Escape, and Cmd/Ctrl+K. The existing editor remains borderless by design; the missing borders reported here were the search result cards.
