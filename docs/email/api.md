---
description: Complete API reference for Glasswork's email module, including TemplatedEmailService, transports, and template compilation.
---

# Email API Reference

Use this page when you need exact constructor options and method signatures for the email module.

## Template compilation

```typescript
import mjml2html from 'mjml';
import { compileTemplates } from 'glasswork/email';

const result = await compileTemplates({
  sourceDir: './templates',
  outputDir: './src/email/compiled',
  mjmlCompile: async (source, filePath) => {
    const { html, errors } = await mjml2html(source, {
      validationLevel: 'strict',
      ignoreIncludes: false,
      ...(filePath ? { filePath } : {}),
    });
    return { html, errors: errors.map((error) => ({ message: error.formattedMessage })) };
  },
});
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `sourceDir` | `string` | — | Folder with templates, searched recursively |
| `outputDir` | `string` | — | Folder for the generated modules and `index.ts` |
| `mjmlCompile` | `(mjml: string, filePath?: string) => MjmlCompileResult \| Promise<MjmlCompileResult>` | — | Compiles MJML to `{ html, errors }`; the second argument is the template path for `mj-include` |
| `layoutFile` | `string` | — | MJML document that wraps templates without an `<mjml>` root |
| `layoutMarker` | `string` | `<!-- content -->` | Text in the layout that the template replaces |
| `generateIndex` | `boolean` | `true` | Writes `index.ts` with a registry of all templates |
| `templateExtension` | `string` | `.mjml` | Extension of template files |
| `excludeDirs` | `string[]` | `['layouts']` | Folder names to skip |

**Result:**

```ts
{
  count: number;
  templates: Array<{ name: string; subject?: string }>;
  errors: Array<{ template: string; error: string }>;
}
```

A template that fails to compile is reported in `errors`; the others are still compiled.
`compile(source, name, mjmlCompile, filePath?)` compiles a single template and returns
`{ source, contextInterface, name, subject }`. See the
[templates guide](./templates.md) for the template syntax and the generated types.

## Transports

### `SESTransport`

```typescript
import { SESTransport } from 'glasswork/email';

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
import { TemplatedEmailService } from 'glasswork/email';
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
| `config.logger` | `Logger?` | Logger for diagnostics, such as a failing `onSent` hook |
| `templates` | `TemplateRegistry` | The `templates` registry from the generated `index.ts` |
| `onSent` | `(result, message, context) => Promise<void> \| void` | Hook after a successful send. Errors are logged; `send()` still returns the result |

### `send`

```typescript
await emailService.send('welcome', {
  to: 'user@example.com',
  context: { name: 'User', dashboardUrl: 'https://app.example.com' },
  metadata: { userId: user.id },
});
```

| Field | Type | Description |
|-------|------|-------------|
| `to` | `string \| string[]` | Recipient(s) |
| `context` | generated context type | Values used in the template, typed by the template name |
| `subject` | `string?` | Overrides the default subject from `<mj-title>`; required when the template has none |
| `cc`, `bcc` | `string \| string[]` | Extra recipients |
| `from`, `replyTo` | `string?` | Override the configured defaults |
| `metadata` | `Record<string, string \| number \| boolean>?` | Correlation data for `onSent`; never sent to the provider |

`sendRaw()` accepts custom headers. They cannot override structural MIME headers, and
their names and values must not contain line breaks. Attachment string content must be
valid base64; `Buffer` content is encoded automatically.

**Return:** `{ messageId: string; success: boolean; metadata?: Record<string, unknown> }`

### Rendering without sending

Render a template without sending it, for previews or tests, with the registry:

```typescript
const { html, text } = emailService.getTemplates().render('welcome', {
  name: 'User',
  dashboardUrl: 'https://app.example.com',
});
```

### Plain text

Every message gets a plain-text part. Compiled templates and `sendRaw` without `text`
derive it from the HTML with `htmlToText`, which is also exported from `glasswork/email`.
It leaves out the head, comments (including Outlook conditional comments), scripts and
hidden preheader text such as `mj-preview`, keeps link targets (`Open the app:
https://…`), uses the alt text for a link around an image, and trims lines with at most
one blank line between blocks.

```typescript
import { htmlToText } from 'glasswork/email';

htmlToText('<p>Read <a href="https://example.com/terms">the terms</a></p>');
// 'Read the terms: https://example.com/terms'
```

## Error handling patterns

- Wrap `send` in a circuit breaker or retry when SES throttles.
- Log `messageId`, `template`, and `to` for traceability.
- For background delivery, keep the `context` small and re-hydrate data inside the job.
