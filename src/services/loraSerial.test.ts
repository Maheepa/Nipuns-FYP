import { describe, expect, it } from 'vitest';
import { LineSplitter } from './loraSerial';

async function split(chunks: string[]): Promise<string[]> {
  const ts = new TransformStream(new LineSplitter(64));
  const writer = ts.writable.getWriter();
  const out: string[] = [];
  const reading = (async () => {
    const r = ts.readable.getReader();
    for (;;) {
      const { value, done } = await r.read();
      if (done) break;
      out.push(value);
    }
  })();
  for (const c of chunks) await writer.write(c);
  await writer.close();
  await reading;
  return out;
}

describe('LineSplitter', () => {
  it('joins lines split across chunks and handles CRLF', async () => {
    expect(await split(['RX|DA', 'TA|BPM:1\r\nHB|5', '000\n', 'READY|LORA_OK\n'])).toEqual([
      'RX|DATA|BPM:1',
      'HB|5000',
      'READY|LORA_OK',
    ]);
  });

  it('flushes a trailing partial line on close', async () => {
    expect(await split(['HB|1\nHB|2'])).toEqual(['HB|1', 'HB|2']);
  });

  it('drops an over-long line without a newline', async () => {
    expect(await split(['x'.repeat(100), 'y\nHB|3\n'])).toEqual(['y', 'HB|3']);
  });
});
