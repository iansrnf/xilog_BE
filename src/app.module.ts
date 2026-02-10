import { Module } from '@nestjs/common';
import { HubService } from './hub.service';
import { DeviceGateway } from './device.gateway';
import { StreamGateway } from './stream.gateway';

@Module({
  providers: [HubService, DeviceGateway, StreamGateway],
})
export class AppModule {}
