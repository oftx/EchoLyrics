type LogLevel = 'info' | 'warn' | 'error' | 'debug';

export interface LogEntry {
    timestamp: number;
    level: LogLevel;
    message: string;
    data?: any;
}

type LogListener = (entry: LogEntry) => void;

class LoggerService {
    private listeners: LogListener[] = [];

    public subscribe(listener: LogListener): () => void {
        this.listeners.push(listener);
        return () => {
            this.listeners = this.listeners.filter(l => l !== listener);
        };
    }

    private emit(level: LogLevel, message: string, data?: any) {
        const entry: LogEntry = {
            timestamp: Date.now(),
            level,
            message,
            data
        };
        // Also log to browser console
        console[level](`[${level.toUpperCase()}] ${message}`, data || '');

        this.listeners.forEach(l => l(entry));
    }

    public info(msg: string, data?: any) { this.emit('info', msg, data); }
    public warn(msg: string, data?: any) { this.emit('warn', msg, data); }
    public error(msg: string, data?: any) { this.emit('error', msg, data); }
    public debug(msg: string, data?: any) { this.emit('debug', msg, data); }
}

export const Logger = new LoggerService();
