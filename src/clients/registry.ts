import type { ClientDescriptor, DesktopClient } from './types.js';

// Descriptors are UI metadata. Only registered implementations may perform actions.
export const futureClients: ClientDescriptor[] = [{
  id: 'chatgpt', name: 'ChatGPT Desktop', description: 'Future integration', availability: 'planned', protocol: null,
  reason: 'A supported way to connect external inference must be established before this integration can be enabled.',
}];
export class ClientRegistry {
  private clients: Map<string, DesktopClient>;
  constructor(clients: DesktopClient[]) {
    this.clients = new Map();
    for (const client of clients) {
      if (this.clients.has(client.descriptor.id)) throw new Error('Duplicate desktop client adapter.');
      this.clients.set(client.descriptor.id, client);
    }
  }
  descriptors(): ClientDescriptor[] { return [...this.clients.values()].map(c => c.descriptor).concat(futureClients.filter(c => !this.clients.has(c.id))); }
  get(id: string): DesktopClient {
    const client = this.clients.get(id);
    if (!client || client.descriptor.availability !== 'available') throw new Error('This desktop client does not have an enabled integration.');
    return client;
  }
}
