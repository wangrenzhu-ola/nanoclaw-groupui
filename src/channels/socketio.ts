import { io, Socket } from 'socket.io-client';
import { Channel, OnInboundMessage, OnChatMetadata, NewMessage } from '../types.js';
import { logger } from '../logger.js';

export interface SocketIOChannelConfig {
  url: string; // e.g. "http://localhost:3000"
  onMessage: OnInboundMessage;
  onChatMetadata: OnChatMetadata;
}

export class SocketIOChannel implements Channel {
  name = 'socketio';
  private socket: Socket | null = null;
  private url: string;
  private onMessage: OnInboundMessage;
  private onChatMetadata: OnChatMetadata;

  constructor(config: SocketIOChannelConfig) {
    this.url = config.url;
    this.onMessage = config.onMessage;
    this.onChatMetadata = config.onChatMetadata;
  }

  async connect(): Promise<void> {
    if (this.socket?.connected) return;

    logger.info({ url: this.url }, 'Connecting to Socket.io WebUI...');
    this.socket = io(this.url, {
      reconnection: true,
      reconnectionAttempts: 5,
    });

    this.socket.on('connect', () => {
      logger.info('Connected to Socket.io WebUI');
    });

    this.socket.on('client:message', (data: any) => {
      // Data from WebUI: { chat_jid, content, sender, timestamp? }
      logger.debug({ data }, 'Received socket message');
      
      // Note: WebUI (server.ts) already saves message to DB.
      // We listen here mainly to update metadata or trigger immediate processing if needed.
      // But Core polls DB, so we don't need to store it again to avoid duplicates.
      // However, we might want to ensure metadata is fresh.
      
      const msg: NewMessage = {
        id: data.id || Date.now().toString(),
        chat_jid: data.chat_jid,
        sender: data.sender || 'User',
        sender_name: data.sender || 'User',
        content: data.content,
        timestamp: data.timestamp ? new Date(data.timestamp).toISOString() : new Date().toISOString(),
        is_from_me: false, // Inbound from user
      };

      // Notify core - BUT SKIP STORAGE if we assume DB polling handles it.
      // The `onMessage` callback in index.ts calls `storeMessage`.
      // If we call it, we duplicate.
      // So we comment this out for now, relying on DB polling.
      // this.onMessage(msg.chat_jid, msg);
      
      // Update metadata (assume it exists if message received)
      this.onChatMetadata(msg.chat_jid, msg.timestamp, msg.chat_jid.split('@')[0], 'socketio', true);
    });

    this.socket.on('disconnect', () => {
      logger.warn('Disconnected from Socket.io WebUI');
    });
  }

  async sendMessage(jid: string, text: string): Promise<void> {
    if (!this.socket?.connected) {
      logger.warn({ jid }, 'Cannot send message: Socket not connected');
      return;
    }
    
    // Emit agent:response
    this.socket.emit('agent:response', {
        jid,
        content: text
    });
  }

  isConnected(): boolean {
    return !!this.socket?.connected;
  }

  ownsJid(jid: string): boolean {
    // Assume any JID ending in @nanoclaw or generic ones are ours
    // Or simple check: if it was received via socket, we reply via socket.
    // For now, let's claim anything that looks like a WebUI JID.
    return jid.includes('@nanoclaw') || jid.includes('@socket');
  }

  async disconnect(): Promise<void> {
    this.socket?.disconnect();
    this.socket = null;
  }

  async setTyping(jid: string, isTyping: boolean): Promise<void> {
    if (!this.socket?.connected) return;
    if (isTyping) {
        this.socket.emit('agent:typing', { chat_jid: jid });
    }
  }
}

export function createSocketIOChannel(
  config: { 
    onMessage: OnInboundMessage; 
    onChatMetadata: OnChatMetadata;
    registeredGroups: () => any 
  }
): Channel | null {
  // Check if WebUI URL is configured, or default to localhost:3000
  const url = process.env.WEBUI_URL || 'http://localhost:3000';
  return new SocketIOChannel({
    url,
    onMessage: config.onMessage,
    onChatMetadata: config.onChatMetadata,
  });
}
