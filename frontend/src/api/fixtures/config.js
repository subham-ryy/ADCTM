/**
 * Canonical configuration fixture matching GET /api/v1/config
 */
export const configFixture = {
  schema_version: '1.0.0',
  facility_id: 'dc-primary-01',
  temperature_thresholds: [
    { max: 22, label: 'OPTIMAL', color: '#06b6d4', bg: 'rgba(6, 182, 212, 0.2)' },
    { max: 26, label: 'NORMAL', color: '#22c55e', bg: 'rgba(34, 197, 94, 0.2)' },
    { max: 30, label: 'WARM', color: '#eab308', bg: 'rgba(234, 179, 8, 0.2)' },
    { max: 34, label: 'WARNING', color: '#f97316', bg: 'rgba(249, 115, 22, 0.2)' },
    { max: 100, label: 'CRITICAL', color: '#ef4444', bg: 'rgba(239, 68, 68, 0.25)' },
  ],
  topology: {
    zones: [
      { id: 'zone-01', label: 'ZONE 01 (ROW A-L)', x: 140, y: 70, w: 200, h: 140 },
      { id: 'zone-02', label: 'ZONE 02 (ROW A-C)', x: 370, y: 70, w: 200, h: 140 },
      { id: 'zone-03', label: 'ZONE 03 (ROW A-R)', x: 600, y: 70, w: 200, h: 140 },
      { id: 'zone-04', label: 'ZONE 04 (ROW B-L)', x: 250, y: 260, w: 200, h: 140 },
      { id: 'zone-05', label: 'ZONE 05 (ROW B-R)', x: 480, y: 260, w: 200, h: 140 },
    ],
    cooling_units: [
      { id: 'crac-01', label: 'CRAC-01', x: 30, y: 90, w: 80, h: 100 },
      { id: 'crac-02', label: 'CRAC-02', x: 820, y: 90, w: 80, h: 100 },
    ],
    cooling_unit_zone_mapping: {
      'crac-01': ['zone-01', 'zone-02', 'zone-04'],
      'crac-02': ['zone-03', 'zone-05'],
    },
  },
}
