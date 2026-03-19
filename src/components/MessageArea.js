import React, { useState, useRef, useEffect } from 'react';
import { messageAPI } from '../api';
import GifPicker from './GifPicker';
import ImagePicker from './ImagePicker';
import CustomModal from './CustomModal';
import Twemoji, { parseTextWithEmoji } from './Twemoji';
import './MessageArea.css';

// SQLite stores CURRENT_TIMESTAMP as 'YYYY-MM-DD HH:MM:SS' with no timezone
// marker, meaning it is UTC. Without a 'Z' suffix, JavaScript's Date parser
// treats that format as local time — so we normalise it to UTC first, then
// toLocaleTimeString() will render it in the user's actual local timezone.
function parseTimestamp(ts) {
  if (!ts) return new Date();
  if (typeof ts === 'string' && !ts.endsWith('Z') && !/[+-]\d{2}:\d{2}$/.test(ts)) {
    // Replace the space separator (SQLite) or leave T (ISO) then force UTC
    return new Date(ts.replace(' ', 'T') + 'Z');
  }
  return new Date(ts);
}

const EMOJI_CATEGORIES = {
  smileys: {
    name: 'Smileys',
    icon: '😀',
    emojis: ['😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '🙃', '😉', '😊', '😇', '🥰', '😍', '🤩', '😘', '😗', '😚', '😙', '😋', '😛', '😜', '🤪', '😌', '😔', '😑', '😐', '😶', '😏', '😒', '🙁', '😬', '🤐', '🤨', '😐', '😕', '🤦', '🤷', '😮', '😯', '😲', '😳', '🥺', '😦', '😧', '😨', '😰', '😥', '😢', '😭', '😱', '😖', '😣', '😞', '😓', '😩', '😫', '🥱', '😤', '😡', '😠', '🤬', '😈', '👿', '💀', '☠️', '💩', '🤡', '👹', '👺', '👻', '👽', '👾', '🤖']
  },
  hand: {
    name: 'Hands',
    icon: '👋',
    emojis: ['👋', '🤚', '🖐️', '✋', '🖖', '👌', '🤏', '✌️', '🤞', '🤟', '🤘', '🤙', '👍', '👎', '✊', '👊', '🤛', '🤜', '👏', '🙌', '👐', '🤲', '🤝', '🤜', '🤛', '🦵', '🦶', '👂', '👃', '🧠', '🦷', '🦴', '🌳']
  },
  food: {
    name: 'Food',
    icon: '🍔',
    emojis: ['🍏', '🍎', '🍐', '🍊', '🍋', '🍌', '🍉', '🍇', '🍓', '🍈', '🍒', '🍑', '🥭', '🍍', '🥥', '🥑', '🍆', '🍅', '🌶️', '🌽', '🥕', '🧄', '🧅', '🥔', '🍠', '🥐', '🥯', '🍞', '🥖', '🥨', '🧀', '🥚', '🍳', '🧈', '🥞', '🧇', '🥓', '🥔', '🍖', '🍗', '🥩', '🍝', '🍜', '🍲', '🍛', '🍣', '🍱', '🥟', '🦪', '🍤', '🍙', '🍚', '🍘', '🍥', '🥠', '🥮', '🍢', '🍡', '🍧', '🍨', '🍦', '🍰', '🎂', '🧁', '🍮', '🍭', '🍬', '🍫', '🍿', '🍩', '🍪', '🌰', '🍯', '🥛', '🍼', '☕', '🍵', '🍶', '🍾', '🍷', '🍸', '🍹', '🍺', '🍻', '🥂', '🍻']
  },
  activity: {
    name: 'Activity',
    icon: '⚽',
    emojis: ['⚽', '🏀', '🏈', '⚾', '🥎', '🎾', '🏐', '🏉', '🥏', '🎳', '🏓', '🏸', '🏒', '🏑', '🥍', '🏏', '🥅', '⛳', '⛸️', '🎣', '🎽', '🎿', '⛷️', '🏂', '🪂', '🛷', '🛹', '🛼', '🛴', '🚲', '🛵', '🏇', '🎪', '🎨', '🎬', '🎤', '🎧', '🎼', '🎹', '🥁', '🎷', '🎺', '🎸', '🎻', '🎲', '🧩', '♟️', '🎯', '🎳', '🎮', '🎰']
  },
  travel: {
    name: 'Travel',
    icon: '✈️',
    emojis: ['✈️', '🛫', '🛬', '🛩️', '💺', '🛰️', '🚁', '🛶', '⛵', '🚤', '🛳️', '🛥️', '🛳', '⛴️', '🚢', '⚓', '⛽', '🚧', '🚨', '🚥', '🚦', '🛑', '🚒', '🚐', '🚚', '🚛', '🚜', '🏎️', '🏍️', '🛵', '🦯', '🦽', '🦼', '🛴', '🚲', '🛹', '🚏', '⛽', '🚨', '🚥', '🚦', '🗺️', '🗿', '🗽', '🗼', '⛩️', '🛤️', '🛣️', '🗾', '🎑']
  },
  nature: {
    name: 'Nature',
    icon: '🌸',
    emojis: ['🌋', '⛰️', '🌄', '🌅', '🌆', '🌇', '🌉', '🌁', '⛱️', '🏖️', '🏝️', '🏜️', '🌞', '🌝', '🌛', '🌜', '🌚', '🌕', '🌖', '🌑', '🌒', '🌓', '🌔', '🌙', '🌎', '🌍', '🌏', '💫', '⭐', '🌟', '✨', '⚡', '☄️', '💥', '🔥', '🌪️', '🌈', '☀️', '🌤️', '⛅', '🌥️', '☁️', '🌦️', '🌧️', '⛈️', '🌩️', '🌨️', '❄️', '☃️', '⛄', '🌬️', '💨', '💧', '💦', '☔']
  },
  objects: {
    name: 'Objects',
    icon: '⌚',
    emojis: ['⌚', '📱', '📲', '💻', '⌨️', '🖥️', '🖨️', '🖱️', '🖲️', '🕹️', '🗜️', '💽', '💾', '💿', '📀', '🧮', '🎥', '🎬', '📺', '📷', '📸', '📹', '🎞️', '📽️', '🎦', '📞', '☎️', '📟', '📠', '📺', '📻', '🎙️', '🎚️', '🎛️', '🧭', '⏱️', '⏲️', '⏰', '🕰️', '⌛', '⏳', '📡', '🔋', '🔌', '💡', '🔦', '🕯️', '🪔', '🧯', '🛢️', '💸', '💵', '💴', '💶', '💷', '💰', '💳', '🧾', '✉️', '📩', '📨', '📧']
  },
  symbols: {
    name: 'Symbols',
    icon: '❤️',
    emojis: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❤️‍🔥', '❤️‍🩹', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💟', '👋', '🤚', '🖐️', '✋', '🖖', '👌', '🤏', '✌️', '🤞', '🤟', '🤘', '🤙', '👍', '👎', '✊', '👊', '🤛', '🤜', '👏', '🙌', '👐', '🤲', '🤝', '🤜', '🔥', '✨', '⭐', '💫', '☄️', '✅', '❌', '❎', '✔️', '⚠️', '🔴', '🟠', '🟡', '🟢', '🔵', '🟣', '🟤', '⚫', '⚪', '🟥', '🟧', '🟨', '🟩', '🟦', '🟪', '🟫', '🔶', '🔷', '🔸', '🔹']
  }
};

function MessageArea({ messages, onSendMessage, onLoadMoreMessages, channelId, currentUserId, onAddReaction, onRemoveReaction, accountKey}) {
  const [inputValue, setInputValue] = useState('');
  
  const normalizeNameColor = (color) => {
    // Convert old grey defaults to new purple
    if (color === '#b9bbbe' || color === '#b5bac1') {
      return '#a78bba';
    }
    return color || '#a78bba';
  };
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [emojiPickerFor, setEmojiPickerFor] = useState('compose'); // 'compose', 'edit', or 'reaction'
  const [emojiPickerPosition, setEmojiPickerPosition] = useState('below'); // 'above' or 'below' for edit picker
  const [selectedEmojiCategory, setSelectedEmojiCategory] = useState('smileys');
  const [emojiSearchQuery, setEmojiSearchQuery] = useState('');
  const [recentlyUsedEmojis, setRecentlyUsedEmojis] = useState([]);
  const [showGifPicker, setShowGifPicker] = useState(false);
  const [showImagePicker, setShowImagePicker] = useState(false);
  const [imagePreview, setImagePreview] = useState(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [contextMenu, setContextMenu] = useState(null);
  const [contextMenuPosition, setContextMenuPosition] = useState({ x: 0, y: 0, direction: 'down' }); // 'down' or 'up'
  const [editingMessageId, setEditingMessageId] = useState(null);
  const [editingMessageText, setEditingMessageText] = useState('');
  const [editingMessageImage, setEditingMessageImage] = useState(null);
  const [removeEditImage, setRemoveEditImage] = useState(false);
  const [replyingTo, setReplyingTo] = useState(null); // { id, author, text, image, profilePicture }
  const [reactionContextMessageId, setReactionContextMessageId] = useState(null); // which message is adding reaction
  const [reactionPickerPosition, setReactionPickerPosition] = useState({ x: 0, y: 0 });
  const [reactionPickerPositionDirection, setReactionPickerPositionDirection] = useState('below'); // 'above' or 'below'
  const [modalInfo, setModalInfo] = useState({ open: false, title: '', message: '', type: 'alert', onConfirm: null, onCancel: null });

  const showModal = (message, { title = '', type = 'alert', onConfirm, onCancel } = {}) => {
    setModalInfo({ open: true, title, message, type, onConfirm: onConfirm || null, onCancel: onCancel || null });
  };
  const closeModal = (confirmed = false) => {
    const info = modalInfo;
    setModalInfo(prev => ({ ...prev, open: false }));
    if (confirmed && info.onConfirm) info.onConfirm();
    if (!confirmed && info.onCancel) info.onCancel();
  };
  const fileInputRef = useRef(null);
  const emojiPickerRef = useRef(null);
  const editEmojiPickerRef = useRef(null);
  const reactionPickerRef = useRef(null);
  const gifPickerRef = useRef(null);
  const imagePickerRef = useRef(null);
  const contextMenuRef = useRef(null);
  const emojiGridRef = useRef(null);
  const emojiCategoryRefsMap = useRef({});
  const messageInputRef = useRef(null);
  const messagesContainerRef = useRef(null);
  const editInputRef = useRef(null);
  const lastMessageCountRef = useRef(0);
  const prevChannelIdRef = useRef(null);
  const justSwitchedChannelRef = useRef(false);
  const inputContainerHeightRef = useRef(0);
  const lastDistanceFromBottomRef = useRef(0);

  const handleSend = () => {
    if (inputValue.trim() || imagePreview) {
      const messageData = {
        text: inputValue,
        image: imagePreview,
        replyTo: replyingTo?.id || null
      };
      onSendMessage(messageData);
      setInputValue('');
      setImagePreview(null);
      setShowEmojiPicker(false);
      setReplyingTo(null);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  useEffect(() => {
    const handleClickOutside = (event) => {
      // Close emoji picker when clicking outside
      if (emojiPickerRef.current && !emojiPickerRef.current.contains(event.target)) {
        if (emojiPickerFor === 'compose') {
          setShowEmojiPicker(false);
        }
      }
      if (editEmojiPickerRef.current && !editEmojiPickerRef.current.contains(event.target)) {
        if (emojiPickerFor === 'edit') {
          setShowEmojiPicker(false);
        }
      }
      // Close context menu only if clicking outside of it
      if (contextMenu && contextMenuRef.current && !contextMenuRef.current.contains(event.target)) {
        setContextMenu(null);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [contextMenu, emojiPickerFor]);

  // Load recently used emojis from localStorage
  useEffect(() => {
    const stored = localStorage.getItem(`recentlyUsedEmojis_${accountKey}`);
    if (stored) {
      try {
        setRecentlyUsedEmojis(JSON.parse(stored));
      } catch (e) {
        console.error('Error loading recently used emojis:', e);
      }
    }
  }, [accountKey]);

  // Set active category to recently used when picker opens if there are recent emojis
  useEffect(() => {
    if (showEmojiPicker && recentlyUsedEmojis.length > 0) {
      setSelectedEmojiCategory('recently');
    }
  }, [showEmojiPicker, recentlyUsedEmojis.length]);

  // Auto-resize textarea based on content
  useEffect(() => {
    const textarea = messageInputRef.current;
    if (textarea) {
      textarea.style.height = '24px';
      const scrollHeight = textarea.scrollHeight;
      textarea.style.height = Math.max(scrollHeight, 24) + 'px';
    }
  }, [inputValue]);

  // Handle scroll for loading older messages (top 25%)
  const handleScroll = (e) => {
    const container = e.target;
    
    // Track distance from bottom so we can use it to decide if new messages should scroll
    lastDistanceFromBottomRef.current = container.scrollHeight - container.scrollTop - container.clientHeight;
    
    // Trigger pagination only when scrolling to the top
    if (container.scrollTop < container.scrollHeight * 0.25 && !isLoadingMore && onLoadMoreMessages) {
      setIsLoadingMore(true);
      onLoadMoreMessages();
      // Reset loading state after a delay
      setTimeout(() => setIsLoadingMore(false), 500);
    }
  };

  // Auto-scroll to bottom on new messages or initial load
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) {
      return;
    }

    // Detect channel switch
    if (channelId !== prevChannelIdRef.current) {
      prevChannelIdRef.current = channelId;
      justSwitchedChannelRef.current = true;
      lastMessageCountRef.current = 0;
      return; // Don't scroll yet, wait for messages to load
    }

    if (messages.length === 0) {
      lastMessageCountRef.current = 0;
      return;
    }

    // After channel switch, scroll once we have the new messages
    if (justSwitchedChannelRef.current) {
      setTimeout(() => {
        container.scrollTop = container.scrollHeight;
      }, 0);
      justSwitchedChannelRef.current = false;
      lastMessageCountRef.current = messages.length;
      return;
    }

    const countDifference = messages.length - lastMessageCountRef.current;
    
    // Auto-scroll on new message if user was near the bottom BEFORE the message arrived
    // Check the distance from BEFORE the new message was added (tracked in handleScroll)
    // This prevents large messages from forcing scroll when user is intentionally reading history
    if (countDifference > 0 && countDifference < 30) {
      if (lastDistanceFromBottomRef.current < 300) {
        // User was near bottom before the message, so scroll down to show it
        // Use multiple intervals to handle images/content rendering
        const scrollIntervals = [0, 100, 200, 300, 500, 800, 1200];
        scrollIntervals.forEach(delay => {
          setTimeout(() => {
            container.scrollTop = container.scrollHeight;
          }, delay);
        });
      }
    }
    // Don't scroll on pagination (30+ messages added at once)
    
    lastMessageCountRef.current = messages.length;
  }, [messages, channelId]);

  // Attach scroll listener
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (container && onLoadMoreMessages) {
      container.addEventListener('scroll', handleScroll);
      return () => container.removeEventListener('scroll', handleScroll);
    }
  }, [isLoadingMore, onLoadMoreMessages]);

  // Monitor input container height and adjust scroll to maintain position
  useEffect(() => {
    const inputContainer = document.querySelector('.message-input-container');
    const messagesContainer = messagesContainerRef.current;
    
    if (!inputContainer || !messagesContainer) return;

    // Store initial height
    inputContainerHeightRef.current = inputContainer.offsetHeight;

    const resizeObserver = new ResizeObserver(() => {
      const newHeight = inputContainer.offsetHeight;
      const heightDifference = newHeight - inputContainerHeightRef.current;
      
      // If input grew, adjust scroll position
      if (heightDifference > 0) {
        const distanceFromBottom = messagesContainer.scrollHeight - messagesContainer.scrollTop - messagesContainer.clientHeight;
        const isNearBottom = distanceFromBottom < 100;
        
        if (isNearBottom) {
          // If we're at the bottom, keep it at the very bottom
          setTimeout(() => {
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
          }, 0);
        } else {
          // If we're reading history, adjust scroll to keep same content visible
          messagesContainer.scrollTop += heightDifference;
        }
      }
      
      inputContainerHeightRef.current = newHeight;
    });

    resizeObserver.observe(inputContainer);
    return () => resizeObserver.disconnect();
  }, []);

  // Close reaction picker when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (
        showEmojiPicker &&
        emojiPickerFor === 'reaction' &&
        reactionPickerRef.current &&
        !reactionPickerRef.current.contains(e.target)
      ) {
        // Also check if the click is on an add-reaction button
        if (!e.target.closest('.add-reaction-btn')) {
          setShowEmojiPicker(false);
          setReactionContextMessageId(null);
          setEmojiSearchQuery('');
        }
      }
    };

    if (showEmojiPicker && emojiPickerFor === 'reaction') {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showEmojiPicker, emojiPickerFor]);

  const getInitial = (user) => {
    const name = user.displayName || user.username;
    return name.charAt(0).toUpperCase();
  };

  const getProfilePicture = (user) => {
    if (user.profilePicture) {
      return user.profilePicture;
    }
    return localStorage.getItem(`profilePicture_${user.userId}`) || null;
  };

  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    if (file && file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setImagePreview(reader.result);
      };
      reader.readAsDataURL(file);
    } else {
      showModal('Please select an image file', { title: 'Invalid File' });
    }
  };

  const handleEmojiSelect = (emoji) => {
    if (emojiPickerFor === 'edit') {
      setEditingMessageText(prev => prev + emoji);
    } else if (emojiPickerFor === 'reaction' && reactionContextMessageId) {
      onAddReaction(reactionContextMessageId, emoji);
    } else {
      setInputValue(prev => prev + emoji);
    }
    setShowEmojiPicker(false);
    setReactionContextMessageId(null);
    setEmojiSearchQuery('');
    
    // Track recently used emojis
    setRecentlyUsedEmojis(prev => {
      // Remove emoji if it already exists, then add it to the beginning
      const filtered = prev.filter(e => e !== emoji);
      const updated = [emoji, ...filtered].slice(0, 10); // Keep only 10 most recent
      // Save to localStorage
      localStorage.setItem(`recentlyUsedEmojis_${accountKey}`, JSON.stringify(updated));
      return updated;
    });
  };

  const handleGifSelect = (gifUrl) => {
    // Add GIF as image to the message
    setImagePreview(gifUrl);
    setShowGifPicker(false);
  };

  const handleImageSelect = (imageData) => {
    // Add selected image to the message
    setImagePreview(imageData);
    setShowImagePicker(false);
  };

  const handleEmojiGridScroll = (e) => {
    const grid = e.target;
    let closestCategory = 'smileys';
    let closestDistance = Infinity;
    
    // Find the category header that's closest to the top of the visible area
    const allCategories = ['recently', ...Object.keys(EMOJI_CATEGORIES)];
    
    for (const categoryKey of allCategories) {
      const categoryRef = emojiCategoryRefsMap.current[categoryKey];
      if (categoryRef) {
        const rect = categoryRef.getBoundingClientRect();
        const gridRect = grid.getBoundingClientRect();
        
        // Calculate distance from top of grid
        const distanceFromTop = rect.top - gridRect.top;
        
        // We want the category that's closest to the top (but below it or slightly above)
        // This finds the "most visible" category at the top of the scroll area
        if (distanceFromTop < 100 && distanceFromTop > -rect.height && distanceFromTop < closestDistance) {
          closestCategory = categoryKey;
          closestDistance = distanceFromTop;
        }
      }
    }
    
    // Only update if we found a valid category and recently used is actually in use
    if (closestCategory === 'recently' && recentlyUsedEmojis.length === 0) {
      closestCategory = 'smileys';
    }
    
    setSelectedEmojiCategory(closestCategory);
  };

  const handleCategoryTabClick = (categoryKey) => {
    setSelectedEmojiCategory(categoryKey);
    if (emojiCategoryRefsMap.current[categoryKey]) {
      emojiCategoryRefsMap.current[categoryKey].scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const getFilteredEmojis = () => {
    if (!emojiSearchQuery.trim()) {
      return EMOJI_CATEGORIES;
    }

    const query = emojiSearchQuery.toLowerCase();
    const filtered = {};

    // Common emoji meanings/names for search
    const emojiNames = {
      '😀': 'grinning smiling happy',
      '😃': 'grinning face smiley',
      '😄': 'smiling eyes happy',
      '😁': 'beaming face smiling',
      '😆': 'grinning laughing smile',
      '😅': 'sweat drop happy',
      '🤣': 'rolling laughing tears',
      '😂': 'tears joy laugh crying',
      '😊': 'smiling heart love',
      '😇': 'angel halo innocent',
      '🙂': 'slightly smiling neutral',
      '🙃': 'upside down sarcasm irony',
      '😉': 'wink winking flirty',
      '😌': 'relieved content peaceful',
      '😍': 'heart eyes love beautiful',
      '🥰': 'red hearts love adore',
      '😘': 'kisses kiss love',
      '👋': 'waving hand hi hello bye',
      '👌': 'ok okay perfect',
      '👍': 'thumbs up yes good',
      '👎': 'thumbs down no bad',
      '❤️': 'red heart love',
      '🔥': 'fire hot awesome flame',
      '✨': 'sparkles magic glitter stars',
      '⭐': 'star bright',
      '👻': 'ghost scary spooky',
      '🍕': 'pizza food eat',
      '🍔': 'hamburger burger food',
      '🍦': 'ice cream dessert cold',
      '🎉': 'party celebration confetti',
      '🎂': 'cake birthday dessert',
    };

    Object.entries(EMOJI_CATEGORIES).forEach(([key, category]) => {
      const filteredEmojis = category.emojis.filter(emoji => {
        const emojiName = emojiNames[emoji] || '';
        const categoryName = category.name.toLowerCase();
        return emojiName.includes(query) || categoryName.includes(query) || emoji.includes(query);
      });

      if (filteredEmojis.length > 0) {
        filtered[key] = {
          ...category,
          emojis: filteredEmojis
        };
      }
    });

    return filtered;
  };

  const removeImage = () => {
    setImagePreview(null);
    fileInputRef.current.value = '';
  };

  const calculateEmojiPickerPosition = (element) => {
    if (!element) return 'below';
    
    const rect = element.getBoundingClientRect();
    const pickerHeight = 400; // Approximate height of emoji picker
    const spaceBelow = window.innerHeight - rect.bottom;
    
    // If there's at least 420px (picker height + margin) below, position below
    // Otherwise position above
    return spaceBelow >= pickerHeight + 50 ? 'below' : 'above';
  };

  const handleEditEmojiClick = () => {
    const position = calculateEmojiPickerPosition(editEmojiPickerRef.current);
    setEmojiPickerPosition(position);
    setEmojiPickerFor('edit');
    setShowEmojiPicker(!showEmojiPicker);
  };

  const calculateContextMenuPosition = (x, y) => {
    const menuHeight = 180; // Approximate height of context menu
    const menuWidth = 200;
    const spaceBelow = window.innerHeight - y;
    const spaceAbove = y;
    const margin = 8;
    
    let direction = 'down';
    let adjustedY = y + margin;
    
    // Prefer to position below
    if (spaceBelow >= menuHeight + margin) {
      direction = 'down';
      adjustedY = y + margin;
    } else if (spaceAbove >= menuHeight + margin) {
      // Position above if not enough space below
      direction = 'up';
      adjustedY = y - menuHeight - margin;
    } else {
      // Not enough space either way, fit it in the best way
      if (spaceBelow > spaceAbove) {
        direction = 'down';
        adjustedY = Math.min(y + margin, window.innerHeight - menuHeight - margin);
      } else {
        direction = 'up';
        adjustedY = Math.max(y - menuHeight - margin, margin);
      }
    }
    
    // Ensure menu doesn't go off screen horizontally
    let adjustedX = x;
    if (x + menuWidth > window.innerWidth) {
      adjustedX = window.innerWidth - menuWidth - margin;
    }
    
    return {
      direction,
      adjustedY: Math.max(margin, Math.min(adjustedY, window.innerHeight - menuHeight - margin)),
      adjustedX
    };
  };

  const handleMessageRightClick = (e, message) => {
    e.preventDefault();
    const positionData = calculateContextMenuPosition(e.clientX, e.clientY);
    setContextMenuPosition({
      x: positionData.adjustedX,
      y: positionData.adjustedY,
      direction: positionData.direction
    });
    setContextMenu({
      messageId: message.id,
      messageText: message.content,
      messageImage: message.image,
      messageAuthor: message.displayName || message.username,
      messageNameColor: message.nameColor,
      messageProfilePicture: message.profilePicture,
      isOwnMessage: message.userId === currentUserId
    });
  };

  const handleCopyText = () => {
    if (contextMenu?.messageText) {
      navigator.clipboard.writeText(contextMenu.messageText);
      setContextMenu(null);
    }
  };

  const handleReply = () => {
    if (contextMenu?.messageId) {
      setReplyingTo({
        id: contextMenu.messageId,
        author: contextMenu.messageAuthor,
        nameColor: contextMenu.messageNameColor,
        text: contextMenu.messageText,
        image: contextMenu.messageImage,
        profilePicture: contextMenu.messageProfilePicture
      });
      setContextMenu(null);
      messageInputRef.current?.focus();
    }
  };

  const handleEditMessage = () => {
    if (contextMenu) {
      setEditingMessageId(contextMenu.messageId);
      setEditingMessageText(contextMenu.messageText);
      setEditingMessageImage(contextMenu.messageImage || null);
      setRemoveEditImage(false);
      setContextMenu(null);
    }
  };

  const handleSaveEdit = async (messageId) => {
    if (editingMessageText.trim()) {
      try {
        await messageAPI.editMessage(messageId, editingMessageText, removeEditImage);
        setEditingMessageId(null);
        setEditingMessageText('');
        setEditingMessageImage(null);
        setRemoveEditImage(false);
        setShowEmojiPicker(false);
        setEmojiPickerFor('compose');
      } catch (error) {
        console.error('Error editing message:', error);
        showModal('Failed to edit message', { title: 'Error' });
      }
    }
  };

  const handleCancelEdit = () => {
    setEditingMessageId(null);
    setEditingMessageText('');
    setEditingMessageImage(null);
    setRemoveEditImage(false);
    setShowEmojiPicker(false);
    setEmojiPickerFor('compose');
  };

  const handleDeleteMessage = (messageId) => {
    showModal('Are you sure you want to delete this message?', {
      title: 'Delete Message',
      type: 'confirm',
      onConfirm: async () => {
        try {
          await messageAPI.deleteMessage(messageId);
          setContextMenu(null);
        } catch (error) {
          console.error('Error deleting message:', error);
          showModal('Failed to delete message', { title: 'Error' });
        }
      },
    });
  };

  const handleReactionButtonClick = (e, messageId) => {
    if (e && e.preventDefault) {
      e.preventDefault();
    }
    
    // Calculate position synchronously BEFORE setting state
    // This ensures the picker renders in the correct position on first render (no flicker)
    let position = { x: 0, y: 0 };
    let positionDirection = 'below';
    
    let buttonElement = null;
    let messageElement = null;
    
    // First, try to use the event's currentTarget if available
    if (e && e.currentTarget) {
      buttonElement = e.currentTarget;
    } else {
      // If called from context menu (e is null), find the button by message ID
      messageElement = document.querySelector(`[data-message-id="${messageId}"]`);
      if (messageElement) {
        buttonElement = messageElement.querySelector('.add-reaction-btn');
      }
    }
    
    if (buttonElement) {
      let rect = buttonElement.getBoundingClientRect();
      
      // If button is hidden (width/height 0), use message element position as fallback
      if ((rect.width === 0 || rect.height === 0) && !messageElement) {
        messageElement = document.querySelector(`[data-message-id="${messageId}"]`);
      }
      
      if ((rect.width === 0 || rect.height === 0) && messageElement) {
        // Use message container position as fallback
        rect = messageElement.getBoundingClientRect();
      }
      
      const pickerHeight = 400;
      const pickerWidth = 440;
      const spaceBelow = window.innerHeight - rect.bottom;
      const margin = 10;
      
      positionDirection = spaceBelow >= pickerHeight + margin ? 'below' : 'above';
      
      let x = rect.left;
      const rightEdge = x + pickerWidth;
      const viewportRight = window.innerWidth;
      
      if (rightEdge > viewportRight) {
        x = viewportRight - pickerWidth - margin;
      }
      x = Math.max(margin, x);
      
      let y;
      if (positionDirection === 'below') {
        y = rect.bottom + margin;
      } else {
        y = rect.top - pickerHeight - margin;
      }
      
      position = { x, y };
    }
    
    // Set all state at once with calculated position
    setReactionContextMessageId(messageId);
    setEmojiPickerFor('reaction');
    setShowEmojiPicker(true);
    setReactionPickerPosition(position);
    setReactionPickerPositionDirection(positionDirection);
  };

  const handleReactionClick = (messageId, emoji, userIds) => {
    // If current user has reacted with this emoji, remove the reaction
    if (userIds.includes(currentUserId)) {
      onRemoveReaction(messageId, emoji);
    } else {
      // Otherwise add the reaction
      onAddReaction(messageId, emoji);
    }
  };



  return (
    <>
      <div className="message-area">
      <div className="messages-container" ref={messagesContainerRef}>
        {messages.length === 0 ? (
          <div className="no-messages">No messages yet. Start the conversation!</div>
        ) : (
          messages.map(message => {
            const profilePicture = getProfilePicture(message);
            const isEditing = editingMessageId === message.id;
            return (
              <div
                key={message.id}
                data-message-id={message.id}
                className={`message ${message.userId === currentUserId ? 'own-message' : ''}`}
                onContextMenu={(e) => handleMessageRightClick(e, message)}
              >
                <div className="message-avatar">
                  {profilePicture ? (
                    <img src={profilePicture} alt={message.displayName || message.username} />
                  ) : (
                    <div className="message-initial">{getInitial(message)}</div>
                  )}
                </div>
                <div className="message-body">
                  <div className="message-header">
                    <span className="message-author" style={{ color: normalizeNameColor(message.nameColor) }}>{message.displayName || message.username}</span>
                    <span className="message-time">
                      {parseTimestamp(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      {message.edited_at && <span className="message-edited"> (edited)</span>}
                    </span>
                  </div>
                  {message.replyTo && message.repliedToId && (
                    <div className="message-quoted">
                      <div className="quoted-message-author" style={{ color: normalizeNameColor(message.repliedToNameColor) }}>
                        {message.repliedToProfilePicture && (
                          <img src={message.repliedToProfilePicture} alt={message.repliedToDisplay || message.repliedToUser} className="quoted-avatar" />
                        )}
                        <span>{message.repliedToDisplay || message.repliedToUser}</span>
                        {message.repliedToImage && (
                          <img src={message.repliedToImage} alt="quoted message" className="quoted-message-image" />
                        )}
                        <span className="quoted-message-text">{message.repliedToContent && (message.repliedToContent.length > 80 ? message.repliedToContent.substring(0, 80) + '...' : message.repliedToContent)}</span>
                      </div>
                    </div>
                  )}
                  {message.image && (
                    <img src={message.image} alt="Message attachment" className="message-image" />
                  )}
                  {isEditing ? (
                    <div className="message-edit-form">
                      {editingMessageImage && !removeEditImage && (
                        <div className="message-edit-image-preview">
                          <img src={editingMessageImage} alt="Message attachment" />
                          <button
                            type="button"
                            className="remove-edit-image-btn"
                            onClick={() => setRemoveEditImage(true)}
                            title="Remove image"
                          >
                            ✕
                          </button>
                        </div>
                      )}
                      <div className="message-edit-input-wrapper">
                        <textarea
                          ref={editInputRef}
                          value={editingMessageText}
                          onChange={(e) => setEditingMessageText(e.target.value)}
                          className="message-edit-input"
                        />
                        <div className="message-edit-emoji-wrapper" ref={editEmojiPickerRef}>
                          <button
                            type="button"
                            className="message-edit-emoji-btn"
                            title="Add emoji"
                            onClick={handleEditEmojiClick}
                          >
                            <Twemoji emoji="😊" size={18} />
                          </button>
                          {showEmojiPicker && emojiPickerFor === 'edit' && (
                            <div className={`emoji-picker-dropdown position-${emojiPickerPosition}`}>
                              <div className="emoji-picker-container">
                                <input
                                  type="text"
                                  placeholder="Search emojis..."
                                  value={emojiSearchQuery}
                                  onChange={(e) => setEmojiSearchQuery(e.target.value)}
                                  className="emoji-search-input"
                                  autoFocus
                                />
                                <div className="emoji-category-tabs-vertical">
                                  {recentlyUsedEmojis.length > 0 && (
                                    <button
                                      className={`emoji-category-tab ${selectedEmojiCategory === 'recently' ? 'active' : ''}`}
                                      onClick={() => handleCategoryTabClick('recently')}
                                      title="Recently Used"
                                    >
                                      <Twemoji emoji="🕐" size={18} />
                                    </button>
                                  )}
                                  {Object.entries(getFilteredEmojis()).map(([key, category]) => (
                                    <button
                                      key={key}
                                      className={`emoji-category-tab ${selectedEmojiCategory === key ? 'active' : ''}`}
                                      onClick={() => handleCategoryTabClick(key)}
                                      title={category.name}
                                    >
                                      <Twemoji emoji={category.icon} size={18} />
                                    </button>
                                  ))}
                                </div>
                                <div className="emoji-grid-container" ref={emojiGridRef} onScroll={handleEmojiGridScroll}>
                                  {recentlyUsedEmojis.length > 0 && (
                                    <div ref={(el) => emojiCategoryRefsMap.current['recently'] = el} className="emoji-category-section">
                                      <div className="emoji-category-header">Recently Used</div>
                                      <div className="emoji-grid">
                                        {recentlyUsedEmojis.map((emoji) => (
                                          <button
                                            key={`recent-${emoji}`}
                                            type="button"
                                            className="emoji-option"
                                            onClick={() => handleEmojiSelect(emoji)}
                                          >
                                            <Twemoji emoji={emoji} size={22} />
                                          </button>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                  {Object.entries(getFilteredEmojis()).map(([key, category]) => (
                                    <div key={key} ref={(el) => emojiCategoryRefsMap.current[key] = el} className="emoji-category-section">
                                      <div className="emoji-category-header">{category.name}</div>
                                      <div className="emoji-grid">
                                        {category.emojis.map((emoji, index) => (
                                          <button
                                            key={`${key}-${index}`}
                                            type="button"
                                            className="emoji-option"
                                            onClick={() => handleEmojiSelect(emoji)}
                                          >
                                            <Twemoji emoji={emoji} size={22} />
                                          </button>
                                        ))}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="message-edit-buttons">
                        <button 
                          className="edit-save-btn"
                          onClick={() => handleSaveEdit(message.id)}
                        >
                          Save
                        </button>
                        <button 
                          className="edit-cancel-btn"
                          onClick={handleCancelEdit}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    message.content && <p className="message-content">{parseTextWithEmoji(message.content, 20)}</p>
                  )}
                  <div className="message-reactions">
                    {message.reactions && message.reactions.length > 0 && (
                      <>
                        {message.reactions.map((reaction) => (
                          <button
                            key={reaction.emoji}
                            className={`reaction-pill ${reaction.userIds.includes(currentUserId) ? 'user-reacted' : ''}`}
                            onClick={() => handleReactionClick(message.id, reaction.emoji, reaction.userIds)}
                          >
                            <span className="reaction-emoji"><Twemoji emoji={reaction.emoji} size={18} /></span>
                            <span className="reaction-count">{reaction.count}</span>
                          </button>
                        ))}
                      </>
                    )}
                    <button
                      className="add-reaction-btn"
                      onClick={(e) => handleReactionButtonClick(e, message.id)}
                      title="Add reaction"
                      style={(!message.reactions || message.reactions.length === 0) ? { display: 'none' } : {}}
                    >
<Twemoji emoji="➕" size={16} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {showEmojiPicker && emojiPickerFor === 'reaction' && (
        <div 
          ref={reactionPickerRef}
          className={`emoji-picker-dropdown position-${reactionPickerPositionDirection}`}
          style={{
            position: 'fixed',
            top: `${reactionPickerPosition.y}px`,
            left: `${reactionPickerPosition.x}px`,
            zIndex: 1000,
            width: '420px',
            overflow: 'hidden'
          }}
        >
          <div className="emoji-picker-container">
            <input
              type="text"
              placeholder="Search emojis..."
              value={emojiSearchQuery}
              onChange={(e) => setEmojiSearchQuery(e.target.value)}
              className="emoji-search-input"
              autoFocus
            />
            <div className="emoji-category-tabs-vertical">
              {recentlyUsedEmojis.length > 0 && (
                <button
                  className={`emoji-category-tab ${selectedEmojiCategory === 'recently' ? 'active' : ''}`}
                  onClick={() => handleCategoryTabClick('recently')}
                  title="Recently Used"
                >
                  <Twemoji emoji="🕐" size={18} />
                </button>
              )}
              {Object.entries(getFilteredEmojis()).map(([key, category]) => (
                <button
                  key={key}
                  className={`emoji-category-tab ${selectedEmojiCategory === key ? 'active' : ''}`}
                  onClick={() => handleCategoryTabClick(key)}
                  title={category.name}
                >
                  <Twemoji emoji={category.icon} size={18} />
                </button>
              ))}
            </div>
            <div className="emoji-grid-container" ref={emojiGridRef} onScroll={handleEmojiGridScroll}>
              {recentlyUsedEmojis.length > 0 && (
                <div ref={(el) => emojiCategoryRefsMap.current['recently'] = el} className="emoji-category-section">
                  <div className="emoji-category-header">Recently Used</div>
                  <div className="emoji-grid">
                    {recentlyUsedEmojis.map((emoji) => (
                      <button
                        key={`recent-${emoji}`}
                        type="button"
                        className="emoji-option"
                        onClick={() => handleEmojiSelect(emoji)}
                      >
                        <Twemoji emoji={emoji} size={22} />
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {Object.entries(getFilteredEmojis()).map(([key, category]) => (
                <div key={key} ref={(el) => emojiCategoryRefsMap.current[key] = el} className="emoji-category-section">
                  <div className="emoji-category-header">{category.name}</div>
                  <div className="emoji-grid">
                    {category.emojis.map((emoji, index) => (
                      <button
                        key={`${key}-${index}`}
                        type="button"
                        className="emoji-option"
                        onClick={() => handleEmojiSelect(emoji)}
                      >
                        <Twemoji emoji={emoji} size={22} />
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {contextMenu && (
        <div 
          ref={contextMenuRef}
          className={`message-context-menu direction-${contextMenuPosition.direction}`}
          style={{
            top: `${contextMenuPosition.y}px`,
            left: `${contextMenuPosition.x}px`
          }}
        >
          <button className="context-menu-item" onClick={() => {
            handleReactionButtonClick(null, contextMenu.messageId);
            setContextMenu(null);
          }}>
            Add Reaction
          </button>
          {contextMenu.isOwnMessage && (
            <button className="context-menu-item" onClick={handleEditMessage}>
              Edit Message
            </button>
          )}
          <button className="context-menu-item" onClick={handleReply}>
            Reply
          </button>
          <button className="context-menu-item" onClick={handleCopyText}>
            Copy Text
          </button>
          {contextMenu.isOwnMessage && (
            <button 
              className="context-menu-item delete-item"
              onClick={() => handleDeleteMessage(contextMenu.messageId)}
            >
              Delete Message
            </button>
          )}
        </div>
      )}

      <div className="message-input-container">
        {replyingTo && (
          <div className="reply-indicator">
            <div className="reply-header">
              <div className="reply-label">Replying to <strong style={{ color: normalizeNameColor(replyingTo.nameColor) }}>{replyingTo.author}</strong></div>
              <button 
                type="button"
                className="cancel-reply-btn"
                onClick={() => setReplyingTo(null)}
                title="Cancel reply"
              >
                ✕
              </button>
            </div>
            <div className="reply-content">
              {replyingTo.image && <img src={replyingTo.image} alt="replied message content" className="reply-image-preview" />}
              <span className="reply-text">{replyingTo.text.length > 100 ? replyingTo.text.substring(0, 100) + '...' : replyingTo.text}</span>
            </div>
          </div>
        )}
        {imagePreview && (
          <div className="image-preview-container">
            <img src={imagePreview} alt="Preview" className="image-preview" />
            <button type="button" onClick={removeImage} className="remove-image-btn">✕</button>
          </div>
        )}
        <div className="message-input-form">
          <button
            type="button"
            className="action-button add-file-btn"
            title="Add image or file"
            onClick={() => fileInputRef.current?.click()}
          >
            <Twemoji emoji="➕" size={16} />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileSelect}
            style={{ display: 'none' }}
          />
          
          <textarea
            ref={messageInputRef}
            placeholder="Type a message..."
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            className="message-input"
            style={{ resize: 'none', overflow: 'hidden', minHeight: '24px' }}
          />

          <div className="action-buttons-right">
            <div className="gif-picker-wrapper" ref={gifPickerRef}>
              <button
                type="button"
                className="action-button gif-btn"
                title="Add GIF"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setShowGifPicker(!showGifPicker);
                }}
              >
                GIF
              </button>
              {showGifPicker && (
                <GifPicker
                  onGifSelect={handleGifSelect}
                  onClose={() => setShowGifPicker(false)}
                  accountKey={accountKey}
                />
              )}
            </div>

            <div className="image-picker-wrapper" ref={imagePickerRef}>
              <button
                type="button"
                className="action-button image-btn"
                title="Add image"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setShowImagePicker(!showImagePicker);
                }}
              >
                <Twemoji emoji="🖼️" size={18} />
              </button>
              {showImagePicker && (
                <ImagePicker
                  onImageSelect={handleImageSelect}
                  onClose={() => setShowImagePicker(false)}
                  accountKey={accountKey}
                />
              )}
            </div>

            <div className="emoji-picker-wrapper" ref={emojiPickerRef}>
              <button
                type="button"
                className="action-button emoji-btn"
                title="Add emoji"
                onClick={() => {
                  setEmojiPickerFor('compose');
                  setShowEmojiPicker(!showEmojiPicker);
                }}
              >
                <Twemoji emoji="😊" size={18} />
              </button>
              {showEmojiPicker && emojiPickerFor === 'compose' && (
                <div className="emoji-picker-dropdown">
                  <div className="emoji-picker-container">
                    <input
                      type="text"
                      placeholder="Search emojis..."
                      value={emojiSearchQuery}
                      onChange={(e) => setEmojiSearchQuery(e.target.value)}
                      className="emoji-search-input"
                      autoFocus
                    />
                    <div className="emoji-category-tabs-vertical">
                      {recentlyUsedEmojis.length > 0 && (
                        <button
                          className={`emoji-category-tab ${selectedEmojiCategory === 'recently' ? 'active' : ''}`}
                          onClick={() => handleCategoryTabClick('recently')}
                          title="Recently Used"
                        >
                          <Twemoji emoji="🕐" size={18} />
                        </button>
                      )}
                      {Object.entries(getFilteredEmojis()).map(([key, category]) => (
                        <button
                          key={key}
                          className={`emoji-category-tab ${selectedEmojiCategory === key ? 'active' : ''}`}
                          onClick={() => handleCategoryTabClick(key)}
                          title={category.name}
                        >
                          <Twemoji emoji={category.icon} size={18} />
                        </button>
                      ))}
                    </div>
                    <div className="emoji-grid-container" ref={emojiGridRef} onScroll={handleEmojiGridScroll}>
                      {recentlyUsedEmojis.length > 0 && (
                        <div ref={(el) => emojiCategoryRefsMap.current['recently'] = el} className="emoji-category-section">
                          <div className="emoji-category-header">Recently Used</div>
                          <div className="emoji-grid">
                            {recentlyUsedEmojis.map((emoji) => (
                              <button
                                key={`recent-${emoji}`}
                                type="button"
                                className="emoji-option"
                                onClick={() => handleEmojiSelect(emoji)}
                              >
                                <Twemoji emoji={emoji} size={22} />
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                      {Object.entries(getFilteredEmojis()).map(([key, category]) => (
                        <div key={key} ref={(el) => emojiCategoryRefsMap.current[key] = el} className="emoji-category-section">
                          <div className="emoji-category-header">{category.name}</div>
                          <div className="emoji-grid">
                            {category.emojis.map((emoji, index) => (
                              <button
                                key={`${key}-${index}`}
                                type="button"
                                className="emoji-option"
                                onClick={() => handleEmojiSelect(emoji)}
                              >
                                <Twemoji emoji={emoji} size={22} />
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      </div>
      <CustomModal
        isOpen={modalInfo.open}
        title={modalInfo.title}
        message={modalInfo.message}
        type={modalInfo.type}
        onConfirm={() => closeModal(true)}
        onCancel={() => closeModal(false)}
      />
    </>
  );
}

export default MessageArea;
