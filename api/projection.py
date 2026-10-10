"""Pure financial projection calculations and domain validation.

This module is the single source of truth for the projection maths. It has no
HTTP, DOM or network concerns, so it can be unit tested directly.

Conventions
-----------
Return timing
    A fund's balance grows once per year:

        balance_end = (balance_open + annual_contributions) * (1 + annual_return)

    The year's twelve monthly contributions are treated as made during the
    year and earn that year's return together with the opening balance. No
    monthly compounding is modelled.

Salary input
    ``base_salary`` is given at ``salary_frequency`` (monthly or annual) and is
    normalised to a gross *monthly* figure internally. A fixed increment is
    entered at the same frequency as the salary and normalised the same way.

Bonuses
    The AWS and performance bonus are entered as multiples (months) of the
    year's gross monthly salary, taxed at the same effective rate as salary,
    and added to unallocated cash once per year. They therefore grow with the
    annual salary increment and never increase monthly contribution capacity.

Deficit and over-allocation handling
    Allocations are never silently reduced or capped:

    * Percentage funds allocate ``max(monthly_surplus, 0) * percent`` so a
      deficit year cannot drain funds automatically. The year is reported as a
      ``negative_surplus`` warning.
    * When the monthly surplus is non-negative but total contributions exceed
      it, the year is reported as an ``over_allocation`` warning with the
      monthly excess amount. Remaining cash may go negative.

Rounding
    Values are computed unrounded; rounding happens only at display time.
"""

from math import isfinite

SALARY_FREQUENCIES = ("monthly", "annual")
INCREMENT_TYPES = ("percent", "fixed")
ALLOCATION_TYPES = ("fixed", "percent")


class ValidationError(ValueError):
    """Raised when the request contains invalid inputs."""

    def __init__(self, errors):
        self.errors = errors
        super().__init__("; ".join(error["message"] for error in errors))


def compute_projection(request):
    """Validate ``request`` and return the full projection result.

    Raises :class:`ValidationError` with a list of ``{"field", "message"}``
    entries when any input is invalid.
    """
    inputs = _validate(request)
    return _project(inputs)


# --------------------------------------------------------------------------
# Validation
# --------------------------------------------------------------------------


def _is_number(value):
    return (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and isfinite(value)
    )


def _number(value, field, errors, *, required=False, minimum=None, maximum=None):
    if value is None or value == "":
        if required:
            errors.append({"field": field, "message": "This field is required."})
        return 0.0
    if not _is_number(value):
        errors.append({"field": field, "message": "Must be a number."})
        return 0.0
    value = float(value)
    if minimum is not None and value < minimum:
        errors.append({"field": field, "message": f"Must be at least {minimum}."})
        return 0.0
    if maximum is not None and value > maximum:
        errors.append({"field": field, "message": f"Must be at most {maximum}."})
        return 0.0
    return value


def _positive_int(value, field, errors):
    if value is None or value == "":
        errors.append({"field": field, "message": "This field is required."})
        return 1
    if not _is_number(value) or int(value) != value or value < 1:
        errors.append(
            {"field": field, "message": "Must be a whole number of at least 1."}
        )
        return 1
    return int(value)


def _choice(value, field, choices, errors, *, default=None):
    if value is None or value == "":
        if default is None:
            errors.append(
                {
                    "field": field,
                    "message": f"Required — choose one of: {', '.join(choices)}.",
                }
            )
            return choices[0]
        return default
    if value not in choices:
        errors.append(
            {
                "field": field,
                "message": f"Must be one of: {', '.join(choices)}.",
            }
        )
        return default if default is not None else choices[0]
    return value


def _validate(request):
    errors = []
    if not isinstance(request, dict):
        raise ValidationError(
            [{"field": "", "message": "Request body must be a JSON object."}]
        )

    currency = request.get("currency")
    if not isinstance(currency, str) or not currency.strip():
        errors.append(
            {
                "field": "currency",
                "message": "Required — provide a currency code such as USD.",
            }
        )
        currency = "USD"

    duration_years = _positive_int(request.get("duration_years"), "duration_years", errors)
    starting_cash = _number(
        request.get("starting_cash"), "starting_cash", errors, minimum=0
    )

    income = request.get("income")
    if not isinstance(income, dict):
        errors.append({"field": "income", "message": "Provide an income object."})
        income = {}
    base_salary = _number(
        income.get("base_salary"), "income.base_salary", errors, required=True, minimum=0
    )
    salary_frequency = _choice(
        income.get("salary_frequency"),
        "income.salary_frequency",
        SALARY_FREQUENCIES,
        errors,
    )
    tax_rate = _number(
        income.get("tax_rate_percent"),
        "income.tax_rate_percent",
        errors,
        required=True,
        minimum=0,
        maximum=100,
    )
    increment_type = _choice(
        income.get("increment_type"),
        "income.increment_type",
        INCREMENT_TYPES,
        errors,
        default="percent",
    )
    increment_value = _number(
        income.get("increment_value"), "income.increment_value", errors, minimum=0
    )

    aws_months = _number(
        income.get("aws_months"), "income.aws_months", errors, minimum=0
    )
    performance_bonus_months = _number(
        income.get("performance_bonus_months"),
        "income.performance_bonus_months",
        errors,
        minimum=0,
    )

    expenses = request.get("expenses")
    if expenses is None:
        expenses = {}
    if not isinstance(expenses, dict):
        errors.append({"field": "expenses", "message": "Provide an expenses object."})
        expenses = {}
    inflation = _number(
        expenses.get("annual_inflation_percent"),
        "expenses.annual_inflation_percent",
        errors,
        minimum=0,
        maximum=100,
    )
    items_raw = expenses.get("items")
    if items_raw is None or items_raw == "":
        items_raw = []
    if not isinstance(items_raw, list):
        errors.append({"field": "expenses.items", "message": "Must be a list of expenses."})
        items_raw = []
    expense_items = []
    for index, item in enumerate(items_raw):
        if not isinstance(item, dict):
            errors.append(
                {"field": f"expenses.items[{index}]", "message": "Each expense must be an object."}
            )
            continue
        name = item.get("name")
        if not isinstance(name, str) or not name.strip():
            errors.append(
                {"field": f"expenses.items[{index}].name", "message": "Name is required."}
            )
            name = ""
        amount = _number(
            item.get("monthly_amount"),
            f"expenses.items[{index}].monthly_amount",
            errors,
            minimum=0,
        )
        expense_items.append({"name": name.strip(), "monthly_amount": amount})

    funds_raw = request.get("funds")
    if funds_raw is None or funds_raw == "":
        funds_raw = []
    if not isinstance(funds_raw, list):
        errors.append({"field": "funds", "message": "Must be a list of funds."})
        funds_raw = []
    funds = []
    for index, fund in enumerate(funds_raw):
        if not isinstance(fund, dict):
            errors.append({"field": f"funds[{index}]", "message": "Each fund must be an object."})
            continue
        name = fund.get("name")
        if not isinstance(name, str) or not name.strip():
            errors.append({"field": f"funds[{index}].name", "message": "Fund name is required."})
            name = ""
        allocation_type = _choice(
            fund.get("allocation_type"),
            f"funds[{index}].allocation_type",
            ALLOCATION_TYPES,
            errors,
        )
        maximum = 100 if allocation_type == "percent" else None
        allocation_value = _number(
            fund.get("allocation_value"),
            f"funds[{index}].allocation_value",
            errors,
            minimum=0,
            maximum=maximum,
        )
        starting_balance = _number(
            fund.get("starting_balance"),
            f"funds[{index}].starting_balance",
            errors,
            minimum=0,
        )
        annual_return = _number(
            fund.get("annual_return_percent"),
            f"funds[{index}].annual_return_percent",
            errors,
            minimum=-100,
        )
        funds.append(
            {
                "name": name.strip(),
                "allocation_type": allocation_type,
                "allocation_value": allocation_value,
                "starting_balance": starting_balance,
                "annual_return_percent": annual_return,
            }
        )

    if errors:
        raise ValidationError(errors)

    return {
        "currency": currency.strip().upper(),
        "duration_years": duration_years,
        "starting_cash": starting_cash,
        "income": {
            "base_salary": base_salary,
            "salary_frequency": salary_frequency,
            "tax_rate_percent": tax_rate,
            "increment_type": increment_type,
            "increment_value": increment_value,
            "aws_months": aws_months,
            "performance_bonus_months": performance_bonus_months,
        },
        "expenses": {
            "annual_inflation_percent": inflation,
            "items": expense_items,
        },
        "funds": funds,
    }


# --------------------------------------------------------------------------
# Projection
# --------------------------------------------------------------------------


def _project(inputs):
    income = inputs["income"]
    tax_rate = income["tax_rate_percent"] / 100
    bonus_months = income["aws_months"] + income["performance_bonus_months"]

    if income["salary_frequency"] == "annual":
        gross_monthly_salary = income["base_salary"] / 12
    else:
        gross_monthly_salary = income["base_salary"]

    if income["increment_type"] == "percent":
        increment_multiplier = 1 + income["increment_value"] / 100
        increment_monthly_step = 0.0
    else:
        increment_multiplier = 1.0
        if income["salary_frequency"] == "annual":
            increment_monthly_step = income["increment_value"] / 12
        else:
            increment_monthly_step = income["increment_value"]

    inflation_multiplier = 1 + inputs["expenses"]["annual_inflation_percent"] / 100
    monthly_expenses = sum(item["monthly_amount"] for item in inputs["expenses"]["items"])

    cash = inputs["starting_cash"]
    balances = [fund["starting_balance"] for fund in inputs["funds"]]

    years = []
    warnings = []
    for year in range(1, inputs["duration_years"] + 1):
        if year > 1:
            gross_monthly_salary = (
                gross_monthly_salary * increment_multiplier + increment_monthly_step
            )
            monthly_expenses = monthly_expenses * inflation_multiplier

        net_monthly_salary = gross_monthly_salary * (1 - tax_rate)
        monthly_surplus = net_monthly_salary - monthly_expenses
        gross_bonuses = bonus_months * gross_monthly_salary
        net_bonuses = gross_bonuses * (1 - tax_rate)

        contributions = []
        for fund in inputs["funds"]:
            if fund["allocation_type"] == "percent":
                contributions.append(max(monthly_surplus, 0) * fund["allocation_value"] / 100)
            else:
                contributions.append(fund["allocation_value"])
        total_contributions = sum(contributions)

        if monthly_surplus < 0:
            warnings.append(
                {
                    "type": "negative_surplus",
                    "year": year,
                    "monthly_surplus": monthly_surplus,
                    "monthly_deficit": -monthly_surplus,
                }
            )
        elif total_contributions - monthly_surplus > 1e-9:
            warnings.append(
                {
                    "type": "over_allocation",
                    "year": year,
                    "monthly_surplus": monthly_surplus,
                    "total_monthly_contributions": total_contributions,
                    "monthly_excess": total_contributions - monthly_surplus,
                }
            )

        remaining_monthly_cash = monthly_surplus - total_contributions

        for index, fund in enumerate(inputs["funds"]):
            balances[index] = (balances[index] + contributions[index] * 12) * (
                1 + fund["annual_return_percent"] / 100
            )

        cash += remaining_monthly_cash * 12 + net_bonuses

        gross_annual_salary = gross_monthly_salary * 12
        net_annual_salary = net_monthly_salary * 12
        annual_expenses = monthly_expenses * 12
        years.append(
            {
                "year": year,
                "gross_annual_salary": gross_annual_salary,
                "gross_bonuses": gross_bonuses,
                "tax_annual": (gross_annual_salary + gross_bonuses) * tax_rate,
                "net_annual_salary": net_annual_salary,
                "net_bonuses": net_bonuses,
                "annual_expenses": annual_expenses,
                "annual_savings": net_annual_salary + net_bonuses - annual_expenses,
                "monthly_surplus": monthly_surplus,
                "monthly_expenses": monthly_expenses,
                "fund_contributions": [contribution * 12 for contribution in contributions],
                "total_fund_contributions": total_contributions * 12,
                "remaining_annual_cash": remaining_monthly_cash * 12,
                "unallocated_cash": cash,
                "fund_balances": list(balances),
                "total_fund_balances": sum(balances),
                "total_wealth": cash + sum(balances),
            }
        )

    first_year = years[0]
    last_year = years[-1]
    return {
        "assumptions": {
            "currency": inputs["currency"],
            "duration_years": inputs["duration_years"],
            "starting_cash": inputs["starting_cash"],
            "salary_frequency": income["salary_frequency"],
            "gross_monthly_salary": _initial_gross_monthly(inputs),
            "tax_rate_percent": income["tax_rate_percent"],
            "increment_type": income["increment_type"],
            "increment_value": income["increment_value"],
            "aws_months": income["aws_months"],
            "performance_bonus_months": income["performance_bonus_months"],
            "annual_inflation_percent": inputs["expenses"]["annual_inflation_percent"],
            "total_monthly_expenses": sum(
                item["monthly_amount"] for item in inputs["expenses"]["items"]
            ),
            "funds": [dict(fund) for fund in inputs["funds"]],
        },
        "summary": {
            "net_monthly_salary": first_year["net_annual_salary"] / 12,
            "monthly_surplus": first_year["monthly_surplus"],
            "remaining_monthly_cash": first_year["remaining_annual_cash"] / 12,
            "end_unallocated_cash": last_year["unallocated_cash"],
            "end_total_fund_balances": last_year["total_fund_balances"],
            "end_total_wealth": last_year["total_wealth"],
        },
        "years": years,
        "warnings": warnings,
    }


def _initial_gross_monthly(inputs):
    income = inputs["income"]
    if income["salary_frequency"] == "annual":
        return income["base_salary"] / 12
    return income["base_salary"]
