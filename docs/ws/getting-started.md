---
description: Getting started with WebSockets in Glasswork for real-time bidirectional communication and event broadcasting in long-running Node.js servers.
---

# WebSockets

This guide covers setting up real-time bidirectional communication and event broadcasting in Glasswork applications using `glasswork/ws`.

After reading this guide, you will know:

- When to use WebSockets in Glasswork applications
- How to register and inject the `WebSocketGateway` in your modules
- How the `OnServerStart` lifecycle hook automatically attaches WebSockets via `serveNodeApp`
- How to broadcast typed events to connected clients
- How connection lifecycles, heartbeats, and graceful shutdowns are managed

::: tip Long-Running Server Deployments
Glasswork is primarily optimized for serverless (AWS Lambda) deployments where HTTP requests are short-lived and stateless.

The `glasswork/ws` subsystem is specifically designed for **long-running Node.js process deployments** (e.g. standalone servers, Docker containers, VPS, PM2) where persistent TCP connections and low-latency push notifications are needed.
:::

## Quick Start

### 1. Register the WebSocket Module

Create a module that registers the `WebSocketGateway` as a singleton in your application:

```typescript
// src/modules/ws/ws.module.ts
import { defineModule } from 'glasswork';
import { WebSocketGateway } from 'glasswork/ws';

const wsGateway = new WebSocketGateway({
  heartbeatIntervalMs: 30000, // Ping clients every 30s to keep connections alive
  path: '/ws', // WebSocket endpoint path (defaults to '/ws')
});

export const WsModule = defineModule({
  name: 'ws',
  providers: [
    {
      provide: 'wsGateway',
      useFactory: () => wsGateway,
      scope: 'SINGLETON',
    },
  ],
  exports: ['wsGateway'],
});
```

Import `WsModule` into your root `AppModule`:

```typescript
// src/app.module.ts
import { defineModule } from 'glasswork';
import { WsModule } from './modules/ws/ws.module';
import { PhotoModule } from './modules/photos/photo.module';

export const AppModule = defineModule({
  name: 'app',
  imports: [WsModule, PhotoModule],
});
```

---

### 2. Start the Server with `serveNodeApp`

When starting your standalone Node.js server, use `serveNodeApp` from `glasswork/node`.

Because `WebSocketGateway` implements the `OnServerStart` lifecycle hook, WebSockets are **automatically attached** to the HTTP server without any extra boilerplate:

```typescript
// src/server.ts
import { bootstrap } from 'glasswork';
import { serveNodeApp } from 'glasswork/node';
import { AppModule } from './app.module';

const app = await bootstrap(AppModule);

// Automatically starts the server, executes OnServerStart hooks,
// and wires SIGINT/SIGTERM for graceful shutdown!
serveNodeApp(app, {
  port: 3000,
  onListen: () => {
    console.log('🚀 Server running on http://localhost:3000');
    console.log('🔌 WebSockets active on ws://localhost:3000/ws');
  },
});
```

::: info Manual Server Attachment
If you prefer calling `@hono/node-server`'s `serve()` manually, you can attach the server using `app.attachServer(server)`:

```typescript
import { serve } from '@hono/node-server';

const app = await bootstrap(AppModule);
const server = serve({ fetch: app.fetch, port: 3000 });

// Executes OnServerStart lifecycle hooks on all registered services
await app.attachServer(server);
```
:::

---

### 3. Broadcast Events from Services

Inject `wsGateway` into any service to broadcast typed events:

```typescript
// src/modules/photos/photo-worker.service.ts
import type { WebSocketGateway } from 'glasswork/ws';

export class PhotoWorkerService {
  private readonly wsGateway?: WebSocketGateway;

  constructor({ wsGateway }: { wsGateway?: WebSocketGateway }) {
    this.wsGateway = wsGateway;
  }

  async processPhoto(photoId: string) {
    // Process image...
    
    // Broadcast progress in real-time
    this.wsGateway?.broadcast('photos:progress', {
      photoId,
      status: 'COMPLETED',
      timestamp: Date.now(),
    });
  }
}
```

---

## Message Envelope Structure

All messages broadcast through `WebSocketGateway` are automatically wrapped in a structured JSON envelope:

```json
{
  "type": "photos:progress",
  "payload": {
    "photoId": "photo_123",
    "status": "COMPLETED"
  },
  "timestamp": 1787856422374
}
```

Upon initial connection, the server immediately sends a `connected` handshake event to the client:

```json
{
  "type": "connected",
  "payload": {
    "clientId": "vLiAhzCcI4NH",
    "serverTime": 1787856422374
  },
  "timestamp": 1787856422374
}
```

---

## Direct Client Messaging

In addition to broadcasting to all connected clients (`gateway.broadcast(event, payload)`), you can target specific clients by client ID:

```typescript
// Send a message only to a specific connected client
const delivered = wsGateway.sendTo('client_abc123', 'notification:direct', {
  message: 'Your download is ready!',
});
```

---

## Connection Lifecycles & Graceful Shutdown

- **`OnServerStart` Lifecycle**: When the HTTP server instance is created, `WebSocketGateway.onServerStart(server)` attaches the `ws.WebSocketServer` adapter to handle incoming HTTP upgrade requests.
- **Automatic Heartbeats**: `WebSocketGateway` automatically pings connected clients at a configurable interval (`heartbeatIntervalMs`, default 30s) and prunes stale or terminated sockets.
- **`OnModuleDestroy` Graceful Cleanup**: When the Glasswork application stops (`app.stop()` or via `SIGINT`/`SIGTERM`), all active client sockets are gracefully closed with status code `1001 (Server shutting down)` and all background timers are cleared.

---

## Frontend Integration Example (React)

```typescript
import { useEffect, useState } from 'react';

export function useWebSocketEvent<T = unknown>(
  eventType: string,
  onMessage: (payload: T) => void
) {
  useEffect(() => {
    const ws = new WebSocket('ws://localhost:3000/ws');

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === eventType) {
          onMessage(msg.payload);
        }
      } catch (err) {
        console.error('Failed to parse WebSocket message', err);
      }
    };

    return () => {
      ws.close();
    };
  }, [eventType, onMessage]);
}
```
