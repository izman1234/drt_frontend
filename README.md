# DRT Frontend

The desktop client for the Discord Replacement Tool — an Electron + React application providing a Discord-like chat experience with end-to-end identity verification and real-time communication.

## Features

- **Passwordless Identity System** — Ed25519 keypair generation, Argon2id password-based key wrapping, and challenge-response authentication
- **Recovery Keys** — 256-bit Crockford Base32 recovery keys for account backup and restoration
- **Encrypted Identity Storage** — Master key architecture with password-KEK and recovery-KEK wrapping (XChaCha20-Poly1305)
- **Text Channels** — Browse, create, edit, delete, and reorder channels with unread indicators
- **Voice Channels** — WebRTC peer-to-peer voice with mute/deafen controls and speaking indicators
- **Real-time Messaging** — Live message send/receive/edit/delete via Socket.IO
- **Message Signatures** — Ed25519 signing and verification of messages
- **Image Attachments** — Inline image attachments with paste and file picker support
- **Reply Threading** — Reply to specific messages with context
- **Emoji Reactions** — React to messages with emoji
- **GIF Picker** — Integrated GIF search and trending via Klipy API
- **User Profiles** — Custom display names, profile pictures, and name colors
- **User Presence** — Real-time online/offline/away status with idle detection
- **Image Cropping** — Built-in image crop/resize tool for profile pictures
- **Color Picker** — Custom name color selection
- **TLS Trust-On-First-Use** — Automatic self-signed certificate trust with fingerprint pinning
- **Server Discovery** — Automatic protocol detection (HTTPS+1, HTTPS, HTTP fallback)

## Tech Stack

- **Framework**: React 18
- **Desktop Shell**: Electron 25
- **Build Tool**: react-scripts 5 (via react-app-rewired)
- **HTTP Client**: Axios
- **Real-time**: Socket.IO Client
- **Cryptography**: libsodium-wrappers-sumo (Ed25519, XChaCha20-Poly1305, Argon2id)
- **Virtualization**: react-window (for large message/user lists)
- **Dev Tools**: concurrently, wait-on

## Setup

If you only care about using it and not actually contributing go to the tags tab and download the installer of the desired version. 
Else:

1. Install dependencies:
   ```bash
   npm install
   ```

2. Start the development server:
   ```bash
   npm start
   ```

   This starts the React dev server on `http://localhost:3000`.

3. Run the Electron app (in a separate terminal):
   ```bash
   npm run electron
   ```

   Or run both simultaneously:
   ```bash
   npm run dev
   ```

## Components

| Component | Description |
|-----------|-------------|
| **App** | Root component — routes between Auth and Main based on authentication state |
| **Auth** | Identity creation, unlock, recovery, and server connection UI |
| **Main** | Main layout shell — manages socket connection, user state, and layout |
| **ServerList** | Server sidebar — displays server icon and name |
| **ChannelList** | Channel sidebar — text/voice channel list with create, edit, delete, reorder, and unread indicators |
| **MessageArea** | Message display and input — pagination, replies, editing, image attachments, GIF sending, signature verification |
| **UserList** | User sidebar — online/offline user list with profile pictures, name colors, and status |
| **VoiceArea** | Voice channel UI — join/leave, mute/deafen, WebRTC peer connections, speaking indicators |
| **GifPicker** | GIF search and trending picker (Klipy integration) |
| **ColorPicker** | Name color selection UI |
| **ImagePicker** | Image selection for attachments and profile pictures |
| **ImageCropper** | Image crop and resize tool |

## Security Model

The client implements a comprehensive cryptographic identity system:

1. **Identity keypair** (Ed25519) — used for authentication and message signing
2. **Recovery keypair** (Ed25519) — used for account recovery and key rotation
3. **Master key** — 256-bit random key that encrypts private keys at rest
4. **Password KEK** — Argon2id-derived key (3 ops, 64MB) that wraps the master key
5. **Recovery KEK** — Derived from recovery key, also wraps the master key
6. **TOFU certificate pinning** — Self-signed server certificates are trusted on first connection, with fingerprints stored locally

No passwords are ever transmitted to the server.

## TODO

- Linux support
- Roles and permissions
- Ping (@) users
- Video / Screen Sharing
- Custom Server Emojis
- Banning / Kicking
- Direct Messaging
- More I can't think of right now

## Building

To build the React app for production:
```bash
npm run build
```

The built files go to the `build/` directory and are served by Electron in production mode.

## Notes

- Requires a running DRT Backend server to connect to
- The Electron app falls back to serving built files if the React dev server is not running
- Voice channels use WebRTC for peer-to-peer audio

## License

MIT — see [LICENSE](LICENSE) for details.
