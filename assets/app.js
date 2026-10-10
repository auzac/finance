/* Form state, API calls, chart and table rendering.
   All financial calculations live in the Python engine (api/projection.py). */

const $ = (id) => document.getElementById(id);
const DRAFT_KEY = "growth-calculator-draft-v3";

let currentCurrency = "USD";
let lastResult = null;
let saveTimer = null;
let liveTimer = null;
let calcSeq = 0;

/* ---------- helpers ---------- */

const optionalNum = (value) => {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : 0;
};

const requiredNum = (value) => {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : null;
};

function money(value) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: currentCurrency,
    maximumFractionDigits: 0,
  }).format(value);
}

// Plain grouped number for the projection table, which states the currency once.
function amount(value) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value);
}

function compact(value) {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1e6) return sign + (abs / 1e6).toFixed(1).replace(/\.0$/, "") + "m";
  if (abs >= 1e3) return sign + Math.round(abs / 1e3) + "k";
  return sign + Math.round(abs);
}

function esc(text) {
  return String(text).replace(/[&<>"']/g, (ch) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]
  ));
}

/* ---------- dynamic rows ---------- */

function addExpenseRow(item = {}) {
  const row = document.createElement("div");
  row.className = "row-card expense-row";
  row.innerHTML = `
    <div class="field"><input class="e-name" type="text" placeholder="e.g. Rent" aria-label="Expense name" /></div>
    <div class="field"><input class="e-amount" type="number" min="0" step="any" placeholder="0" inputmode="decimal" aria-label="Amount per month" /></div>
    <button class="icon-btn remove" type="button" aria-label="Remove expense">&times;</button>`;
  row.querySelector(".e-name").value = item.name || "";
  row.querySelector(".e-amount").value = item.amount ?? "";
  row.querySelector(".remove").addEventListener("click", () => {
    row.remove();
    refreshFields();
    onInputChanged();
  });
  $("expenseList").appendChild(row);
  refreshFields();
  return row;
}

// The allocation field's placeholder and limit follow the chosen method,
// so the user can always see whether the number is money or a percentage.
function updateFundUnit(row) {
  const isPercent = row.querySelector(".f-type").value === "percent";
  const input = row.querySelector(".f-value");
  input.placeholder = isPercent ? "e.g. 20" : "0";
  input.setAttribute(
    "aria-label",
    isPercent ? "Percentage of monthly surplus" : "Amount per month"
  );
  if (isPercent) input.max = "100";
  else input.removeAttribute("max");
}

function addFundRow(fund = {}) {
  const row = document.createElement("div");
  row.className = "row-card fund-row";
  row.innerHTML = `
    <div class="field"><input class="f-name" type="text" placeholder="e.g. Emergency fund" aria-label="Fund name" /></div>
    <div class="field"><select class="f-type" aria-label="How you contribute">
      <option value="fixed">Fixed amount each month</option>
      <option value="percent">% of monthly surplus</option>
    </select></div>
    <div class="field"><input class="f-value" type="number" min="0" step="any" inputmode="decimal" aria-label="Amount per month" /></div>
    <div class="field"><input class="f-balance" type="number" min="0" step="any" placeholder="0" inputmode="decimal" aria-label="Current balance" /></div>
    <div class="field"><input class="f-return" type="number" min="-100" step="any" placeholder="0" inputmode="decimal" aria-label="Yearly return percent" /></div>
    <button class="icon-btn remove" type="button" aria-label="Remove fund">&times;</button>`;
  row.querySelector(".f-name").value = fund.name || "";
  row.querySelector(".f-type").value = fund.type || "fixed";
  row.querySelector(".f-value").value = fund.value ?? "";
  row.querySelector(".f-balance").value = fund.balance ?? "";
  row.querySelector(".f-return").value = fund.return ?? "";
  updateFundUnit(row);
  row.querySelector(".f-type").addEventListener("change", () => updateFundUnit(row));
  row.querySelector(".remove").addEventListener("click", () => {
    row.remove();
    refreshFields();
    onInputChanged();
  });
  $("fundList").appendChild(row);
  refreshFields();
  return row;
}

function refreshFields() {
  const expenseRows = document.querySelectorAll("#expenseList .row-card");
  expenseRows.forEach((row, index) => {
    row.querySelector(".e-name").closest(".field").dataset.field = `expenses.items[${index}].name`;
    row.querySelector(".e-amount").closest(".field").dataset.field = `expenses.items[${index}].monthly_amount`;
  });
  const fundRows = document.querySelectorAll("#fundList .row-card");
  const fundKeys = {
    ".f-name": "name",
    ".f-type": "allocation_type",
    ".f-value": "allocation_value",
    ".f-balance": "starting_balance",
    ".f-return": "annual_return_percent",
  };
  fundRows.forEach((row, index) => {
    for (const [selector, key] of Object.entries(fundKeys)) {
      row.querySelector(selector).closest(".field").dataset.field = `funds[${index}].${key}`;
    }
  });
  // The table (headings and all) only appears while at least one row exists.
  $("expenseTable").hidden = expenseRows.length === 0;
  $("fundTable").hidden = fundRows.length === 0;
}

/* ---------- payload ---------- */

function collectPayload() {
  return {
    currency: $("currency").value,
    duration_years: requiredNum($("years").value),
    starting_cash: optionalNum($("startingCash").value),
    income: {
      base_salary: requiredNum($("salary").value),
      salary_frequency: $("salaryFrequency").value,
      tax_rate_percent: requiredNum($("taxRate").value),
      increment_type: $("incrementType").value,
      increment_value: optionalNum($("incrementValue").value),
      aws_months: optionalNum($("awsMonths").value),
      performance_bonus_months: optionalNum($("performanceBonusMonths").value),
    },
    expenses: {
      annual_inflation_percent: optionalNum($("inflation").value),
      items: [...document.querySelectorAll("#expenseList .row-card")].map((row) => ({
        name: row.querySelector(".e-name").value,
        monthly_amount: optionalNum(row.querySelector(".e-amount").value),
      })),
    },
    funds: [...document.querySelectorAll("#fundList .row-card")].map((row) => ({
      name: row.querySelector(".f-name").value,
      allocation_type: row.querySelector(".f-type").value,
      allocation_value: optionalNum(row.querySelector(".f-value").value),
      starting_balance: optionalNum(row.querySelector(".f-balance").value),
      annual_return_percent: optionalNum(row.querySelector(".f-return").value),
    })),
  };
}

/* ---------- input side effects ---------- */

function updateCurrencyLabels() {
  currentCurrency = $("currency").value;
  document.querySelectorAll(".cur-code").forEach((el) => { el.textContent = `(${currentCurrency})`; });
}

function updateExpenseTotal() {
  const total = [...document.querySelectorAll("#expenseList .e-amount")]
    .reduce((sum, input) => sum + optionalNum(input.value), 0);
  $("expenseTotal").textContent = `Total monthly: ${money(total)}`;
}

// Percentage funds all draw from the same monthly surplus; show how much of
// that surplus the entered percentages leave unallocated, as colour-coded
// chips in the section header (green = allocated, grey = unallocated,
// red = over 100%).
function updateFundAllocation() {
  const el = $("fundAllocation");
  const percents = [...document.querySelectorAll("#fundList .row-card")]
    .filter((row) => row.querySelector(".f-type").value === "percent")
    .map((row) => optionalNum(row.querySelector(".f-value").value));
  if (!percents.length) {
    el.hidden = true;
    return;
  }
  const round1 = (value) => Math.round(value * 10) / 10;
  const allocated = percents.reduce((sum, value) => sum + value, 0);
  const unallocated = 100 - allocated;
  const over = unallocated < 0;
  el.hidden = false;
  el.classList.toggle("warn", over);
  el.innerHTML = over
    ? `<span class="allocated">${round1(allocated)}% allocated</span><span class="unallocated">${round1(-unallocated)}% over</span>`
    : `<span class="allocated">${round1(allocated)}% allocated</span><span class="unallocated">${round1(unallocated)}% unallocated</span>`;
}

function updateIncrementLabel() {
  const type = $("incrementType").value;
  const frequency = $("salaryFrequency").value;
  const fixedUnit = frequency === "annual" ? "(per year, matches salary)" : "(per month, matches salary)";
  $("incrementLabel").textContent = type === "percent" ? "Increment value (% per year)" : `Increment value ${fixedUnit}`;
}

function updatePeriodPill() {
  const source = document.body.dataset.tool === "salary" ? $("sgYears") : $("years");
  const years = parseInt(source.value, 10);
  $("periodPill").textContent = years > 0 ? `${years}-YEAR PROJECTION` : "PROJECTION";
}

function onInputChanged() {
  saveDraftSoon();
  updateCurrencyLabels();
  updateExpenseTotal();
  updateFundAllocation();
  updateIncrementLabel();
  updatePeriodPill();
  calcSoon();
}

function calcSoon() {
  clearTimeout(liveTimer);
  liveTimer = setTimeout(() => calculate(), 350);
}

/* ---------- draft persistence (optional, local only) ---------- */

function collectDraft() {
  return {
    salary: $("salary").value,
    salaryFrequency: $("salaryFrequency").value,
    taxRate: $("taxRate").value,
    incrementType: $("incrementType").value,
    incrementValue: $("incrementValue").value,
    inflation: $("inflation").value,
    years: $("years").value,
    currency: $("currency").value,
    startingCash: $("startingCash").value,
    tableInterval: $("tableInterval").value,
    awsMonths: $("awsMonths").value,
    performanceBonusMonths: $("performanceBonusMonths").value,
    expenses: [...document.querySelectorAll("#expenseList .row-card")].map((row) => ({
      name: row.querySelector(".e-name").value,
      amount: row.querySelector(".e-amount").value,
    })),
    funds: [...document.querySelectorAll("#fundList .row-card")].map((row) => ({
      name: row.querySelector(".f-name").value,
      type: row.querySelector(".f-type").value,
      value: row.querySelector(".f-value").value,
      balance: row.querySelector(".f-balance").value,
      return: row.querySelector(".f-return").value,
    })),
  };
}

function saveDraftSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(collectDraft()));
    } catch (error) {
      /* storage unavailable — drafts are optional */
    }
  }, 400);
}

function restoreDraft() {
  let draft = null;
  try {
    draft = JSON.parse(localStorage.getItem(DRAFT_KEY));
  } catch (error) {
    draft = null;
  }
  if (!draft || typeof draft !== "object") return false;
  const scalar = {
    salary: "salary",
    salaryFrequency: "salaryFrequency",
    taxRate: "taxRate",
    incrementType: "incrementType",
    incrementValue: "incrementValue",
    inflation: "inflation",
    years: "years",
    currency: "currency",
    startingCash: "startingCash",
    tableInterval: "tableInterval",
    awsMonths: "awsMonths",
    performanceBonusMonths: "performanceBonusMonths",
  };
  for (const [key, id] of Object.entries(scalar)) {
    if (typeof draft[key] === "string") $(id).value = draft[key];
  }
  (Array.isArray(draft.expenses) ? draft.expenses : []).forEach((item) => addExpenseRow(item));
  (Array.isArray(draft.funds) ? draft.funds : []).forEach((fund) => addFundRow(fund));
  return true;
}

function applyDefaultRows() {
  addExpenseRow({ name: "Housing", amount: "1500" });
  addFundRow({ name: "Emergency fund", type: "fixed", value: "500", balance: "", return: "" });
  addFundRow({ name: "Investment portfolio", type: "percent", value: "30", balance: "", return: "5" });
}

/* ---------- rendering ---------- */

function setMetric(el, value) {
  el.textContent = money(value);
  el.classList.toggle("negative", value < 0);
}

function renderWarnings(data) {
  const startYear = new Date().getFullYear();
  const box = $("warnings");
  const list = box.querySelector("ul");
  list.innerHTML = "";
  data.warnings.forEach((warning) => {
    const item = document.createElement("li");
    if (warning.type === "over_allocation") {
      item.textContent = `Year ${warning.year} (${startYear + warning.year}): fund allocations exceed the monthly surplus by ${money(warning.monthly_excess)}. Contributions are not reduced automatically — lower a fund allocation or an expense.`;
    } else {
      item.textContent = `Year ${warning.year} (${startYear + warning.year}): monthly surplus is negative (${money(warning.monthly_deficit)} deficit). Expenses exceed net salary.`;
    }
    list.appendChild(item);
  });
  box.hidden = data.warnings.length === 0;

  const note = $("fundsNote");
  if (data.warnings.length) {
    note.hidden = false;
    note.classList.add("warn");
    note.textContent = `${data.warnings.length} allocation warning${data.warnings.length > 1 ? "s" : ""} across the projection — see Results.`;
  } else {
    note.hidden = true;
    note.classList.remove("warn");
  }
}

function setSideValue(id, value) {
  const el = $(id);
  el.textContent = money(value);
  el.classList.toggle("negative", value < 0);
}

function renderStrips(data) {
  const summary = data.summary;
  const commitments = data.assumptions.total_monthly_expenses;

  const surplusStrip = $("surplusStrip");
  surplusStrip.hidden = false;
  surplusStrip.classList.toggle("warn", summary.monthly_surplus < 0);
  $("stripNet").textContent = `${money(summary.net_monthly_salary)}/mo`;
  $("stripCommitments").textContent = `${money(commitments)}/mo`;
  $("stripSurplus").textContent = `${money(summary.monthly_surplus)}/mo`;

  const fundsStrip = $("fundsStrip");
  fundsStrip.hidden = false;
  fundsStrip.classList.toggle("warn", summary.remaining_monthly_cash < 0);
  $("stripRemaining").textContent = `${money(summary.remaining_monthly_cash)}/mo`;

  $("sideStats").hidden = false;
  setSideValue("sideNet", summary.net_monthly_salary);
  setSideValue("sideCommitments", commitments);
  setSideValue("sideSurplus", summary.monthly_surplus);
  setSideValue("sideRemaining", summary.remaining_monthly_cash);
}

function renderChart(data) {
  const svg = $("projectionChart");
  const startYear = new Date().getFullYear();
  const count = data.years.length;
  const startingBalance = data.assumptions.funds.reduce((sum, fund) => sum + fund.starting_balance, 0);

  const points = [{
    cash: data.assumptions.starting_cash,
    principal: startingBalance,
    total: data.assumptions.starting_cash + startingBalance,
  }];
  let principal = startingBalance;
  for (const year of data.years) {
    principal += year.total_fund_contributions;
    points.push({ cash: year.unallocated_cash, principal, total: year.total_wealth });
  }

  const W = 1000, H = 390;
  const margin = { left: 79, right: 18, top: 12, bottom: 39 };
  const pw = W - margin.left - margin.right;
  const ph = H - margin.top - margin.bottom;

  const values = points.flatMap((p) => [p.cash, p.principal, p.total]);
  const hi = Math.max(0, ...values);
  const lo = Math.min(0, ...values);
  const pad = (hi - lo || 1) * 0.08;
  const yMax = hi + pad;
  const yMin = lo < 0 ? lo - pad : 0;
  const x = (i) => margin.left + (i / count) * pw;
  const y = (value) => margin.top + ph - ((value - yMin) / (yMax - yMin)) * ph;

  const line = (get) => points
    .map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(get(p)).toFixed(1)}`)
    .join(" ");
  const area = (lower, upper) => {
    let d = `M${x(0).toFixed(1)} ${y(lower(points[0])).toFixed(1)} `;
    points.forEach((p, i) => { d += `L${x(i).toFixed(1)} ${y(upper(p)).toFixed(1)} `; });
    for (let i = points.length - 1; i >= 0; i--) {
      d += `L${x(i).toFixed(1)} ${y(lower(points[i])).toFixed(1)} `;
    }
    return `${d}Z`;
  };

  const parts = [];
  const base = y(0);
  for (let j = 0; j <= 5; j++) {
    const value = yMin + ((yMax - yMin) * j) / 5;
    const lineY = y(value).toFixed(1);
    parts.push(`<line x1="${margin.left}" y1="${lineY}" x2="${W - margin.right}" y2="${lineY}" stroke="#e6e6e9"/>`);
    parts.push(`<text x="${margin.left - 12}" y="${(y(value) + 4).toFixed(1)}" text-anchor="end" font-size="12" fill="#8c8c94">${compact(value)}</text>`);
  }
  const tickStep = count <= 12 ? 1 : count <= 20 ? 2 : 5;
  for (let i = 0; i <= count; i += tickStep) {
    parts.push(`<line x1="${x(i).toFixed(1)}" y1="${margin.top}" x2="${x(i).toFixed(1)}" y2="${base.toFixed(1)}" stroke="#f0f0f1"/>`);
    parts.push(`<text x="${x(i).toFixed(1)}" y="${H - 14}" text-anchor="middle" font-size="12" fill="#92929a">${startYear + i}</text>`);
  }

  parts.push(`<path d="${area(() => 0, (p) => p.cash)}" fill="#60c99e" fill-opacity=".87"/>`);
  parts.push(`<path d="${area((p) => p.cash, (p) => p.cash + p.principal)}" fill="#f3c04d" fill-opacity=".94"/>`);
  parts.push(`<path d="${area((p) => p.cash + p.principal, (p) => p.total)}" fill="#8185f2" fill-opacity=".92"/>`);

  const series = [
    [(p) => p.cash, "#3eaa80"],
    [(p) => p.cash + p.principal, "#dc9831"],
    [(p) => p.total, "#676ee4"],
  ];
  for (const [get, color] of series) {
    parts.push(`<path d="${line(get)}" fill="none" stroke="${color}" stroke-width="3"/>`);
    points.forEach((p, i) => {
      if (i > 0 && (count <= 15 || i % 2 === 0)) {
        parts.push(`<circle cx="${x(i).toFixed(1)}" cy="${y(get(p)).toFixed(1)}" r="4.5" fill="${color}" stroke="#fff" stroke-width="1.5"/>`);
      }
    });
  }

  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.innerHTML = parts.join("");
}

function renderTable(data) {
  const startYear = new Date().getFullYear();
  const funds = data.assumptions.funds;
  const startingBalance = funds.reduce((sum, fund) => sum + fund.starting_balance, 0);
  const startingTotal = data.assumptions.starting_cash + startingBalance;
  const lastYear = data.years.length;
  const interval = Math.max(1, parseInt($("tableInterval").value, 10) || 1);
  // Interval sampling always keeps the final year so the end of the
  // projection is never missing from the table.
  const shown = data.years.filter((year) => year.year % interval === 0 || year.year === lastYear);
  const dashCell = '<td class="dash">&mdash;</td>';
  const cell = (value, extraClass = "") => {
    if (value === null || value === undefined) return dashCell;
    const cls = `num${value < 0 ? " neg" : ""}${extraClass ? ` ${extraClass}` : ""}`;
    return `<td class="${cls}">${amount(value)}</td>`;
  };

  let head = `<thead><tr><th class="row-label" scope="col">Metric</th><th scope="col">Now (${startYear})</th>`;
  shown.forEach((year) => { head += `<th scope="col">${startYear + year.year}</th>`; });
  head += "</tr></thead>";

  const rows = [];
  const group = (label) => {
    rows.push(`<tr class="group group-sep"><th class="row-label" scope="colgroup">${label}</th>${'<td></td>'.repeat(shown.length + 1)}</tr>`);
  };
  const row = (label, getter, startValue) => {
    let html = `<tr><th class="row-label" scope="row">${label}</th>`;
    html += startValue === undefined ? dashCell : cell(startValue, "start-col");
    shown.forEach((year) => { html += cell(getter(year)); });
    rows.push(`${html}</tr>`);
  };

  group("Income");
  row("Gross salary", (y) => y.gross_annual_salary);
  row("Bonuses", (y) => y.gross_bonuses);
  row("Net income", (y) => y.net_annual_salary + y.net_bonuses);

  if (funds.length) {
    group("Funds &middot; contributions");
    funds.forEach((fund, index) => {
      row(esc(fund.name || `Fund ${index + 1}`), (y) => y.fund_contributions[index]);
    });
    row("Total contributions", (y) => y.total_fund_contributions);

    group("Funds &middot; balance");
    funds.forEach((fund, index) => {
      row(esc(fund.name || `Fund ${index + 1}`), (y) => y.fund_balances[index], fund.starting_balance);
    });
  }

  group("Cash &amp; wealth");
  row("Total fund balances", (y) => y.total_fund_balances, startingBalance);
  row("Unallocated cash", (y) => y.unallocated_cash, data.assumptions.starting_cash);
  row("Total wealth", (y) => y.total_wealth, startingTotal);

  $("resultTable").innerHTML = `${head}<tbody>${rows.join("")}</tbody>`;
}

function renderResults(data) {
  currentCurrency = data.assumptions.currency;
  const years = data.assumptions.duration_years;
  const startYear = new Date().getFullYear();
  const endYear = startYear + years;

  $("resultsStatus").hidden = true;
  $("resultsBody").hidden = false;

  renderWarnings(data);
  renderStrips(data);

  $("headlineYears").textContent = `${years} ${years === 1 ? "year" : "years"}`;
  $("headlineRange").textContent = `${startYear} – ${endYear} · illustrative assumptions · not financial advice`;
  $("wealthMetricSub").textContent = `End of ${endYear}`;
  $("periodPill").textContent = `${years}-YEAR PROJECTION`;
  $("tableCurrency").textContent = `Amounts in ${data.assumptions.currency}`;

  const summary = data.summary;
  setMetric($("wealthMetric"), summary.end_total_wealth);
  setMetric($("netMetric"), summary.net_monthly_salary);
  setMetric($("surplusMetric"), summary.monthly_surplus);
  setMetric($("remainingMetric"), summary.remaining_monthly_cash);
  $("sideWealth").textContent = money(summary.end_total_wealth);

  renderChart(data);
  renderTable(data);
}

/* ---------- errors ---------- */

function clearFieldErrors() {
  document.querySelectorAll(".field-error").forEach((el) => el.remove());
  document.querySelectorAll(".invalid").forEach((el) => el.classList.remove("invalid"));
}

function renderFieldErrors(errors) {
  const unplaced = [];
  errors.forEach((error) => {
    const wrap = document.querySelector(`[data-field="${error.field}"]`);
    if (!wrap) {
      unplaced.push(error.message);
      return;
    }
    const input = wrap.querySelector("input, select");
    if (input) input.classList.add("invalid");
    const message = document.createElement("p");
    message.className = "field-error";
    message.textContent = error.message;
    wrap.appendChild(message);
  });
  return unplaced;
}

function showBanner(target, message, details) {
  const banner = typeof target === "string" ? $(target) : target;
  banner.innerHTML = "";
  const text = document.createElement("div");
  text.textContent = message;
  banner.appendChild(text);
  if (details && details.length) {
    const list = document.createElement("ul");
    details.forEach((detail) => {
      const item = document.createElement("li");
      item.textContent = detail;
      list.appendChild(item);
    });
    banner.appendChild(list);
  }
  banner.hidden = false;
}

/* ---------- calculate ---------- */

function setLoading(loading) {
  const button = $("calcTop");
  button.disabled = loading;
  button.textContent = loading ? "Calculating…" : "Calculate";
}

async function calculate({ manual = false } = {}) {
  const sequence = ++calcSeq;
  if (manual) {
    setLoading(true);
    $("errorBanner").hidden = true;
    clearFieldErrors();
  }
  try {
    const response = await fetch("/api/calculate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(collectPayload()),
    });
    const data = await response.json().catch(() => ({}));
    if (sequence !== calcSeq) return;
    if (response.ok) {
      lastResult = data;
      renderResults(data);
      return;
    }
    // Live recalculation stays quiet while results are on screen; anything
    // before the first success is reported so problems are never silent.
    if (!manual && lastResult) return;
    const unplaced = renderFieldErrors(Array.isArray(data.errors) ? data.errors : []);
    const message = data.error || (response.status === 404 || response.status === 405
      ? `The calculation API is not available at this address (HTTP ${response.status}). Open the app through dev_server.py, not a static file server.`
      : `The projection could not be calculated (HTTP ${response.status}).`);
    showBanner($("errorBanner"), message, unplaced);
    $("resultsStatus").textContent = "Projection unavailable — check the message above.";
  } catch (error) {
    if (sequence !== calcSeq) return;
    if (!manual && lastResult) return;
    showBanner($("errorBanner"), 'Could not reach the calculation service. Run "python dev_server.py" and open the app from that server.');
    $("resultsStatus").textContent = "Projection unavailable — check the message above.";
  } finally {
    if (manual) setLoading(false);
  }
}

/* ---------- salary growth tool ---------- */

const SG_DRAFT_KEY = "salary-growth-draft-v1";
let sgLastResult = null;
let sgSaveTimer = null;
let sgLiveTimer = null;
let sgSeq = 0;

function collectSalaryPayload() {
  return {
    currency: $("currency").value,
    duration_years: requiredNum($("sgYears").value),
    current_income: requiredNum($("sgIncome").value),
    income_frequency: $("sgFrequency").value,
    increment_type: $("sgType").value,
    min_increment: optionalNum($("sgMin").value),
    max_increment: optionalNum($("sgMax").value),
  };
}

// The increment labels read as percentage or as money at the income's frequency.
function sgUpdateLabels() {
  const isPercent = $("sgType").value === "percent";
  const unit = isPercent
    ? "% per year"
    : $("sgFrequency").value === "annual"
      ? "per year, matches income"
      : "per month, matches income";
  $("sgMinLabel").textContent = `Low estimate (${unit})`;
  $("sgMaxLabel").textContent = `High estimate (${unit})`;
}

function onSgInputChanged() {
  sgSaveDraftSoon();
  sgUpdateLabels();
  updateCurrencyLabels();
  updatePeriodPill();
  sgCalcSoon();
}

function sgCalcSoon() {
  clearTimeout(sgLiveTimer);
  sgLiveTimer = setTimeout(() => salaryCalculate(), 350);
}

async function salaryCalculate({ manual = false } = {}) {
  const sequence = ++sgSeq;
  if (manual) {
    setLoading(true);
    $("sgErrorBanner").hidden = true;
    clearFieldErrors();
  }
  try {
    const response = await fetch("/api/salary", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(collectSalaryPayload()),
    });
    const data = await response.json().catch(() => ({}));
    if (sequence !== sgSeq) return;
    if (response.ok) {
      sgLastResult = data;
      renderSalaryResults(data);
      return;
    }
    // Live recalculation stays quiet while results are on screen.
    if (!manual && sgLastResult) return;
    const unplaced = renderFieldErrors(Array.isArray(data.errors) ? data.errors : []);
    const message = data.error || (response.status === 404 || response.status === 405
      ? `The calculation API is not available at this address (HTTP ${response.status}). Open the app through dev_server.py, not a static file server.`
      : `The projection could not be calculated (HTTP ${response.status}).`);
    showBanner($("sgErrorBanner"), message, unplaced);
    $("sgStatus").textContent = "Projection unavailable — check the message above.";
  } catch (error) {
    if (sequence !== sgSeq) return;
    if (!manual && sgLastResult) return;
    showBanner($("sgErrorBanner"), 'Could not reach the calculation service. Run "python dev_server.py" and open the app from that server.');
    $("sgStatus").textContent = "Projection unavailable — check the message above.";
  } finally {
    if (manual) setLoading(false);
  }
}

function renderSalaryResults(data) {
  currentCurrency = data.assumptions.currency;
  const years = data.assumptions.duration_years;
  const summary = data.summary;
  const startYear = new Date().getFullYear();
  const endYear = startYear + years;
  const fmtPct = (value) => `${value > 0 ? "+" : ""}${Math.round(value * 10) / 10}%`;

  $("sgStatus").hidden = true;
  $("sgResultsBody").hidden = false;

  $("sgHeadline").textContent = `${years} ${years === 1 ? "year" : "years"}`;
  $("sgHeadlineRange").textContent = `${startYear} – ${endYear} · illustrative assumptions · not financial advice`;
  $("periodPill").textContent = `${years}-YEAR PROJECTION`;
  $("sgTableCurrency").textContent = `Amounts in ${data.assumptions.currency}`;

  setMetric($("sgCurrentMetric"), summary.current_income_monthly);
  $("sgEndEyebrow").textContent = `Income in ${endYear}`;
  $("sgEndMetric").textContent = `${money(summary.end_income_min_monthly)} – ${money(summary.end_income_max_monthly)}`;
  $("sgEndMetric").classList.remove("negative");
  $("sgEndSub").textContent = "Low to high estimate, per month";
  $("sgGrowthMetric").textContent = `${fmtPct(summary.growth_percent_min)} to ${fmtPct(summary.growth_percent_max)}`;
  $("sgGrowthMetric").classList.remove("negative");
  $("sgGrowthSub").textContent = "Low and high path vs current income";

  renderSalaryChart(data);
  renderSalaryTable(data);
}

function renderSalaryChart(data) {
  const svg = $("sgChart");
  const startYear = new Date().getFullYear();
  const count = data.years.length;
  const isFlat = data.years.every((year) => year.income_min_monthly === year.income_max_monthly);

  const points = [{
    min: data.assumptions.current_income_monthly,
    max: data.assumptions.current_income_monthly,
  }];
  for (const year of data.years) {
    points.push({ min: year.income_min_monthly, max: year.income_max_monthly });
  }

  const W = 1000, H = 390;
  const margin = { left: 79, right: 18, top: 12, bottom: 39 };
  const pw = W - margin.left - margin.right;
  const ph = H - margin.top - margin.bottom;

  const values = points.flatMap((p) => [p.min, p.max]);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const yMin = lo * 0.9;
  const yMax = hi * 1.06;
  const x = (i) => margin.left + (i / count) * pw;
  const y = (value) => margin.top + ph - ((value - yMin) / (yMax - yMin)) * ph;
  const line = (get) => points
    .map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(get(p)).toFixed(1)}`)
    .join(" ");

  const parts = [];
  for (let j = 0; j <= 5; j++) {
    const value = yMin + ((yMax - yMin) * j) / 5;
    const lineY = y(value).toFixed(1);
    parts.push(`<line x1="${margin.left}" y1="${lineY}" x2="${W - margin.right}" y2="${lineY}" stroke="#e6e6e9"/>`);
    parts.push(`<text x="${margin.left - 12}" y="${(y(value) + 4).toFixed(1)}" text-anchor="end" font-size="12" fill="#8c8c94">${compact(value)}</text>`);
  }
  const base = y(yMin);
  const tickStep = count <= 12 ? 1 : count <= 20 ? 2 : 5;
  for (let i = 0; i <= count; i += tickStep) {
    parts.push(`<line x1="${x(i).toFixed(1)}" y1="${margin.top}" x2="${x(i).toFixed(1)}" y2="${base.toFixed(1)}" stroke="#f0f0f1"/>`);
    parts.push(`<text x="${x(i).toFixed(1)}" y="${H - 14}" text-anchor="middle" font-size="12" fill="#92929a">${startYear + i}</text>`);
  }

  const drawDots = (get) => {
    points.forEach((p, i) => {
      if (i > 0 && (count <= 15 || i % 2 === 0)) {
        parts.push(`<circle cx="${x(i).toFixed(1)}" cy="${y(get(p)).toFixed(1)}" r="4.5" fill="#3eaa80" stroke="#fff" stroke-width="1.5"/>`);
      }
    });
  };

  if (!isFlat) {
    let band = `M${x(0).toFixed(1)} ${y(points[0].max).toFixed(1)} `;
    points.forEach((p, i) => { band += `L${x(i).toFixed(1)} ${y(p.max).toFixed(1)} `; });
    for (let i = points.length - 1; i >= 0; i--) {
      band += `L${x(i).toFixed(1)} ${y(points[i].min).toFixed(1)} `;
    }
    band += "Z";
    parts.push(`<path d="${band}" fill="#60c99e" fill-opacity=".18"/>`);
    for (const get of [(p) => p.max, (p) => p.min]) {
      parts.push(`<path d="${line(get)}" fill="none" stroke="#3eaa80" stroke-width="3"/>`);
      drawDots(get);
    }
  } else {
    let shade = `M${x(0).toFixed(1)} ${base.toFixed(1)} `;
    points.forEach((p, i) => { shade += `L${x(i).toFixed(1)} ${y(p.min).toFixed(1)} `; });
    shade += `L${x(points.length - 1).toFixed(1)} ${base.toFixed(1)} Z`;
    parts.push(`<path d="${shade}" fill="#60c99e" fill-opacity=".16"/>`);
    parts.push(`<path d="${line((p) => p.min)}" fill="none" stroke="#3eaa80" stroke-width="3"/>`);
    drawDots((p) => p.min);
  }

  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.innerHTML = parts.join("");
  $("sgLegend").innerHTML = isFlat
    ? '<span><i class="key" style="color:#3eaa80;background:#60c99e"></i>Projected monthly income</span>'
    : '<span><i class="key" style="color:#3eaa80;background:#60c99e"></i>Salary range (low – high)</span>';
}

function renderSalaryTable(data) {
  const startYear = new Date().getFullYear();
  const assumptions = data.assumptions;
  const lastYear = data.years.length;
  const interval = Math.max(1, parseInt($("sgTableInterval").value, 10) || 1);
  const shown = data.years.filter((year) => year.year % interval === 0 || year.year === lastYear);
  const dashCell = '<td class="dash">&mdash;</td>';
  const cell = (value, extraClass = "") => {
    if (value === null || value === undefined) return dashCell;
    const cls = `num${value < 0 ? " neg" : ""}${extraClass ? ` ${extraClass}` : ""}`;
    return `<td class="${cls}">${amount(value)}</td>`;
  };

  const head = `<thead>
    <tr>
      <th class="row-label" rowspan="2" scope="col">Year</th>
      <th class="group-head" colspan="3" scope="colgroup">Low estimate</th>
      <th class="group-head" colspan="3" scope="colgroup">High estimate</th>
    </tr>
    <tr>
      <th scope="col">Monthly</th><th scope="col">Annual</th><th scope="col">Increase</th>
      <th class="group-start" scope="col">Monthly</th><th scope="col">Annual</th><th scope="col">Increase</th>
    </tr>
  </thead>`;

  const rows = [];
  const currentMonthly = assumptions.current_income_monthly;
  let startRow = `<tr class="start-row"><th class="row-label" scope="row">Now (${startYear})</th>`;
  startRow += cell(currentMonthly, "start-col") + cell(currentMonthly * 12, "start-col") + dashCell;
  startRow += cell(currentMonthly, "start-col") + cell(currentMonthly * 12, "start-col") + dashCell;
  rows.push(`${startRow}</tr>`);

  shown.forEach((year) => {
    let html = `<tr><th class="row-label" scope="row">${startYear + year.year}</th>`;
    html += cell(year.income_min_monthly) + cell(year.income_min_annual) + cell(year.increase_min);
    html += cell(year.income_max_monthly, "group-start") + cell(year.income_max_annual) + cell(year.increase_max);
    rows.push(`${html}</tr>`);
  });

  $("sgTable").innerHTML = `${head}<tbody>${rows.join("")}</tbody>`;
}

/* ---------- salary draft persistence ---------- */

function sgCollectDraft() {
  return {
    sgIncome: $("sgIncome").value,
    sgFrequency: $("sgFrequency").value,
    sgYears: $("sgYears").value,
    sgType: $("sgType").value,
    sgMin: $("sgMin").value,
    sgMax: $("sgMax").value,
    sgTableInterval: $("sgTableInterval").value,
  };
}

function sgSaveDraftSoon() {
  clearTimeout(sgSaveTimer);
  sgSaveTimer = setTimeout(() => {
    try {
      localStorage.setItem(SG_DRAFT_KEY, JSON.stringify(sgCollectDraft()));
    } catch (error) {
      /* storage unavailable — drafts are optional */
    }
  }, 400);
}

function sgRestoreDraft() {
  let draft = null;
  try {
    draft = JSON.parse(localStorage.getItem(SG_DRAFT_KEY));
  } catch (error) {
    draft = null;
  }
  if (!draft || typeof draft !== "object") return false;
  for (const [key, id] of Object.entries(sgCollectDraft())) {
    if (typeof draft[key] === "string") $(id).value = draft[key];
  }
  return true;
}

/* ---------- tool switching ---------- */

function setTool(name) {
  document.body.dataset.tool = name;
  $("tool-projection").hidden = name !== "projection";
  $("tool-salary").hidden = name !== "salary";
  $("projectionGroup").querySelector(".nav-parent").classList.toggle("active", name === "projection");
  $("salaryGroup").querySelector(".nav-parent").classList.toggle("active", name === "salary");
  updatePeriodPill();
}

/* ---------- navigation highlighting ---------- */

function setupNavObserver() {
  const links = [...document.querySelectorAll(".nav-item")];
  const sections = links
    .map((link) => document.querySelector(link.getAttribute("href")))
    .filter(Boolean);
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        links.forEach((link) => {
          link.classList.toggle("active", link.getAttribute("href") === `#${entry.target.id}`);
        });
      }
    });
  }, { rootMargin: "-40% 0px -55% 0px" });
  sections.forEach((section) => observer.observe(section));
}

/* ---------- init ---------- */

function init() {
  ["income", "bonuses", "commitments", "funds", "projection"].forEach((id) => {
    const section = document.getElementById(id);
    section.addEventListener("input", onInputChanged);
    section.addEventListener("change", onInputChanged);
  });
  // The currency picker lives in the top bar, outside the input sections.
  $("currency").addEventListener("change", onInputChanged);
  $("addExpense").addEventListener("click", () => {
    addExpenseRow();
    onInputChanged();
  });
  $("addFund").addEventListener("click", () => {
    addFundRow();
    onInputChanged();
  });
  $("calcTop").addEventListener("click", () => {
    if (document.body.dataset.tool === "salary") salaryCalculate({ manual: true });
    else calculate({ manual: true });
  });
  $("tableInterval").addEventListener("change", () => {
    saveDraftSoon();
    if (lastResult) renderTable(lastResult);
  });
  const projectionParentButton = $("projectionGroup").querySelector(".nav-parent");
  projectionParentButton.addEventListener("click", () => {
    if (document.body.dataset.tool !== "projection") {
      $("projectionGroup").classList.remove("collapsed");
      projectionParentButton.setAttribute("aria-expanded", "true");
      setTool("projection");
      return;
    }
    const collapsed = $("projectionGroup").classList.toggle("collapsed");
    projectionParentButton.setAttribute("aria-expanded", String(!collapsed));
  });
  $("salaryGroup").querySelector(".nav-parent").addEventListener("click", () => setTool("salary"));

  if (!restoreDraft()) applyDefaultRows();
  refreshFields();
  updateCurrencyLabels();
  updateExpenseTotal();
  updateFundAllocation();
  updateIncrementLabel();
  updatePeriodPill();
  setupNavObserver();

  const salarySection = document.getElementById("sg-inputs");
  salarySection.addEventListener("input", onSgInputChanged);
  salarySection.addEventListener("change", onSgInputChanged);
  $("sgTableInterval").addEventListener("change", () => {
    sgSaveDraftSoon();
    if (sgLastResult) renderSalaryTable(sgLastResult);
  });
  sgRestoreDraft();
  sgUpdateLabels();
  setTool("projection");

  calculate();
  salaryCalculate();
}

init();