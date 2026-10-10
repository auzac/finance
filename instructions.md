# Development Instructions

## Objective
Build a simple, reliable, and user-friendly financial growth calculator. Prioritize clean, efficient code and maintainability. Do not overengineer.

## Source of Truth
- `context.md` defines the agreed features, inputs, calculations, and scope.
- `structure.md` defines the project layout and file responsibilities.
- Do not introduce features or architectural changes outside these documents without an explicit decision.

## Languages and Tools
- **HTML** — page structure.
- **CSS** — responsive styling.
- **Vanilla JavaScript** — interface, dynamic inputs, API calls, and charts (Chart.js).
- **Python** — calculation engine, validation, and a single API endpoint.
- **Pytest** — tests for calculation logic.
- **Vercel** — web app hosting and Python serverless API.

## Coding Rules
1. Prefer straightforward, readable code over abstractions and frameworks.
2. Keep calculations in Python; keep the frontend focused on input and display.
3. Reuse small functions where helpful; avoid unnecessary classes, layers, and dependencies.
4. Validate inputs and return clear, actionable errors. Never silently allow fund allocations above available surplus.
5. Treat optional blank numeric inputs as zero, as specified in `context.md`.
6. Keep annual projection results consistent, deterministic, and free from double-counting.
7. Use descriptive names, minimal comments, and consistent formatting.
8. Make the interface responsive and easy to modify.
9. Add focused tests for core calculations and edge cases before adding features.
10. Do not add a database, authentication, complex state management, or additional frameworks for Version 1.

## Implementation Discipline
- Implement the smallest working version first.
- Make one focused change at a time and verify it works.
- Fix correctness and usability issues before expanding functionality.
- If a simpler implementation meets the requirement, use it.

## Definition of Done
Users can enter assumptions, add or remove funds, receive allocation warnings, and view accurate annual results in a table and trend chart on the deployed Vercel web app.
