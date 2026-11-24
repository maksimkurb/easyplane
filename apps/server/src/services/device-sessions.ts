import type { ManagedClient } from "../control/managed-client.js";

/**
 * In-memory map between approved/pending devices and their live config-server
 * session. Powers "push on change" and "push on connect". A device has at most
 * one session in practice (easyter-core keeps one config-server connection per
 * process); a newer session wins.
 */
export class DeviceSessionRegistry {
  private readonly byDevice = new Map<string, ManagedClient>();
  private readonly bySession = new Map<string, string>();

  bind(deviceId: string, client: ManagedClient): void {
    const previous = this.byDevice.get(deviceId);
    if (previous && previous !== client) {
      this.bySession.delete(previous.id);
    }
    const previousDevice = this.bySession.get(client.id);
    if (previousDevice && previousDevice !== deviceId) {
      this.byDevice.delete(previousDevice);
    }
    this.byDevice.set(deviceId, client);
    this.bySession.set(client.id, deviceId);
  }

  get(deviceId: string): ManagedClient | undefined {
    const client = this.byDevice.get(deviceId);
    if (client?.isClosed) {
      this.byDevice.delete(deviceId);
      this.bySession.delete(client.id);
      return undefined;
    }
    return client;
  }

  /** Ids of devices with an open session. */
  deviceIds(): string[] {
    return [...this.byDevice.keys()].filter((id) => this.get(id) !== undefined);
  }

  unbindClient(client: ManagedClient): void {
    const deviceId = this.bySession.get(client.id);
    if (deviceId === undefined) return;
    this.bySession.delete(client.id);
    if (this.byDevice.get(deviceId) === client) this.byDevice.delete(deviceId);
  }

  /** Device id bound to a session, even if the session is already closed. */
  deviceForClient(client: ManagedClient): string | undefined {
    return this.bySession.get(client.id);
  }

  onlineDeviceIds(): string[] {
    return [...this.byDevice.entries()]
      .filter(([, client]) => !client.isClosed)
      .map(([deviceId]) => deviceId);
  }

  get size(): number {
    return this.byDevice.size;
  }
}
