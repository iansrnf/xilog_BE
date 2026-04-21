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
import { ModbusStreamService } from './modbus-stream.service';
import { ModbusGateway } from './modbus.gateway';

@Module({
  controllers: [XilogHistoryController, ModbusHistoryController],
  providers: [
    DatabaseService,
    ModbusPollerService,
    ModbusHistoryService,
    ModbusStreamService,
    XilogLoggerService,
    HubService,
    DeviceGateway,
    StreamGateway,
    ModbusGateway,
  ],
})
export class AppModule {}
