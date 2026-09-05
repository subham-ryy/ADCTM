"""
Unit tests for Real-Data Calibration and Validation Gate.

Tests verification of:
1. Thermal standards and documentation corrections.
2. .gitignore rules for data/raw/.
3. data/README.md completeness.
4. Chronological splitting integrity without row mixing.
5. Physical plausibility check and closed-loop confounding detection.
6. Calibration parameter export integrity without simulator config overwrite.
"""

import json
from pathlib import Path
import numpy as np
import pytest

from engine.physics.thermal_model import ThermalConfig
from benchmarks.calibrate_dataset import (
    chronological_split,
    fit_thermal_parameters,
    check_physical_plausibility,
    CALIBRATED_CONFIG_PATH,
    DATA_PATH,
)

REPO_ROOT = Path(__file__).resolve().parents[2]


class TestThermalDocumentationCorrections:
    """Validate corrections to thermal standard documentation."""

    def test_thresholds_json_terminology(self):
        thresholds_file = REPO_ROOT / "config" / "thresholds.json"
        assert thresholds_file.exists()
        with open(thresholds_file, "r", encoding="utf-8") as f:
            data = json.load(f)

        doc = data.get("documentation", {})
        # Check Class A2
        assert "Class A2" in doc.get("operational_max_temperature_c", "")
        # Check 22C within 18-27C
        assert "18-27C" in doc.get("target_temperature_c", "")
        # Check project-defined emergency threshold
        assert "Project-defined" in doc.get("emergency_max_temperature_c", "")
        # Check simulated IT inlet/zone temperature mention
        assert "simulated IT inlet/zone" in doc.get("target_temperature_c", "")

    def test_thermal_model_config_integrity(self):
        cfg = ThermalConfig.from_config_dir()
        assert cfg.target_temperature_c == 22.0
        assert cfg.operational_max_temperature_c == 35.0
        assert cfg.emergency_max_temperature_c == 45.0
        # Check simulator baseline parameters were preserved
        assert cfg.a == 5.0
        assert cfg.b == 6.0
        assert cfg.g == 0.02


class TestRepositoryAndDataHygiene:
    """Validate repository hygiene and documentation."""

    def test_gitignore_contains_data_raw(self):
        gitignore = REPO_ROOT / ".gitignore"
        assert gitignore.exists()
        content = gitignore.read_text(encoding="utf-8")
        assert "data/raw/" in content

    def test_data_readme_contents(self):
        readme = REPO_ROOT / "data" / "README.md"
        assert readme.exists()
        text = readme.read_text(encoding="utf-8")
        assert "Data Centre Warm Channel Temperature prediction" in text
        assert "License" in text
        assert "Download Instructions" in text
        assert "Relevant Columns and Units" in text
        assert "Limitations" in text
        assert "15 minutes" in text
        assert "standardized" in text.lower()


class TestCalibrationLogic:
    """Validate mathematical and physical logic of calibration gate."""

    def test_chronological_split_contiguous(self):
        import pandas as pd
        dummy_df = pd.DataFrame({"val": np.arange(100)})
        train, val, test = chronological_split(dummy_df, train_ratio=0.70, val_ratio=0.15)

        assert len(train) == 70
        assert len(val) == 15
        assert len(test) == 15
        assert train["val"].iloc[-1] == 69
        assert val["val"].iloc[0] == 70
        assert val["val"].iloc[-1] == 84
        assert test["val"].iloc[0] == 85
        assert test["val"].iloc[-1] == 99

    def test_physical_plausibility_detects_unphysical_cooling(self):
        # b <= 0 means cooling heats up the room
        unphysical_params = {"a": 0.05, "b": -0.04, "g": 0.02, "bias": 0.0}
        is_valid, reasons = check_physical_plausibility(unphysical_params)
        assert not is_valid
        assert any("Cooling coefficient b" in r for r in reasons)

    def test_physical_plausibility_detects_unphysical_workload(self):
        # a <= 0 means workload cools down the room
        unphysical_params = {"a": -0.01, "b": 0.05, "g": 0.02, "bias": 0.0}
        is_valid, reasons = check_physical_plausibility(unphysical_params)
        assert not is_valid
        assert any("Workload coefficient a" in r for r in reasons)

    def test_calibrated_parameters_record(self):
        assert CALIBRATED_CONFIG_PATH.exists()
        with open(CALIBRATED_CONFIG_PATH, "r", encoding="utf-8") as f:
            rec = json.load(f)

        assert rec["validation_decision"]["status"] == "REJECTED"
        assert rec["validation_decision"]["phase3_retraining_required"] is False
        assert "held_out_evaluation" in rec
        assert rec["held_out_evaluation"]["one_step_mae"] > 0
        assert rec["held_out_evaluation"]["rollout_mae"] > 0
