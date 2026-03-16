import { Module } from '@nestjs/common';
import { HubService } from './hub.service';
import { DeviceGateway } from './device.gateway';
import { StreamGateway } from './stream.gateway';
import { DatabaseService } from './database.service';
import { ModbusPollerService } from './modbus-poller.service';
import { ModbusHistoryService } from './modbus-history.service';
import { ModbusHistoryController } from './modbus-history.controller';
import { XilogLoggerService } from './xilog-logger.service';
import { XilogHistoryController } from './xilog-history.controller';

@Module({
  controllers: [XilogHistoryController, ModbusHistoryController],
  providers: [
    DatabaseService,
    ModbusPollerService,
    ModbusHistoryService,
    XilogLoggerService,
    HubService,
    DeviceGateway,
    StreamGateway,
  ],
})
export class AppModule {}
