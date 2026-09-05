"""Model loader and registry for pretrained RL checkpoints.

Loads models once at application startup. Never triggers live training.
Caches both PPO model objects and supporting wrappers.
"""

from __future__ import annotations

from pathlib import Path
from typing import Optional

from engine.physics.thermal_model import ThermalConfig
from engine.control.rule_based import RuleBasedController
from engine.control.cooling_only_rl import (
    CoolingOnlyWrapper,
    load_model as load_cooling_only_model,
    CHECKPOINT_PATH as COOLING_ONLY_CHECKPOINT,
)
from engine.control.joint_rl import (
    JointRLWrapper,
    load_model as load_joint_model,
    CHECKPOINT_PATH as JOINT_CHECKPOINT,
)


class ModelRegistry:
    """Singleton-style registry holding all pretrained controllers.

    Attributes
    ----------
    cooling_only_model : PPO model loaded from models/checkpoints/cooling_only_rl.zip
    joint_rl_model     : PPO model loaded from models/checkpoints/joint_rl_v2.zip
    cfg                : ThermalConfig loaded from config/topology.json + thresholds.json
    """

    def __init__(self) -> None:
        self.cfg: Optional[ThermalConfig] = None
        self.cooling_only_model = None
        self.joint_rl_model = None
        self._loaded = False

    def load(self) -> None:
        """Load all models from disk. Called once during FastAPI lifespan."""
        if self._loaded:
            return

        self.cfg = ThermalConfig.from_config_dir()

        # Load cooling-only PPO checkpoint
        # Actual path: models/checkpoints/cooling_only_rl.zip
        co_path = COOLING_ONLY_CHECKPOINT
        if not co_path.exists():
            raise FileNotFoundError(f"Cooling-only checkpoint not found: {co_path}")
        self.cooling_only_model = load_cooling_only_model(co_path)

        # Load joint RL PPO checkpoint
        # Actual path: models/checkpoints/joint_rl_v2.zip
        jt_path = JOINT_CHECKPOINT
        if not jt_path.exists():
            raise FileNotFoundError(f"Joint RL checkpoint not found: {jt_path}")
        self.joint_rl_model = load_joint_model(jt_path)

        self._loaded = True

    @property
    def models_loaded(self) -> dict[str, bool]:
        """Return a map of controller name -> whether model is loaded."""
        return {
            "rule_based": True,  # No model file needed
            "cooling_only_rl": self.cooling_only_model is not None,
            "joint_rl": self.joint_rl_model is not None,
        }


# Module-level singleton
registry = ModelRegistry()
