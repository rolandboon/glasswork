# Email API Reference

Use this page when you need exact constructor options and method signatures for the email module.

## Template compilation

```typescript
import { compileTemplates } from 'glasswork';

const result = await compileTemplates({
  sourceDir: './templates',
  outputDir: './src/email/compiled',
  verbose: true,
});
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `sourceDir` | `string` | — | Input folder with MJML templates |
| `outputDir` | `string` | — | Where compiled templates are emitted |
| `verbose` | `boolean` | `false` | Print compilation progress |
| `helpers` | `Record<string, Function>` | `{}` | Custom helper functions available inside templates |

**Result:**

```ts
{
  templates: Array<{
    name: string;
    html: string;
    text: string;
    components: string[];
  }>;
  errors: { file: string; message: string }[];
}
```

## Transports

### `SESTransport`

```typescript
import { SESTransport } from 'glasswork';

const transport = new SESTransport({
  region: 'eu-west-1',
  configurationSet: 'production-emails',
  endpoint: process.env.SES_ENDPOINT, // optional (LocalStack)
});
```

| Option | Type | Description |
|--------|------|-------------|
| `region` | `string` | AWS region |
| `configurationSet` | `string?` | Optional SES configuration set |
| `endpoint` | `string?` | Override SES endpoint (e.g., LocalStack) |

### Custom transport

Implement `EmailTransport`:

```typescript
interface EmailTransport {
  send(message: {
    to: string | string[];
    subject: string;
    html: string;
    text: string;
    headers?: Record<string, string>;
  }): Promise<{ messageId: string }>;
}
```

## `TemplatedEmailService`

```typescript
import { TemplatedEmailService } from 'glasswork';
import { templates } from './compiled';

const emailService = new TemplatedEmailService({
  config: {
    transport,
    from: 'noreply@example.com',
    replyTo: 'support@example.com',
  },
  templates,
});
```

| Option | Type | Description |
|--------|------|-------------|
| `config.transport` | `EmailTransport` | Transport instance |
| `config.from` | `string` | Default sender |
| `config.replyTo` | `string?` | Default reply-to |
| `config.onSent` | `(result, message) => Promise<void> \| void` | Hook after successful send |
| `templates` | `Record<string, CompiledTemplate>` | Output from `compileTemplates` |

### `send`

```typescript
await emailService.send({
  template: 'welcome',
  to: 'user@example.com',
  subject: 'Welcome!',
  context: { name: 'User', dashboardUrl: 'https://app.example.com' },
  headers: { 'X-Correlation-Id': requestId },
});
```

| Field | Type | Description |
|-------|------|-------------|
| `template` | `string` | Name of compiled template |
| `to` | `string \| string[]` | Recipient(s) |
| `subject` | `string` | Subject line |
| `context` | `Record<string, unknown>` | Values used in the template (fully typed if you import the compiled context type) |
| `headers` | `Record<string, string>?` | Extra headers |

**Return:** `{ messageId: string }`

### `render`

Render without sending (useful for previews or logging):

```typescript
const { html, text } = emailService.render('welcome', {
  name: 'User',
  dashboardUrl: 'https://app.example.com',
});
```

## Error handling patterns

- Wrap `send` in a circuit breaker or retry when SES throttles.
- Log `messageId`, `template`, and `to` for traceability.
- For background delivery, keep the `context` small and re-hydrate data inside the job.
