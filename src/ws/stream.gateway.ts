import { Injectable, OnModuleDestroy } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, WebSocket } from 'ws';
import { Subscription } from 'rxjs';
import { HubService } from '../hub/hub.service';

function nowIso() {
  return new Date().toISOString();
}

@WebSocketGateway({ path: '/stream' })
@Injectable()
export class StreamGateway implements OnGatewayConnection, OnGatewayDisconnect, OnModuleDestroy {
  @WebSocketServer()
  server!: Server;

  private readonly clients = new Set<WebSocket>();
  private sub?: Subscription;

  constructor(private readonly hub: HubService) {
    this.sub = this.hub.feed$.subscribe((msg) => this.broadcast(msg));
  }

  onModuleDestroy() {
    this.sub?.unsubscribe();
  }

  handleConnection(client: WebSocket, req: any) {
    // Optional client token
    const required = (process.env.CLIENT_TOKEN ?? '').trim();
    if (required) {
      const url = new URL(req.url, 'http://localhost');
      const token = url.searchParams.get('token') ?? '';
      if (token !== required) {
        try {
          client.close(1008, 'unauthorized');
        } catch {}
        return;
      }
    }

    this.clients.add(client);

    // Hello
    this.safeSend(client, { type: 'hello', timestamp: nowIso(), message: 'connected to backend' });

    // Snapshot
    if (this.hub.lastReading) {
      this.safeSend(client, { type: 'snapshot', timestamp: nowIso(), data: this.hub.lastReading });
    }
  }

  handleDisconnect(client: WebSocket) {
    this.clients.delete(client);
  }

  private broadcast(payload: any) {
    const msg = JSON.stringify(payload);
    for (const c of this.clients) {
      if (c.readyState !== c.OPEN) continue;
      try {
        c.send(msg);
      } catch {
        this.clients.delete(c);
      }
    }
  }

  private safeSend(client: WebSocket, payload: any) {
    if (client.readyState !== client.OPEN) return;
    try {
      client.send(JSON.stringify(payload));
    } catch {}
  }
}
