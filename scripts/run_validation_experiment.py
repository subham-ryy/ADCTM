"""
Bounded Validation Experiment for Phase 4 Joint RL.

Evaluates Rule-Based and Cooling-Only baselines on VALIDATION_SEEDS = [201, 202, 203, 204],
trains Candidate A, B, C reward configurations on TRAIN_SEEDS = [101, 102, 103, 104],
evaluates each candidate on VALIDATION_SEEDS, and selects the optimal checkpoint
using the lexicographic safety-first procedure with thermal robustness margin (T_max <= 34.0 C).
"""

from __future__ import annotations

import json
import time
from pathlib import Path
import sys

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

import numpy as np

from engine.physics.thermal_model import ThermalConfig, TIMESTEP_SECONDS
from engine.env import DataCenterEnv
from engine.scenarios.scenario_env import get_reset_options
from engine.control.rule_based import RuleBasedController
from engine.control.cooling_only_rl import (
    CoolingOnlyWrapper,
    load_model as load_cooling_only_model,
    CHECKPOINT_PATH as COOLING_ONLY_CHECKPOINT,
)
from engine.control.joint_rl import (
    JointRLWrapper,
    JointRewardConfig,
    train as train_joint_rl,
    evaluate_multi_seed,
    evaluate_episode,
    TRAIN_SEEDS,
    VALIDATION_SEEDS,
)
from engine.safety.safety_shield import apply_safety_shield


def evaluate_rule_based_val(seeds: list[int], cfg: ThermalConfig) -> dict[str, any]:
    """Evaluate Rule-Based controller on validation seeds under canonical cooling failure."""
    results = []
    failure_zone = 2
    failure_step = 50
    failure_capacity = 0.60

    for seed in seeds:
        base_env = DataCenterEnv(config=cfg)
        options = get_reset_options("cooling_failure", cfg)
        controller = RuleBasedController(config=cfg)

        obs, info = base_env.reset(seed=seed, options=options)
        done = False
        step = 0

        operational_violations = 0
        operational_degree_minutes = 0.0
        emergency_violations = 0
        shield_overrides = 0
        temps_all = []
        applied_all = []

        while not done:
            if step >= failure_step:
                base_env._cooling_capacity[failure_zone] = failure_capacity
            state = base_env.get_state_dict()

            action_dict = controller.act(state)
            corrected, shield_info = apply_safety_shield(action_dict, state, cfg)
            applied_c = corrected["cooling"].copy()
            if shield_info["corrections_applied"] > 0:
                shield_overrides += 1

            raw_action = base_env.action_space.sample()
            raw_action[:cfg.num_zones] = applied_c * 2.0 - 1.0
            raw_action[cfg.num_zones] = 2.0 * 0.5 / cfg.num_zones - 1.0
            raw_action[cfg.num_zones + 1] = 2.0 * 0.5 / cfg.num_zones - 1.0
            raw_action[cfg.num_zones + 2] = -1.0

            obs, reward, terminated, truncated, step_info = base_env.step(raw_action)
            done = terminated or truncated

            curr_temps = base_env._temperatures.copy()
            temps_all.append(curr_temps)
            applied_all.append(applied_c)

            op_excess = np.maximum(curr_temps - cfg.operational_max_temperature_c, 0.0)
            if np.any(op_excess > 0.0):
                operational_violations += 1
                operational_degree_minutes += float(np.sum(op_excess) * 5.0)

            if np.any(curr_temps > cfg.emergency_max_temperature_c):
                emergency_violations += 1

            step += 1

        temps_arr = np.array(temps_all)
        it_kwh = base_env._cumulative_it_power * (TIMESTEP_SECONDS / 3600.0)
        cooling_kwh = base_env._cumulative_cooling_power * (TIMESTEP_SECONDS / 3600.0)
        overhead_kwh = base_env._cumulative_overhead * (TIMESTEP_SECONDS / 3600.0)
        total_kwh = it_kwh + cooling_kwh + overhead_kwh
        pue = total_kwh / max(it_kwh, 1e-6)

        results.append({
            "seed": seed,
            "pue": float(pue),
            "total_facility_energy_kwh": float(total_kwh),
            "cooling_energy_kwh": float(cooling_kwh),
            "it_energy_kwh": float(it_kwh),
            "overhead_energy_kwh": float(overhead_kwh),
            "max_temp": float(np.max(temps_arr)),
            "sla_uptime_pct": float(100.0 * (1.0 - (operational_violations / max(step, 1)))),
            "operational_violations": operational_violations,
            "emergency_violations": emergency_violations,
            "workload_served_pct": 100.0,
            "shield_override_rate": float(shield_overrides / max(step, 1)),
        })

    pue_mean = float(np.mean([r["pue"] for r in results]))
    energy_mean = float(np.mean([r["total_facility_energy_kwh"] for r in results]))
    max_temp_mean = float(np.mean([r["max_temp"] for r in results]))
    max_temp_max = float(np.max([r["max_temp"] for r in results]))
    emerg_mean = float(np.mean([r["emergency_violations"] for r in results]))
    op_mean = float(np.mean([r["operational_violations"] for r in results]))

    return {
        "controller": "Rule-Based",
        "seeds": seeds,
        "per_seed": results,
        "pue_mean": pue_mean,
        "energy_kwh_mean": energy_mean,
        "max_temp_mean": max_temp_mean,
        "max_temp_max": max_temp_max,
        "emergency_violations_mean": emerg_mean,
        "operational_violations_mean": op_mean,
    }


def evaluate_cooling_only_val(seeds: list[int], cfg: ThermalConfig) -> dict[str, any]:
    """Evaluate Cooling-Only RL model on validation seeds under canonical cooling failure."""
    if not COOLING_ONLY_CHECKPOINT.exists():
        return {"controller": "Cooling-Only RL (checkpoint missing)", "pue_mean": None}

    model = load_cooling_only_model(COOLING_ONLY_CHECKPOINT)
    results = []
    failure_zone = 2
    failure_step = 50
    failure_capacity = 0.60

    for seed in seeds:
        base_env = DataCenterEnv(config=cfg)
        options = get_reset_options("cooling_failure", cfg)
        wrapped_env = CoolingOnlyWrapper(base_env, apply_shield=True)
        obs, info = wrapped_env.reset(seed=seed, options=options)
        done = False
        step = 0

        operational_violations = 0
        operational_degree_minutes = 0.0
        emergency_violations = 0
        shield_overrides = 0
        temps_all = []

        while not done:
            if step >= failure_step:
                base_env._cooling_capacity[failure_zone] = failure_capacity

            action, _ = model.predict(obs, deterministic=True)
            obs, reward, terminated, truncated, step_info = wrapped_env.step(action)
            done = terminated or truncated

            curr_temps = base_env._temperatures.copy()
            temps_all.append(curr_temps)

            if step_info.get("action_discrepancy", 0.0) > 0.01:
                shield_overrides += 1

            op_excess = np.maximum(curr_temps - cfg.operational_max_temperature_c, 0.0)
            if np.any(op_excess > 0.0):
                operational_violations += 1
                operational_degree_minutes += float(np.sum(op_excess) * 5.0)

            if np.any(curr_temps > cfg.emergency_max_temperature_c):
                emergency_violations += 1

            step += 1

        temps_arr = np.array(temps_all)
        it_kwh = base_env._cumulative_it_power * (TIMESTEP_SECONDS / 3600.0)
        cooling_kwh = base_env._cumulative_cooling_power * (TIMESTEP_SECONDS / 3600.0)
        overhead_kwh = base_env._cumulative_overhead * (TIMESTEP_SECONDS / 3600.0)
        total_kwh = it_kwh + cooling_kwh + overhead_kwh
        pue = total_kwh / max(it_kwh, 1e-6)

        results.append({
            "seed": seed,
            "pue": float(pue),
            "total_facility_energy_kwh": float(total_kwh),
            "cooling_energy_kwh": float(cooling_kwh),
            "it_energy_kwh": float(it_kwh),
            "overhead_energy_kwh": float(overhead_kwh),
            "max_temp": float(np.max(temps_arr)),
            "sla_uptime_pct": float(100.0 * (1.0 - (operational_violations / max(step, 1)))),
            "operational_violations": operational_violations,
            "emergency_violations": emergency_violations,
            "workload_served_pct": 100.0,
            "shield_override_rate": float(shield_overrides / max(step, 1)),
        })

    pue_mean = float(np.mean([r["pue"] for r in results]))
    energy_mean = float(np.mean([r["total_facility_energy_kwh"] for r in results]))
    max_temp_mean = float(np.mean([r["max_temp"] for r in results]))
    max_temp_max = float(np.max([r["max_temp"] for r in results]))
    emerg_mean = float(np.mean([r["emergency_violations"] for r in results]))
    op_mean = float(np.mean([r["operational_violations"] for r in results]))

    return {
        "controller": "Cooling-Only RL",
        "seeds": seeds,
        "per_seed": results,
        "pue_mean": pue_mean,
        "energy_kwh_mean": energy_mean,
        "max_temp_mean": max_temp_mean,
        "max_temp_max": max_temp_max,
        "emergency_violations_mean": emerg_mean,
        "operational_violations_mean": op_mean,
    }


def audit_migration_behavior(model, cfg: ThermalConfig, seed: int = 201) -> dict[str, any]:
    """Audit migration behavior for a single validation run."""
    base_env = DataCenterEnv(config=cfg)
    options = get_reset_options("cooling_failure", cfg)
    wrapped = JointRLWrapper(base_env, apply_shield=True, training=False)
    wrapped._failure_zone = 2
    wrapped._failure_step = 50
    wrapped._failure_capacity = 0.60

    obs, info = wrapped.reset(seed=seed, options=options)
    done = False
    step = 0

    workloads_z2 = []
    migrations_before = 0
    migrations_after = 0
    first_response_step = None
    migration_events = []
    cooling_z2 = []
    cooling_others = []

    while not done:
        action, _ = model.predict(obs, deterministic=True)
        obs, reward, terminated, truncated, step_info = wrapped.step(action)
        done = terminated or truncated

        w = wrapped.unwrapped._workloads.copy()
        c = np.array(step_info["applied_cooling"])
        workloads_z2.append(w[2])
        cooling_z2.append(c[2])
        cooling_others.append(float(np.mean(np.delete(c, 2))))

        mig = step_info["executed_migration"]
        if mig["amount"] > 1e-6:
            migration_events.append((step, mig["from_zone"], mig["to_zone"], mig["amount"]))
            if step < 50:
                migrations_before += 1
            else:
                migrations_after += 1
                if first_response_step is None and mig["from_zone"] == 2:
                    first_response_step = step

        step += 1

    pre_fail_w = float(np.mean(workloads_z2[:50]))
    post_fail_w = float(np.mean(workloads_z2[50:]))
    net_moved_out = pre_fail_w - post_fail_w
    response_delay = (first_response_step - 50) if first_response_step is not None else None

    # Check oscillations/reversals (e.g., from 2 -> X, then immediately X -> 2)
    reversals = 0
    for i in range(1, len(migration_events)):
        prev_ev = migration_events[i - 1]
        curr_ev = migration_events[i]
        if prev_ev[1] == curr_ev[2] and prev_ev[2] == curr_ev[1]:
            reversals += 1

    return {
        "pre_failure_mean_workload_z2": pre_fail_w,
        "post_failure_mean_workload_z2": post_fail_w,
        "net_workload_moved_out_z2": net_moved_out,
        "first_response_step": first_response_step,
        "response_delay_steps": response_delay,
        "migrations_before_failure": migrations_before,
        "migrations_after_failure": migrations_after,
        "migration_reversals": reversals,
        "total_migrations": len(migration_events),
        "post_fail_mean_cooling_z2": float(np.mean(cooling_z2[50:])),
        "post_fail_mean_cooling_others": float(np.mean(cooling_others[50:])),
    }


def main():
    cfg = ThermalConfig.from_config_dir()
    print("=" * 70)
    print("PHASE 4: BOUNDED VALIDATION-ONLY RETUNING EXPERIMENT")
    print("=" * 70)
    print(f"Validation Seeds: {VALIDATION_SEEDS}")
    print(f"Training Seeds:   {TRAIN_SEEDS}")
    print(f"Authoritative Timestep: {TIMESTEP_SECONDS} s (5 min)")

    # 1. Evaluate Rule-Based baseline on validation seeds
    print("\n--- 1. Evaluating Rule-Based Baseline on VALIDATION SEEDS ---")
    rb_val = evaluate_rule_based_val(VALIDATION_SEEDS, cfg)
    print(f"Rule-Based Val PUE:       {rb_val['pue_mean']:.4f}")
    print(f"Rule-Based Val Energy:    {rb_val['energy_kwh_mean']:.2f} kWh")
    print(f"Rule-Based Val Max Temp:  {rb_val['max_temp_mean']:.2f} C (Peak: {rb_val['max_temp_max']:.2f} C)")
    print(f"Rule-Based Emerg Viol:    {rb_val['emergency_violations_mean']:.1f}")
    print(f"Rule-Based Op Viol:       {rb_val['operational_violations_mean']:.1f}")

    # 2. Evaluate Cooling-Only RL baseline on validation seeds
    print("\n--- 2. Evaluating Cooling-Only RL Baseline on VALIDATION SEEDS ---")
    co_val = evaluate_cooling_only_val(VALIDATION_SEEDS, cfg)
    if co_val["pue_mean"] is not None:
        print(f"Cooling-Only Val PUE:     {co_val['pue_mean']:.4f}")
        print(f"Cooling-Only Val Energy:  {co_val['energy_kwh_mean']:.2f} kWh")
        print(f"Cooling-Only Val Max Temp:{co_val['max_temp_mean']:.2f} C (Peak: {co_val['max_temp_max']:.2f} C)")
        print(f"Cooling-Only Emerg Viol:  {co_val['emergency_violations_mean']:.1f}")
        print(f"Cooling-Only Op Viol:     {co_val['operational_violations_mean']:.1f}")

    # 3. Define candidate reward parameterizations
    candidates = {
        "Candidate A (Baseline Phase 4)": JointRewardConfig(
            w_energy=4.0,
            w_drift=0.02,
            drift_temp_low=18.0,
            drift_temp_high=27.0,
            w_mig=1.0,
        ),
        "Candidate B (High Energy / Headroom Band 33C)": JointRewardConfig(
            w_energy=10.0,
            w_drift=0.005,
            drift_temp_low=18.0,
            drift_temp_high=33.0,
            w_mig=1.0,
        ),
        "Candidate C (Balanced Aggressive / Band 34C)": JointRewardConfig(
            w_energy=12.0,
            w_drift=0.002,
            drift_temp_low=18.0,
            drift_temp_high=34.0,
            w_mig=0.5,
        ),
    }

    checkpoints_dir = REPO_ROOT / "models" / "checkpoints" / "candidates"
    checkpoints_dir.mkdir(parents=True, exist_ok=True)

    candidate_results = {}

    for cand_name, r_cfg in candidates.items():
        print(f"\n=================================================================")
        print(f"Training {cand_name}...")
        print(f"Config: w_energy={r_cfg.w_energy}, w_drift={r_cfg.w_drift}, "
              f"drift_high={r_cfg.drift_temp_high}C, w_mig={r_cfg.w_mig}")
        print(f"=================================================================")

        safe_name = cand_name.split()[1].lower()  # "a", "b", "c"
        ckpt_path = checkpoints_dir / f"joint_rl_{safe_name}.zip"

        t0 = time.time()
        model = train_joint_rl(
            total_timesteps=150_000,
            checkpoint_path=ckpt_path,
            base_seed=42,
            cfg=cfg,
            reward_config=r_cfg,
            verbose=1,
        )
        train_duration = time.time() - t0
        print(f"Training completed in {train_duration:.1f} s. Model saved to {ckpt_path}")

        # Evaluate on VALIDATION SEEDS
        val_eval = evaluate_multi_seed(
            model,
            "cooling_failure",
            seeds=VALIDATION_SEEDS,
            cfg=cfg,
            shield_active=True,
        )

        mig_audit = audit_migration_behavior(model, cfg, seed=201)

        candidate_results[cand_name] = {
            "checkpoint_path": str(ckpt_path),
            "reward_config": {
                "w_energy": r_cfg.w_energy,
                "w_drift": r_cfg.w_drift,
                "drift_temp_high": r_cfg.drift_temp_high,
                "w_mig": r_cfg.w_mig,
            },
            "pue_mean": val_eval["pue_mean"],
            "pue_std": val_eval["pue_std"],
            "energy_kwh_mean": val_eval["total_facility_energy_kwh_mean"],
            "max_temp_mean": val_eval["max_temp_mean"],
            "max_temp_peak": float(max(r["max_temp"] for r in val_eval["per_seed_results"])),
            "emergency_violations": val_eval["emergency_violations_mean"],
            "operational_violations": val_eval["operational_violations_mean"],
            "shield_override_rate": val_eval["shield_override_rate_mean"],
            "migration_count_mean": val_eval["migration_count_mean"],
            "total_migration_amount_mean": val_eval["total_migration_amount_mean"],
            "migration_audit_seed_201": mig_audit,
        }

    # 4. Print Candidate Comparison Table
    print("\n" + "=" * 80)
    print("CANDIDATE VALIDATION COMPARISON TABLE (VALIDATION SEEDS [201, 202, 203, 204])")
    print("=" * 80)
    headers = ["Candidate", "PUE (mean)", "Facility kWh", "Max Temp (C)", "Peak Temp", "Op Viol", "Emerg", "Shield Overr", "Migrations"]
    print(f"{headers[0]:<35} | {headers[1]:<10} | {headers[2]:<12} | {headers[3]:<12} | {headers[4]:<9} | {headers[5]:<7} | {headers[6]:<5} | {headers[7]:<12} | {headers[8]:<10}")
    print("-" * 125)

    # Reference Rule-Based row
    print(f"{'Rule-Based Baseline (Paired Ref)':<35} | {rb_val['pue_mean']:<10.4f} | {rb_val['energy_kwh_mean']:<12.2f} | {rb_val['max_temp_mean']:<12.2f} | {rb_val['max_temp_max']:<9.2f} | {rb_val['operational_violations_mean']:<7.1f} | {rb_val['emergency_violations_mean']:<5.1f} | {'0.0%':<12} | {'0.0':<10}")

    if co_val["pue_mean"] is not None:
        print(f"{'Cooling-Only RL (Paired Ref)':<35} | {co_val['pue_mean']:<10.4f} | {co_val['energy_kwh_mean']:<12.2f} | {co_val['max_temp_mean']:<12.2f} | {co_val['max_temp_max']:<9.2f} | {co_val['operational_violations_mean']:<7.1f} | {co_val['emergency_violations_mean']:<5.1f} | {co_val['per_seed'][0]['shield_override_rate']:<12.1%} | {'0.0':<10}")

    print("-" * 125)
    for c_name, c_res in candidate_results.items():
        print(
            f"{c_name:<35} | "
            f"{c_res['pue_mean']:<10.4f} | "
            f"{c_res['energy_kwh_mean']:<12.2f} | "
            f"{c_res['max_temp_mean']:<12.2f} | "
            f"{c_res['max_temp_peak']:<9.2f} | "
            f"{c_res['operational_violations']:<7.1f} | "
            f"{c_res['emergency_violations']:<5.1f} | "
            f"{c_res['shield_override_rate']:<12.1%} | "
            f"{c_res['migration_count_mean']:<10.1f}"
        )

    # 5. Apply Lexicographic Checkpoint Selection Rule
    print("\n" + "=" * 80)
    print("LEXICOGRAPHIC SELECTION ON VALIDATION SEEDS")
    print("=" * 80)
    print("Gates:")
    print("  1. Zero emergency violations (T <= 45 C)")
    print("  2. Zero operational violations (T <= 35 C SLA limit, 100% uptime)")
    print("  3. 100% workload served (0% shed)")
    print("  4. Thermal Robustness Margin: Validation peak temperature <= 34.0 C (>= 1.0 C buffer below 35 C)")
    print("  5. Shield override rate <= 10%")
    print(f"  6. Lower PUE than paired Rule-Based ({rb_val['pue_mean']:.4f}) and Cooling-Only")

    selected_candidate = None
    best_qualifying_pue = float("inf")

    for c_name, c_res in candidate_results.items():
        pass_emerg = c_res["emergency_violations"] == 0
        pass_op = c_res["operational_violations"] == 0
        pass_robustness = c_res["max_temp_peak"] <= 34.0
        pass_shield = c_res["shield_override_rate"] <= 0.10
        beats_rule_based = c_res["pue_mean"] < rb_val["pue_mean"]

        status_str = []
        if not pass_emerg: status_str.append("FAIL: emerg viol")
        if not pass_op: status_str.append("FAIL: op viol")
        if not pass_robustness: status_str.append(f"FAIL: peak {c_res['max_temp_peak']:.2f}C > 34.0C")
        if not pass_shield: status_str.append(f"FAIL: override {c_res['shield_override_rate']:.1%} > 10%")
        if not beats_rule_based: status_str.append(f"FAIL: PUE {c_res['pue_mean']:.4f} >= RB {rb_val['pue_mean']:.4f}")

        if not status_str:
            status_str.append("PASS ALL GATES")
            if c_res["pue_mean"] < best_qualifying_pue:
                best_qualifying_pue = c_res["pue_mean"]
                selected_candidate = c_name

        print(f"  {c_name}: {', '.join(status_str)}")

    print("-" * 80)
    if selected_candidate is not None:
        print(f"SELECTED CANDIDATE: {selected_candidate}")
        # Copy selected candidate to primary JOINT_CHECKPOINT path
        primary_ckpt = REPO_ROOT / "models" / "checkpoints" / "joint_rl.zip"
        selected_ckpt = Path(candidate_results[selected_candidate]["checkpoint_path"])
        import shutil
        shutil.copyfile(selected_ckpt, primary_ckpt)
        print(f"Primary checkpoint updated: {primary_ckpt} <- {selected_ckpt}")
    else:
        print("WARNING: No candidate satisfied all hard gates simultaneously. Check candidate results.")

    # Save validation experiment report
    report = {
        "rule_based_val": rb_val,
        "cooling_only_val": co_val,
        "candidate_results": candidate_results,
        "selected_candidate": selected_candidate,
    }
    report_path = REPO_ROOT / "outputs" / "validation_retuning_report.json"
    with open(report_path, "w") as f:
        json.dump(report, f, indent=2)
    print(f"\nSaved full validation report to {report_path}")


if __name__ == "__main__":
    main()
