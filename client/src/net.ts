// WebSocket connection with MessagePack encoding, RTT measurement and a
// dev network-condition simulator (?lag=120&jitter=30&loss=2).
import { decode, encode } from '@msgpack/msgpack';
import type { ClientMsg } from './generated/ClientMsg';
import type { ServerMsg } from './generated/ServerMsg';

interface LagSim {
  lag: number;
  jitter: number;
  loss: number;
}

function readLagSim(): LagSim | null {
  const q = new URLSearchParams(location.search);
  if (!q.has('lag') && !q.has('jitter') && !q.has('loss')) return null;
  return { lag: +(q.get('lag') ?? 0), jitter: +(q.get('jitter') ?? 0), loss: +(q.get('loss') ?? 0) };
}

/** Delays messages one way (half the simulated RTT), keeping order like TCP does. */
class DelayLine<T> {
  private last = 0;
  constructor(
    private sim: LagSim,
    private deliver: (v: T) => void,
  ) {}
  push(v: T): void {
    let d = this.sim.lag / 2 + (Math.random() * 2 - 1) * this.sim.jitter;
    // A "lost" packet over TCP arrives late after retransmission.
    if (Math.random() * 100 < this.sim.loss) d += 200;
    const at = Math.max(performance.now() + Math.max(d, 0), this.last);
    this.last = at;
    setTimeout(() => this.deliver(v), at - performance.now());
  }
}

export type Handler = (msg: ServerMsg) => void;

export class Net {
  private ws!: WebSocket;
  private handlers = new Set<Handler>();
  private sim = readLagSim();
  private outLine?: DelayLine<Uint8Array>;
  private inLine?: DelayLine<ServerMsg>;
  rtt = 50;
  rttJitter = 0;
  lastSnapshotBytes = 0;
  bytesIn = 0;
  connected = false;
  onClose?: () => void;

  connect(): Promise<void> {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    this.ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws.binaryType = 'arraybuffer';
    if (this.sim) {
      this.outLine = new DelayLine(this.sim, (b) => this.ws.readyState === WebSocket.OPEN && this.ws.send(b));
      this.inLine = new DelayLine(this.sim, (m) => this.dispatch(m));
    }
    this.ws.onmessage = (e) => {
      const bytes = new Uint8Array(e.data as ArrayBuffer);
      this.bytesIn += bytes.length;
      const msg = decode(bytes) as ServerMsg;
      if (msg.t === 'Snap') this.lastSnapshotBytes = bytes.length;
      if (this.inLine) this.inLine.push(msg);
      else this.dispatch(msg);
    };
    this.ws.onclose = () => {
      this.connected = false;
      this.onClose?.();
    };
    return new Promise((resolve, reject) => {
      this.ws.onopen = () => {
        this.connected = true;
        setInterval(() => this.send({ t: 'Ping', time: performance.now() }), 1000);
        resolve();
      };
      this.ws.onerror = () => reject(new Error('connection failed'));
    });
  }

  private queued: ServerMsg[] = [];

  private dispatch(msg: ServerMsg): void {
    if (msg.t === 'Pong') {
      const sample = performance.now() - msg.time;
      this.rttJitter = this.rttJitter * 0.8 + Math.abs(sample - this.rtt) * 0.2;
      this.rtt = this.rtt * 0.7 + sample * 0.3;
      return;
    }
    // Messages that arrive before the UI subscribes (Welcome, first Lobby) are kept.
    if (this.handlers.size === 0) this.queued.push(msg);
    for (const h of this.handlers) h(msg);
  }

  on(h: Handler): () => void {
    this.handlers.add(h);
    const q = this.queued.splice(0);
    for (const m of q) h(m);
    return () => this.handlers.delete(h);
  }

  send(msg: ClientMsg): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    const bytes = encode(msg, { ignoreUndefined: true });
    if (this.outLine) this.outLine.push(bytes);
    else this.ws.send(bytes);
  }
}
