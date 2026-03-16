import { Controller, Get, Query } from '@nestjs/common';
import { ModbusHistoryService } from './modbus-history.service';

@Controller('modbus')
export class ModbusHistoryController {
  constructor(private readonly modbusHistoryService: ModbusHistoryService) {}

  @Get('history')
  async getHistory(
    @Query('station') station: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.modbusHistoryService.getHistory(station, from, to);
  }
}
