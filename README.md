# Financial Growth Calculator

A simple, input-driven web app with two tools:

- **Projection** — projects savings, fund balances and total wealth over a user-selected number of years.
- **Salary growth** — projects monthly income year by year between a low and a high yearly increase estimate.

No country-specific logic, accounts, database or live data feeds.

- [context.md](context.md) — what the app does, inputs, calculation rules and scope.
- [structure.md](structure.md) — repository layout and responsibilities.
- [instructions.md](instructions.md) — development conventions.

## How it works

The browser collects inputs and posts them to `/api/calculate`. All financial calculations and validation live in the Python engine (`api/projection.py`); the frontend only displays results. Responses contain per-year projections (income, tax, expenses, savings, fund contributions and balances, cash, total wealth), a summary, and per-year allocation warnings.

## Requirements

- Python 3.9+ (standard library only; no `requirements.txt`)
- pytest (for tests)

## Local development

```text
python dev_server.py
```

Then open <http://localhost:8000>. The dev server serves the static frontend and the `POST /api/calculate` endpoint from the same origin, mirroring production. Do not open `index.html` directly from the filesystem — the API call needs an HTTP origin.

Options: `python dev_server.py 8123` to change the port.

## Tests

```text
python -m pytest
```

Covers calculation rules, increments, bonuses, expenses and inflation, mixed funds, over-allocation and deficit handling, invalid inputs, starting balances, returns and annual reconciliation.

## API contract

`POST /api/calculate` with a JSON body:

```json
{
  "currency": "USD",
  "duration_years": 10,
  "starting_cash": 0,
  "income": {
    "base_salary": 5000,
    "salary_frequency": "monthly",
    "tax_rate_percent": 10,
    "increment_type": "percent",
    "increment_value": 3,
    "aws_months": 1,
    "performance_bonus_months": 0
  },
  "expenses": {
    "annual_inflation_percent": 2,
    "items": [{ "name": "Housing", "monthly_amount": 1500 }]
  },
  "funds": [
    {
      "name": "Emergency fund",
      "allocation_type": "fixed",
      "allocation_value": 500,
      "starting_balance": 0,
      "annual_return_percent": 0
    }
  ]
}
```

- **200**: `{ "assumptions": ..., "summary": ..., "years": [...], "warnings": [...] }` — one `years` entry per projection year; `fund_contributions` and `fund_balances` are arrays parallel to `funds`.
- **400**: `{ "error": "...", "errors": [{ "field": "income.base_salary", "message": "..." }] }` for malformed JSON or invalid inputs.

### `POST /api/salary` (salary growth tool)

```json
{
  "currency": "SGD",
  "duration_years": 10,
  "current_income": 5000,
  "income_frequency": "monthly",
  "increment_type": "percent",
  "min_increment": 3,
  "max_increment": 8
}
```

- The yearly increase is entered as a low and a high estimate (`min_increment` / `max_increment`); the projection shows both paths as a range. Equal estimates collapse to a single path.
- `increment_type` is `percent` (compounds each year) or `fixed` (a money amount entered at the income's frequency, added linearly).
- **200**: one `years` entry per year with monthly and annual income plus the year-over-year increase, for low and high paths, alongside `assumptions` and `summary`.

### Calculation conventions

- Fund return timing: `balance_end = (balance_open + annual_contributions) × (1 + annual_return)` — the year's contributions earn that year's return with the opening balance. No monthly compounding.
- AWS and performance bonus are entered as months of the year's gross salary (e.g. 1 month of AWS), so they grow with the salary increment. They are taxed at the effective rate and added to unallocated cash once per year; they never increase monthly contribution capacity.
- A year with a negative monthly surplus allocates 0 to percentage funds and is reported in `warnings`; fixed funds keep their amount.
- Over-allocation (contributions above a non-negative surplus) is never auto-adjusted — it is reported per year in `warnings` with the monthly excess, and remaining cash is allowed to go negative.
- Values are computed unrounded and rounded for display only.

All results are illustrative estimates, not financial advice.

## Deploying to Vercel

1. Push this repository to GitHub and import it in Vercel (framework preset: **Other**; no build step).
2. Static files are served as-is; `api/calculate.py` is picked up as a Python serverless function at `/api/calculate`.
3. Verify after the first deploy that the Python runtime resolves `from projection import ...`; if the function layout ever changes, `api/calculate.py` also supports a package-relative import fallback.

No `vercel.json` or environment variables are required.
