---
description: Two-pass MJML template compilation system with control flow syntax, type-safe render functions, and responsive email layout.
---

# Email Templates Guide

Glasswork uses a two-pass compilation system that transforms MJML templates with control flow syntax into type-safe TypeScript render functions.

## MJML Basics

[MJML](https://mjml.io/) is a markup language for creating responsive emails. It abstracts away the complexity of email HTML:

```xml
<mjml>
  <mj-head>
    <mj-attributes>
      <mj-all font-family="Arial, sans-serif" />
    </mj-attributes>
  </mj-head>
  <mj-body>
    <mj-section>
      <mj-column>
        <mj-text>Hello World</mj-text>
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>
```

## Variable Interpolation

Use double curly braces for variables:

```xml
<mj-text>Hello, {{name}}!</mj-text>
<mj-text>Your order total is {{order.total}}</mj-text>
```

Glasswork HTML-escapes regular variable expressions by default, including values
used in quoted HTML attributes. Dynamic `href` and `src` attributes must contain
one complete expression, such as `href="{{trackingUrl}}"`; unsafe URL schemes
are rejected at render time. Construct URLs with paths or query parameters in
application code and pass the complete URL. Composed attributes such as
`href="{{baseUrl}}/track"`, unquoted dynamic attributes, and raw HTML expressions
inside URL attributes are rejected during compilation. Use the triple-brace form only for HTML that the application has
already sanitized:

```xml
<mj-text>{{{trustedHtml}}}</mj-text>
```

Do not use triple braces with user-controlled content. Existing templates that
intentionally insert markup must migrate those expressions to the triple-brace
form shown above.

### Default Values

Provide fallbacks with the nullish coalescing operator:

```xml
<mj-text>Hello, {{name ?? 'there'}}!</mj-text>
<mj-text>Items: {{items.length ?? 0}}</mj-text>
```

### Expressions

Variables and conditions use a small part of the JavaScript expression syntax:

| Syntax | Example |
| --- | --- |
| Paths, also with optional chaining | `{{user.address.city}}`, `{{user?.name}}` |
| String, number and boolean literals, `null` and `undefined` | `<!-- @if status === 'paid' -->` |
| Fallbacks | `{{name ?? 'there'}}`, `{{nickname \|\| name}}` |
| Arithmetic | `{{price * quantity}}`, `{{@index + 1}}` |
| Comparisons | `<!-- @if items.length > 0 -->` |
| Logical operators and parentheses | `<!-- @if user && (user.isAdmin \|\| user.isOwner) -->` |
| Conditional expressions | `{{isPro ? 'Pro' : 'Free'}}` |

Calls such as `{{name.toUpperCase()}}` and computed access such as `{{items[0]}}` are not
supported: prepare those values in application code. A template with an invalid
expression fails to compile with a message that names the expression. HTML entities in
expressions are decoded, so `&amp;&amp;` from an XML editor works as `&&`.

## Control Flow Syntax

Control flow uses HTML comments to preserve MJML validity:

### Conditionals

```xml
<!-- @if hasSubscription -->
<mj-section>
  <mj-column>
    <mj-text>Thank you for being a subscriber!</mj-text>
  </mj-column>
</mj-section>
<!-- @end -->
```

### If-Else

```xml
<!-- @if isPremium -->
<mj-text>Welcome, Premium Member!</mj-text>
<!-- @else -->
<mj-text>Upgrade to Premium for more features.</mj-text>
<!-- @end -->
```

### Else-If

```xml
<!-- @if isPremium -->
<mj-text>Welcome, Premium Member!</mj-text>
<!-- @elseif isTrial -->
<mj-text>Your trial ends soon.</mj-text>
<!-- @else -->
<mj-text>Upgrade to Premium for more features.</mj-text>
<!-- @end -->
```

`@elseif` and `@else` belong to the innermost open `@if` block, and `@else` comes last.
The compiler rejects an `@else` or `@elseif` outside an `@if` block, an `@elseif` after
`@else`, and a second `@else` in one block.

### Blocks

Every `@if` and `@each` block ends with `<!-- @end -->`, which closes the innermost open
block. Compilation fails for an unclosed block, an `@end` without a block, a misspelled
directive such as `@endif` or `@else if`, and arguments after `@else` or `@end`.

Directives are HTML comments, so they work where MJML keeps comments in place: anywhere in
`mj-body`, around sections, columns and other components, and inside `mj-text` and
`mj-raw`. MJML moves or removes comments in `mj-head`, so the compiler rejects directives
there; put conditional head content in an `mj-raw`. Compilation also fails when MJML
removed directives, for example with `keepComments: false`.

### Complex Conditions

```xml
<!-- @if items && items.length > 0 -->
<mj-text>You have {{items.length}} items in your cart.</mj-text>
<!-- @else -->
<mj-text>Your cart is empty.</mj-text>
<!-- @end -->
```

### Loops

```xml
<!-- @each items as item -->
<mj-section>
  <mj-column>
    <mj-text>{{item.name}} - {{item.price}}</mj-text>
  </mj-column>
</mj-section>
<!-- @end -->
```

### Loop with Index

```xml
<!-- @each items as item, index -->
<mj-text>{{index}}. {{item.name}}</mj-text>
<!-- @end -->
```

### Loop Variables

The item and index names exist only inside their loop; outside it, the same name is a
context variable. An inner loop can reuse a name of an outer loop, and can loop over a
property of the outer item or over the item itself:

```xml
<!-- @each orders as order -->
<mj-text>Order {{order.number}}</mj-text>
<!-- @each order.lines as line -->
<mj-text>{{line.name}}</mj-text>
<!-- @end -->
<!-- @end -->
```

`@index`, `@first`, `@last` and `@length` belong to the innermost loop, also when that
loop names its index. Name the index of an outer loop to use it inside an inner loop.
A loop variable cannot be a reserved word, `ctx`, `escapeHtml`, `sanitizeUrl`, `String` or
a name that starts with two underscores, which the generated code uses.

### Nested Conditions in Loops

```xml
<!-- @each items as item -->
<mj-section>
  <mj-column>
    <mj-text>
      {{item.name}} - {{item.price}}
      <!-- @if item.onSale -->
      <span style="color: red;">(On Sale!)</span>
      <!-- @end -->
    </mj-text>
  </mj-column>
</mj-section>
<!-- @end -->
```

## Complete Example

```xml
<!-- order-confirmation.mjml -->
<mjml>
  <mj-head>
    <mj-attributes>
      <mj-all font-family="Arial, sans-serif" color="#333" />
      <mj-text line-height="1.5" />
    </mj-attributes>
    <mj-style>
      .sale { color: #e53e3e; font-weight: bold; }
      .total { font-size: 20px; font-weight: bold; }
    </mj-style>
  </mj-head>

  <mj-body background-color="#f4f4f4">
    <!-- Header -->
    <mj-section background-color="#2563eb">
      <mj-column>
        <mj-text color="#fff" font-size="24px" align="center">
          Order Confirmation
        </mj-text>
      </mj-column>
    </mj-section>

    <!-- Greeting -->
    <mj-section background-color="#fff">
      <mj-column>
        <mj-text>
          Hi {{name ?? 'there'}},
        </mj-text>
        <mj-text>
          Thank you for your order #{{orderNumber}}!
        </mj-text>
      </mj-column>
    </mj-section>

    <!-- Order Items -->
    <!-- @if items && items.length -->
    <mj-section background-color="#fff">
      <mj-column>
        <mj-text font-weight="bold">Order Details:</mj-text>
        <mj-divider border-color="#e5e5e5" />
      </mj-column>
    </mj-section>

    <!-- @each items as item -->
    <mj-section background-color="#fff" padding="5px 25px">
      <mj-column width="60%">
        <mj-text>
          {{item.name}}
          <!-- @if item.onSale -->
          <span class="sale">(On Sale!)</span>
          <!-- @end -->
        </mj-text>
      </mj-column>
      <mj-column width="20%">
        <mj-text>x{{item.quantity}}</mj-text>
      </mj-column>
      <mj-column width="20%">
        <mj-text align="right">{{item.price}}</mj-text>
      </mj-column>
    </mj-section>
    <!-- @end -->

    <!-- Total -->
    <mj-section background-color="#fff">
      <mj-column>
        <mj-divider border-color="#e5e5e5" />
        <mj-text align="right" css-class="total">
          Total: {{total}}
        </mj-text>
      </mj-column>
    </mj-section>
    <!-- @else -->
    <mj-section background-color="#fff">
      <mj-column>
        <mj-text>No items in this order.</mj-text>
      </mj-column>
    </mj-section>
    <!-- @end -->

    <!-- Shipping Info -->
    <!-- @if shippingAddress -->
    <mj-section background-color="#f9f9f9">
      <mj-column>
        <mj-text font-weight="bold">Shipping To:</mj-text>
        <mj-text>
          {{shippingAddress.name}}<br />
          {{shippingAddress.street}}<br />
          {{shippingAddress.city}}, {{shippingAddress.zip}}
        </mj-text>
      </mj-column>
    </mj-section>
    <!-- @end -->

    <!-- CTA -->
    <mj-section background-color="#fff">
      <mj-column>
        <mj-button background-color="#2563eb" href="{{trackingUrl}}">
          Track Your Order
        </mj-button>
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>
```

## Automatic Type Inference

The compiler automatically generates TypeScript interfaces from template usage. It reads
the HTML that MJML produces, so variables in files added with `<mj-include>` are part of
the interface just like variables in the template itself:

```typescript
// Generated from the template above:
export interface OrderConfirmationContext {
  name?: string | undefined;
  orderNumber: string;
  items?: Array<{
    name: string;
    onSale?: boolean | undefined;
    quantity: string;
    price: string;
  }> | undefined;
  total: string;
  shippingAddress?: {
    name: string;
    street: string;
    city: string;
    zip: string;
  } | undefined;
  trackingUrl: string;
}

export function render(ctx: OrderConfirmationContext): { html: string; text: string };
```

Each property follows from what the template does with the value:

- A printed value is a `string`. An operand of `-`, `*`, `/`, `%`, `<`, `>`, `<=` or `>=`
  is a `number`, and so are both sides of `+` without a string literal. A value compared
  with a literal, as in `status === 'paid'`, gets the type of the literal.
- A value that is only tested, such as `isPremium` in `<!-- @if isPremium -->` or
  `!isPremium`, is a `boolean`.
- `@each` makes a value an array. When the loop prints the item itself, it is an array of
  strings, such as `tags: string[]`.
- A property is optional when the template copes with it missing: it is only tested, it
  has a fallback with `??` or `||`, it is read with `?.`, or every use is inside a block
  that tested it first, such as `{{shippingAddress.city}}` inside
  `<!-- @if shippingAddress -->`. Optional properties also accept `undefined`, so they work
  with `exactOptionalPropertyTypes`.
- `length` is a `number`. Arrays and strings have it already, so `{{items.length}}` adds no
  property to an array.

The generated module only declares the helpers it uses, so it compiles with
`noUnusedLocals` and `noUnusedParameters`.

## Subjects

The text of `<mj-title>` becomes the default subject of the template, with entities
decoded and whitespace collapsed. A title with a variable cannot be a default subject: pass
`subject` when you send that template.

## Template Compilation

### Basic Compilation

```typescript
import mjml2html from 'mjml';
import { compileTemplates } from 'glasswork/email';

const result = await compileTemplates({
  sourceDir: './templates',
  outputDir: './src/email/compiled',
  // The template path lets mj-include find included files.
  mjmlCompile: async (source, filePath) => {
    const { html, errors } = await mjml2html(source, {
      validationLevel: 'strict',
      ignoreIncludes: false,
      ...(filePath ? { filePath } : {}),
    });
    return { html, errors: errors.map((error) => ({ message: error.formattedMessage })) };
  },
});

if (result.errors.length > 0) {
  console.error(result.errors);
  process.exit(1);
}
```

`compileTemplates` reports a failing template in `result.errors` and compiles the others.
Templates are compiled in path order, so the generated `index.ts` is the same on every
machine. Template names come from file names and must be unique, also across folders.

### Compilation Options

| Option | Default | Description |
| --- | --- | --- |
| `sourceDir` | | Folder with templates, searched recursively |
| `outputDir` | | Folder for the generated modules and `index.ts` |
| `mjmlCompile` | | Compiles MJML to HTML, so your application chooses the MJML version and options. The second argument is the template path |
| `layoutFile` | | MJML document that wraps templates without an `<mjml>` root |
| `layoutMarker` | `<!-- content -->` | Text in the layout that the template replaces |
| `generateIndex` | `true` | Writes `index.ts` with a registry of all templates |
| `templateExtension` | `.mjml` | Extension of template files |
| `excludeDirs` | `['layouts']` | Folder names to skip, such as folders with included partials |

### Watch Mode (Development)

```typescript
import { watch } from 'node:fs';

watch('./templates', { recursive: true }, async () => {
  await compileTemplates({
    sourceDir: './templates',
    outputDir: './src/email/compiled',
    mjmlCompile,
  });
});
```

## Best Practices

### 1. Keep Templates Simple

Extract complex logic to the application layer:

```typescript
// Good: Prepare data before rendering
const context = {
  items: order.items.map(item => ({
    name: item.product.name,
    price: formatCurrency(item.price),
    onSale: item.discount > 0,
  })),
  total: formatCurrency(order.total),
};

await emailService.send({ template: 'order', context });
```

### 2. Use Meaningful Variable Names

```xml
<!-- Good -->
<mj-text>Hi {{customerName}}, your order #{{orderNumber}} is confirmed.</mj-text>

<!-- Avoid -->
<mj-text>Hi {{n}}, your order #{{o}} is confirmed.</mj-text>
```

### 3. Provide Default Values for Optional Fields

```xml
<mj-text>Shipping: {{shippingMethod ?? 'Standard Delivery'}}</mj-text>
```

### 4. Test with Sample Data

Create test fixtures for your templates:

```typescript
// test/email-fixtures.ts
export const orderConfirmationFixture = {
  name: 'John Doe',
  orderNumber: 'ORD-12345',
  items: [
    { name: 'Widget', quantity: 2, price: '$9.99', onSale: true },
    { name: 'Gadget', quantity: 1, price: '$24.99', onSale: false },
  ],
  total: '$44.97',
  trackingUrl: 'https://track.example.com/12345',
};
```

## Troubleshooting

### Common Issues

**"Variable is not defined"**

- Check that you're passing all required variables in the context
- Use optional chaining or default values for conditional data

**"MJML compilation failed"**

- Validate your MJML syntax at https://mjml.io/try-it-live
- Check for unclosed tags or invalid nesting
- MJML validates attribute values such as colors, so `background-color="{{color}}"` fails
  with "invalid value". Write that element as HTML in an `mj-raw`, or compile the template
  with `validationLevel: 'skip'`

**"Type mismatch"**

- Ensure your context object matches the generated interface
- Use `satisfies` for type checking without losing inference
