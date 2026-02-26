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

      try {
        const parsed = JSON.parse(raw);
        payload = parsed;
        if (!targetDeviceId && parsed && typeof parsed === 'object') {
          targetDeviceId = parsed.deviceId ?? parsed.targetDeviceId ?? null;
        }
      } catch {
        // raw plain-text commands (e.g. "request_history") are forwarded as-is
      }

      if (!targetDeviceId) return;
      this.hub.sendToDevice(targetDeviceId, payload);
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
}
