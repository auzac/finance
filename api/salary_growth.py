"""Pure salary growth projection and validation.

Projects a current income year by year between a low and a high yearly
increase estimate. Percentage increases compound (``income * (1 + pct)``
each year); fixed-value increases are added linearly. When the low and high
estimates are equal, the two paths collapse into one.

The income frequency (monthly or annual) only describes how the input is
entered: a fixed-value increase is entered at the same frequency and is
normalised to a monthly step. Outputs carry both monthly and annual figures,
unrounded; rounding happens at display time only.
"""

from math import isfinite

FREQUENCIES = ("monthly", "annual")
INCREMENT_TYPES = ("percent", "fixed")


class ValidationError(ValueError):
    """Raised when the request contains invalid inputs."""

    def __init__(self, errors):
        self.errors = errors
        super().__init__("; ".join(error["message"] for error in errors))


def compute_salary_growth(request):
    """Validate ``request`` and return the full salary projection."""
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


def _number(value, field, errors, *, required=False, minimum=None):
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
            {"field": field, "message": f"Must be one of: {', '.join(choices)}."}
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
    current_income = _number(
        request.get("current_income"), "current_income", errors, required=True, minimum=0
    )
    income_frequency = _choice(
        request.get("income_frequency"),
        "income_frequency",
        FREQUENCIES,
        errors,
    )
    increment_type = _choice(
        request.get("increment_type"),
        "increment_type",
        INCREMENT_TYPES,
        errors,
        default="percent",
    )

    min_increment = _number(
        request.get("min_increment"), "min_increment", errors, minimum=0
    )
    max_increment = _number(
        request.get("max_increment"), "max_increment", errors, minimum=0
    )
    if min_increment > max_increment:
        errors.append(
            {
                "field": "max_increment",
                "message": "Maximum increase must be at least the minimum.",
            }
        )

    if errors:
        raise ValidationError(errors)

    return {
        "currency": currency.strip().upper(),
        "duration_years": duration_years,
        "current_income": current_income,
        "income_frequency": income_frequency,
        "increment_type": increment_type,
        "min_increment": min_increment,
        "max_increment": max_increment,
    }


# --------------------------------------------------------------------------
# Projection
# --------------------------------------------------------------------------


def _project(inputs):
    frequency = inputs["income_frequency"]
    if frequency == "annual":
        monthly_current = inputs["current_income"] / 12
    else:
        monthly_current = inputs["current_income"]

    low_spec = inputs["min_increment"]
    high_spec = inputs["max_increment"]

    def monthly_income(year, spec):
        if inputs["increment_type"] == "percent":
            return monthly_current * (1 + spec / 100) ** year
        step = spec / 12 if frequency == "annual" else spec
        return monthly_current + step * year

    years = []
    previous_low = previous_high = monthly_current
    for year in range(1, inputs["duration_years"] + 1):
        low = monthly_income(year, low_spec)
        high = monthly_income(year, high_spec)
        years.append(
            {
                "year": year,
                "income_min_monthly": low,
                "income_max_monthly": high,
                "income_min_annual": low * 12,
                "income_max_annual": high * 12,
                "increase_min": low - previous_low,
                "increase_max": high - previous_high,
            }
        )
        previous_low = low
        previous_high = high

    last = years[-1]

    def growth_percent(end_monthly):
        if monthly_current <= 0:
            return 0.0
        return (end_monthly / monthly_current - 1) * 100

    return {
        "assumptions": {
            "currency": inputs["currency"],
            "duration_years": inputs["duration_years"],
            "current_income": inputs["current_income"],
            "income_frequency": inputs["income_frequency"],
            "current_income_monthly": monthly_current,
            "increment_type": inputs["increment_type"],
            "min_increment": inputs["min_increment"],
            "max_increment": inputs["max_increment"],
        },
        "summary": {
            "current_income_monthly": monthly_current,
            "current_income_annual": monthly_current * 12,
            "end_income_min_monthly": last["income_min_monthly"],
            "end_income_max_monthly": last["income_max_monthly"],
            "growth_percent_min": growth_percent(last["income_min_monthly"]),
            "growth_percent_max": growth_percent(last["income_max_monthly"]),
        },
        "years": years,
        "warnings": [],
    }
