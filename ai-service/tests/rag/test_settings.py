import pytest

from app.rag.settings import get_settings


def test_rag_confidence_thresholds_must_be_ordered(monkeypatch):
    monkeypatch.setenv("KB_CONFIDENCE_MEDIUM_SCORE", "0.85")
    monkeypatch.setenv("KB_CONFIDENCE_HIGH_SCORE", "0.80")

    with pytest.raises(ValueError, match="confidence_high_score"):
        get_settings()


def test_rag_confidence_minimum_result_count_must_be_positive(monkeypatch):
    monkeypatch.setenv("KB_CONFIDENCE_HIGH_MIN_RESULTS", "0")

    with pytest.raises(ValueError, match="confidence_high_min_results"):
        get_settings()
