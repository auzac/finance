# Personal Financial Growth Calculator — Project Structure

## 1. Purpose
Define the smallest maintainable repository structure for the Version 1 web app. This document governs **where code belongs**; `context.md` governs **what the app does and how calculations behave**. If they conflict on product requirements, follow `context.md`.

## 2. Recommended Repository Layout

```text
financial-growth-calculator/
├── context.md                 # Agreed objective, scope, inputs and financial rules
├── structure.md               # This document: repository organization
├── README.md                  # Local setup, usage and Vercel deployment
├── index.html                 # Single-page application markup
├── dev_server.py              # Local dev server: static files + POST /api/calculate on one origin
├── conftest.py                # Adds api/ to sys.path for pytest
├── assets/
│   ├── styles.css             # Responsive layout and visual styles
│   └── app.js                 # Form state, dynamic funds, API calls and chart/table rendering
├── api/
│   ├── calculate.py           # Stateless Vercel Python API endpoint: POST /api/calculate
│   └── projection.py          # Pure financial calculations and domain validation
└── tests/
    └── test_projection.py     # Calculation and validation unit tests
```

No framework, database, application server, or build process is required initially. Add `vercel.json` **only if routing or deployment configuration actually requires it**, and `requirements.txt` **only if Python dependencies are introduced**.

## 3. Responsibilities and Boundaries

| File | Responsibility | Must not contain |
|---|---|---|
| `index.html` | Semantic page structure and input/result containers | Calculation formulas |
| `assets/styles.css` | Responsive styling and validation states | Business logic |
| `assets/app.js` | Collect inputs, add/edit/remove funds, send request, render annual table/chart and show errors | Independent financial projection formulas |
| `api/calculate.py` | Accept JSON request, call projection, return JSON response and appropriate HTTP status | UI logic or duplicated calculations |
| `api/projection.py` | Normalize and validate inputs, compute annual projections, fund balances and reconciliation | HTTP framework, DOM or network code |
| `tests/test_projection.py` | Test financial correctness, invalid inputs, edge cases and annual reconciliation | UI snapshot or deployment tests |
| `README.md` | Minimal install/run/deploy instructions | Duplicated detailed specifications |

**Dependency direction:** Browser UI → `/api/calculate` → pure Python projection function → JSON results → Browser UI.

## 4. Data Contract

Use one JSON request and one JSON response. Maintain consistent names across frontend and backend. The following is an *illustrative shape*, not a hard-coded scenario:

```json
{
  "currency": "USD",
  "duration_years": 10,
  "starting_cash": 0,
  "income": {
    "base_salary": 0,
    "salary_frequency": "monthly",
    "tax_rate_percent": 0,
    "increment_type": "percent",
    "increment_value": 0,
    "aws_months": 1,
    "performance_bonus_months": 0
  },
  "expenses": {
    "annual_inflation_percent": 0,
    "items": [{ "name": "Housing", "monthly_amount": 0 }]
  },
  "funds": [
    {
      "name": "Emergency Fund",
      "allocation_type": "fixed",
      "allocation_value": 0,
      "starting_balance": 0,
      "annual_return_percent": 0
    }
  ]
}
```

Optional fields omitted or left blank in the UI should be normalized to zero where `context.md` permits. Required fields must not be silently defaulted. Monetary values should be JSON numbers; avoid using formatted currency strings in calculations.

**Successful response (`200`):** JSON containing the validated inputs or assumptions, `summary`, and a `years` array with one entry per projection year. Every annual entry must supply gross and net income, expenses, contributions by fund, remaining cash, each fund's ending balance, and total wealth so both table and chart use the *same* result.

**Invalid request (`400` or `422`):** JSON containing a general error message and field-level errors. Over-allocation errors must identify affected projection year(s) and excess amounts. Do not silently adjust user-entered allocations.

## 5. UI Organization

Use a single page with these visible sections, in this order:

1. **Income:** salary, salary frequency, effective tax, annual increment.
2. **Additional income / bonuses:** AWS and performance bonus, each entered as months of gross salary.
3. **Expenses & commitments:** editable list of monthly items; annual expense inflation.
4. **Funds:** `+ Add Fund`; each entry has name, fixed/percentage allocation, starting balance, optional annual return; edit/remove.
5. **Projection settings:** years, starting unallocated cash. Display currency (USD/SGD/MYR) lives in the top bar.
6. **Results:** validation messages, headline totals, annual projection table and one trend chart.

Use native accessible form controls and labels. Recalculate automatically (debounced) as inputs change, with a clear **Calculate** button as a manual fallback; live recalculation failures stay quiet while results are already on screen. Keep a live monthly take-home / surplus indicator beside the commitments and funds sections so commitments and allocations can be seen crossing take-home pay immediately.

## 6. Calculation and Validation Discipline

- The Python engine is the **single source of truth** for financial calculations and validation. Frontend validation is for immediate usability only.
- Normalize salary input to a gross monthly value for internal calculations.
- Apply annual salary increments and expense inflation exactly as specified in `context.md`.
- Calculate percentage-based contributions from the same monthly net-salary surplus before any fund allocations.
- Handle the three bonuses as annual gross income; net bonuses increase annual unallocated cash, not monthly contribution capacity.
- Validate fund affordability in **every projected year**; return errors rather than artificially capping allocations.
- Carry forward starting cash and each fund's starting balance. Total wealth is cash plus all fund balances, with no double counting.
- Choose and document **one** investment-return timing convention in `projection.py` before implementing returns; cover it in tests.
- Compute with unrounded numerical values; round only when formatting UI output.

## 7. Minimum Test Cases

1. Salary-only projection with no expenses, bonuses or funds.
2. Tax, percentage increment and fixed increment (including annual salary input).
3. Each of the three annual bonuses; blank optional bonuses treated as zero.
4. Multiple expense items and expense inflation.
5. Multiple funds mixing fixed contributions and percentages of the same surplus.
6. Over-allocation in year 1 and in a later year.
7. Negative monthly surplus and other invalid inputs.
8. Starting balances, optional fund returns and total-wealth reconciliation.

## 8. Local Development and Deployment

- Work locally in VS Code; use Git/GitHub as the source repository.
- Serve the frontend over HTTP during development (`python dev_server.py` serves the static files and `/api/calculate` from the same origin); the browser calls `/api/calculate` on the same origin in deployment. Do not hard-code production URLs.
- Keep the endpoint compatible with Vercel's supported Python Functions conventions (verify during implementation).
- Deploy through GitHub → Vercel after local calculations and API response shape have been verified.
- Do not store user financial inputs on the server. No account system or database is needed.

## 9. Scope and Refactoring Guardrails

- **One page, one API endpoint, one calculation module, one test suite** for Version 1.
- Avoid React, Next.js, Flask/FastAPI dependencies, ORMs, repositories, services, state-management libraries or elaborate folder layers unless a concrete limitation requires them.
- Do not split files merely for architectural aesthetics. Split only when a file becomes difficult to understand or test.
- Do not implement features excluded by `context.md` (live FX, country tax tables, multi-scenario models, account synchronization, etc.).
- Keep names, payload shape, and calculation conventions consistent; update this document when a meaningful structural decision changes.

**Completion standard:** The user can enter assumptions, add funds, calculate a valid annual projection, understand any allocation error, and view a consistent table and growth chart in a Vercel-hosted web app.
