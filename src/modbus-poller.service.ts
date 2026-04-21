import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import ModbusRTU from 'modbus-serial';
import { DatabaseService } from './database.service';
import {
  ModbusStreamMessage,
  ModbusStreamService,
} from './modbus-stream.service';

type StationFormat = 'scaled-16' | 'float-32';
type StationKind = 'station' | 'reservoir';

interface StationConfig {
  envKey: string;
  name: string;
  tableName: string;
  kind: StationKind;
  register: number;
  count: number;
  format: StationFormat;
}

class ModbusStationClient {
  private readonly client = new ModbusRTU();
  private connected = false;

  constructor(
    private readonly host: string,
    private readonly port: number,
  ) {}

  async readHoldingRegisters(register: number, count: number): Promise<number[]> {
    await this.ensureConnected();

    try {
      const { data } = await this.client.readHoldingRegisters(register, count);
      return data.map((value) => Number(value));
    } catch (error) {
      await this.resetConnection();
      throw error;
    }
  }

  async destroy(): Promise<void> {
    await this.resetConnection();
  }

  private async ensureConnected(): Promise<void> {
    if (this.connected) return;

    try {
      await this.client.connectTCP(this.host, { port: this.port });
      this.connected = true;
      this.client.setTimeout(5000);
    } catch (error) {
      this.connected = false;
      throw error;
    }
  }

  private async resetConnection(): Promise<void> {
    try {
      this.client.close(() => undefined);
    } catch {
      // ignore close errors during reconnect cleanup
    } finally {
      this.connected = false;
    }
  }
}

@Injectable()
export class ModbusPollerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ModbusPollerService.name);
  private readonly pollIntervalMs = Number(
    process.env.MODBUS_POLL_INTERVAL_MS ?? 15000,
  );
  private readonly stations: Array<StationConfig & { host: string; client: ModbusStationClient }> = [];
  private timer: NodeJS.Timeout | null = null;
  private polling = false;

  constructor(
    private readonly database: DatabaseService,
    private readonly modbusStream: ModbusStreamService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.ensureTables();
    this.initializeStations();

    if (this.stations.length === 0) {
      this.logger.warn('No Modbus stations configured. Polling is disabled.');
      return;
    }

    await this.pollOnce();
    this.timer = setInterval(() => {
      void this.pollOnce();
    }, this.pollIntervalMs);

    this.logger.log(
      `Passive Modbus polling started for ${this.stations.length} endpoints every ${this.pollIntervalMs}ms`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    await Promise.all(this.stations.map((station) => station.client.destroy()));
  }

  private initializeStations(): void {
    const configs: StationConfig[] = [
      {
        envKey: 'PS1_IP',
        name: 'ps1',
        tableName: 'ps1_scada',
        kind: 'station',
        register: 4,
        count: 6,
        format: 'scaled-16',
      },
      {
        envKey: 'PS2_IP',
        name: 'ps2',
        tableName: 'ps2_scada',
        kind: 'station',
        register: 4,
        count: 6,
        format: 'scaled-16',
      },
      {
        envKey: 'PS5_IP',
        name: 'ps5',
        tableName: 'ps5_scada',
        kind: 'station',
        register: 4,
        count: 6,
        format: 'scaled-16',
      },
      {
        envKey: 'PS6_IP',
        name: 'ps6',
        tableName: 'ps6_scada',
        kind: 'station',
        register: 4,
        count: 12,
        format: 'float-32',
      },
      {
        envKey: 'PS7_IP',
        name: 'ps7',
        tableName: 'ps7_scada',
        kind: 'station',
        register: 4,
        count: 12,
        format: 'float-32',
      },
      {
        envKey: 'PS8_IP',
        name: 'ps8',
        tableName: 'ps8_scada',
        kind: 'station',
        register: 4,
        count: 12,
        format: 'float-32',
      },
      {
        envKey: 'PS26_IP',
        name: 'ps26',
        tableName: 'ps26_scada',
        kind: 'station',
        register: 4,
        count: 12,
        format: 'float-32',
      },
      {
        envKey: 'RESERVOIR',
        name: 'reservoir',
        tableName: 'ps1_tank_scada',
        kind: 'reservoir',
        register: 2,
        count: 6,
        format: 'float-32',
      },
    ];

    this.stations.length = 0;

    for (const config of configs) {
      const host = process.env[config.envKey]?.trim();
      if (!host) {
        this.logger.warn(`Skipping ${config.name}: missing ${config.envKey}`);
        continue;
      }

      this.stations.push({
        ...config,
        host,
        client: new ModbusStationClient(host, 502),
      });
    }
  }

  private async ensureTables(): Promise<void> {
    const stationTables = [
      'ps1_scada',
      'ps2_scada',
      'ps5_scada',
      'ps6_scada',
      'ps7_scada',
      'ps8_scada',
      'ps26_scada',
    ];

    for (const tableName of stationTables) {
      await this.database.query(`
        CREATE TABLE IF NOT EXISTS ${tableName} (
          id SERIAL PRIMARY KEY,
          waterlevel DOUBLE PRECISION NULL,
          pressure DOUBLE PRECISION NULL,
          flowmeter DOUBLE PRECISION NULL,
          turbidity DOUBLE PRECISION NULL,
          humidity DOUBLE PRECISION NULL,
          chlorine DOUBLE PRECISION NULL,
          logged_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await this.ensureLoggedAtColumn(tableName);
    }

    await this.database.query(`
      CREATE TABLE IF NOT EXISTS ps1_tank_scada (
        id SERIAL PRIMARY KEY,
        waterlevel DOUBLE PRECISION NULL,
        flowmeter DOUBLE PRECISION NULL,
        volume DOUBLE PRECISION NULL,
        logged_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await this.ensureLoggedAtColumn('ps1_tank_scada');
  }

  private async ensureLoggedAtColumn(tableName: string): Promise<void> {
    await this.database.query(`
      ALTER TABLE ${tableName}
      ADD COLUMN IF NOT EXISTS logged_at TIMESTAMPTZ
    `);

    const hasDatetimeColumn = await this.database.query<{ exists: boolean }>(
      `
        SELECT EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = $1
            AND column_name = 'datetime'
        ) AS exists
      `,
      [tableName],
    );

    if (hasDatetimeColumn.rows[0]?.exists) {
      await this.database.query(`
        UPDATE ${tableName}
        SET logged_at = COALESCE(logged_at, datetime, NOW())
        WHERE logged_at IS NULL
      `);
    } else {
      await this.database.query(`
        UPDATE ${tableName}
        SET logged_at = NOW()
        WHERE logged_at IS NULL
      `);
    }

    await this.database.query(`
      ALTER TABLE ${tableName}
      ALTER COLUMN logged_at SET DEFAULT NOW()
    `);
  }

  private async pollOnce(): Promise<void> {
    if (this.polling) {
      this.logger.warn('Skipping Modbus poll because the previous cycle is still running.');
      return;
    }

    this.polling = true;

    try {
      await Promise.all(this.stations.map((station) => this.pollStation(station)));
    } finally {
      this.polling = false;
    }
  }

  private async pollStation(
    station: StationConfig & { host: string; client: ModbusStationClient },
  ): Promise<void> {
    try {
      const registers = await station.client.readHoldingRegisters(
        station.register,
        station.count,
      );
      const values = this.decodeRegisters(station.format, registers);

      if (station.kind === 'reservoir') {
        const message = await this.insertReservoirRecord(station, values);
        this.modbusStream.publish(station.name, message);
        return;
      }

      const message = await this.insertStationRecord(station, values);
      this.modbusStream.publish(station.name, message);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Polling failed for ${station.name} (${station.host}): ${reason}`);
    }
  }

  private decodeRegisters(format: StationFormat, registers: number[]): number[] {
    if (format === 'scaled-16') {
      const scales = [100, 10, 100, 100, 100, 100];
      return scales.map((scale, index) => {
        const value = registers[index];
        return typeof value === 'number' ? value / scale : null;
      }) as number[];
    }

    const values: number[] = [];
    for (let index = 0; index < registers.length; index += 2) {
      const low = registers[index];
      const high = registers[index + 1];

      if (typeof low !== 'number' || typeof high !== 'number') {
        break;
      }

      const buffer = new ArrayBuffer(4);
      const view = new DataView(buffer);
      view.setUint16(0, high, false);
      view.setUint16(2, low, false);
      values.push(Math.round(view.getFloat32(0, false) * 1000) / 1000);
    }

    return values;
  }

  private async insertStationRecord(
    station: StationConfig,
    values: number[],
  ): Promise<ModbusStreamMessage> {
    const payload = values.slice(0, 6);
    while (payload.length < 6) payload.push(null as unknown as number);
    const loggedAt = new Date().toISOString();

    await this.database.query(
      `
        INSERT INTO ${station.tableName} (
          waterlevel,
          pressure,
          flowmeter,
          turbidity,
          humidity,
          chlorine,
          logged_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      `,
      [...payload, loggedAt],
    );

    return {
      device: station.name,
      kind: station.kind,
      tableName: station.tableName,
      waterlevel: payload[0] ?? null,
      pressure: payload[1] ?? null,
      flowmeter: payload[2] ?? null,
      turbidity: payload[3] ?? null,
      humidity: payload[4] ?? null,
      chlorine: payload[5] ?? null,
      loggedAt,
    };
  }

  private async insertReservoirRecord(
    station: StationConfig,
    values: number[],
  ): Promise<ModbusStreamMessage> {
    const payload = values.slice(0, 3);
    while (payload.length < 3) payload.push(null as unknown as number);
    const loggedAt = new Date().toISOString();

    await this.database.query(
      `
        INSERT INTO ${station.tableName} (
          waterlevel,
          flowmeter,
          volume,
          logged_at
        ) VALUES ($1, $2, $3, $4)
      `,
      [...payload, loggedAt],
    );

    return {
      device: station.name,
      kind: station.kind,
      tableName: station.tableName,
      waterlevel: payload[0] ?? null,
      flowmeter: payload[1] ?? null,
      volume: payload[2] ?? null,
      loggedAt,
    };
  }
}
