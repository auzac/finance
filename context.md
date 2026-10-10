# Personal Financial Growth Calculator — Project Context

## 1. Objective
Build a simple, input-driven web application that projects an individual's savings and financial growth over a user-selected number of years. It must be usable by anyone, without country-specific or hard-coded personal financial assumptions.

**Guiding principle:** Enter assumptions → validate available cash → calculate annual results → show a table and growth trend. Prioritize usability, transparent calculations, and scope control.

## 2. Agreed Scope (Version 1)
- Responsive web interface with editable inputs and recalculation.
- Annual financial projections based on salary, estimated tax, increments, expenses, annual bonuses, and configurable fund contributions.
- Add, edit, and remove named savings/contribution funds.
- Detect invalid inputs, negative monthly surplus, and fund over-allocation.
- Annual results table, individual fund balances, total accumulated wealth, and trend chart.
- Optional assumed annual investment return for funds; 0% by default.
- No required accounts, database, live data feeds, or country-specific tax logic.

## 3. Agreed Inputs

### General
| Input | Rule |
|---|---|
| Currency | User-selected display currency; no live FX needed |
| Projection duration | User-entered number of years; positive integer |
| Starting unallocated cash/savings | Optional, default 0 |

### Income
| Input | Rule |
|---|---|
| Base salary | Required, nonnegative; input frequency monthly or annual |
| Estimated tax rate | User-entered effective percentage; used to estimate net income |
| Salary increment | Percentage or fixed monetary increase, applied annually |
| AWS | Optional; entered as months of gross salary; blank = 0 |
| Performance bonus | Optional; entered as months of gross salary; blank = 0 |

Bonuses are **annual income**, not recurring monthly salary, and are entered as months of gross salary, so they follow the salary increment. They are treated as gross and taxed at the same effective tax rate. Net salary is calculated, not manually entered.

### Expenses and Commitments
- User-defined fixed monthly expense/commitment entries (name + amount); allow add/edit/remove.
- Optional annual expense inflation percentage, default 0%.
- Blank optional amounts count as 0; invalid or negative amounts are rejected.

### Savings / Contribution Funds
Users can select **+ Add Fund** and configure:
| Input | Rule |
|---|---|
| Fund name | User-defined |
| Allocation method | Fixed monthly amount **or** percentage of monthly salary surplus |
| Allocation value | Nonnegative amount or percentage |
| Starting fund balance | Optional, default 0 |
| Annual investment return | Optional percentage, default 0% |

Funds can be added, edited, or removed. There is no preset list of fund types. Contributions draw from **monthly salary surplus after tax and expenses**, not from annual bonuses.

## 4. Calculation Rules
All calculation logic must reside in a separate, testable module rather than being embedded in UI components.

For each projection year `y`:
1. Apply the annual salary increment to obtain that year's gross salary (year 1 uses the initial salary).
2. Apply the expense inflation assumption (year 1 uses initial expenses).
3. Calculate `net_monthly_salary = gross_monthly_salary × (1 − tax_rate)`.
4. Calculate `monthly_surplus = net_monthly_salary − total_monthly_expenses`.
5. Each percentage-based fund receives `monthly_surplus × allocation_percentage`; each fixed fund receives its entered monthly amount.
6. Calculate `remaining_monthly_cash = monthly_surplus − sum(monthly_fund_contributions)`.
7. Calculate net annual bonuses as `(AWS months + performance bonus months) × gross monthly salary × (1 − tax_rate)`; add these separately to annual unallocated cash.
8. Accumulate annual fund contributions into their respective balances, applying any optional investment return under **one documented, consistent annual timing convention**.
9. Accumulate any remaining cash (including net annual bonuses) in the unallocated cash balance.
10. Calculate total wealth as `unallocated_cash_balance + sum(all_fund_balances)`; do not count fund contributions twice.

For a fixed salary increment, the entered monetary amount is applied at the **same frequency as the base salary input** (monthly or annual), then normalized for the calculation. Percentage increments use the prior year's salary. Bonuses are multiples of the year's gross salary, so they grow with the annual increment.

Annual results are the required reporting frequency. Monthly cash flow may be used internally to calculate annual contributions; do not add monthly reporting UI to Version 1.

## 5. Validation and Guardrails
- Require a valid base salary, tax rate, and positive projection duration.
- Tax and percentage allocation values must be within 0–100%; monetary contributions must be nonnegative.
- Blank **optional** income fields are zero, not validation errors.
- If `monthly_surplus < 0`, clearly indicate the deficit; do not represent an unaffordable allocation as valid.
- If `sum(monthly_fund_contributions) > monthly_surplus`, flag **over-allocation**, including the excess amount; do not silently reduce contributions.
- Check allocations **for every projected year**, not only year 1, because income and expenses change over time.
- All percentage allocations use the same original monthly salary surplus, independent of fund order.
- Never double-count contributions as additional income or wealth.
- Present assumptions and tax estimates as projections, not guaranteed financial outcomes.
- Maintain a consistent rounding policy: calculate with unrounded numbers; round for display only.

## 6. Outputs
- Annual projection table: gross income, estimated tax, net income, expenses, bonuses, annual savings, unallocated cash, each fund's annual contribution and ending balance, and total wealth.
- Summary: current projected net monthly salary, monthly surplus, remaining monthly cash, end-of-period savings/wealth.
- Line chart: accumulated cash, total fund balances, and total projected wealth over time.
- Clear inline warnings for invalid or unaffordable fund allocations.

## 7. Technology and Deployment
- **Frontend:** HTML, CSS, JavaScript; responsive and user-friendly.
- **Calculation engine:** Python, separate from the UI.
- **Integration:** Stateless JSON request/response API.
- **Visualizations:** Chart.js or similarly lightweight client-side charting library.
- **Hosting target:** Vercel, with Python serverless functions where supported.
- **Storage:** No database for Version 1. Optional browser local storage if easy to implement.
- **Testing:** Unit tests for calculation rules, edge cases, and annual reconciliations.

## 8. Explicitly Out of Scope (Version 1)
- Automatic tax brackets, payroll rules, CPF/KWSP or country-specific statutory deductions.
- Automatic exchange rates or financial account connectivity.
- User authentication, cloud accounts, databases, or synced profiles.
- Monte Carlo simulations, retirement drawdown, withdrawal strategies, multiple financial scenarios, portfolio rebalancing, or tax optimization.
- Monthly reporting dashboards or unnecessarily complex charts.

## 9. Acceptance Criteria
The first release is complete when a user can:
1. Enter salary, effective tax, duration, increments, expenses, and optional annual bonuses.
2. Create or change any number of funds using fixed amounts or percentage allocations.
3. Receive clear validation when allocations exceed the available monthly surplus in any year.
4. See the full annual projection, fund balances, cumulative wealth, and a trend chart update from their inputs.
5. Understand the formulas and reconcile income, expenses, contributions, and cash without double counting.

**Scope guardrail:** Implement the smallest usable version of these requirements. Do not introduce new features, frameworks, external services, or abstractions without a concrete Version 1 need.
