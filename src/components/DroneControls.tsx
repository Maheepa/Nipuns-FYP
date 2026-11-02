import { useState } from 'react';
import { runCommands } from '../services/rescue';
import { live } from '../store/live';
import { useFrame } from '../store/ticker';
import { useStore } from '../store/useStore';
import { askConfirm, useUi } from '../store/useUi';

const ARM_CHECKLIST = [
  'Propellers are clear of people and objects (or removed for a bench test)',
  'Drone is on a level surface with GPS 3D fix',
  'A pilot with an RC transmitter is ready to take over',
];

/** Manual drone controls overlay (bottom-left of the map). Every button asks for confirmation. */
export function DroneControls() {
  const [open, setOpen] = useState(false);
  useFrame(2);
  const drone = live.drone;
  const stage = useStore((s) => s.rescue.stage);
  // During a rescue the ring may only drop On target; with no rescue running it stays
  // available for bench-testing the servo.
  const releaseAllowed = stage === 'idle' || stage === 'alert' || stage === 'ontarget';
  const setSettingsOpen = useUi((s) => s.setSettingsOpen);

  const run = async (title: string, body: string, label: string, cmds: Parameters<typeof runCommands>[1], danger = false, checklist?: string[]) => {
    if (await askConfirm({ title, body: <p>{body}</p>, confirmLabel: label, tone: danger ? 'danger' : 'normal', checklist })) {
      await runCommands(label, cmds);
    }
  };

  const { altitudeM: alt, releaseServoChannel, releasePwm, holdPwm } = useStore((s) => s.settings.rescue);

  return (
    <div className={`drone-ctl ${open ? 'open' : ''}`}>
      <button className="dc-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
        🚁 Drone controls {open ? '▾' : '▸'}
      </button>
      {open && (
        <div className="dc-buttons">
          <button onClick={() => run('Switch to GUIDED?', 'Sends SET_MODE GUIDED (custom mode 4).', 'GUIDED', [{ type: 'setMode', mode: 'GUIDED' }])}>
            GUIDED
          </button>
          <button
            className="danger"
            disabled={drone.armed}
            onClick={() =>
              run('ARM the motors?', 'Sends COMPONENT_ARM_DISARM (arm). Motors will spin.', 'ARM', [{ type: 'arm' }], true, ARM_CHECKLIST)
            }
          >
            ARM
          </button>
          <button
            onClick={() =>
              run(
                `Take off to ${alt} m?`,
                `Sends NAV_TAKEOFF to ${alt} m. Needs GUIDED mode and armed motors.`,
                'Take off',
                [{ type: 'takeoff', altM: alt }],
                true,
              )
            }
          >
            TAKEOFF
          </button>
          <button
            disabled={!releaseAllowed}
            title={releaseAllowed ? '' : 'During a rescue the ring can only be released On target'}
            onClick={() =>
              run(
                'Release the life ring?',
                `Sends DO_SET_SERVO ch${releaseServoChannel} = ${releasePwm} µs.`,
                'Release',
                [{ type: 'servo', channel: releaseServoChannel, pwm: releasePwm }],
                true,
              )
            }
          >
            RELEASE
          </button>
          <button
            onClick={() =>
              run('Close the release servo?', `Sends DO_SET_SERVO ch${releaseServoChannel} = ${holdPwm} µs.`, 'Hold', [
                { type: 'servo', channel: releaseServoChannel, pwm: holdPwm },
              ])
            }
          >
            HOLD
          </button>
          <button onClick={() => run('Return to launch?', 'Sends NAV_RETURN_TO_LAUNCH.', 'RTL', [{ type: 'rtl' }])}>RTL</button>
          <button
            disabled={!drone.armed}
            onClick={() =>
              run('DISARM the motors?', 'Sends COMPONENT_ARM_DISARM (disarm). Only works on the ground.', 'DISARM', [{ type: 'disarm' }], true)
            }
          >
            DISARM
          </button>
          <button className="icon" onClick={() => setSettingsOpen(true)} title="Rescue settings">
            ⚙
          </button>
        </div>
      )}
    </div>
  );
}
