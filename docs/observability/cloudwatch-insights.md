# CloudWatch Logs Insights Queries

Useful CloudWatch Logs Insights queries for analyzing structured JSON logs from Pino.

## Prerequisites

Set up Pino logging as described in the [Observability Guide](/observability/overview):

```typescript
import pino from 'pino';
import { bootstrap, lambdaPinoConfig } from 'glasswork';

const { app } = await bootstrap(AppModule, {
  logger: { pino: pino(lambdaPinoConfig) },
});
```

## Request Tracing

### Track a Specific Request

```sql
fields @timestamp, service, msg, method, path, status
| filter requestId = "your-request-id-here"
| sort @timestamp asc
```

### All Requests for a User

```sql
fields @timestamp, service, msg, action
| filter userId = "user-123"
| sort @timestamp asc
```

### Failed Requests (5xx)

```sql
fields @timestamp, requestId, method, path, status, duration
| filter status >= 500
| sort @timestamp desc
| limit 100
```

## Performance Analysis

### Slow Requests (>1000ms)

```sql
fields @timestamp, requestId, method, path, status, duration
| filter msg = "HTTP Request" and duration > 1000
| sort duration desc
| limit 50
```

### Average Response Time by Endpoint

```sql
fields path, duration
| filter msg = "HTTP Request"
| stats avg(duration) as avgMs,
        max(duration) as maxMs,
        count() as requests
  by path
| sort avgMs desc
```

### P95 and P99 Latency

```sql
fields duration
| filter msg = "HTTP Request"
| stats pct(duration, 50) as p50,
        pct(duration, 95) as p95,
        pct(duration, 99) as p99,
        avg(duration) as avg
```

### Requests Per Minute

```sql
fields @timestamp
| filter msg = "HTTP Request"
| stats count() as requests by bin(1m)
| sort @timestamp desc
```

## Error Analysis

### Error Rate by Endpoint

```sql
fields path, status
| filter msg = "HTTP Request"
| stats
    sum(status >= 500) as errors,
    count() as total,
    (sum(status >= 500) / count() * 100) as errorRate
  by path
| sort errorRate desc
```

### Top Errors

```sql
fields msg, error
| filter level = "error"
| stats count() as occurrences by msg
| sort occurrences desc
| limit 10
```

### Error Timeline

```sql
fields @timestamp, msg
| filter level = "error"
| stats count() as errors by bin(5m)
| sort @timestamp desc
| limit 100
```

## Service-Specific Queries

### Filter by Service

```sql
fields @timestamp, msg, @message
| filter service = "user-service"
| sort @timestamp desc
| limit 100
```

### Slow Database Queries

```sql
fields @timestamp, service, msg, duration
| filter service = "database" and duration > 100
| sort duration desc
| limit 50
```

## Lambda Metrics

### Cold Start Analysis

```sql
fields @timestamp, @initDuration, @duration
| filter @type = "REPORT"
| filter @initDuration > 0
| stats
    count() as coldStarts,
    avg(@initDuration) as avgColdStartMs,
    max(@initDuration) as maxColdStartMs
```

### Memory Usage

```sql
fields @timestamp, @maxMemoryUsed, @memorySize
| filter @type = "REPORT"
| stats
    avg(@maxMemoryUsed / 1024 / 1024) as avgMemoryMB,
    max(@maxMemoryUsed / 1024 / 1024) as maxMemoryMB,
    avg(@maxMemoryUsed / @memorySize * 100) as avgMemoryPercent
```

## Debugging Workflow

### Step 1: Find Failed Request

```sql
fields requestId, status, path, @timestamp
| filter msg = "HTTP Request" and status >= 500
| sort @timestamp desc
| limit 1
```

### Step 2: Get Full Request Timeline

```sql
fields @timestamp, service, msg, level
| filter requestId = "abc-123-def"  -- Replace with actual ID
| sort @timestamp asc
```

## Query Optimization

### Use Specific Time Ranges

```sql
-- ✅ Good - limit time range
fields @timestamp, msg
| filter @timestamp > ago(24h)
| filter level = "error"

-- ❌ Avoid - searches all data
fields @timestamp, msg
| filter level = "error"
```

### Filter Early

```sql
-- ✅ Good - filter before aggregation
fields path, duration
| filter path = "/api/users"
| stats avg(duration) by path

-- ❌ Bad - filters after stats
fields path, duration
| stats avg(duration) by path
| filter path = "/api/users"
```

### Limit Results

```sql
-- Always add limit to prevent timeouts
fields @timestamp, msg
| sort @timestamp desc
| limit 1000
```

## Creating Alarms

### High Error Rate

```sql
fields status
| filter msg = "HTTP Request" and status >= 500
| stats count() as errors by bin(5m)
```

Create alarm: `errors > 10` in 5 minutes

### Slow Responses

```sql
fields duration
| filter msg = "HTTP Request" and duration > 1000
| stats count() as slowRequests by bin(5m)
```

Create alarm: `slowRequests > 5` in 5 minutes

## Saved Queries

Save frequently-used queries in CloudWatch:

1. Run your query
2. Click **Save**
3. Name it (e.g., "Slow Requests")
4. Reuse from the **Saved queries** dropdown

**Recommended saved queries:**

- Slow Requests (duration > 1000ms)
- Error Tracker (5xx with details)
- User Activity (by userId)
- Performance Dashboard (P95/P99)

## Costs

CloudWatch Logs Insights pricing:

- **Queries**: $0.005 per GB scanned
- **Tip**: Use specific time ranges and filters to reduce costs
