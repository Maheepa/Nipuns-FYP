import { useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, Marker, Polyline, Popup, TileLayer, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import type { LatLngExpression } from 'leaflet';
import { create } from 'zustand';
import { config, type LatLng } from '../config';
import { destination, distanceM, fitZoomAroundCenter } from '../geo';
import { clock, metres } from '../format';
import { live } from '../store/live';
import { useFrame } from '../store/ticker';
import { useStore } from '../store/useStore';
import { askConfirm } from '../store/useUi';
import { DroneControls } from './DroneControls';
import { Hud } from './Hud';
import { SimControls } from './SimControls';
import { baseIcon, droneIcon, swimmerIcon, targetIcon, type SwimmerState } from './mapIcons';

// Mouse position for the GEO readout lives in its own tiny store so mouse moves
// re-render only the readout bar, not the markers.
const useCursor = create<{ pos: LatLng | null; zoom: number }>(() => ({ pos: null, zoom: config.map.defaultZoom }));

const MAX_AUTO_ZOOM = 18;
const snapDown = (z: number) => Math.floor(z / config.map.zoomSnap) * config.map.zoomSnap;
const clampZoom = (z: number) => Math.max(config.map.minZoom, Math.min(config.map.maxZoom, z));

interface ControllerProps {
  base: LatLng;
  points: LatLng[];
  autoFit: boolean;
  manualZoom: number;
  /** The user zoomed with the mouse wheel: switch to manual at this zoom. */
  onUserZoom: (z: number) => void;
}

/**
 * Keeps the base station at the exact centre of the map and chooses the zoom:
 *  - auto-fit: the highest zoom that keeps every marker inside the view (with padding)
 *  - manual (after +/- or the mouse wheel): the user's zoom, until Auto-fit is pressed
 */
function CenterLockController({ base, points, autoFit, manualZoom, onUserZoom }: ControllerProps) {
  const map = useMap();
  const latest = useRef({ base, points, autoFit, manualZoom });
  latest.current = { base, points, autoFit, manualZoom };

  const apply = useRef(() => {});
  const applying = useRef(false);
  apply.current = () => {
    const { base, points, autoFit, manualZoom } = latest.current;
    const size = map.getSize();
    if (size.x === 0 || size.y === 0) return;

    const current = map.getZoom();
    let target: number;
    if (autoFit) {
      const fit = fitZoomAroundCenter(base, points, size.x, size.y, config.map.autoZoomPaddingPx);
      const fitSnapped = fit == null ? null : clampZoom(snapDown(Math.min(fit, MAX_AUTO_ZOOM)));
      if (fitSnapped == null) target = config.map.defaultZoom;
      else if (fitSnapped < current) target = fitSnapped; // must zoom out to keep markers in view
      else if (fitSnapped - current >= 0.75) target = fitSnapped - config.map.zoomSnap; // zoom in, with margin
      else target = current; // hysteresis: avoid zoom jitter as markers move a little
    } else {
      target = manualZoom;
    }
    target = clampZoom(target);

    // Compare in screen pixels: Leaflet rounds its pixel origin, so getCenter() never
    // equals the base station exactly and a lat/lng comparison would loop forever.
    const p = map.latLngToContainerPoint([base.lat, base.lng]);
    const off = Math.abs(p.x - size.x / 2) > 1 || Math.abs(p.y - size.y / 2) > 1;
    if ((off || Math.abs(target - current) > 1e-6) && !applying.current) {
      applying.current = true;
      try {
        map.setView([base.lat, base.lng], target, { animate: Math.abs(target - current) <= 2 && !off });
      } finally {
        applying.current = false;
      }
    }
  };

  // Re-apply when inputs change (markers move).
  useEffect(() => {
    apply.current();
  });

  useEffect(() => {
    const el = map.getContainer();
    let wheelAt = 0;
    const onWheel = () => {
      wheelAt = Date.now();
    };
    // Leaflet fires zoomend before moveend: switch to manual first so the snap-back
    // below keeps the user's wheel zoom instead of reverting it.
    const onZoomEnd = () => {
      if (Date.now() - wheelAt < 1000) {
        const z = map.getZoom();
        latest.current = { ...latest.current, autoFit: false, manualZoom: z };
        onUserZoom(z);
      }
    };
    const snap = () => apply.current();
    el.addEventListener('wheel', onWheel, { passive: true });
    map.on('zoomend', onZoomEnd);
    map.on('moveend', snap);
    const ro = new ResizeObserver(() => {
      map.invalidateSize({ pan: false });
      apply.current();
    });
    ro.observe(el);
    return () => {
      el.removeEventListener('wheel', onWheel);
      map.off('zoomend', onZoomEnd);
      map.off('moveend', snap);
      ro.disconnect();
    };
  }, [map, onUserZoom]);

  return null;
}

function MapEvents({ onContext }: { onContext: (p: LatLng) => void }) {
  useMapEvents({
    mousemove: (e) => useCursor.setState({ pos: { lat: e.latlng.lat, lng: e.latlng.lng } }),
    mouseout: () => useCursor.setState({ pos: null }),
    zoomend: (e) => useCursor.setState({ zoom: e.target.getZoom() }),
    contextmenu: (e) => onContext({ lat: e.latlng.lat, lng: e.latlng.lng }),
  });
  return null;
}

/** Red "current heading" line in front of the drone, about 90 px long at any zoom. */
function headingLine(pos: LatLng, heading: number, zoom: number): LatLngExpression[] {
  const mPerPx = (156543.03392 * Math.cos((pos.lat * Math.PI) / 180)) / 2 ** zoom;
  const end = destination(pos, heading, 90 * mPerPx);
  return [
    [pos.lat, pos.lng],
    [end.lat, end.lng],
  ];
}

/** Mission-Planner-style readout under the map. */
function CoordBar({ base, autoFit }: { base: LatLng; autoFit: boolean }) {
  const { pos, zoom } = useCursor();
  const tileSource = useStore((s) => s.settings.tileSource);
  const setTileSource = useStore((s) => s.setTileSource);
  return (
    <div className="coord-bar mono">
      <span className="geo-tag">GEO</span>
      <span className="coord">{pos ? `${pos.lat.toFixed(7)}  ${pos.lng.toFixed(7)}` : '—'}</span>
      <span className="muted">BASE</span>
      <span className="coord">
        {base.lat.toFixed(7)}  {base.lng.toFixed(7)}
      </span>
      <span className="muted">DIST</span>
      <span className="coord">{pos ? metres(distanceM(base, pos)) : '—'}</span>
      <span className="spacer" />
      <span>
        Zoom <b>{zoom.toFixed(2)}</b> {autoFit ? 'auto' : 'manual'}
      </span>
      <label className="tiles-toggle" title="Offline tiles are served from /public/tiles (see README)">
        <input
          type="checkbox"
          checked={tileSource === 'offline'}
          onChange={(e) => setTileSource(e.target.checked ? 'offline' : 'online')}
        />
        Offline tiles
      </label>
    </div>
  );
}

function secondsAgo(t: number | null, now: number): string {
  return t == null ? 'never' : `${Math.max(0, Math.round((now - t) / 1000))}s ago`;
}

export function MapPanel() {
  // Markers and lines refresh at most 4 times a second, whatever the data rate.
  const now = useFrame(4);
  const base = useStore((s) => s.settings.baseStation);
  const setBaseStation = useStore((s) => s.setBaseStation);
  const tileSource = useStore((s) => s.settings.tileSource);
  const alertLevel = useStore((s) => s.alert?.level ?? null);
  const alertId = useStore((s) => s.alert?.id ?? null);
  const rescueStage = useStore((s) => s.rescue.stage);
  const rescueTarget = useStore((s) => s.rescue.target);

  const drone = live.drone;
  const watchPos = live.watch.position;
  const lastFixAt = live.watch.lastFixAt;
  const lastPacketAt = live.stats.lastPacketAt;

  const [autoFit, setAutoFit] = useState(true);
  const [manualZoom, setManualZoom] = useState(config.map.defaultZoom);
  const [ctx, setCtx] = useState<LatLng | null>(null);
  const [zoom, setZoom] = useState(config.map.defaultZoom);
  useEffect(() => useCursor.subscribe((s) => setZoom(s.zoom)), []);

  // A new alert brings auto-fit back so the victim is in view.
  useEffect(() => {
    if (alertId != null) setAutoFit(true);
  }, [alertId]);

  const onUserZoom = useMemo(
    () => (z: number) => {
      setManualZoom(z);
      setAutoFit(false);
    },
    [],
  );

  const droneLive = drone.lastMsgAt != null && now - drone.lastMsgAt < config.bridge.telemetryTimeoutMs * 3;
  const dronePos = droneLive ? drone.position : null;

  // Stale = last packet had no fix (NA), or no packet for more than 5 s.
  const packetsStale = lastPacketAt == null || now - lastPacketAt > config.serial.packetStaleMs;
  const stale = live.watch.positionStale || packetsStale;
  // An alert always wins (pulsing red/amber), even on a last-known position.
  const swimmerState: SwimmerState =
    alertLevel === 'drowning' ? 'alert' : alertLevel === 'warning' ? 'warning' : stale ? 'stale' : 'normal';
  const swimmerTip = stale
    ? `${alertLevel ? 'LAST KNOWN POSITION · ' : ''}Last fix ${lastFixAt ? clock(lastFixAt) : '—'} (${secondsAgo(lastFixAt, now)})`
    : 'Swimmer · live';

  const flying = rescueStage === 'dispatched' || rescueStage === 'enroute' || rescueStage === 'ontarget';
  const victim = watchPos ?? rescueTarget;

  const pointsKey = [watchPos, dronePos, rescueTarget].map((p) => (p ? `${p.lat.toFixed(6)},${p.lng.toFixed(6)}` : '-')).join('|');
  // Re-fit only when a position really changes (not on every 4 Hz frame).
  const points = useMemo(() => [watchPos, dronePos, rescueTarget].filter((p): p is LatLng => p != null), [pointsKey]);

  const zoomBy = (dz: number) => {
    setManualZoom(clampZoom(useCursor.getState().zoom + dz));
    setAutoFit(false);
  };

  const confirmBase = async (p: LatLng) => {
    setCtx(null);
    const ok = await askConfirm({
      title: 'Move the base station here?',
      confirmLabel: 'Set base station',
      body: (
        <p>
          New position <b className="mono">{p.lat.toFixed(7)}, {p.lng.toFixed(7)}</b>, {metres(distanceM(base, p))} from the
          current one. It is saved in this browser; distances and the max-distance limit use it. Reset it in Settings.
        </p>
      ),
    });
    if (ok) {
      setBaseStation(p);
      useStore.getState().logEvent({ kind: 'info', message: `Base station moved to ${p.lat.toFixed(7)}, ${p.lng.toFixed(7)}`, lat: p.lat, lng: p.lng });
    }
  };

  return (
    <section className="card map-card">
      <div className="card-head">
        Live map
        <span className="sub">base station locked at centre</span>
        <div className="right">
          <SimControls />
        </div>
      </div>

      <div className="map-wrap">
        <MapContainer
          center={[base.lat, base.lng]}
          zoom={config.map.defaultZoom}
          minZoom={config.map.minZoom}
          maxZoom={config.map.maxZoom}
          zoomSnap={config.map.zoomSnap}
          zoomDelta={0.5}
          dragging={false}
          scrollWheelZoom="center"
          doubleClickZoom={false}
          touchZoom={false}
          boxZoom={false}
          keyboard={false}
          zoomControl={false}
          attributionControl
          className="map"
        >
          {tileSource === 'online' ? (
            <>
              <TileLayer
                key="imagery"
                url={config.map.imageryUrl}
                attribution={config.map.imageryAttribution}
                maxNativeZoom={19}
                maxZoom={config.map.maxZoom}
              />
              {config.map.showLabels && (
                <TileLayer key="labels" url={config.map.labelsUrl} maxNativeZoom={19} maxZoom={config.map.maxZoom} />
              )}
            </>
          ) : (
            <TileLayer
              key="offline"
              url={config.map.offlineUrl}
              attribution={`${config.map.imageryAttribution} (offline cache)`}
              minNativeZoom={config.map.offlineMinZoom}
              maxNativeZoom={config.map.offlineMaxZoom}
              maxZoom={config.map.maxZoom}
            />
          )}

          <CenterLockController base={base} points={points} autoFit={autoFit} manualZoom={manualZoom} onUserZoom={onUserZoom} />
          <MapEvents onContext={setCtx} />

          {/* drone GPS track (black, like Mission Planner) */}
          {live.track.size > 1 && (
            <Polyline positions={live.track.toArray()} pathOptions={{ color: '#000', weight: 2.5, opacity: 0.9 }} />
          )}

          {/* thin base → marker lines with distance labels */}
          {watchPos && (
            <Polyline
              positions={[
                [base.lat, base.lng],
                [watchPos.lat, watchPos.lng],
              ]}
              pathOptions={{ color: '#ffffff', weight: 1.5, opacity: 0.85, dashArray: '2 5' }}
            >
              <Tooltip permanent direction="center" className="dist-label">
                {metres(distanceM(base, watchPos))}
              </Tooltip>
            </Polyline>
          )}
          {dronePos && (
            <Polyline
              positions={[
                [base.lat, base.lng],
                [dronePos.lat, dronePos.lng],
              ]}
              pathOptions={{ color: '#d7e04a', weight: 1.5, opacity: 0.85, dashArray: '2 5' }}
            >
              <Tooltip permanent direction="center" className="dist-label drone">
                {metres(distanceM(base, dronePos))}
              </Tooltip>
            </Polyline>
          )}

          {/* rescue: dashed orange drone → victim line with the live distance (removed once delivered / cleared) */}
          {flying && dronePos && victim && (
            <Polyline
              positions={[
                [dronePos.lat, dronePos.lng],
                [victim.lat, victim.lng],
              ]}
              pathOptions={{ color: '#ff6b1a', weight: 3, dashArray: '10 8' }}
            >
              <Tooltip permanent direction="center" className="dist-label rescue">
                {metres(distanceM(dronePos, victim))} to victim
              </Tooltip>
            </Polyline>
          )}
          {rescueTarget && flying && (
            <Marker position={[rescueTarget.lat, rescueTarget.lng]} icon={targetIcon} zIndexOffset={100}>
              <Tooltip direction="bottom" offset={[0, 12]}>
                Drone go-to target
              </Tooltip>
            </Marker>
          )}

          <Marker position={[base.lat, base.lng]} icon={baseIcon} zIndexOffset={-100}>
            <Tooltip direction="top" offset={[0, -16]}>
              Base station
            </Tooltip>
          </Marker>

          {watchPos && (
            <Marker position={[watchPos.lat, watchPos.lng]} icon={swimmerIcon(swimmerState)} zIndexOffset={200}>
              <Tooltip direction="top" offset={[0, -16]}>
                {swimmerTip}
              </Tooltip>
            </Marker>
          )}

          {dronePos && drone.headingDeg != null && (
            <Polyline positions={headingLine(dronePos, drone.headingDeg, zoom)} pathOptions={{ color: '#e0242b', weight: 2.5 }} />
          )}
          {dronePos && (
            <Marker
              position={[dronePos.lat, dronePos.lng]}
              icon={droneIcon(drone.headingDeg ?? 0, drone.armed)}
              zIndexOffset={300}
            />
          )}

          {ctx && (
            <Popup position={[ctx.lat, ctx.lng]} eventHandlers={{ remove: () => setCtx(null) }}>
              <div className="ctx-menu">
                <div className="mono">
                  {ctx.lat.toFixed(7)}, {ctx.lng.toFixed(7)}
                </div>
                <button onClick={() => void confirmBase(ctx)}>Set base station here</button>
              </div>
            </Popup>
          )}
        </MapContainer>

        <Hud />
        <DroneControls />

        <div className="zoom-ctl">
          <button onClick={() => zoomBy(0.5)} disabled={zoom >= config.map.maxZoom} title="Zoom in (stays centred on the base station)">
            +
          </button>
          <button onClick={() => zoomBy(-0.5)} disabled={zoom <= config.map.minZoom} title="Zoom out (stays centred on the base station)">
            −
          </button>
          <button
            className={`fit ${autoFit ? 'on' : ''}`}
            onClick={() => setAutoFit(true)}
            title="Auto-fit: keep the swimmer and the drone in view. Paused after a manual zoom."
          >
            Auto-fit
          </button>
        </div>
      </div>

      <CoordBar base={base} autoFit={autoFit} />
    </section>
  );
}
