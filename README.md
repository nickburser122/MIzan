# ميزان — Mizan (Light) · v1.1.0

A client-side app that splits incentive pools fairly across employees, so the numbers can be audited. It runs as a static site with no backend.

## Structure
```
index.html        design system (CSS) + shell
js/engine.js      calculation engine, icons, demo data (pure logic)
js/selftest.js    19 engine/app self-tests
js/app.js         UI, state, import/export
```

## Entry points
- `/` or `index.html` runs the app. It picks up your last session automatically.
- `index.html?selftest=1` runs the engine self-test report (19/19 pass).

## Flow
1. **الملف**: upload an XLSX/XLS/CSV file, load demo data, download the template or open a saved JSON project.
2. **ربط الأعمدة**: map columns and see sample values. Unknown tier values get mapped once, and the mapping is remembered. Unmatched pin values show a warning.
3. **المبالغ**: pool amounts accept Arabic digits and separators. Point value updates live as you type.
4. **التوزيع**: pin a pool, set days, penalty, custom value and exclusion per person. Undo (Ctrl+Z) and pagination are available.
5. **النتائج**: KPIs, pool balance, bar charts, filters, sortable table and pagination.
6. **التصدير**: Excel workbook (RTL, formatted), CSV, save/open the project, conservation check.

## What changed in v1.1
- **UI:** full redesign. Sticky glass top bar with a pill stepper, bottom action bar, calmer surfaces, dark "hero" KPI cards, CSS bar charts in place of SVG, bottom-sheet modals on mobile, and refined dark mode.
- **Favicon:** a proper balance scale (pivot, beam, hanging pans) on a gradient tile.
- **Logic fixes:**
  - Steps can't be skipped before validation passes.
  - Rows with an unknown tier but a custom value are no longer blocked.
  - Blank rows are filtered out on import.
  - Duplicate headers are de-duplicated.
  - Auto-mapping never assigns the same column twice.
  - CSV reading handles BOM and `;` or tab delimiters.
  - Excel files are read as native numbers.
  - "Everyone excluded" now gives a clear error.
  - Undo history is reset when data is rebuilt.
  - Saved JSON projects are checked and cleaned on load.
  - The settings reset keeps your entered pool amounts.
  - The penalty column accepts both `15` and `15%`.
  - Days are clamped to the period.
  - The methodology example uses a person who actually has a payout.
- **Gaps filled:**
  - The session is saved to localStorage automatically.
  - You can open a project from the first screen.
  - "New project" asks for confirmation.
  - CSV export is also available when Excel works.
  - Tables are paginated (50 rows per page).
  - Ctrl+S saves the project.
  - Search matches job titles too.
  - A filter summary chip shows active filters, with a one-tap clear.
  - Sorting cycles through ascending, descending and off.

## Storage
localStorage only. Keys: `mizan.session.v1`, `incentiveSettings`, `tierMappings`, `themePreference`. No tables or APIs are used.

## Not included / next ideas
- Adding or renaming pools and tiers from the UI.
- Printable PDF summary.
