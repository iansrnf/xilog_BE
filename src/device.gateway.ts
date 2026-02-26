import { WebSocketGateway, OnGatewayConnection } from '@nestjs/websockets';
import { HubService } from './hub.service';

@WebSocketGateway({ path: '/device' })
export class DeviceGateway implements OnGatewayConnection {
  constructor(private readonly hub: HubService) {}

  handleConnection(client: any, req: any) {
    const url = new URL(req.url, 'http://localhost');
    const deviceId = url.searchParams.get('deviceId');
    if (!deviceId) return client.close();
    this.hub.registerDevice(deviceId, client);

    client.on('close', () => {
      this.hub.unregisterDevice(deviceId, client);
    });

    client.on('message', (data: any) => {
      try {
        const msg = JSON.parse(data.toString());
        // ensure deviceId always present in stream messages
        this.hub.publish(deviceId, { deviceId, ...msg });
      } catch {}
    });
  }
}
