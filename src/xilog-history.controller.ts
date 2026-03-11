import { Controller, Get, Query } from '@nestjs/common';
import { XilogLoggerService } from './xilog-logger.service';

@Controller('xilog')
export class XilogHistoryController {
  constructor(private readonly xilogLoggerService: XilogLoggerService) {}

  @Get('history')
  async getHistory(
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('deviceId') deviceId?: string,
  ) {
    return this.xilogLoggerService.getHistory(from, to, deviceId);
  }
}
