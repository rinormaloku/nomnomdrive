import * as net from 'net';
import * as path from 'path';
import * as os from 'os';
import type { IpcMessage, IpcResponse } from '@nomnomdrive/shared';

function getDaemonSockPath(): string {
  const dataDir = path.join(os.homedir(), '.local', 'share', 'nomnomdrive');
  return path.join(dataDir, 'daemon.sock');
}

let _idCounter = 1;
function nextId(): string {
  return `cli-${Date.now()}-${_idCounter++}`;
}

export class IpcClient {
  private sockPath: string;

  constructor(sockPath?: string) {
    this.sockPath = sockPath ?? getDaemonSockPath();
  }

  async send<T = unknown>(message: Omit<IpcMessage, 'id'>, timeoutMs = 10_000): Promise<IpcResponse<T>> {
    const msgWithId: IpcMessage = { id: nextId(), ...message };
    return new Promise((resolve, reject) => {
      const socket = net.createConnection(this.sockPath);
      let buf = '';
      let done = false;

      const timer = setTimeout(() => {
        if (!done) {
          done = true;
          socket.destroy();
          reject(new Error('IPC request timed out'));
        }
      }, timeoutMs);

      socket.on('connect', () => {
        socket.write(JSON.stringify(msgWithId) + '\n');
      });

      socket.on('data', (chunk) => {
        buf += chunk.toString();
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const parsed = JSON.parse(trimmed) as { id: string; success: boolean; data?: T; error?: string };
            if (!done) {
              done = true;
              clearTimeout(timer);
              socket.destroy();
              const result: IpcResponse<T> = {
                id: parsed.id,
                success: parsed.success,
                ok: parsed.success,
                data: parsed.data,
                error: parsed.error,
              };
              resolve(result);
            }
          } catch {
            // incomplete JSON — keep buffering
          }
        }
      });

      socket.on('error', (err: NodeJS.ErrnoException) => {
        if (!done) {
          done = true;
          clearTimeout(timer);
          if (err.code === 'ENOENT' || err.code === 'ECONNREFUSED') {
            reject(new Error('NomNomDrive daemon is not running. Start it with: nomnomdrive start'));
          } else {
            reject(err);
          }
        }
      });

      socket.on('close', () => {
        if (!done) {
          done = true;
          clearTimeout(timer);
          reject(new Error('IPC connection closed unexpectedly'));
        }
      });
    });
  }

  async ping(): Promise<boolean> {
    try {
      await this.send({ command: 'status' }, 2_000);
      return true;
    } catch {
      return false;
    }
  }
}
