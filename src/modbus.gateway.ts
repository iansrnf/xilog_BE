import { WebSocketGateway, OnGatewayConnection } from '@nestjs/websockets';
import { ModbusStreamService } from './modbus-stream.service';

@WebSocketGateway({ path: '/modbus' })
export class ModbusGateway implements OnGatewayConnection {
  constructor(private readonly modbusStream: ModbusStreamService) {}

  handleConnection(client: any, req: any) {
    const url = new URL(req.url, 'http://localhost');
    const device =
      url.searchParams.get('device') ??
      url.searchParams.get('station') ??
      url.searchParams.get('deviceId');

    if (device) {
      this.modbusStream.subscribeDevice(device, client);
      client.on('close', () => this.modbusStream.unsubscribeDevice(device, client));
      return;
    }

    this.modbusStream.subscribeAll(client);
    client.on('close', () => this.modbusStream.unsubscribeAll(client));
  }
}
