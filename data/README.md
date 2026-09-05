# Data Center Thermal Telemetry Dataset

## 1. Dataset Name and Source

- **Dataset Name:** Data Centre Warm Channel Temperature prediction
- **Source:** Kaggle (`mbjunior/data-centre-hot-corridor-temperature-prediction`)
- **Origin Context:** Operational telemetry recording temperatures and power consumption in the hot corridor of a data center located in an office building.
- **Author/Uploader:** `mbjunior` (Kaggle)

## 2. License

- **License:** Unknown / Unspecified on Kaggle.
- **Citation Request:** The dataset description requests citing the corresponding academic publication detailing the office building data center deployment.

## 3. Download Instructions

To download and place this dataset manually:
1. Ensure the Kaggle CLI is configured or visit the Kaggle page:
   `https://www.kaggle.com/datasets/mbjunior/data-centre-hot-corridor-temperature-prediction`
2. Download the dataset archive.
3. Extract `final_dataset_std.csv` into the local repository under:
   `data/raw/final_dataset_std.csv`
4. Note that `data/raw/` is listed in `.gitignore` to prevent raw data files from being tracked in git.

## 4. Files Expected Locally

- `data/raw/final_dataset_std.csv`: A semicolon-separated CSV file containing 27,013 observations across 43 features.

## 5. Relevant Columns and Units

All continuous telemetry variables are **standardized via z-score normalization** ($\mu = 0, \sigma = 1$). Original physical units reported in the data card prior to standardization are listed below:

| Column Name(s) | Role in Physical Telemetry | Original Units | Standardized Representation |
|:---|:---|:---:|:---:|
| `P_cu-0` to `P_cu-7` | Power consumption of computing units (IT workload) across 8 sliding-window lags ($t, t-1, \dots, t-7$) | kW | Dimensionless z-score ($\mu=0, \sigma=1$) |
| `P_ac-0` to `P_ac-7` | Electrical power consumption of air conditioning / cooling units across 8 lags ($t, t-1, \dots, t-7$) | kW | Dimensionless z-score ($\mu=0, \sigma=1$) |
| `T_out-0` to `T_out-7` | Outdoor ambient temperature outside the office building across 8 lags ($t, t-1, \dots, t-7$) | °C | Dimensionless z-score ($\mu=0, \sigma=1$) |
| `T_MEAS-0` to `T_MEAS-7` | Air temperature measured by air conditioning return sensors across 8 lags ($t, t-1, \dots, t-7$) | °C | Dimensionless z-score ($\mu=0, \sigma=1$) |
| `T_celCC-0` to `T_celCC-7` | Air temperature measured under the ceiling of the cold corridor across 8 lags ($t, t-1, \dots, t-7$) | °C | Dimensionless z-score ($\mu=0, \sigma=1$) |
| `TLHC` | Temperature of the Left Hot Corridor (warm exhaust air) at step $t$ | °C | Dimensionless z-score ($\mu=0, \sigma=1$) |
| `DoW` | Day of Week (discrete integer 0–6) | Categorical | Untransformed integer (0 = Monday ... 6 = Sunday) |
| `WeH` | Working day vs. Weekend/Holiday flag | Binary | Untransformed binary (1 = weekday, 0 = weekend/holiday) |

*Note: Suffixes `-0` through `-7` represent an autoregressive history of 8 consecutive 15-minute samples (spanning 2 hours of history for a single facility), NOT 8 separate spatial zones.*

## 6. Limitations and Scientific Constraints

1. **Loss of Physical Scales (Standardization):**
   The dataset only provides z-scores. The scaling factors (empirical mean $\mu$ and standard deviation $\sigma$ for temperatures, IT power, and cooling power) were not released with the dataset. Fitting physical coefficients ($a, b, g$) in °C / kW on dimensionless numbers is unphysical.

2. **Temporal Resolution (15 minutes vs. 1 minute):**
   The sampling interval is **15 minutes** (96 samples per day). The digital twin simulator operates on **1-minute control intervals** ($\Delta t = 60$ s). Transient dynamics over 15 minutes represent quasi-steady thermal equilibrium rather than dynamic 60-second actuation responses.

3. **Closed-Loop Observational Confounding:**
   The data reflects an operational data center under active feedback control. When IT load or ambient temperature heats the corridor, the AC system turns on and consumes *more* electrical power ($P_{\text{ac}}$). Without open-loop experimental perturbation, $P_{\text{ac}}$ is positively correlated with temperature, causing naive regression to yield negative cooling effectiveness ($b < 0$), falsely implying cooling heats up the room.

4. **Single-Zone vs. Multi-Zone Spatial Architecture:**
   The dataset captures a single hot corridor in an office building. It contains no spatial topology, inter-zone thermal coupling, or workload migration telemetry between distinct compute zones.

5. **Exhaust (Hot Corridor) vs. IT Inlet Temperatures:**
   The target variable `TLHC` measures hot exhaust air in the hot aisle, whereas the project simulator models IT rack inlet temperatures governed by ASHRAE Class A2 specifications (18–27°C recommended, 35°C allowable max).
