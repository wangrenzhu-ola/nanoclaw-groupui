// Channel self-registration barrel file.
// Each import triggers the channel module's registerChannel() call.

import './cli.js';
import { createSocketIOChannel } from './socketio.js';
import { registerChannel } from './registry.js';

// Manually register socketio for now as we didn't add self-registration in socketio.ts
registerChannel('socketio', createSocketIOChannel);

// discord

// gmail

// slack

// telegram

// whatsapp
