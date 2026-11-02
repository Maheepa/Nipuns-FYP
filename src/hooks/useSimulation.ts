import { useEffect } from 'react';
import { resetWatch } from '../store/live';
import { useStore } from '../store/useStore';
import { startSimulator, stopSimulator } from '../services/simulator';
import { startDroneSim, stopDroneSim } from '../services/droneSim';
import { bridgeConnected } from '../services/droneSocket';

/** Starts/stops the watch and drone simulators when the Simulate toggle changes. */
export function useSimulation(): void {
  const simulate = useStore((s) => s.settings.simulate);
  useEffect(() => {
    if (!simulate) return;
    const { setLink, setDroneLink } = useStore.getState();
    resetWatch();
    startSimulator();
    startDroneSim();
    return () => {
      stopSimulator();
      stopDroneSim();
      setDroneLink({ wsConnected: bridgeConnected() });
      resetWatch();
      setLink({ receiverReady: null, lastHbAt: null });
    };
  }, [simulate]);
}
