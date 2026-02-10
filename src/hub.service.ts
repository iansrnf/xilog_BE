import { Injectable } from '@nestjs/common';

@Injectable()
export class HubService {
  private last = new Map<string, any>();

  // deviceId -> subscribers
  private perDevice = new Map<string, Set<any>>();

  // subscribers to ALL devices
  private all = new Set<any>();

  publish(deviceId: string, msg: any) {
    this.last.set(deviceId, msg);
    const data = JSON.stringify(msg);

    const subs = this.perDevice.get(deviceId);
    if (subs) {
      for (const ws of subs) this.safeSend(ws, data);
    }
    for (const ws of this.all) this.safeSend(ws, data);
  }

  subscribeDevice(deviceId: string, ws: any) {
    if (!this.perDevice.has(deviceId)) this.perDevice.set(deviceId, new Set());
    this.perDevice.get(deviceId)!.add(ws);

    const last = this.last.get(deviceId);
    if (last) {
      try { ws.send(JSON.stringify({ type: 'snapshot', data: last })); } catch {}
    }
  }

  unsubscribeDevice(deviceId: string, ws: any) {
    this.perDevice.get(deviceId)?.delete(ws);
  }

  subscribeAll(ws: any) {
    this.all.add(ws);
    // optional: send snapshots for all known devices
    for (const last of this.last.values()) {
      try { ws.send(JSON.stringify({ type: 'snapshot', data: last })); } catch {}
    }
  }

  unsubscribeAll(ws: any) {
    this.all.delete(ws);
  }

  private safeSend(ws: any, data: string) {
    if (ws.readyState !== ws.OPEN) return;
    try { ws.send(data); } catch {}
  }
}
