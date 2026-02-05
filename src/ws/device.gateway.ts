import { Injectable } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, WebSocket } from 'ws';
import { HubService } from '../hub/hub.service';

function nowIso() {
  return new Date().toISOString();
}

function parseAllowedTokens(): Set<string> {
  const raw = (process.env.DEVICE_TOKENS ?? '').trim();
  const tokens = raw
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  return new Set(tokens);
}

@WebSocketGateway({ path: '/device' })
@Injectable()
export class DeviceGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly allowed = parseAllowedTokens();
  private readonly devices = new Set<WebSocket>();

  constructor(private readonly hub: HubService) {}

  handleConnection(client: WebSocket, req: any) {
    // Require device token
    if (this.allowed.size > 0) {
      const url = new URL(req.url, 'http://localhost');
      const token = url.searchParams.get('token') ?? '';
      if (!this.allowed.has(token)) {
        try {
          client.close(1008, 'unauthorized');
        } catch {}
        return;
      }
    }

    this.devices.add(client);

    // Notify stream clients that a device connected
    this.hub.publish({ type: 'device_status', timestamp: nowIso(), status: 'connected' });

    client.on('message', (data) => {
      let msg: any;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        // ignore non-JSON
        return;
      }

      // Basic validation: expect an object
      if (!msg || typeof msg !== 'object') return;

      // Forward readings to stream clients
      this.hub.publish(msg);
    });

    client.on('close', () => {
      this.devices.delete(client);
      this.hub.publish({ type: 'device_status', timestamp: nowIso(), status: 'disconnected' });
    });

    client.on('error', () => {
      // close handler will emit disconnected
    });
  }

  handleDisconnect(client: WebSocket) {
    this.devices.delete(client);
  }
}
