---
description: Server-sent event notifications in Glasswork, with setup, reconnect behavior, and deployment limitations.
---

# Server-Sent Events

`glasswork/sse` sends notifications from a long-running application process to connected browsers. Use it when clients need to refresh data after a job progresses or a record changes. Clients send commands through normal HTTP requests.

## Deployment Compatibility

**The current `SseBroadcaster` is intended for long-running processes, such as a Node.js server in a container or on a VM. It is not a working cross-invocation broadcast solution for Glasswork's standard Lambda deployment.** Each broadcaster stores its connections in memory. A mutation handled by a different Lambda invocation or execution environment cannot reach those connections. The [standard Glasswork Lambda handler](/deployment/lambda) uses Hono's `handle`, which does not enable response streaming.

SSE itself *can* run on Lambda. AWS supports [Lambda response streaming](https://docs.aws.amazon.com/lambda/latest/dg/configuration-response-streaming.html) through function URLs or a streaming API Gateway proxy integration. Hono provides [`streamHandle`](https://hono.dev/docs/getting-started/aws-lambda#lambda-response-streaming) for streaming Lambda responses. That deployment also needs a shared event source, such as a broker, so a stream invocation can receive changes from other invocations. Glasswork does not currently provide that integration. Streaming invocations have finite lifetimes, so clients must reconnect and reload state. API Gateway's streaming mode is available for REST APIs and [limits a response stream to 15 minutes](https://docs.aws.amazon.com/apigateway/latest/developerguide/response-transfer-mode.html).

## Setup

`createSseModule()` registers a singleton named `sseBroadcaster` in the application container. It does not add a route. Define the endpoint and apply your application's authentication and authorization middleware:

```typescript
import { createRoutes, defineModule } from 'glasswork';
import { createSseModule, type SseBroadcaster } from 'glasswork/sse';

export const NotificationsModule = defineModule({
  name: 'notifications',
  basePath: 'notifications',
  imports: [createSseModule()],
  routes: createRoutes<{ sseBroadcaster: SseBroadcaster }>(
    (router, { sseBroadcaster }) => {
      // Apply your application's access control to this route.
      router.get('/stream', (context) => sseBroadcaster.stream(context));
    }
  ),
});
```

With the default API prefix, the endpoint is `/api/notifications/stream`. Hono middleware applies to it like any other route.

Inject `sseBroadcaster` into a service and publish an event when an export progresses:

```typescript
import type { SseBroadcaster } from 'glasswork/sse';

export class ExportService {
  constructor(private readonly deps: { sseBroadcaster: SseBroadcaster }) {}

  notifyProgress(exportId: string) {
    this.deps.sseBroadcaster.broadcast('exports:progress', { exportId });
  }
}
```

Use small payloads for refresh events. For compile-time payload checking, register a singleton `SseBroadcaster<{ 'exports:progress': { exportId: string } }>` through a provider factory. The broadcaster sends every event to every connection on that instance. Keep audiences with different access rights on separate broadcasters; authenticating a route does not filter broadcasts by tenant.

## Browser Client

`EventSource` reconnects after a dropped connection. Reload current state on **every** connection, including a reconnect, because the broadcaster does not store or replay events:

```typescript
const events = new EventSource('/api/notifications/stream');

events.onopen = () => refreshExportStatus();
events.addEventListener('exports:progress', () => refreshExportStatus());

// When the page or component is removed:
// events.close();
```

Coalesce bursts of notifications, avoid overlapping refreshes, and retry failed data requests. This implementation does not use `Last-Event-ID`. Native `EventSource` sends cookies but cannot set a custom `Authorization` header. For cross-origin cookie sessions, use `withCredentials: true` and configure CORS. Bearer-token authentication requires a fetch-based SSE client.

## Connection Lifecycle

- A heartbeat comment is sent every 15 seconds. Set `heartbeatIntervalMs` to `0` to disable it.
- Each connection has a 64 KiB application buffer by default (`maxBufferedBytes`). A slow client is disconnected when it exceeds the limit; it must reload state after reconnecting. Events larger than the limit are rejected.
- `bootstrapResult.stop()` closes connections through `onModuleDestroy`. Request cancellation also removes the connection and its heartbeat.
- The response sets `Cache-Control: no-cache, no-transform` and `X-Accel-Buffering: no`. Disable buffering and compression for the endpoint in any other proxy, and set its idle timeout longer than the heartbeat interval.
- A broadcaster only reaches clients in its own process. Multiple application replicas need a shared pub/sub source to deliver the same notifications.
