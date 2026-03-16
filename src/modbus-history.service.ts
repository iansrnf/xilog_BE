import { BadRequestException, Injectable } from '@nestjs/common';
import { DatabaseService } from './database.service';

type ModbusHistoryTarget =
  | {
      tableName: string;
      kind: 'station';
    }
  | {
      tableName: string;
      kind: 'reservoir';
    };

const MODBUS_HISTORY_TARGETS: Record<string, ModbusHistoryTarget> = {
  ps1: { tableName: 'ps1_scada', kind: 'station' },
  ps2: { tableName: 'ps2_scada', kind: 'station' },
  ps5: { tableName: 'ps5_scada', kind: 'station' },
  ps6: { tableName: 'ps6_scada', kind: 'station' },
  ps7: { tableName: 'ps7_scada', kind: 'station' },
  ps8: { tableName: 'ps8_scada', kind: 'station' },
  ps26: { tableName: 'ps26_scada', kind: 'station' },
  reservoir: { tableName: 'ps1_tank_scada', kind: 'reservoir' },
};

@Injectable()
export class ModbusHistoryService {
  constructor(private readonly database: DatabaseService) {}

  async getHistory(station: string, from: string, to: string) {
    const target = this.parseStation(station);
    const fromDate = this.parseDateParam(from, 'from');
    const toDate = this.parseDateParam(to, 'to');

    if (fromDate > toDate) {
      throw new BadRequestException('from must be earlier than or equal to to');
    }

    const query =
      target.kind === 'reservoir'
        ? `
            SELECT
              id,
              waterlevel,
              flowmeter,
              volume,
              datetime AS "loggedAt"
            FROM ${target.tableName}
            WHERE datetime BETWEEN $1 AND $2
            ORDER BY datetime ASC, id ASC
          `
        : `
            SELECT
              id,
              waterlevel,
              pressure,
              flowmeter,
              turbidity,
              humidity,
              chlorine,
              datetime AS "loggedAt"
            FROM ${target.tableName}
            WHERE datetime BETWEEN $1 AND $2
            ORDER BY datetime ASC, id ASC
          `;

    const result = await this.database.query(query, [
      fromDate.toISOString(),
      toDate.toISOString(),
    ]);

    return {
      station: station.trim().toLowerCase(),
      from: fromDate.toISOString(),
      to: toDate.toISOString(),
      count: result.rowCount ?? result.rows.length,
      rows: result.rows,
    };
  }

  private parseStation(station: string): ModbusHistoryTarget {
    if (!station || station.trim() === '') {
      throw new BadRequestException('station query parameter is required');
    }

    const normalized = station.trim().toLowerCase();
    const target = MODBUS_HISTORY_TARGETS[normalized];

    if (!target) {
      throw new BadRequestException(
        `station must be one of: ${Object.keys(MODBUS_HISTORY_TARGETS).join(', ')}`,
      );
    }

    return target;
  }

  private parseDateParam(value: string, name: string): Date {
    if (!value || value.trim() === '') {
      throw new BadRequestException(`${name} query parameter is required`);
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException(`${name} must be a valid date`);
    }

    return parsed;
  }
}
