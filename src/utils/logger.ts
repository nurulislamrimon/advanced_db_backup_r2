export type LogLevel = 'info' | 'warn' | 'error' | 'debug';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
}

class Logger {
  private isProduction: boolean;

  constructor() {
    this.isProduction = process.env.NODE_ENV === 'production';
  }

  private formatEntry(level: LogLevel, message: string, context?: Record<string, unknown>): LogEntry {
    return {
      timestamp: new Date().toISOString(),
      level,
      message,
      context,
    };
  }

  private output(entry: LogEntry): void {
    const output = this.isProduction
      ? JSON.stringify(entry)
      : `[${entry.timestamp}] ${entry.level.toUpperCase()}: ${entry.message}${entry.context ? ' ' + JSON.stringify(entry.context) : ''}`;

    if (entry.level === 'error') {
      console.error(output);
    } else if (entry.level === 'warn') {
      console.warn(output);
    } else {
      console.log(output);
    }
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.output(this.formatEntry('info', message, context));
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.output(this.formatEntry('warn', message, context));
  }

  error(message: string, context?: Record<string, unknown>): void {
    this.output(this.formatEntry('error', message, context));
  }

  debug(message: string, context?: Record<string, unknown>): void {
    if (process.env.DEBUG === 'true') {
      this.output(this.formatEntry('debug', message, context));
    }
  }
}

export const logger = new Logger();