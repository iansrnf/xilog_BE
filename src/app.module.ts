import { Module } from '@nestjs/common';
import { HubService } from './hub.service';
import { DeviceGateway } from './device.gateway';
import { StreamGateway } from './stream.gateway';
import { DatabaseService } from './database.service';
import { XilogLoggerService } from './xilog-logger.service';
import { XilogHistoryController } from './xilog-history.controller';

@Module({
  controllers: [XilogHistoryController],
  providers: [
    DatabaseService,
    XilogLoggerService,
    HubService,
    DeviceGateway,
    StreamGateway,
  ],
})
export class AppModule {}
