# Browser evidence

The before images come from the unchanged production baseline at b6f605126121cf118f2707988c3178e11bf5599b. The before reports record exact assertion failures. The after images come from the final production build, captured after the matching assertions pass.

| Fix | Before | After | Repeatable check |
| --- | --- | --- | --- |
| Preserve the final edit across reload | [Old text restored](before-reload.png) | [Final text retained](after-reload.png) | regressions.spec.ts, last edit survives reload |
| Make sidebar Search usable | [Click stays in editor](before-search.png) | [Search field focused](after-search.png) | regressions.spec.ts, sidebar Search |
| Expose the selected mobile note | [Drawer stays open](before-mobile.png) | [Editor visible](after-mobile.png) | mobile.spec.ts, selection and creation |

Persistence also has [visible save failure](after-save-failure.png) and [recovered draft](after-draft-recovery.png) screenshots. Automated assertions check exact note contents and stored values. Screenshots illustrate the result; they do not replace the assertions.

Raw traces, recordings, and full HTML reports remain in each run’s local `test-results` and `html` directories, which Git ignores. Curated images and JSON reports are committed. The original final run passed 56 checks, but two screenshots caught transition frames. Success captures were moved after assertions and the repeated suite was rerun to replace that evidence.
