// Central configuration for the base station.
// Values marked ASSUMED are not known from the hardware — verify them on the bench.

export interface LatLng {
  lat: number;
  lng: number;
}

export const config = {
  // ---------------------------------------------------------------- base station
  /** Default base-station position (from the Mission Planner screenshot). Right-click the map to override. */
  baseStation: { lat: 6.8122982, lng: 79.8907368 } as LatLng,

  // ---------------------------------------------------------------- LoRa receiver (Web Serial)
  serial: {
    baudRate: 115200,
    /** Receiver prints HB|<millis> every 5 s; treat it as lost after this long. */
    heartbeatTimeoutMs: 12_000,
    /** Watch sends one packet per second; mark telemetry stale after this long. */
    packetStaleMs: 5_000,
  },

  // ---------------------------------------------------------------- map
  map: {
    /**
     * 'online'  → imagery from the URL below (Esri World Imagery by default).
     * 'offline' → tiles served by Vite from /public/tiles/{z}/{x}/{y}.jpg (see README).
     */
    tileSource: 'online' as 'online' | 'offline',
    imageryUrl: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    imageryAttribution: 'Imagery &copy; Esri, Maxar, Earthstar Geographics, and the GIS User Community',
    labelsUrl: 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
    showLabels: true,
    offlineUrl: '/tiles/{z}/{x}/{y}.jpg',
    /** Zoom levels covered by the offline tile download script. */
    offlineMinZoom: 15,
    offlineMaxZoom: 19,
    minZoom: 3,
    maxZoom: 19,
    /** Zoom used when there is nothing to fit (Mission Planner screenshot was at 16). */
    defaultZoom: 17,
    /** Pixels kept free between the farthest marker and the map edge during auto-zoom. */
    autoZoomPaddingPx: 60,
    /** Fractional zoom step for the auto-fit (Leaflet zoomSnap). */
    zoomSnap: 0.25,
    /** Max number of points kept in the drone GPS track. */
    trackMaxPoints: 2000,
  },

  // ---------------------------------------------------------------- charts
  charts: {
    windowMs: 60_000,
  },

  // ---------------------------------------------------------------- drone bridge
  bridge: {
    wsUrl: 'ws://localhost:8787',
    /** No MAVLink message for this long → "no data". */
    telemetryTimeoutMs: 5_000,
  },

  // ---------------------------------------------------------------- rescue (ASSUMED defaults — editable in Settings)
  rescue: {
    /** Relative altitude (m above home) for the GUIDED go-to. ASSUMED. */
    altitudeM: 10,
    /** Refuse any target farther than this from the drone's home / base station. ASSUMED. */
    maxDistanceFromHomeM: 300,
    /** Drone within this distance of the victim → "On target". ASSUMED. */
    onTargetRadiusM: 5,
    /** Servo output that releases the life ring (MAV_CMD_DO_SET_SERVO). ASSUMED — check your APM wiring. */
    releaseServoChannel: 9,
    releasePwm: 1900,
    holdPwm: 1100,
  },

  // ---------------------------------------------------------------- automatic detection (Type 2) — ASSUMED thresholds
  detection: {
    /** Only trust heart-rate readings with at least this confidence and a finger on the sensor (STAT 3). */
    minConfidence: 50,
    requireFinger: true,
    /** Literature ref [10] alarms below 60 or above 120 BPM; 50 is used to tolerate resting swimmers. */
    bpmLow: 50,
    bpmHigh: 120,
    /** BPM must stay out of range this long before it raises an alert. */
    abnormalBpmSeconds: 10,
    /** |a| deviation from 1 g (m/s²) that counts as a violent spike. */
    accelSpikeMs2: 25,
    /** After a spike, acceleration-vector standard deviation below this for `stillSeconds` = "little movement". */
    stillStdDevMs2: 0.5,
    stillSeconds: 5,
    /** |gyro| above this (°/s) in `gyroCount` of the last `gyroWindow` samples = erratic motion. */
    gyroErraticDps: 250,
    gyroWindow: 5,
    gyroCount: 3,
    /** Do not re-raise the same rule within this time after it was cleared. */
    cooldownMs: 30_000,
  },

  // ---------------------------------------------------------------- alerts
  alerts: {
    /** Alarm tone (Hz) and beep pattern. */
    alarmFreqHz: 880,
  },
};

export type RescueSettings = typeof config.rescue;
