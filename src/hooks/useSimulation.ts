import { useEffect } from 'react';
import { useStore } from '../store/useStore';
import { startSimulator, stopSimulator } from '../services/simulator';
import { startDroneSim, stopDroneSim } from '../services/droneSim';
import { bridgeConnected } from '../services/droneSocket';

/** Starts/stops the watch and drone simulators when the Simulate toggle changes. */
export function useSimulation(): void {
  const simulate = useStore((s) => s.settings.simulate);
  useEffect(() => {
    if (!simulate) return;
    const { resetTelemetry, setLink, setDroneLink } = useStore.getState();
    resetTelemetry();
    startSimulator();
    startDroneSim();
    return () => {
      stopSimulator();
      stopDroneSim();
      setDroneLink({ wsConnected: bridgeConnected() });
      resetTelemetry();
      setLink({ receiverReady: null, lastHbAt: null });
    };
  }, [simulate]);
}
