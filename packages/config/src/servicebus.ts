/**
 * Azure Service Bus sender — used by the scheduler to enqueue check jobs.
 * Lives in @pulseway/config so it can be imported by both the API and scheduler
 * without creating a circular dependency on @pulseway/worker.
 *
 * The full receiver (ServiceBusAdapter) stays in @pulseway/worker since only
 * workers need to receive and settle messages.
 */
import { ServiceBusClient } from '@azure/service-bus';

export class ServiceBusSender {
  private readonly client: ServiceBusClient;

  constructor(connectionString: string) {
    this.client = new ServiceBusClient(connectionString);
  }

  async sendMessage(queueName: string, body: string): Promise<void> {
    const sender = this.client.createSender(queueName);
    try {
      await sender.sendMessages({ body });
    } finally {
      await sender.close();
    }
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}
