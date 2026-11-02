import { useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, Marker, Polyline, Popup, TileLayer, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import type { LatLngExpression } from 'leaflet';
import { create } from 'zustand';
import { config, type LatLng } from '../config';
import { destination, distanceM, fitZoomAroundCenter } from '../geo';
import { metres } from '../format';
import { useNow } from '../hooks/useNow';
import { useStore } from '../store/useStore';
import { Hud } from './Hud';
import { SimControls } from './SimControls';
import { baseIcon, droneIcon, swimmerIcon, targetIcon, type SwimmerState } from './mapIcons';
import { DroneControls } from './DroneControls';

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
  onFitZoom: (z: number | null) => void;
}

/**
 * Keeps the base station at the exact centre of the map and chooses the zoom:
 *  - auto: the highest zoom that keeps every marker inside the view (with padding)
 *  - manual: the +/- zoom, but never closer than the auto-fit (markers stay visible)
 */
function CenterLockController({ base, points, autoFit, manualZoom, onFitZoom }: ControllerProps) {
  const map = useMap();
  const latest = useRef({ base, points, autoFit, manualZoom });
  latest.current = { base, points, autoFit, manualZoom };

  const apply = useRef(() => {});
  const applying = useRef(false);
  apply.current = () => {
    const { base, points, autoFit, manualZoom } = latest.current;
    const size = map.getSize();
    if (size.x === 0 || size.y === 0) return;

    const fit = fitZoomAroundCenter(base, points, size.x, size.y, config.map.autoZoomPaddingPx);
    const fitSnapped = fit == null ? null : clampZoom(snapDown(Math.min(fit, MAX_AUTO_ZOOM)));
    onFitZoom(fitSnapped);

    const current = map.getZoom();
    let target: number;
    if (autoFit) {
      if (fitSnapped == null) target = config.map.defaultZoom;
      else if (fitSnapped < current) target = fitSnapped; // must zoom out to keep markers in view
      else if (fitSnapped - current >= 0.75) target = fitSnapped - config.map.zoomSnap; // zoom in, with margin
      else target = current; // hysteresis: avoid zoom jitter as markers move a little
    } else {
      target = fitSnapped == null ? manualZoom : Math.min(manualZoom, fitSnapped);
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

  // Re-apply when inputs change (markers move every second).
  useEffect(() => {
    apply.current();
  });

  // Snap back after anything moves the map, and re-centre on container resize.
  useEffect(() => {
    const snap = () => apply.current();
    map.on('moveend', snap);
    const ro = new ResizeObserver(() => {
      map.invalidateSize({ pan: false });
      apply.current();
    });
    ro.observe(map.getContainer());
    return () => {
      map.off('moveend', snap);
      ro.disconnect();
    };
  }, [map]);

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

function CoordBar({ base, autoFit }: { base: LatLng; autoFit: boolean }) {
  const { pos, zoom } = useCursor();
  const tileSource = useStore((s) => s.settings.tileSource);
  const setTileSource = useStore((s) => s.setTileSource);
  const p = pos ?? base;
  return (
    <div className="coord-bar">
      <span className="geo-tag">GEO</span>
      <span className="mono">
        {p.lat.toFixed(7)} {p.lng.toFixed(7)}
      </span>
      <span className="muted">{pos ? 'cursor' : 'base station'}</span>
      {pos && <span className="mono muted">{metres(distanceM(base, pos))} from base</span>}
      <span className="spacer" />
      <span>
        Zoom <b className="mono">{zoom.toFixed(2)}</b> {autoFit ? '(auto)' : '(manual)'}
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

export function MapPanel() {
  const now = useNow(1000);
  const base = useStore((s) => s.settings.baseStation);
  const setBaseStation = useStore((s) => s.setBaseStation);
  const tileSource = useStore((s) => s.settings.tileSource);
  const watchPos = useStore((s) => s.watch.position);
  const watchStale = useStore((s) => s.watch.positionStale);
  const lastPacketAt = useStore((s) => s.stats.lastPacketAt);
  const drone = useStore((s) => s.drone);

  const [autoFit, setAutoFit] = useState(true);
  const [manualZoom, setManualZoom] = useState(config.map.defaultZoom);
  const [fitZoom, setFitZoom] = useState<number | null>(null);
  const [ctx, setCtx] = useState<LatLng | null>(null);
  const [zoom, setZoom] = useState(config.map.defaultZoom);
  useEffect(() => useCursor.subscribe((s) => setZoom(s.zoom)), []);

  const droneLive = drone.lastMsgAt != null && now - drone.lastMsgAt < config.bridge.telemetryTimeoutMs * 3;
  const dronePos = droneLive ? drone.position : null;

  // Watch is "stale" with no fix, or when packets stopped arriving.
  const packetsStale = lastPacketAt == null || now - lastPacketAt > config.serial.packetStaleMs;
  const alertLevel = useStore((s) => s.alert?.level ?? null);
  // An alert always wins (pulsing red/amber) — even on a last-known position.
  const swimmerState: SwimmerState =
    alertLevel === 'drowning' ? 'alert' : alertLevel === 'warning' ? 'warning' : watchStale || packetsStale ? 'stale' : 'normal';

  const rescueStage = useStore((s) => s.rescue.stage);
  const rescueTarget = useStore((s) => s.rescue.target);
  const flying = rescueStage === 'dispatched' || rescueStage === 'enroute' || rescueStage === 'ontarget';

  const points = useMemo(() => {
    const pts: LatLng[] = [];
    if (watchPos) pts.push(watchPos);
    if (dronePos) pts.push(dronePos);
    if (rescueTarget) pts.push(rescueTarget);
    return pts;
  }, [watchPos, dronePos, rescueTarget]);

  const zoomBy = (dz: number) => {
    const current = useCursor.getState().zoom;
    let z = clampZoom(current + dz);
    if (fitZoom != null) z = Math.min(z, fitZoom);
    setManualZoom(z);
    setAutoFit(false);
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
          scrollWheelZoom={false}
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

          <CenterLockController
            base={base}
            points={points}
            autoFit={autoFit}
            manualZoom={manualZoom}
            onFitZoom={setFitZoom}
          />
          <MapEvents onContext={setCtx} />

          {/* drone GPS track (black, like Mission Planner) */}
          {drone.track.length > 1 && (
            <Polyline positions={drone.track} pathOptions={{ color: '#000', weight: 2.5, opacity: 0.9 }} />
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

          <Marker position={[base.lat, base.lng]} icon={baseIcon} zIndexOffset={-100}>
            <Tooltip direction="top" offset={[0, -16]}>
              Base station
            </Tooltip>
          </Marker>

          {watchPos && (
            <Marker position={[watchPos.lat, watchPos.lng]} icon={swimmerIcon(swimmerState)} zIndexOffset={200}>
              <Tooltip direction="top" offset={[0, -16]}>
                Swimmer {swimmerState === 'stale' ? '(last known position)' : ''}
              </Tooltip>
            </Marker>
          )}

          {/* rescue: dashed orange drone → victim line and the go-to target */}
          {flying && dronePos && (rescueTarget ?? watchPos) && (
            <Polyline
              positions={[
                [dronePos.lat, dronePos.lng],
                [(rescueTarget ?? watchPos)!.lat, (rescueTarget ?? watchPos)!.lng],
              ]}
              pathOptions={{ color: '#ff6b1a', weight: 3, dashArray: '10 8' }}
            />
          )}
          {rescueTarget && rescueStage !== 'idle' && (
            <Marker position={[rescueTarget.lat, rescueTarget.lng]} icon={targetIcon} zIndexOffset={100}>
              <Tooltip direction="bottom" offset={[0, 12]}>
                Drone go-to target
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
                <button
                  onClick={() => {
                    setBaseStation(ctx);
                    setCtx(null);
                  }}
                >
                  Set base station here
                </button>
                <button
                  onClick={() => {
                    setBaseStation(null);
                    setCtx(null);
                  }}
                >
                  Reset base station to default
                </button>
              </div>
            </Popup>
          )}
        </MapContainer>

        <Hud />
        <DroneControls />

        <div className="zoom-ctl">
          <button onClick={() => zoomBy(0.5)} disabled={fitZoom != null && zoom >= fitZoom - 1e-6} title="Zoom in">
            +
          </button>
          <button onClick={() => zoomBy(-0.5)} disabled={zoom <= config.map.minZoom} title="Zoom out">
            −
          </button>
          <button className={autoFit ? 'on' : ''} onClick={() => setAutoFit(true)} title="Auto-zoom to keep swimmer and drone in view">
            AUTO
          </button>
        </div>
      </div>

      <CoordBar base={base} autoFit={autoFit} />
    </section>
  );
}
