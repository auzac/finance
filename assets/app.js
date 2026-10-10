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
    <div class="field"><input class="e-name" type="text" placeholder="Commitment name" aria-label="Commitment name" /></div>
    <div class="field"><input class="e-amount" type="number" min="0" step="any" placeholder="Monthly amount" aria-label="Monthly amount" inputmode="decimal" /></div>
    <button class="icon-btn remove" type="button" aria-label="Remove commitment">&times;</button>`;
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

function addFundRow(fund = {}) {
  const row = document.createElement("div");
  row.className = "row-card fund-row";
  row.innerHTML = `
    <div class="field"><input class="f-name" type="text" placeholder="Fund name" aria-label="Fund name" /></div>
    <div class="field"><select class="f-type" aria-label="Allocation method">
      <option value="fixed">Fixed amount / month</option>
      <option value="percent">% of monthly surplus</option>
    </select></div>
    <div class="field"><input class="f-value" type="number" min="0" step="any" placeholder="Allocation value" aria-label="Allocation value" inputmode="decimal" /></div>
    <div class="field"><input class="f-balance" type="number" min="0" step="any" placeholder="Starting balance" aria-label="Starting balance" inputmode="decimal" /></div>
    <div class="field"><input class="f-return" type="number" min="-100" step="any" placeholder="Annual return %" aria-label="Annual return percent" inputmode="decimal" /></div>
    <button class="icon-btn remove" type="button" aria-label="Remove fund">&times;</button>`;
  row.querySelector(".f-name").value = fund.name || "";
  row.querySelector(".f-type").value = fund.type || "fixed";
  row.querySelector(".f-value").value = fund.value ?? "";
  row.querySelector(".f-balance").value = fund.balance ?? "";
  row.querySelector(".f-return").value = fund.return ?? "";
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
  document.querySelectorAll("#expenseList .row-card").forEach((row, index) => {
    row.querySelector(".e-name").closest(".field").dataset.field = `expenses.items[${index}].name`;
    row.querySelector(".e-amount").closest(".field").dataset.field = `expenses.items[${index}].monthly_amount`;
  });
  const fundKeys = {
    ".f-name": "name",
    ".f-type": "allocation_type",
    ".f-value": "allocation_value",
    ".f-balance": "starting_balance",
    ".f-return": "annual_return_percent",
  };
  document.querySelectorAll("#fundList .row-card").forEach((row, index) => {
    for (const [selector, key] of Object.entries(fundKeys)) {
      row.querySelector(selector).closest(".field").dataset.field = `funds[${index}].${key}`;
    }
  });
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

function updateIncrementLabel() {
  const type = $("incrementType").value;
  const frequency = $("salaryFrequency").value;
  const fixedUnit = frequency === "annual" ? "(per year, matches salary)" : "(per month, matches salary)";
  $("incrementLabel").textContent = type === "percent" ? "Increment value (% per year)" : `Increment value ${fixedUnit}`;
}

function updatePeriodPill() {
  const years = parseInt($("years").value, 10);
  $("periodPill").textContent = years > 0 ? `${years}-YEAR PROJECTION` : "PROJECTION";
}

function onInputChanged() {
  saveDraftSoon();
  updateCurrencyLabels();
  updateExpenseTotal();
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
      item.textContent = `Year ${warning.year} (${startYear + warning.year}): fund allocations exceed the monthly surplus by ${money(warning.monthly_excess)}. Contributions are not reduced automatically — lower an allocation or a commitment.`;
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
    return `<td class="${cls}">${money(value)}</td>`;
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

  group("Commitments &amp; savings");
  row("Annual expenses", (y) => y.annual_expenses);
  row("Annual savings", (y) => y.annual_savings);

  group("Funds");
  funds.forEach((fund, index) => {
    const name = esc(fund.name || `Fund ${index + 1}`);
    row(`${name} &middot; contributions`, (y) => y.fund_contributions[index]);
    row(`${name} &middot; balance`, (y) => y.fund_balances[index], fund.starting_balance);
  });
  row("Total contributions", (y) => y.total_fund_contributions);
  row("Total fund balances", (y) => y.total_fund_balances, startingBalance);

  group("Cash &amp; wealth");
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

function showBanner(message, details) {
  const banner = $("errorBanner");
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
  $("calcTop").disabled = loading;
  $("calcMain").disabled = loading;
  $("calcMain").textContent = loading ? "Calculating…" : "Calculate projection";
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
    showBanner(message, unplaced);
    $("resultsStatus").textContent = "Projection unavailable — check the message above.";
  } catch (error) {
    if (sequence !== calcSeq) return;
    if (!manual && lastResult) return;
    showBanner('Could not reach the calculation service. Run "python dev_server.py" and open the app from that server.');
    $("resultsStatus").textContent = "Projection unavailable — check the message above.";
  } finally {
    if (manual) setLoading(false);
  }
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
  $("addExpense").addEventListener("click", () => {
    addExpenseRow();
    onInputChanged();
  });
  $("addFund").addEventListener("click", () => {
    addFundRow();
    onInputChanged();
  });
  $("calcTop").addEventListener("click", calculate);
  $("calcMain").addEventListener("click", calculate);
  $("tableInterval").addEventListener("change", () => {
    saveDraftSoon();
    if (lastResult) renderTable(lastResult);
  });

  if (!restoreDraft()) applyDefaultRows();
  refreshFields();
  updateCurrencyLabels();
  updateExpenseTotal();
  updateIncrementLabel();
  updatePeriodPill();
  setupNavObserver();
  calculate();
}

init();
