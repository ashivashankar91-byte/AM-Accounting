// RabbitMQ event publisher configuration types
// The actual implementation lives in each service (uses amqplib which is a service-level dependency)

export interface RabbitMQConfig {
  url: string;
  exchange?: string;
  maxRetries?: number;
  retryDelayMs?: number;
}
