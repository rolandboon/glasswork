/**
 * Converts email HTML to the plain-text part of a message.
 *
 * Skips everything a reader never sees as text: the head (title, styles, font links),
 * comments including Outlook conditional comments, scripts, and hidden preheader text
 * such as MJML's `mj-preview`. Links keep their target after the label, and a link that
 * only wraps an image (a logo) becomes the image's alt text. Lines are trimmed and at
 * most one blank line separates blocks.
 *
 * The template compiler emits the same logic inline, so compiled templates stay free of
 * runtime imports; `test/email/html-to-text.spec.ts` keeps both in step.
 */
export function htmlToText(html: string): string {
  return (
    html
      .replace(/<head[\s\S]*?<\/head>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<(div|span)\s[^>]*display:\s*none[^>]*>[\s\S]*?<\/\1>/gi, '')
      .replace(/<a\s[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_match, href, label) => {
        const text = label.replace(/<[^>]+>/g, '').trim();
        if (text) return text === href ? href : `${text}: ${href}`;
        const alt = /<img\s[^>]*alt="([^"]*)"/i.exec(label);
        return alt?.[1] || href;
      })
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<li(\s[^>]*)?>/gi, '• ')
      .replace(/<\/(p|div|li|tr|table|h[1-6])>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#(\d+);/g, (match, code) =>
        Number(code) <= 0x10ffff ? String.fromCodePoint(Number(code)) : match
      )
      .replace(/&#x([0-9a-f]+);/gi, (match, code) =>
        Number.parseInt(code, 16) <= 0x10ffff
          ? String.fromCodePoint(Number.parseInt(code, 16))
          : match
      )
      // Last, so an escaped entity such as &amp;lt; stays literal text.
      .replace(/&amp;/gi, '&')
      .split('\n')
      .map((line) => line.replace(/[ \t]+/g, ' ').trim())
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}
