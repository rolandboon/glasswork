import { once } from 'node:events';
import { createServer, type Server } from 'node:net';
import PostalMime from 'postal-mime';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SmtpTransport } from '../../src/email/transports/smtp-transport.js';

interface ReceivedMail {
  recipients: string[];
  raw: string;
}

interface SmtpSession {
  buffer: string;
  inData: boolean;
  recipients: string[];
}

/** Stores a complete message once its terminating dot arrives. */
function receiveData(
  session: SmtpSession,
  received: ReceivedMail[],
  reply: (line: string) => void
): boolean {
  const end = session.buffer.indexOf('\r\n.\r\n');
  if (end === -1) return false;
  const raw = session.buffer.slice(0, end).replaceAll('\r\n..', '\r\n.');
  received.push({ recipients: session.recipients, raw });
  session.buffer = session.buffer.slice(end + 5);
  session.inData = false;
  session.recipients = [];
  reply('250 OK: queued');
  return true;
}

/** Answers one command line, the minimum a client needs to send a message. */
function receiveCommand(
  session: SmtpSession,
  reply: (line: string) => void,
  quit: () => void
): boolean {
  const lineEnd = session.buffer.indexOf('\r\n');
  if (lineEnd === -1) return false;
  const line = session.buffer.slice(0, lineEnd);
  session.buffer = session.buffer.slice(lineEnd + 2);
  const command = line.slice(0, 4).toUpperCase();
  if (command === 'RCPT') session.recipients.push(/<([^>]+)>/.exec(line)?.[1] ?? '');
  if (command === 'DATA') session.inData = true;
  if (command === 'QUIT') quit();
  else reply(SMTP_REPLIES[command] ?? '502 Command not implemented');
  return true;
}

const SMTP_REPLIES: Record<string, string> = {
  EHLO: '250 localhost',
  HELO: '250 localhost',
  MAIL: '250 OK',
  RCPT: '250 OK',
  RSET: '250 OK',
  NOOP: '250 OK',
  DATA: '354 End data with <CR><LF>.<CR><LF>',
};

/** A plain SMTP receiver that accepts every message, enough for Nodemailer without TLS. */
async function startSmtpServer() {
  const received: ReceivedMail[] = [];
  const server: Server = createServer((socket) => {
    const session = { buffer: '', inData: false, recipients: [] as string[] };
    const reply = (line: string) => socket.write(`${line}\r\n`);
    reply('220 localhost ESMTP');

    socket.on('data', (chunk) => {
      session.buffer += chunk.toString('utf8');
      while (session.buffer.length > 0) {
        const consumed = session.inData
          ? receiveData(session, received, reply)
          : receiveCommand(session, reply, () => socket.end('221 Bye\r\n'));
        if (!consumed) return;
      }
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return { port, received, close: () => new Promise((resolve) => server.close(resolve)) };
}

const servers: Array<{ close(): Promise<unknown> }> = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

async function createTransport() {
  const server = await startSmtpServer();
  servers.push(server);
  const transport = new SmtpTransport({
    host: '127.0.0.1',
    port: server.port,
    secure: false,
    nodemailer: { ignoreTLS: true },
  });
  return { server, transport };
}

describe('SmtpTransport', () => {
  it('delivers every message field, including attachments', async () => {
    const { server, transport } = await createTransport();

    const result = await transport.send({
      from: 'app@example.com',
      to: ['ada@example.com', 'bob@example.com'],
      cc: 'carol@example.com',
      bcc: 'audit@example.com',
      replyTo: 'support@example.com',
      subject: 'Your report',
      html: '<p>See <img src="cid:logo"> attached.</p>',
      text: 'See attached.',
      headers: { 'X-Report-Id': 'r-42' },
      attachments: [
        { filename: 'report.csv', content: 'id,total\n1,10\n', contentType: 'text/csv' },
        {
          filename: 'logo.png',
          content: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
          contentType: 'image/png',
          disposition: 'inline',
          contentId: 'logo',
        },
      ],
    });
    await transport.close();

    expect(result).toMatchObject({ success: true, messageId: expect.stringContaining('@') });
    expect(server.received).toHaveLength(1);
    const [mail] = server.received;
    expect(mail?.recipients.sort()).toEqual([
      'ada@example.com',
      'audit@example.com',
      'bob@example.com',
      'carol@example.com',
    ]);
    const parsed = await PostalMime.parse(mail?.raw ?? '');
    expect(parsed.from?.address).toBe('app@example.com');
    expect(parsed.replyTo?.map((address) => address.address)).toEqual(['support@example.com']);
    expect(parsed.cc?.map((address) => address.address)).toEqual(['carol@example.com']);
    expect(parsed.subject).toBe('Your report');
    expect(parsed.text?.trim()).toBe('See attached.');
    expect(parsed.html).toContain('cid:logo');
    expect(parsed.headers.find((header) => header.key === 'x-report-id')?.value).toBe('r-42');
    const attachments = [...parsed.attachments].sort((a, b) =>
      String(a.filename).localeCompare(String(b.filename))
    );
    expect(
      attachments.map(({ filename, mimeType, disposition, contentId }) => ({
        filename,
        mimeType,
        disposition,
        contentId,
      }))
    ).toEqual([
      { filename: 'logo.png', mimeType: 'image/png', disposition: 'inline', contentId: '<logo>' },
      {
        filename: 'report.csv',
        mimeType: 'text/csv',
        disposition: 'attachment',
        contentId: undefined,
      },
    ]);
    expect(new TextDecoder().decode(attachments[1]?.content as ArrayBuffer)).toBe(
      'id,total\n1,10\n'
    );
  });

  it('leaves a transporter it did not create open', async () => {
    const transporter = {
      sendMail: vi.fn(async () => ({ messageId: '<m@example.com>', accepted: ['a@example.com'] })),
      close: vi.fn(),
    };
    const transport = new SmtpTransport({ transporter });

    await expect(
      transport.send({ to: 'a@example.com', subject: 'Hi', html: '<p>Hi</p>' })
    ).resolves.toMatchObject({ messageId: '<m@example.com>', success: true });
    await transport.close();

    expect(transporter.close).not.toHaveBeenCalled();
  });

  it('reports recipients the server rejected', async () => {
    const transport = new SmtpTransport({
      transporter: {
        sendMail: async () => ({ messageId: '<m@example.com>', rejected: ['x@example.com'] }),
      },
    });

    await expect(
      transport.send({ to: 'x@example.com', subject: 'Hi', html: '<p>Hi</p>' })
    ).resolves.toMatchObject({ success: false, metadata: { rejected: ['x@example.com'] } });
  });

  it('needs a transporter or connection options', () => {
    expect(() => new SmtpTransport({})).toThrow(
      'SmtpTransport needs a transporter, a host or nodemailer options'
    );
  });
});
