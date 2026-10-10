"""Calculation, validation and reconciliation tests for the projection engine."""

import json

import pytest

from calculate import process_body
from projection import compute_projection, ValidationError


def request(**overrides):
    """Build a valid request payload, applying shallow overrides."""
    payload = {
        "currency": "USD",
        "duration_years": 3,
        "starting_cash": 0,
        "income": {
            "base_salary": 6000,
            "salary_frequency": "monthly",
            "tax_rate_percent": 0,
            "increment_type": "percent",
            "increment_value": 0,
            "aws_months": 0,
            "performance_bonus_months": 0,
        },
        "expenses": {"annual_inflation_percent": 0, "items": []},
        "funds": [],
    }
    for key, value in overrides.items():
        if key in ("income", "expenses") and isinstance(value, dict):
            payload[key].update(value)
        else:
            payload[key] = value
    return payload


def field_errors(payload):
    """Return {field: message} for a payload that should fail validation."""
    with pytest.raises(ValidationError) as excinfo:
        compute_projection(payload)
    return {error["field"]: error["message"] for error in excinfo.value.errors}


def assert_reconciled(result):
    tax_rate = result["assumptions"]["tax_rate_percent"] / 100
    for entry in result["years"]:
        assert entry["annual_savings"] == pytest.approx(
            entry["total_fund_contributions"]
            + entry["remaining_annual_cash"]
            + entry["net_bonuses"]
        )
        assert entry["total_wealth"] == pytest.approx(
            entry["unallocated_cash"] + entry["total_fund_balances"]
        )
        assert entry["total_fund_balances"] == pytest.approx(sum(entry["fund_balances"]))
        assert entry["tax_annual"] == pytest.approx(
            (entry["gross_annual_salary"] + entry["gross_bonuses"]) * tax_rate
        )
        assert entry["net_bonuses"] == pytest.approx(entry["gross_bonuses"] * (1 - tax_rate))
    assert result["summary"]["end_total_wealth"] == pytest.approx(
        result["years"][-1]["total_wealth"]
    )


# ---------------------------------------------------------------------------
# 1. Salary-only projection
# ---------------------------------------------------------------------------


def test_salary_only_projection():
    result = compute_projection(request())
    assert len(result["years"]) == 3
    for entry in result["years"]:
        assert entry["net_annual_salary"] == pytest.approx(72000)
    for entry, expected in zip(result["years"], [72000, 144000, 216000]):
        assert entry["unallocated_cash"] == pytest.approx(expected)
        assert entry["total_wealth"] == pytest.approx(expected)
        assert entry["total_fund_contributions"] == 0
    assert result["warnings"] == []
    assert result["summary"]["monthly_surplus"] == pytest.approx(6000)
    assert result["summary"]["end_total_wealth"] == pytest.approx(216000)
    assert_reconciled(result)


def test_single_year_projection():
    result = compute_projection(request(duration_years=1))
    assert len(result["years"]) == 1
    assert result["summary"]["end_total_wealth"] == pytest.approx(72000)


# ---------------------------------------------------------------------------
# 2. Tax and increments
# ---------------------------------------------------------------------------


def test_tax_and_percentage_increment():
    payload = request(income={"base_salary": 1000, "tax_rate_percent": 20, "increment_value": 10})
    result = compute_projection(payload)
    assert [entry["net_annual_salary"] for entry in result["years"]] == pytest.approx(
        [9600, 10560, 11616]
    )
    assert [entry["unallocated_cash"] for entry in result["years"]] == pytest.approx(
        [9600, 20160, 31776]
    )
    assert result["years"][0]["tax_annual"] == pytest.approx(2400)
    assert result["years"][2]["gross_annual_salary"] == pytest.approx(14520)
    assert_reconciled(result)


def test_fixed_monthly_increment():
    payload = request(
        income={"base_salary": 1000, "increment_type": "fixed", "increment_value": 100}
    )
    result = compute_projection(payload)
    assert [entry["gross_annual_salary"] for entry in result["years"]] == pytest.approx(
        [12000, 13200, 14400]
    )


def test_annual_salary_with_fixed_annual_increment_is_normalized():
    payload = request(
        income={
            "base_salary": 12000,
            "salary_frequency": "annual",
            "increment_type": "fixed",
            "increment_value": 1200,
        }
    )
    result = compute_projection(payload)
    assert result["assumptions"]["gross_monthly_salary"] == pytest.approx(1000)
    assert [entry["gross_annual_salary"] for entry in result["years"]] == pytest.approx(
        [12000, 13200, 14400]
    )


# ---------------------------------------------------------------------------
# 3. Bonuses (months of gross salary)
# ---------------------------------------------------------------------------


def test_aws_and_performance_bonus_are_months_of_salary():
    payload = request(
        income={"tax_rate_percent": 10, "aws_months": 1, "performance_bonus_months": 0.5}
    )
    result = compute_projection(payload)
    entry = result["years"][0]
    assert entry["gross_bonuses"] == pytest.approx(9000)
    assert entry["net_bonuses"] == pytest.approx(8100)
    assert entry["unallocated_cash"] == pytest.approx(64800 + 8100)
    assert result["assumptions"]["aws_months"] == pytest.approx(1)
    assert result["assumptions"]["performance_bonus_months"] == pytest.approx(0.5)
    assert_reconciled(result)


def test_blank_bonus_months_are_zero():
    result = compute_projection(
        request(income={"aws_months": "", "performance_bonus_months": None})
    )
    assert result["years"][0]["gross_bonuses"] == 0
    assert result["years"][0]["net_bonuses"] == 0
    assert result["warnings"] == []


def test_bonuses_scale_with_salary_increments():
    payload = request(
        income={
            "base_salary": 1000,
            "increment_value": 10,
            "aws_months": 1,
            "performance_bonus_months": 0.5,
        }
    )
    result = compute_projection(payload)
    assert [entry["gross_bonuses"] for entry in result["years"]] == pytest.approx(
        [1500, 1650, 1815]
    )
    assert [entry["net_bonuses"] for entry in result["years"]] == pytest.approx(
        [1500, 1650, 1815]
    )


# ---------------------------------------------------------------------------
# 4. Expenses and inflation
# ---------------------------------------------------------------------------


def test_multiple_expense_items_and_inflation():
    payload = request(
        expenses={
            "annual_inflation_percent": 10,
            "items": [
                {"name": "Rent", "monthly_amount": 1000},
                {"name": "Food", "monthly_amount": 500},
            ],
        }
    )
    result = compute_projection(payload)
    assert result["assumptions"]["total_monthly_expenses"] == pytest.approx(1500)
    assert [entry["annual_expenses"] for entry in result["years"]] == pytest.approx(
        [18000, 19800, 21780]
    )
    assert [entry["unallocated_cash"] for entry in result["years"]] == pytest.approx(
        [54000, 106200, 156420]
    )
    assert_reconciled(result)


def test_blank_expense_amount_is_zero():
    payload = request(expenses={"items": [{"name": "Misc", "monthly_amount": ""}]})
    result = compute_projection(payload)
    assert result["assumptions"]["total_monthly_expenses"] == 0
    assert result["warnings"] == []


# ---------------------------------------------------------------------------
# 5. Mixed funds
# ---------------------------------------------------------------------------


def mixed_fund_payload(funds):
    return request(
        income={"base_salary": 5000},
        expenses={"items": [{"name": "Rent", "monthly_amount": 500}]},
        funds=funds,
    )


def test_mixed_fixed_and_percentage_funds():
    funds = [
        {"name": "Emergency", "allocation_type": "fixed", "allocation_value": 500},
        {"name": "Invest", "allocation_type": "percent", "allocation_value": 40},
    ]
    result = compute_projection(mixed_fund_payload(funds))
    entry = result["years"][0]
    # Surplus is 4500/month: 40% of it is 1800, independent of the fixed fund.
    assert entry["fund_contributions"] == pytest.approx([6000, 21600])
    assert entry["remaining_annual_cash"] == pytest.approx(26400)
    assert entry["fund_balances"] == pytest.approx([6000, 21600])
    assert entry["total_wealth"] == pytest.approx(54000)
    assert_reconciled(result)


def test_percentage_fund_is_order_independent():
    funds = [
        {"name": "Emergency", "allocation_type": "fixed", "allocation_value": 500},
        {"name": "Invest", "allocation_type": "percent", "allocation_value": 40},
    ]
    forward = compute_projection(mixed_fund_payload(funds))
    backward = compute_projection(mixed_fund_payload(list(reversed(funds))))
    assert forward["years"][0]["fund_contributions"] == pytest.approx([6000, 21600])
    assert backward["years"][0]["fund_contributions"] == pytest.approx([21600, 6000])
    assert forward["years"][0]["total_wealth"] == pytest.approx(
        backward["years"][0]["total_wealth"]
    )


# ---------------------------------------------------------------------------
# 6. Over-allocation and negative surplus
# ---------------------------------------------------------------------------


def test_over_allocation_in_year_one():
    funds = [{"name": "Aggressive", "allocation_type": "fixed", "allocation_value": 5500}]
    payload = request(duration_years=1, income={"base_salary": 5000}, funds=funds)
    result = compute_projection(payload)
    assert len(result["warnings"]) == 1
    warning = result["warnings"][0]
    assert warning["type"] == "over_allocation"
    assert warning["year"] == 1
    assert warning["monthly_surplus"] == pytest.approx(5000)
    assert warning["total_monthly_contributions"] == pytest.approx(5500)
    assert warning["monthly_excess"] == pytest.approx(500)
    assert result["years"][0]["remaining_annual_cash"] == pytest.approx(-6000)
    assert result["years"][0]["unallocated_cash"] == pytest.approx(-6000)


def test_over_allocation_in_a_later_year_from_expense_growth():
    funds = [{"name": "Fixed", "allocation_type": "fixed", "allocation_value": 900}]
    payload = request(
        income={"base_salary": 5000},
        expenses={
            "annual_inflation_percent": 50,
            "items": [{"name": "Living", "monthly_amount": 4000}],
        },
        funds=funds,
        duration_years=2,
    )
    result = compute_projection(payload)
    assert result["years"][0]["monthly_surplus"] == pytest.approx(1000)
    assert result["warnings"] == [
        {
            "type": "negative_surplus",
            "year": 2,
            "monthly_surplus": -1000,
            "monthly_deficit": 1000,
        }
    ]


def test_negative_surplus_does_not_drain_percentage_funds():
    funds = [{"name": "Invest", "allocation_type": "percent", "allocation_value": 50}]
    payload = request(
        duration_years=1,
        income={"base_salary": 2000},
        expenses={"items": [{"name": "Living", "monthly_amount": 3000}]},
        funds=funds,
    )
    result = compute_projection(payload)
    entry = result["years"][0]
    assert entry["monthly_surplus"] == pytest.approx(-1000)
    assert entry["fund_contributions"] == pytest.approx([0])
    assert entry["fund_balances"] == pytest.approx([0])
    assert entry["unallocated_cash"] == pytest.approx(-12000)
    assert [warning["type"] for warning in result["warnings"]] == ["negative_surplus"]
    assert result["warnings"][0]["monthly_deficit"] == pytest.approx(1000)


# ---------------------------------------------------------------------------
# 7. Invalid inputs
# ---------------------------------------------------------------------------


def test_required_fields_missing_or_blank_are_rejected():
    assert "duration_years" in field_errors(request(duration_years=None))
    assert "income.base_salary" in field_errors(request(income={"base_salary": None}))
    assert "income.base_salary" in field_errors(request(income={"base_salary": ""}))
    assert "income.tax_rate_percent" in field_errors(
        request(income={"tax_rate_percent": None})
    )
    assert "currency" in field_errors(request(currency=None))
    assert "income.salary_frequency" in field_errors(
        request(income={"salary_frequency": None})
    )
    assert "income" in field_errors(request(income=None))


def test_out_of_range_values_are_rejected():
    assert "duration_years" in field_errors(request(duration_years=0))
    assert "duration_years" in field_errors(request(duration_years=2.5))
    assert "duration_years" in field_errors(request(duration_years=-3))
    assert "income.base_salary" in field_errors(request(income={"base_salary": -1}))
    assert "income.tax_rate_percent" in field_errors(request(income={"tax_rate_percent": 150}))
    assert "income.tax_rate_percent" in field_errors(request(income={"tax_rate_percent": -5}))
    assert "income.increment_value" in field_errors(request(income={"increment_value": -2}))
    assert "starting_cash" in field_errors(request(starting_cash=-1))
    assert "expenses.annual_inflation_percent" in field_errors(
        request(expenses={"annual_inflation_percent": 101})
    )


def test_wrong_types_are_rejected():
    assert "income.base_salary" in field_errors(request(income={"base_salary": "5000"}))
    assert "duration_years" in field_errors(request(duration_years="ten"))
    assert "duration_years" in field_errors(request(duration_years=True))
    assert "income.salary_frequency" in field_errors(
        request(income={"salary_frequency": "weekly"})
    )
    assert "income.increment_type" in field_errors(
        request(income={"increment_type": "bonus"})
    )
    assert "funds" in field_errors(request(funds="none"))
    assert "expenses" in field_errors(request(expenses="none"))


def test_bonus_validation():
    assert "income.aws_months" in field_errors(request(income={"aws_months": -1}))
    assert "income.performance_bonus_months" in field_errors(
        request(income={"performance_bonus_months": -0.5})
    )
    assert "income.aws_months" in field_errors(request(income={"aws_months": "one"}))


def test_expense_validation():
    errors = field_errors(request(expenses={"items": [{"name": ""}]}))
    assert "expenses.items[0].name" in errors
    errors = field_errors(
        request(expenses={"items": [{"name": "Rent", "monthly_amount": -100}]})
    )
    assert "expenses.items[0].monthly_amount" in errors
    assert "expenses.items[1]" in field_errors(
        request(expenses={"items": [{"name": "Rent", "monthly_amount": 1}, "nope"]})
    )


def test_fund_validation():
    funds = [{"name": "", "allocation_type": "fixed", "allocation_value": 100}]
    assert "funds[0].name" in field_errors(request(funds=funds))

    funds = [{"name": "Invest", "allocation_type": "weekly", "allocation_value": 10}]
    assert "funds[0].allocation_type" in field_errors(request(funds=funds))

    funds = [{"name": "Invest", "allocation_type": "percent", "allocation_value": 120}]
    assert "funds[0].allocation_value" in field_errors(request(funds=funds))

    funds = [{"name": "Invest", "allocation_type": "fixed", "allocation_value": -1}]
    assert "funds[0].allocation_value" in field_errors(request(funds=funds))

    funds = [
        {
            "name": "Invest",
            "allocation_type": "fixed",
            "allocation_value": 100,
            "starting_balance": -5,
            "annual_return_percent": -150,
        }
    ]
    errors = field_errors(request(funds=funds))
    assert "funds[0].starting_balance" in errors
    assert "funds[0].annual_return_percent" in errors

    assert "funds[1]" in field_errors(
        request(funds=[{"name": "Ok", "allocation_type": "fixed"}, "nope"])
    )


def test_validation_error_messages_are_actionable():
    errors = field_errors(request(duration_years=0))
    assert "whole number" in errors["duration_years"]


# ---------------------------------------------------------------------------
# 8. Starting balances, returns and reconciliation
# ---------------------------------------------------------------------------


def test_starting_balances_and_return_timing_convention():
    funds = [
        {
            "name": "Invest",
            "allocation_type": "fixed",
            "allocation_value": 100,
            "starting_balance": 1000,
            "annual_return_percent": 10,
        }
    ]
    payload = request(starting_cash=500, funds=funds)
    result = compute_projection(payload)
    entries = result["years"]
    # balance_end = (balance_open + contributions) * (1 + return)
    assert [entry["fund_balances"][0] for entry in entries] == pytest.approx(
        [2420, 3982, 5700.2]
    )
    assert [entry["unallocated_cash"] for entry in entries] == pytest.approx(
        [71300, 142100, 212900]
    )
    assert [entry["total_wealth"] for entry in entries] == pytest.approx(
        [73720, 146082, 218600.2]
    )
    assert result["summary"]["end_total_fund_balances"] == pytest.approx(5700.2)
    assert result["summary"]["end_unallocated_cash"] == pytest.approx(212900)
    assert_reconciled(result)


def test_zero_return_fund_equals_sum_of_contributions():
    funds = [
        {
            "name": "Savings",
            "allocation_type": "fixed",
            "allocation_value": 250,
            "starting_balance": 100,
            "annual_return_percent": 0,
        }
    ]
    payload = request(duration_years=2, funds=funds)
    result = compute_projection(payload)
    assert [entry["fund_balances"][0] for entry in result["years"]] == pytest.approx(
        [3100, 6100]
    )
    assert_reconciled(result)


def test_assumptions_echo_normalized_inputs():
    funds = [{"name": "Emergency", "allocation_type": "fixed", "allocation_value": 500}]
    payload = request(
        currency="SGD",
        starting_cash=100,
        income={"base_salary": 60000, "salary_frequency": "annual"},
        funds=funds,
    )
    result = compute_projection(payload)
    assumptions = result["assumptions"]
    assert assumptions["currency"] == "SGD"
    assert assumptions["gross_monthly_salary"] == pytest.approx(5000)
    assert assumptions["starting_cash"] == pytest.approx(100)
    assert [fund["name"] for fund in assumptions["funds"]] == ["Emergency"]


# ---------------------------------------------------------------------------
# API body handling
# ---------------------------------------------------------------------------


def test_process_body_rejects_malformed_json():
    status, payload = process_body(b"{not json")
    assert status == 400
    assert "error" in payload


def test_process_body_rejects_empty_body():
    status, payload = process_body(b"")
    assert status == 400


def test_process_body_returns_full_result_for_valid_request():
    status, payload = process_body(json.dumps(request()).encode("utf-8"))
    assert status == 200
    assert {"assumptions", "summary", "years", "warnings"} <= set(payload)
    assert len(payload["years"]) == 3


def test_process_body_returns_field_errors_for_invalid_request():
    status, payload = process_body(
        json.dumps(request(income={"base_salary": -1})).encode("utf-8")
    )
    assert status == 400
    assert any(error["field"] == "income.base_salary" for error in payload["errors"])
