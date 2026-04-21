import { Injectable } from '@nestjs/common';

export interface ModbusStreamMessage {
  device: string;
  kind: 'station' | 'reservoir';
  tableName: string;
  waterlevel: number | null;
  pressure?: number | null;
  flowmeter: number | null;
  turbidity?: number | null;
  humidity?: number | null;
  chlorine?: number | null;
  volume?: number | null;
  loggedAt: string;
}

@Injectable()
export class ModbusStreamService {
  private readonly last = new Map<string, ModbusStreamMessage>();
  private readonly perDevice = new Map<string, Set<any>>();
  private readonly all = new Set<any>();

  publish(device: string, message: ModbusStreamMessage) {
    this.last.set(device, message);
    const data = JSON.stringify(message);

    const subs = this.perDevice.get(device);
    if (subs) {
      for (const ws of subs) this.safeSend(ws, data);
    }

    for (const ws of this.all) this.safeSend(ws, data);
  }

  subscribeDevice(device: string, ws: any) {
    if (!this.perDevice.has(device)) this.perDevice.set(device, new Set());
    this.perDevice.get(device)!.add(ws);

    const last = this.last.get(device);
    if (last) {
      try {
        ws.send(JSON.stringify({ type: 'snapshot', data: last }));
      } catch {}
    }
  }

  unsubscribeDevice(device: string, ws: any) {
    this.perDevice.get(device)?.delete(ws);
  }

  subscribeAll(ws: any) {
    this.all.add(ws);
    for (const last of this.last.values()) {
      try {
        ws.send(JSON.stringify({ type: 'snapshot', data: last }));
      } catch {}
    }
  }

  unsubscribeAll(ws: any) {
    this.all.delete(ws);
  }

  private safeSend(ws: any, data: string) {
    if (ws.readyState !== ws.OPEN) return;
    try {
      ws.send(data);
    } catch {}
  }
}
