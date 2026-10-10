"""Tests for the salary growth projection and its API body handling."""

import json

import pytest

from salary import process_body as salary_process_body
from salary_growth import compute_salary_growth, ValidationError


def request(**overrides):
    payload = {
        "currency": "USD",
        "duration_years": 3,
        "current_income": 5000,
        "income_frequency": "monthly",
        "increment_type": "percent",
        "min_increment": 3,
        "max_increment": 8,
    }
    payload.update(overrides)
    return payload


def field_errors(payload):
    with pytest.raises(ValidationError) as excinfo:
        compute_salary_growth(payload)
    return {error["field"]: error["message"] for error in excinfo.value.errors}


# ---------------------------------------------------------------------------
# Range mode
# ---------------------------------------------------------------------------


def test_percent_range_compounds():
    result = compute_salary_growth(request())
    incomes = [(entry["income_min_monthly"], entry["income_max_monthly"]) for entry in result["years"]]
    assert incomes[0] == pytest.approx((5150, 5400))
    assert incomes[2] == pytest.approx((5463.635, 6298.56))
    assert result["summary"]["end_income_min_monthly"] == pytest.approx(5463.635)
    assert result["summary"]["end_income_max_monthly"] == pytest.approx(6298.56)


def test_fixed_value_range_is_linear():
    payload = request(increment_type="fixed", min_increment=100, max_increment=300)
    result = compute_salary_growth(payload)
    incomes = [(entry["income_min_monthly"], entry["income_max_monthly"]) for entry in result["years"]]
    assert incomes == [
        (pytest.approx(5100), pytest.approx(5300)),
        (pytest.approx(5200), pytest.approx(5600)),
        (pytest.approx(5300), pytest.approx(5900)),
    ]
    assert result["years"][0]["increase_min"] == pytest.approx(100)
    assert result["years"][2]["increase_max"] == pytest.approx(300)


def test_yearly_increase_is_the_delta_from_the_previous_year():
    result = compute_salary_growth(request())
    assert result["years"][0]["increase_min"] == pytest.approx(150)
    assert result["years"][1]["increase_min"] == pytest.approx(5150 * 0.03)
    assert result["years"][2]["increase_max"] == pytest.approx(5400 * 1.08 * 1.08 - 5400 * 1.08)


def test_equal_low_and_high_estimates_give_identical_paths():
    result = compute_salary_growth(request(min_increment=5, max_increment=5))
    for entry in result["years"]:
        assert entry["income_min_monthly"] == pytest.approx(entry["income_max_monthly"])
    assert result["years"][2]["income_min_monthly"] == pytest.approx(5000 * 1.05 ** 3)


# ---------------------------------------------------------------------------
# Frequency normalization
# ---------------------------------------------------------------------------


def test_annual_income_input_is_normalized():
    result = compute_salary_growth(request(current_income=60000, income_frequency="annual"))
    assert result["assumptions"]["current_income_monthly"] == pytest.approx(5000)
    assert result["years"][0]["income_min_annual"] == pytest.approx(5150 * 12)


def test_annual_fixed_value_increment_is_a_monthly_twelfth():
    payload = request(
        current_income=60000,
        income_frequency="annual",
        increment_type="fixed",
        min_increment=1200,
        max_increment=2400,
    )
    result = compute_salary_growth(payload)
    assert result["years"][0]["income_min_monthly"] == pytest.approx(5100)
    assert result["years"][0]["income_max_monthly"] == pytest.approx(5200)


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------


def test_required_fields():
    assert "current_income" in field_errors(request(current_income=None))
    assert "current_income" in field_errors(request(current_income=""))
    assert "duration_years" in field_errors(request(duration_years=0))
    assert "income_frequency" in field_errors(request(income_frequency=None))
    assert "currency" in field_errors(request(currency=None))


def test_range_validation():
    assert "min_increment" in field_errors(request(min_increment=-1))
    errors = field_errors(request(min_increment=9, max_increment=3))
    assert "max_increment" in errors
    assert "at least the minimum" in errors["max_increment"]
    assert "increment_type" in field_errors(request(increment_type="daily"))


def test_zero_income_gives_zero_growth_percent():
    result = compute_salary_growth(request(current_income=0))
    assert result["summary"]["growth_percent_max"] == 0
    assert result["years"][0]["income_min_monthly"] == 0


# ---------------------------------------------------------------------------
# API body handling
# ---------------------------------------------------------------------------


def test_salary_process_body_rejects_malformed_json():
    status, payload = salary_process_body(b"{not json")
    assert status == 400
    assert "error" in payload


def test_salary_process_body_returns_result_for_valid_request():
    status, payload = salary_process_body(json.dumps(request()).encode("utf-8"))
    assert status == 200
    assert {"assumptions", "summary", "years", "warnings"} <= set(payload)
    assert len(payload["years"]) == 3


def test_salary_process_body_returns_field_errors():
    status, payload = salary_process_body(
        json.dumps(request(current_income=-1)).encode("utf-8")
    )
    assert status == 400
    assert any(error["field"] == "current_income" for error in payload["errors"])
