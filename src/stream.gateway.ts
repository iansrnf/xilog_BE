import { WebSocketGateway, OnGatewayConnection } from '@nestjs/websockets';
import { HubService } from './hub.service';

@WebSocketGateway({ path: '/stream' })
export class StreamGateway implements OnGatewayConnection {
  constructor(private readonly hub: HubService) {}

  handleConnection(client: any, req: any) {
    const url = new URL(req.url, 'http://localhost');
    const queryDeviceId = url.searchParams.get('deviceId');

    client.on('message', (data: any) => {
      const raw = data.toString();
      let targetDeviceId = queryDeviceId;
      let payload: any = raw;
      let parsedObj: any = null;

      try {
        const parsed = JSON.parse(raw);
        parsedObj = parsed;
        payload = parsed;
        if (!targetDeviceId && parsed && typeof parsed === 'object') {
          targetDeviceId = parsed.deviceId ?? parsed.targetDeviceId ?? null;
        }
      } catch {
        // raw plain-text commands (e.g. "request_history") are forwarded as-is
      }

      const isHistoryRequest =
        parsedObj &&
        typeof parsedObj === 'object' &&
        ['request_history', 'get_history', 'history'].includes(
          String(parsedObj.type ?? parsedObj.action ?? parsedObj.event ?? '').toLowerCase(),
        );

      if (!targetDeviceId) {
        if (isHistoryRequest) {
          this.safeSend(client, {
            type: 'error',
            code: 'device_id_required',
            message: 'request_history requires deviceId in query or payload',
          });
        }
        return;
      }

      const sent = this.hub.sendToDevice(targetDeviceId, payload);
      if (!sent && isHistoryRequest) {
        this.safeSend(client, {
          type: 'error',
          code: 'device_not_connected',
          deviceId: targetDeviceId,
          message: 'Target device websocket is not connected',
        });
      }
    });

    if (queryDeviceId) {
      this.hub.subscribeDevice(queryDeviceId, client);
      client.on('close', () => this.hub.unsubscribeDevice(queryDeviceId, client));
      return;
    }

    // no deviceId query => subscribe to ALL devices
    this.hub.subscribeAll(client);
    client.on('close', () => this.hub.unsubscribeAll(client));
  }

  private safeSend(ws: any, payload: any) {
    if (ws.readyState !== ws.OPEN) return;
    try {
      ws.send(JSON.stringify(payload));
    } catch {}
  }
}
