"""
Log detailed workload migration events around an unseen failure scenario.
"""

from pathlib import Path
import sys
REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

import numpy as np
from engine.physics.thermal_model import ThermalConfig
from engine.env import DataCenterEnv
from engine.control.joint_rl import JointRLWrapper, load_model, CHECKPOINT_PATH

cfg = ThermalConfig.from_config_dir()
base_env = DataCenterEnv(config=cfg)

# Unseen failure: Zone 3 failure at step 40 with 50% capacity
wrapped_env = JointRLWrapper(base_env, apply_shield=True, training=False)
wrapped_env._failure_zone = 3
wrapped_env._failure_step = 40
wrapped_env._failure_capacity = 0.50

model = load_model(CHECKPOINT_PATH)
obs, info = wrapped_env.reset(seed=1337)
done = False
step = 0

print(f"Tracking Workload Migrations around Unseen Failure (Zone 3 failure at t=40, cap=0.50):")
print(f"{'Step':<6} {'Event':<20} {'From':<6} {'To':<6} {'Amount':<8} {'Zone 3 Temp':<14} {'Zone 3 Load':<12} {'Cooling':<10}")
print("-" * 84)

while not done and step < 80:
    action, _ = model.predict(obs, deterministic=True)
    obs, rew, term, trunc, step_info = wrapped_env.step(action)
    done = term or trunc
    step += 1

    mig = step_info["executed_migration"]
    z3_temp = base_env._temperatures[3]
    z3_load = base_env._workloads[3]
    z3_cool = step_info["applied_cooling"][3]

    event_str = "Pre-failure" if step < 40 else ("FAILURE TRIGGER" if step == 40 else "Post-failure")
    if mig["amount"] > 1e-4 or step in [38, 39, 40, 41, 42, 45, 50]:
        print(
            f"{step:<6} {event_str:<20} {mig['from_zone']:<6} {mig['to_zone']:<6} "
            f"{mig['amount']:<8.4f} {z3_temp:<14.2f}C {z3_load:<12.3f} {z3_cool:<10.3f}"
        )
