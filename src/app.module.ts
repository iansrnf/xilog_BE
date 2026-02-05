import { Module } from '@nestjs/common';
import { HubService } from './hub/hub.service';
import { DeviceGateway } from './ws/device.gateway';
import { StreamGateway } from './ws/stream.gateway';

@Module({
  providers: [HubService, DeviceGateway, StreamGateway],
})
export class AppModule {}
