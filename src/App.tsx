import { useEffect, useState } from 'react';
import { AlertBanner } from './components/AlertBanner';
import { ConfirmHost } from './components/ConfirmHost';
import { EventLog } from './components/EventLog';
import { Header } from './components/Header';
import { HeartPanel } from './components/HeartPanel';
import { MapPanel } from './components/MapPanel';
import { MpuPanel } from './components/MpuPanel';
import { RescueActions } from './components/RescueActions';
import { ReservedPanel } from './components/ReservedPanel';
import { SettingsDialog } from './components/SettingsDialog';
import { useSimulation } from './hooks/useSimulation';
import { setAlarm, unlockAudioOnFirstGesture } from './services/alarm';
import { initAlerts } from './services/alerts';
import { startDroneSocket } from './services/droneSocket';
import { connectLora, disconnectLora, webSerialSupported } from './services/loraSerial';
import { initRescueTracker } from './services/rescue';
import { useStore } from './store/useStore';

export default function App() {
  useSimulation();
  const linkStatus = useStore((s) => s.link.status);
  const alarmOn = useStore((s) => !!s.alert && !s.alert.acknowledged && !s.settings.muted);
  const [logOpen, setLogOpen] = useState(false);

  useEffect(() => {
    if (!webSerialSupported()) useStore.getState().setLink({ status: 'unsupported' });
    unlockAudioOnFirstGesture();
    const stops = [initAlerts(), startDroneSocket(), initRescueTracker()];
    useStore.getState().logEvent({ kind: 'info', message: 'Base station started (dry-run ON)' });
    return () => stops.forEach((stop) => stop());
  }, []);

  useEffect(() => setAlarm(alarmOn), [alarmOn]);

  return (
    <div className="app">
      <Header onConnect={connectLora} onDisconnect={disconnectLora} onOpenLog={() => setLogOpen(true)} />
      <div className="banners">
        {linkStatus === 'unsupported' && (
          <div className="banner unsupported">
            ⚠ This browser has no Web Serial API, so the LoRa receiver cannot be connected. Open the app in
            Chrome or Edge at http://localhost:5173. Simulation mode still works.
          </div>
        )}
        <AlertBanner actions={<RescueActions />} />
      </div>
      <main className="main">
        <MapPanel />
        <div className="bottom">
          <ReservedPanel />
          <div className="right-stack">
            <MpuPanel />
            <HeartPanel />
          </div>
        </div>
      </main>
      <EventLog open={logOpen} onClose={() => setLogOpen(false)} />
      <SettingsDialog />
      <ConfirmHost />
    </div>
  );
}
