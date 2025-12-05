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

### Default Values

Provide fallbacks with the nullish coalescing operator:

```xml
<mj-text>Hello, {{name ?? 'there'}}!</mj-text>
<mj-text>Items: {{items.length ?? 0}}</mj-text>
```

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

The compiler automatically generates TypeScript interfaces from template usage:

```typescript
// Generated from the template above:
export interface OrderConfirmationContext {
  name?: string;
  orderNumber: string;
  items?: Array<{
    name: string;
    onSale?: boolean;
    quantity: string | number;
    price: string;
  }>;
  total: string;
  shippingAddress?: {
    name: string;
    street: string;
    city: string;
    zip: string;
  };
  trackingUrl: string;
}

export function render(ctx: OrderConfirmationContext): { html: string; text: string };
```

## Template Compilation

### Basic Compilation

```typescript
import { compileTemplates } from 'glasswork';

await compileTemplates({
  sourceDir: './templates',
  outputDir: './src/email/compiled',
});
```

### Compilation Options

```typescript
await compileTemplates({
  sourceDir: './templates',
  outputDir: './src/email/compiled',

  // Include source maps for debugging
  sourceMaps: true,

  // Verbose logging
  verbose: true,

  // Custom MJML options
  mjmlOptions: {
    minify: true,
    validationLevel: 'strict',
  },
});
```

### Watch Mode (Development)

```typescript
import { watch } from 'fs';

watch('./templates', { recursive: true }, async () => {
  await compileTemplates({
    sourceDir: './templates',
    outputDir: './src/email/compiled',
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

**"Type mismatch"**

- Ensure your context object matches the generated interface
- Use `satisfies` for type checking without losing inference
