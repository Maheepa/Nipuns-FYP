// Web Serial connection to the LoRa receiver ESP32 (Chrome/Edge on localhost only).
//
// Teardown order matters: cancel the reader → wait for the pipe to settle →
// release the lock → close the port. Skipping a step leaves the port locked and the
// next open() throws "port is already open".

import { config } from '../config';
import { countBad } from '../store/live';
import { useStore } from '../store/useStore';
import { handleSerialLine } from './telemetry';

/** Splits a decoded text stream into lines (\n or \r\n). */
export class LineSplitter implements Transformer<string, string> {
  private buf = '';
  constructor(private readonly maxLine = 4096) {}

  transform(chunk: string, controller: TransformStreamDefaultController<string>): void {
    this.buf += chunk;
    const lines = this.buf.split(/\r?\n/);
    this.buf = lines.pop() ?? '';
    for (const l of lines) controller.enqueue(l);
    // A missing newline on a noisy line must not grow the buffer forever.
    if (this.buf.length > this.maxLine) this.buf = '';
  }

  flush(controller: TransformStreamDefaultController<string>): void {
    if (this.buf) controller.enqueue(this.buf);
    this.buf = '';
  }
}

export const webSerialSupported = (): boolean => typeof navigator !== 'undefined' && 'serial' in navigator;

// Errors after which port.readable is replaced and reading can continue.
const NON_FATAL = new Set(['BufferOverrunError', 'BreakError', 'FramingError', 'ParityError']);

let port: SerialPort | null = null;
let reader: ReadableStreamDefaultReader<string> | null = null;
let pipeDone: Promise<void> | null = null;
let closing = false;
let readLoop: Promise<void> | null = null;

function setLink(patch: Parameters<ReturnType<typeof useStore.getState>['setLink']>[0]) {
  useStore.getState().setLink(patch);
}

function logLink(message: string, kind: 'link' | 'error' = 'link') {
  useStore.getState().logEvent({ kind, message });
}

function onPortDisconnect() {
  // USB unplugged: the streams error out on their own; just clean up and report.
  void teardown().then(() => {
    setLink({ status: 'error', error: 'receiver unplugged', receiverReady: null });
    logLink('LoRa receiver unplugged (USB disconnect)', 'error');
  });
}

async function readAll(p: SerialPort): Promise<void> {
  while (p.readable && !closing) {
    const decoder = new TextDecoderStream();
    pipeDone = p.readable.pipeTo(decoder.writable as WritableStream<Uint8Array>).catch(() => {});
    reader = decoder.readable.pipeThrough(new TransformStream(new LineSplitter())).getReader();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value != null) handleSerialLine(value);
      }
    } catch (e) {
      const name = (e as DOMException)?.name;
      if (!closing && !NON_FATAL.has(name)) {
        setLink({ status: 'error', error: (e as Error)?.message ?? String(e) });
        logLink(`LoRa serial read error: ${(e as Error)?.message ?? String(e)}`, 'error');
        break;
      }
      // non-fatal (e.g. buffer overrun): count it and keep reading on the new readable
      if (!closing) countBad();
    } finally {
      try {
        reader?.releaseLock();
      } catch {
        /* already released */
      }
      reader = null;
      await pipeDone;
      pipeDone = null;
    }
  }
}

async function teardown(): Promise<void> {
  closing = true;
  const p = port;
  try {
    await reader?.cancel();
  } catch {
    /* reader already errored */
  }
  try {
    await readLoop;
  } catch {
    /* loop errors are reported inside */
  }
  if (p) {
    p.removeEventListener('disconnect', onPortDisconnect);
    try {
      await p.close();
    } catch {
      /* already closed (e.g. unplugged) */
    }
  }
  port = null;
  readLoop = null;
  closing = false;
}

export async function connectLora(): Promise<void> {
  if (!webSerialSupported()) {
    setLink({ status: 'unsupported' });
    return;
  }
  if (port) await teardown(); // never stack two connections

  setLink({ status: 'connecting', error: null, receiverReady: null, lastHbAt: null });

  let p: SerialPort;
  try {
    p = await navigator.serial.requestPort();
  } catch (e) {
    // NotFoundError = user closed the picker without choosing
    const cancelled = (e as DOMException)?.name === 'NotFoundError';
    setLink({ status: cancelled ? 'disconnected' : 'error', error: cancelled ? null : (e as Error).message });
    return;
  }

  try {
    await p.open({ baudRate: config.serial.baudRate, bufferSize: 8192 });
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    setLink({
      status: 'error',
      error: /already open/i.test(msg) ? 'port busy (close Arduino Serial Monitor)' : msg,
    });
    return;
  }

  // ESP32 dev boards wire DTR/RTS to EN/IO0. Release both so the board runs normally
  // (it reboots once and prints READY|...).
  try {
    await p.setSignals({ dataTerminalReady: false, requestToSend: false });
  } catch {
    /* not supported by every adapter */
  }

  port = p;
  p.addEventListener('disconnect', onPortDisconnect);
  setLink({ status: 'connected', connectedAt: Date.now() });
  logLink('LoRa receiver connected (115200 baud)');
  readLoop = readAll(p);
}

export async function disconnectLora(): Promise<void> {
  await teardown();
  setLink({ status: 'disconnected', error: null, receiverReady: null, lastHbAt: null, connectedAt: null });
  logLink('LoRa receiver disconnected');
}
