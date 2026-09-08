# 1.9.1 validation

- Scope: presentation only. No harness behaviour, stored value, API shape or database migration changed. `HarnessSettings` and `ToolSettings` keys, ranges and defaults are untouched.
- Unit suite: 81 passed. Type checking: `npx tsc --noEmit` passed. Production: `npm run build` passed. `git diff --check` passed.
- `SectionTitle` moved from `app/page.tsx` to `app/section-title.tsx` so the harness panel can share it without a circular import.
- Static browser review against the real stylesheet covered the expanded sidebar, the collapsed rail, and the full harness tab. Two CSS specificity defects were found and corrected there: `.sidebar-head > button` outranked both `.sidebar-close` and the narrow-screen `.sidebar-toggle` rule, so the mobile close button showed on desktop and the collapse control would have shown in the mobile drawer. Computed styles now confirm desktop shows only the collapse control and narrow screens only the close control.
- Repaired defect: history rows had three children in a two-column grid, so the delete button wrapped onto a second row. Rename and delete now share one flex action group, hover-revealed on fine pointers and permanent on coarse pointers.
- Narrow-screen rules were exercised by widening every `max-width` breakpoint in a copy of the stylesheet, because the preview surface holds a 980px viewport. Option cards and the model/effort grid collapse to one column and the sidebar becomes a fixed drawer. A real device pass was not performed.
- Not verified interactively: the running application was not launched, so radio-card selection, the threshold slider, prompt dialogs and settings save were reviewed as markup and computed styles rather than as live interactions. The underlying handlers are unchanged from 1.9.0, which was validated interactively.
- Korean and English strings are provided for every new label. Reasoning effort options now display localized names while sending the same values.
- MSI is packaged without installing or restarting the user's service. Installation and upgrade execution are not part of this validation.

MSI build exited successfully. Windows Installer metadata confirms ProductName NeuralNetUI, ProductVersion 1.9.1 and the existing UpgradeCode `{8D444D86-37C2-4E37-B56B-6BB9CD2C62BD}`. Unsigned package: 399,917,432 bytes. SHA-256: `5AF389F55A8172AD00BEE78438974D66D158E2FD58ABDDFFBB1602CF2388BB33`.
