import React from 'react'
import {
  useSimulationState,
  simulationStore,
  getTemperatureColor,
  getWorkloadColor,
  getHealthColor,
  COOLING_TOPOLOGY,
} from '../../state/simulationStore'

/**
 * InspectionPanel renders a rich enterprise-grade telemetry flyout
 * for the selected ServerRack or CRACUnit.
 */
export default function InspectionPanel() {
  const { racks, cracs, selectedRackId, selectedCracId } = useSimulationState()

  const selectedRack = racks.find((r) => r.id === selectedRackId)
  const selectedCrac = cracs.find((c) => c.id === selectedCracId)

  if (!selectedRack && !selectedCrac) return null

  // =========================================================================
  // 1. RACK INSPECTION PANEL
  // =========================================================================
  if (selectedRack) {
    const tempColor = getTemperatureColor(selectedRack.temp)
    const workloadColor = getWorkloadColor(selectedRack.workload)
    const healthColor = getHealthColor(selectedRack.health)

    const isRestricted = selectedRack.airflow === 'RESTRICTED'

    const statusBadgeBg =
      selectedRack.status === 'CRITICAL'
        ? 'rgba(239, 68, 68, 0.2)'
        : selectedRack.status === 'WARNING'
        ? 'rgba(245, 158, 11, 0.2)'
        : 'rgba(34, 197, 94, 0.2)'

    const statusBadgeColor =
      selectedRack.status === 'CRITICAL'
        ? '#ef4444'
        : selectedRack.status === 'WARNING'
        ? '#f59e0b'
        : '#22c55e'

    const rackConnections = COOLING_TOPOLOGY[selectedRack.id] || []

    return (
      <aside
        style={{
          position: 'absolute',
          top: 72,
          right: 20,
          zIndex: 25,
          width: '340px',
          maxHeight: 'calc(100vh - 90px)',
          overflowY: 'auto',
          background: 'rgba(15, 23, 42, 0.95)',
          border: '1px solid rgba(56, 189, 248, 0.35)',
          borderRadius: '10px',
          padding: '18px 20px',
          backdropFilter: 'blur(16px)',
          boxShadow: '0 16px 36px rgba(0, 0, 0, 0.55)',
          color: '#e2e8f0',
          fontFamily: 'sans-serif',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            borderBottom: '1px solid rgba(148, 163, 184, 0.15)',
            paddingBottom: '12px',
            marginBottom: '14px',
          }}
        >
          <div>
            <div
              style={{
                fontFamily: 'monospace',
                fontSize: '16px',
                fontWeight: 700,
                color: '#38bdf8',
                letterSpacing: '0.5px',
              }}
            >
              {selectedRack.name}
            </div>
            <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '2px' }}>
              {selectedRack.row} • 42U Enclosure
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span
              style={{
                fontFamily: 'monospace',
                fontSize: '10px',
                fontWeight: 700,
                padding: '3px 8px',
                borderRadius: '4px',
                background: statusBadgeBg,
                color: statusBadgeColor,
                border: `1px solid ${statusBadgeColor}`,
              }}
            >
              {selectedRack.status}
            </span>

            <button
              type="button"
              onClick={() => simulationStore.setSelectedRack(null)}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#94a3b8',
                fontSize: '16px',
                cursor: 'pointer',
                padding: '2px 6px',
                borderRadius: '4px',
              }}
            >
              ✕
            </button>
          </div>
        </div>

        {/* Telemetry Metrics Container */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {/* Health Score Gauge */}
          <div
            style={{
              background: 'rgba(30, 41, 59, 0.55)',
              border: `1px solid ${healthColor}40`,
              borderRadius: '8px',
              padding: '10px 14px',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '6px',
              }}
            >
              <span style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 600 }}>
                RACK HEALTH SCORE
              </span>
              <span
                style={{
                  fontFamily: 'monospace',
                  fontSize: '11px',
                  fontWeight: 700,
                  color: healthColor,
                }}
              >
                {selectedRack.healthStatus} ({selectedRack.health}%)
              </span>
            </div>
            <div
              style={{
                width: '100%',
                height: '6px',
                background: 'rgba(15, 23, 42, 0.8)',
                borderRadius: '3px',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width: `${selectedRack.health}%`,
                  height: '100%',
                  backgroundColor: healthColor,
                  borderRadius: '3px',
                  transition: 'width 0.25s ease',
                }}
              />
            </div>
          </div>

          {/* Virtual Sensors: 3-Point Thermal Gradient */}
          <div>
            <div
              style={{
                fontSize: '11px',
                color: '#94a3b8',
                fontWeight: 600,
                marginBottom: '6px',
                display: 'flex',
                justifyContent: 'space-between',
              }}
            >
              <span>VIRTUAL SENSOR ZONES</span>
              <span style={{ color: tempColor, fontFamily: 'monospace' }}>
                Mean: {selectedRack.temp.toFixed(1)}°C
              </span>
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr 1fr',
                gap: '6px',
              }}
            >
              {/* Top Sensor */}
              <div
                style={{
                  background: 'rgba(30, 41, 59, 0.6)',
                  border: '1px solid rgba(148, 163, 184, 0.12)',
                  borderRadius: '6px',
                  padding: '6px 8px',
                  textAlign: 'center',
                }}
              >
                <div style={{ fontSize: '9px', color: '#94a3b8' }}>TOP (EXHAUST)</div>
                <div
                  style={{
                    fontFamily: 'monospace',
                    fontSize: '13px',
                    fontWeight: 700,
                    color: getTemperatureColor(selectedRack.tempTop),
                    marginTop: '2px',
                  }}
                >
                  {selectedRack.tempTop.toFixed(1)}°C
                </div>
              </div>

              {/* Mid Sensor */}
              <div
                style={{
                  background: 'rgba(30, 41, 59, 0.6)',
                  border: '1px solid rgba(148, 163, 184, 0.12)',
                  borderRadius: '6px',
                  padding: '6px 8px',
                  textAlign: 'center',
                }}
              >
                <div style={{ fontSize: '9px', color: '#94a3b8' }}>MID (CHASSIS)</div>
                <div
                  style={{
                    fontFamily: 'monospace',
                    fontSize: '13px',
                    fontWeight: 700,
                    color: getTemperatureColor(selectedRack.tempMid),
                    marginTop: '2px',
                  }}
                >
                  {selectedRack.tempMid.toFixed(1)}°C
                </div>
              </div>

              {/* Bottom Sensor */}
              <div
                style={{
                  background: 'rgba(30, 41, 59, 0.6)',
                  border: '1px solid rgba(148, 163, 184, 0.12)',
                  borderRadius: '6px',
                  padding: '6px 8px',
                  textAlign: 'center',
                }}
              >
                <div style={{ fontSize: '9px', color: '#94a3b8' }}>BOTTOM (INTAKE)</div>
                <div
                  style={{
                    fontFamily: 'monospace',
                    fontSize: '13px',
                    fontWeight: 700,
                    color: getTemperatureColor(selectedRack.tempBottom),
                    marginTop: '2px',
                  }}
                >
                  {selectedRack.tempBottom.toFixed(1)}°C
                </div>
              </div>
            </div>
          </div>

          {/* Workload */}
          <div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: '12px',
                marginBottom: '6px',
              }}
            >
              <span style={{ color: '#94a3b8' }}>Compute Workload</span>
              <span
                style={{
                  fontFamily: 'monospace',
                  fontWeight: 700,
                  color: workloadColor,
                }}
              >
                {selectedRack.workload}%
              </span>
            </div>
            <div
              style={{
                width: '100%',
                height: '6px',
                background: 'rgba(30, 41, 59, 0.8)',
                borderRadius: '3px',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width: `${selectedRack.workload}%`,
                  height: '100%',
                  backgroundColor: workloadColor,
                  borderRadius: '3px',
                  transition: 'width 0.2s ease',
                }}
              />
            </div>
          </div>

          {/* IT Power & Active Servers Grid */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '10px',
            }}
          >
            <div
              style={{
                background: 'rgba(30, 41, 59, 0.6)',
                padding: '10px 12px',
                borderRadius: '6px',
                border: '1px solid rgba(148, 163, 184, 0.1)',
              }}
            >
              <div style={{ fontSize: '10px', color: '#94a3b8' }}>IT Power</div>
              <div
                style={{
                  fontFamily: 'monospace',
                  fontSize: '15px',
                  fontWeight: 700,
                  color: '#38bdf8',
                  marginTop: '2px',
                }}
              >
                {selectedRack.itPower.toFixed(1)} kW
              </div>
            </div>

            <div
              style={{
                background: 'rgba(30, 41, 59, 0.6)',
                padding: '10px 12px',
                borderRadius: '6px',
                border: '1px solid rgba(148, 163, 184, 0.1)',
              }}
            >
              <div style={{ fontSize: '10px', color: '#94a3b8' }}>Cooling Received</div>
              <div
                style={{
                  fontFamily: 'monospace',
                  fontSize: '15px',
                  fontWeight: 700,
                  color: selectedRack.coolingReceived < 70 ? '#f59e0b' : '#38bdf8',
                  marginTop: '2px',
                }}
              >
                {selectedRack.coolingReceived}%
              </div>
            </div>
          </div>

          {/* Airflow Status & Restriction Toggle */}
          <div
            style={{
              background: isRestricted
                ? 'rgba(245, 158, 11, 0.12)'
                : 'rgba(30, 41, 59, 0.6)',
              border: isRestricted
                ? '1px solid rgba(245, 158, 11, 0.4)'
                : '1px solid rgba(148, 163, 184, 0.1)',
              borderRadius: '8px',
              padding: '10px 12px',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '6px',
              }}
            >
              <div>
                <div style={{ fontSize: '10px', color: '#94a3b8' }}>AIRFLOW INTAKE STATE</div>
                <div
                  style={{
                    fontFamily: 'monospace',
                    fontSize: '12px',
                    fontWeight: 700,
                    color: isRestricted ? '#f59e0b' : '#22c55e',
                    marginTop: '2px',
                  }}
                >
                  {isRestricted ? 'RESTRICTED (BYPASS)' : 'OPTIMAL (CONTAINED)'}
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  simulationStore.updateRack(selectedRack.id, {
                    airflow: isRestricted ? 'NORMAL' : 'RESTRICTED',
                  })
                }}
                style={{
                  padding: '5px 10px',
                  borderRadius: '5px',
                  fontSize: '11px',
                  fontFamily: 'monospace',
                  fontWeight: 700,
                  cursor: 'pointer',
                  border: isRestricted
                    ? '1px solid #f59e0b'
                    : '1px solid rgba(56, 189, 248, 0.4)',
                  background: isRestricted
                    ? 'rgba(245, 158, 11, 0.2)'
                    : 'rgba(56, 189, 248, 0.15)',
                  color: isRestricted ? '#fbbf24' : '#38bdf8',
                }}
              >
                {isRestricted ? 'RESTORE PANELS' : 'SIMULATE BYPASS'}
              </button>
            </div>
            {isRestricted && (
              <div
                style={{
                  fontSize: '10px',
                  color: '#fbbf24',
                  lineHeight: '1.3',
                  marginTop: '4px',
                }}
              >
                ⚠ Missing blanking panels cause hot air recirculation. Effective cooling reduced to 60%.
              </div>
            )}
          </div>

          {/* Connected CRAC Units (Topology Links) */}
          <div>
            <div
              style={{
                fontSize: '10px',
                fontWeight: 700,
                color: '#64748b',
                fontFamily: 'monospace',
                marginBottom: '6px',
                textTransform: 'uppercase',
              }}
            >
              Connected Cooling Units
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {rackConnections.map(({ cracId, weight }) => {
                const crac = cracs.find((c) => c.id === cracId)
                if (!crac) return null
                const cracFailed = crac.status === 'FAILED'

                return (
                  <button
                    key={cracId}
                    type="button"
                    onClick={() => simulationStore.setSelectedCrac(cracId)}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      background: cracFailed
                        ? 'rgba(239, 68, 68, 0.15)'
                        : 'rgba(30, 41, 59, 0.5)',
                      border: cracFailed
                        ? '1px solid rgba(239, 68, 68, 0.4)'
                        : '1px solid rgba(148, 163, 184, 0.12)',
                      borderRadius: '6px',
                      padding: '8px 10px',
                      cursor: 'pointer',
                      textAlign: 'left',
                      color: '#e2e8f0',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <div>
                      <div
                        style={{
                          fontFamily: 'monospace',
                          fontSize: '11px',
                          fontWeight: 700,
                          color: cracFailed ? '#ef4444' : '#38bdf8',
                        }}
                      >
                        {crac.name}
                      </div>
                      <div style={{ fontSize: '10px', color: '#94a3b8' }}>
                        Coupling Weight: {Math.round(weight * 100)}%
                      </div>
                    </div>

                    <div style={{ textAlign: 'right' }}>
                      <span
                        style={{
                          fontFamily: 'monospace',
                          fontSize: '10px',
                          fontWeight: 700,
                          color: cracFailed ? '#ef4444' : '#22c55e',
                        }}
                      >
                        {crac.status}
                      </span>
                      <div style={{ fontSize: '10px', color: '#94a3b8' }}>
                        {crac.capacity}% Cap
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Interactive Workload Control */}
          <div
            style={{
              borderTop: '1px solid rgba(148, 163, 184, 0.15)',
              paddingTop: '12px',
            }}
          >
            <label
              style={{
                display: 'block',
                fontSize: '11px',
                color: '#94a3b8',
                marginBottom: '4px',
              }}
            >
              Adjust Workload ({selectedRack.workload}%):
            </label>
            <input
              type="range"
              min="10"
              max="100"
              value={selectedRack.workload}
              onChange={(e) => {
                simulationStore.updateRack(selectedRack.id, {
                  workload: Number(e.target.value),
                })
              }}
              style={{ width: '100%', cursor: 'pointer', accentColor: '#38bdf8' }}
            />
          </div>
        </div>
      </aside>
    )
  }

  // =========================================================================
  // 2. CRAC UNIT INSPECTION PANEL
  // =========================================================================
  if (selectedCrac) {
    const isFailed = selectedCrac.status === 'FAILED'

    return (
      <aside
        style={{
          position: 'absolute',
          top: 72,
          right: 20,
          zIndex: 25,
          width: '340px',
          maxHeight: 'calc(100vh - 90px)',
          overflowY: 'auto',
          background: 'rgba(15, 23, 42, 0.95)',
          border: '1px solid rgba(56, 189, 248, 0.35)',
          borderRadius: '10px',
          padding: '18px 20px',
          backdropFilter: 'blur(16px)',
          boxShadow: '0 16px 36px rgba(0, 0, 0, 0.55)',
          color: '#e2e8f0',
          fontFamily: 'sans-serif',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            borderBottom: '1px solid rgba(148, 163, 184, 0.15)',
            paddingBottom: '12px',
            marginBottom: '14px',
          }}
        >
          <div>
            <div
              style={{
                fontFamily: 'monospace',
                fontSize: '16px',
                fontWeight: 700,
                color: '#38bdf8',
                letterSpacing: '0.5px',
              }}
            >
              {selectedCrac.name}
            </div>
            <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '2px' }}>
              Perimeter Air Handler • Direct Expansion
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span
              style={{
                fontFamily: 'monospace',
                fontSize: '10px',
                fontWeight: 700,
                padding: '3px 8px',
                borderRadius: '4px',
                background: isFailed
                  ? 'rgba(239, 68, 68, 0.2)'
                  : 'rgba(34, 197, 94, 0.2)',
                color: isFailed ? '#ef4444' : '#22c55e',
                border: `1px solid ${isFailed ? '#ef4444' : '#22c55e'}`,
              }}
            >
              {selectedCrac.status}
            </span>

            <button
              type="button"
              onClick={() => simulationStore.setSelectedCrac(null)}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#94a3b8',
                fontSize: '16px',
                cursor: 'pointer',
                padding: '2px 6px',
                borderRadius: '4px',
              }}
            >
              ✕
            </button>
          </div>
        </div>

        {/* Telemetry Metrics */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {/* Cooling Capacity */}
          <div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: '12px',
                marginBottom: '6px',
              }}
            >
              <span style={{ color: '#94a3b8' }}>Cooling Capacity</span>
              <span
                style={{
                  fontFamily: 'monospace',
                  fontWeight: 700,
                  color: isFailed ? '#ef4444' : '#38bdf8',
                }}
              >
                {selectedCrac.capacity}%
              </span>
            </div>
            <div
              style={{
                width: '100%',
                height: '6px',
                background: 'rgba(30, 41, 59, 0.8)',
                borderRadius: '3px',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width: `${selectedCrac.capacity}%`,
                  height: '100%',
                  backgroundColor: isFailed ? '#ef4444' : '#38bdf8',
                  borderRadius: '3px',
                  transition: 'width 0.2s ease',
                }}
              />
            </div>
          </div>

          {/* Power & Airflow Grid */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '10px',
            }}
          >
            <div
              style={{
                background: 'rgba(30, 41, 59, 0.6)',
                padding: '10px 12px',
                borderRadius: '6px',
                border: '1px solid rgba(148, 163, 184, 0.1)',
              }}
            >
              <div style={{ fontSize: '10px', color: '#94a3b8' }}>Cooling Power</div>
              <div
                style={{
                  fontFamily: 'monospace',
                  fontSize: '15px',
                  fontWeight: 700,
                  color: '#38bdf8',
                  marginTop: '2px',
                }}
              >
                {selectedCrac.power.toFixed(1)} kW
              </div>
            </div>

            <div
              style={{
                background: 'rgba(30, 41, 59, 0.6)',
                padding: '10px 12px',
                borderRadius: '6px',
                border: '1px solid rgba(148, 163, 184, 0.1)',
              }}
            >
              <div style={{ fontSize: '10px', color: '#94a3b8' }}>Airflow Delivery</div>
              <div
                style={{
                  fontFamily: 'monospace',
                  fontSize: '15px',
                  fontWeight: 700,
                  color: '#f8fafc',
                  marginTop: '2px',
                }}
              >
                {isFailed ? 0 : selectedCrac.airflow.toLocaleString()} CFM
              </div>
            </div>
          </div>

          {/* Connected Racks List */}
          <div>
            <div
              style={{
                fontSize: '10px',
                fontWeight: 700,
                color: '#64748b',
                fontFamily: 'monospace',
                marginBottom: '6px',
                textTransform: 'uppercase',
              }}
            >
              Supplied Server Racks
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
              {selectedCrac.connectedRacks.map((rackId) => {
                const targetRack = racks.find((r) => r.id === rackId)
                if (!targetRack) return null

                return (
                  <button
                    key={rackId}
                    type="button"
                    onClick={() => simulationStore.setSelectedRack(rackId)}
                    style={{
                      background: 'rgba(30, 41, 59, 0.5)',
                      border: '1px solid rgba(148, 163, 184, 0.15)',
                      borderRadius: '6px',
                      padding: '6px 8px',
                      cursor: 'pointer',
                      textAlign: 'left',
                      color: '#e2e8f0',
                    }}
                  >
                    <div
                      style={{
                        fontFamily: 'monospace',
                        fontSize: '11px',
                        fontWeight: 700,
                        color: '#38bdf8',
                      }}
                    >
                      {targetRack.name}
                    </div>
                    <div
                      style={{
                        fontSize: '10px',
                        color: getTemperatureColor(targetRack.temp),
                        fontFamily: 'monospace',
                      }}
                    >
                      {targetRack.temp.toFixed(1)}°C
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Interactive Cooling Controls */}
          <div
            style={{
              borderTop: '1px solid rgba(148, 163, 184, 0.15)',
              paddingTop: '12px',
            }}
          >
            <div
              style={{
                fontSize: '10px',
                fontWeight: 700,
                color: '#64748b',
                fontFamily: 'monospace',
                marginBottom: '8px',
                textTransform: 'uppercase',
              }}
            >
              Interactive Controls
            </div>

            {/* Capacity Slider */}
            <label
              style={{
                display: 'block',
                fontSize: '11px',
                color: '#94a3b8',
                marginBottom: '4px',
              }}
            >
              Cooling Output Level ({selectedCrac.capacity}%):
            </label>
            <input
              type="range"
              min="0"
              max="100"
              disabled={isFailed}
              value={selectedCrac.capacity}
              onChange={(e) => {
                simulationStore.updateCrac(selectedCrac.id, {
                  capacity: Number(e.target.value),
                })
              }}
              style={{
                width: '100%',
                cursor: isFailed ? 'not-allowed' : 'pointer',
                accentColor: '#38bdf8',
                opacity: isFailed ? 0.4 : 1,
              }}
            />

            {/* Invert / Failure Scenario button */}
            <button
              type="button"
              onClick={() => {
                const nextStatus = isFailed ? 'ACTIVE' : 'FAILED'
                simulationStore.updateCrac(selectedCrac.id, {
                  status: nextStatus,
                  capacity: nextStatus === 'FAILED' ? 0 : 80,
                })
              }}
              style={{
                width: '100%',
                marginTop: '10px',
                padding: '8px 12px',
                borderRadius: '6px',
                border: isFailed
                  ? '1px solid #22c55e'
                  : '1px solid rgba(239, 68, 68, 0.5)',
                background: isFailed
                  ? 'rgba(34, 197, 94, 0.15)'
                  : 'rgba(239, 68, 68, 0.15)',
                color: isFailed ? '#22c55e' : '#ef4444',
                fontFamily: 'monospace',
                fontSize: '11px',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              {isFailed ? 'RESTORE CRAC COMPRESSOR' : 'INJECT COMPRESSOR FAILURE'}
            </button>
          </div>
        </div>
      </aside>
    )
  }

  return null
}
