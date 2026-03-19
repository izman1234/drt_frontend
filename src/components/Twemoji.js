import React, { memo } from 'react';
import './Twemoji.css';

/**
 * Twemoji — renders emoji characters as consistent Twemoji SVG images.
 *
 * Usage:
 *   <Twemoji emoji="😀" />                  — single emoji as an image
 *   <Twemoji emoji="😀" size={24} />        — custom size
 *   <Twemoji text="Hello 👋 world 🌍" />   — mixed text with inline emoji images
 */

const TWEMOJI_BASE = 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/';

/**
 * Convert a single emoji character to its Twemoji SVG URL.
 */
function emojiToUrl(emoji) {
  const codePoints = [];
  for (const char of emoji) {
    const cp = char.codePointAt(0);
    // Skip U+FE0F (variation selector 16) – Twemoji file names exclude it
    if (cp !== 0xfe0f) {
      codePoints.push(cp.toString(16));
    }
  }
  return `${TWEMOJI_BASE}svg/${codePoints.join('-')}.svg`;
}

/**
 * <Twemoji emoji="🔥" />
 *
 * Renders a single emoji as an <img> tag using Twemoji SVG.
 * Props:
 *   emoji     – the emoji character(s)
 *   size      – pixel size (default: 20 for inline, override as needed)
 *   className – additional class name
 *   style     – additional inline styles
 */
const TwemojiIcon = memo(function TwemojiIcon({ emoji, size, className = '', style = {} }) {
  if (!emoji) return null;
  const url = emojiToUrl(emoji);
  const s = size || 20;
  return (
    <img
      src={url}
      alt={emoji}
      className={`twemoji ${className}`}
      draggable={false}
      style={{
        width: `${s}px`,
        height: `${s}px`,
        verticalAlign: 'middle',
        display: 'inline-block',
        ...style
      }}
    />
  );
});

/**
 * Parse a string that may contain emoji into an array of React elements,
 * replacing each emoji with a Twemoji <img>.
 */
function parseTextWithEmoji(text, size) {
  if (!text) return text;

  // Use twemoji.parse to get HTML, then extract positions
  // Instead, use a regex-based approach for React rendering
  const emojiRegex = /(\p{Emoji_Presentation}|\p{Emoji}\uFE0F|\p{Emoji_Modifier_Base}\p{Emoji_Modifier}?)/gu;
  
  const parts = [];
  let lastIndex = 0;
  let match;

  while ((match = emojiRegex.exec(text)) !== null) {
    // Add text before the emoji
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    // Add the Twemoji image
    parts.push(
      <TwemojiIcon key={`emoji-${match.index}`} emoji={match[0]} size={size} />
    );
    lastIndex = match.index + match[0].length;
  }

  // Add remaining text
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length > 0 ? parts : text;
}

/**
 * <Twemoji emoji="😀" />         → single emoji image
 * <Twemoji text="Hi 👋!" />      → mixed text with emoji images
 * <Twemoji emoji="😀" size={32} /> → sized emoji
 */
function Twemoji({ emoji, text, size, className, style }) {
  if (emoji) {
    return <TwemojiIcon emoji={emoji} size={size} className={className} style={style} />;
  }
  if (text !== undefined && text !== null) {
    return <>{parseTextWithEmoji(String(text), size)}</>;
  }
  return null;
}

export default memo(Twemoji);
export { TwemojiIcon, parseTextWithEmoji, emojiToUrl };
