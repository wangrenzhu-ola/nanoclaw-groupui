import readline from 'readline';
import { Channel, NewMessage } from '../types.js';
import { registerChannel, ChannelOpts } from './registry.js';
import { randomUUID } from 'crypto';

class CliChannel implements Channel {
  name = 'cli';
  private rl: readline.Interface | null = null;
  private opts: ChannelOpts;

  constructor(opts: ChannelOpts) {
    this.opts = opts;
  }

  async connect(): Promise<void> {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: '> ',
    });

    this.rl.on('line', (line) => {
      const content = line.trim();
      if (!content) return;

      const msg: NewMessage = {
        id: randomUUID(),
        chat_jid: 'cli:main',
        sender: 'user',
        sender_name: 'User',
        content,
        timestamp: new Date().toISOString(),
        is_from_me: false,
      };

      this.opts.onMessage('cli:main', msg);
      this.rl?.prompt();
    });

    // Register metadata for the main CLI chat
    this.opts.onChatMetadata(
      'cli:main',
      new Date().toISOString(),
      'CLI Chat',
      'cli',
      false,
    );

    console.log('CLI Channel connected. Type messages to chat.');
    this.rl.prompt();
  }

  async disconnect(): Promise<void> {
    this.rl?.close();
  }

  async sendMessage(jid: string, text: string): Promise<void> {
    console.log(`\n[Agent]: ${text}\n`);
    this.rl?.prompt();
  }

  isConnected(): boolean {
    return true;
  }

  ownsJid(jid: string): boolean {
    return jid.startsWith('cli:');
  }
}

registerChannel('cli', (opts) => new CliChannel(opts));
