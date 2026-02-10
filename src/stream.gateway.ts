import { WebSocketGateway, OnGatewayConnection } from '@nestjs/websockets';
import { HubService } from './hub.service';

@WebSocketGateway({ path: '/stream' })
export class StreamGateway implements OnGatewayConnection {
  constructor(private readonly hub: HubService) {}

  handleConnection(client: any, req: any) {
    const url = new URL(req.url, 'http://localhost');
    const deviceId = url.searchParams.get('deviceId');

    if (deviceId) {
      this.hub.subscribeDevice(deviceId, client);
      client.on('close', () => this.hub.unsubscribeDevice(deviceId, client));
      return;
    }

    // no deviceId => subscribe to ALL devices
    this.hub.subscribeAll(client);
    client.on('close', () => this.hub.unsubscribeAll(client));
  }
}
