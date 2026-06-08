/**
 * Azure Service Bus adapter -- mirrors the SQS message interface.
 * When CLOUD=azure, workers use this instead of SQS.
 */
import {
  ServiceBusClient,
  type ServiceBusReceivedMessage,
  type ServiceBusReceiver,
} from '@azure/service-bus';

export interface QueueMessage {
  messageId    : string | undefined;
  body         : string;
  receiptHandle: string;
}

export class ServiceBusAdapter {
  private readonly client  : ServiceBusClient;
  private readonly receivers = new Map<string, ServiceBusReceiver>();

  constructor(connectionString: string) {
    this.client = new ServiceBusClient(connectionString);
  }

  async receiveMessages(queueName: string, maxMessages: number): Promise<QueueMessage[]> {
    const receiver = this.getReceiver(queueName);
    const msgs     = await receiver.receiveMessages(maxMessages, { maxWaitTimeInMs: 20_000 });
    return msgs.map((m) => ({
      messageId    : m.messageId?.toString(),
      body         : typeof m.body === 'string' ? m.body : JSON.stringify(m.body),
      receiptHandle: m.lockToken ?? '',
    }));
  }

  async deleteMessage(queueName: string, lockToken: string): Promise<void> {
    await this.getReceiver(queueName).completeMessage(
      { lockToken } as ServiceBusReceivedMessage,
    );
  }

  async abandonMessage(queueName: string, lockToken: string): Promise<void> {
    await this.getReceiver(queueName).abandonMessage(
      { lockToken } as ServiceBusReceivedMessage,
    );
  }

  async close(): Promise<void> {
    for (const r of this.receivers.values()) await r.close().catch(() => null);
    await this.client.close();
  }

  private getReceiver(queueName: string): ServiceBusReceiver {
    if (!this.receivers.has(queueName)) {
      this.receivers.set(queueName, this.client.createReceiver(queueName));
    }
    return this.receivers.get(queueName)!;
  }
}

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

  async close(): Promise<void> { await this.client.close(); }
}
