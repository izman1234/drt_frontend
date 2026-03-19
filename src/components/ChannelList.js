import React, { useState, useCallback, memo } from 'react';
import { channelAPI } from '../api';
import CustomModal from './CustomModal';
import Twemoji from './Twemoji';
import './ChannelList.css';

// Memoized component to prevent unnecessary re-renders
const VoiceMemberComponent = memo(({ member, isSelected, onSelect, isSpeaking, nameColor, getMemberProfilePicture, getMemberInitial, userVolumes, userMutes, onVolumeChange, onToggleMute, currentUserId }) => {
  const profilePicture = getMemberProfilePicture(member);
  const isCurrentUser = member.id === currentUserId;
  const handleClick = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isCurrentUser) {
      onSelect(isSelected ? null : member);
    }
  }, [member, isSelected, onSelect, isCurrentUser]);

  return (
    <div className="voice-member-wrapper">
      <div 
        className={`voice-member ${isSelected ? 'selected-for-control' : ''}`}
        onClick={handleClick}
        style={{ cursor: isCurrentUser ? 'default' : 'pointer', userSelect: 'none', position: 'relative' }}
      >
        <div className={`voice-member-avatar ${isSpeaking ? 'speaking' : ''}`}>
          {profilePicture ? (
            <img src={profilePicture} alt={member.displayName || member.username} />
          ) : (
            <div className="voice-member-initial">{getMemberInitial(member)}</div>
          )}
        </div>
        <span className="voice-member-name" style={{ color: nameColor || '#a78bba' }}>{member.displayName || member.username || member.id}</span>
        <span className="voice-member-icons">
          {member.isMuted && <span className="status-icon muted" title="Muted"><Twemoji emoji="🔇" size={14} /></span>}
          {member.isDeafened && <span className="status-icon deafened" title="Deafened"><Twemoji emoji="🔕" size={14} /></span>}
        </span>
      </div>
      
      {isSelected && onVolumeChange && onToggleMute && (
        <div className="voice-control-inline">
          <div className="control-row">
            <button
              className={`mute-button ${userMutes && userMutes[member.id] ? 'muted' : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                onToggleMute(member.id);
              }}
              title={userMutes && userMutes[member.id] ? 'Unmute' : 'Mute'}
            >
              {userMutes && userMutes[member.id] ? <Twemoji emoji="🔇" size={16} /> : <Twemoji emoji="🔊" size={16} />}
            </button>
            
            <div className="volume-slider-container">
              <input
                type="range"
                min="0"
                max="2"
                step="0.01"
                value={userVolumes && userVolumes[member.id] !== undefined ? userVolumes[member.id] : 1}
                onChange={(e) => onVolumeChange(member.id, parseFloat(e.target.value))}
                className="volume-slider"
              />
              <span className="volume-label">
                {Math.round(((userVolumes && userVolumes[member.id] !== undefined ? userVolumes[member.id] : 1) * 100))}%
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

VoiceMemberComponent.displayName = 'VoiceMember';

function ChannelList({ channels, selectedChannel, onSelectChannel, voiceMembersByChannel = {}, activeVoiceChannel = null, onChannelsChanged, speakingUsers = {}, selectedUserForControl, onSelectUserForControl, userVolumes, userMutes, onVolumeChange, onToggleMute, currentUserId, unreadChannels = new Set() }) {
  const textChannels = channels.filter(c => c.type === 'text');
  const voiceChannels = channels.filter(c => c.type === 'voice');
  
  const [hoveredChannel, setHoveredChannel] = useState(null);
  const [editingChannel, setEditingChannel] = useState(null);
  const [editForm, setEditForm] = useState({ name: '', description: '' });
  const [draggedChannel, setDraggedChannel] = useState(null);
  const [dragOverChannel, setDragOverChannel] = useState(null);
  const [, setDragOverGroupType] = useState(null);
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

  const handleSettingsClick = (e, channel) => {
    e.stopPropagation();
    handleEditClick(channel);
  };

  const handleDelete = (channel) => {
    showModal(`Delete channel "${channel.name}"?`, {
      title: 'Delete Channel',
      type: 'confirm',
      onConfirm: async () => {
        try {
          await channelAPI.deleteChannel(channel.id);
          if (onChannelsChanged) onChannelsChanged();
        } catch (error) {
          console.error('Error deleting channel:', error);
          showModal('Failed to delete channel', { title: 'Error' });
        }
      },
    });
  };

  const handleEditClick = (channel) => {
    setEditingChannel(channel.id);
    setEditForm({ name: channel.name, description: channel.description || '' });
  };

  const handleSaveEdit = async (channel) => {
    try {
      await channelAPI.updateChannel(channel.id, editForm.name, editForm.description);
      setEditingChannel(null);
      setHoveredChannel(null);
      if (onChannelsChanged) onChannelsChanged();
    } catch (error) {
      console.error('Error updating channel:', error);
      showModal('Failed to update channel', { title: 'Error' });
    }
  };

  const handleCancelEdit = () => {
    setEditingChannel(null);
    setHoveredChannel(null);
    setEditForm({ name: '', description: '' });
  };

  const handleDragStart = (e, channel) => {
    e.stopPropagation();
    setDraggedChannel(channel);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e, channel, groupType) => {
    e.preventDefault();
    e.stopPropagation();
    
    // Only allow dropping within the same type
    if (draggedChannel && draggedChannel.type === groupType) {
      e.dataTransfer.dropEffect = 'move';
      setDragOverChannel(channel);
      setDragOverGroupType(groupType);
    } else {
      e.dataTransfer.dropEffect = 'none';
    }
  };

  const handleDragLeave = (e) => {
    e.stopPropagation();
    setDragOverChannel(null);
    setDragOverGroupType(null);
  };

  const handleDrop = async (e, targetChannel, groupType) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (!draggedChannel || draggedChannel.type !== groupType) {
      setDraggedChannel(null);
      setDragOverChannel(null);
      setDragOverGroupType(null);
      return;
    }

    // Get the list of channels for this type
    const channelList = groupType === 'text' ? textChannels : voiceChannels;
    const draggedIndex = channelList.findIndex(c => c.id === draggedChannel.id);
    const targetIndex = channelList.findIndex(c => c.id === targetChannel.id);

    if (draggedIndex === targetIndex) {
      setDraggedChannel(null);
      setDragOverChannel(null);
      setDragOverGroupType(null);
      return;
    }

    try {
      // Call reorder API
      await channelAPI.reorderChannel(draggedChannel.id, targetIndex, groupType);
      if (onChannelsChanged) onChannelsChanged();
    } catch (error) {
      console.error('Error reordering channel:', error);
      showModal('Failed to reorder channel', { title: 'Error' });
    } finally {
      setDraggedChannel(null);
      setDragOverChannel(null);
      setDragOverGroupType(null);
    }
  };

  const renderChannelItem = (channel, isActive, groupType) => {
    const isDragging = draggedChannel?.id === channel.id;
    const isDragOver = dragOverChannel?.id === channel.id;
    const isUnread = unreadChannels.has(channel.id);

    if (editingChannel === channel.id) {
      return (
        <div className="channel-edit-form" onClick={(e) => e.stopPropagation()}>
          <input
            type="text"
            placeholder="Channel name"
            value={editForm.name}
            onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
            className="edit-input"
          />
          {channel.type === 'text' && (
            <input
              type="text"
              placeholder="Description"
              value={editForm.description}
              onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
              className="edit-input"
            />
          )}
          <div className="edit-buttons">
            <button onClick={() => handleSaveEdit(channel)} className="save-btn">Save</button>
            <button onClick={() => handleDelete(channel)} className="delete-btn">Delete</button>
          </div>
        </div>
      );
    }

    return (
      <div
        className={`channel-item ${isActive ? 'active' : ''} ${isDragging ? 'dragging' : ''} ${isDragOver ? 'drag-over' : ''} ${isUnread && !isActive ? 'unread' : ''}`}
        draggable
        onDragStart={(e) => handleDragStart(e, channel)}
        onDragOver={(e) => handleDragOver(e, channel, groupType)}
        onDragLeave={handleDragLeave}
        onDrop={(e) => handleDrop(e, channel, groupType)}
        onMouseEnter={() => setHoveredChannel(channel.id)}
        onMouseLeave={() => setHoveredChannel(null)}
        onClick={() => onSelectChannel(channel)}
      >
        <span className="channel-icon">{channel.type === 'text' ? '#' : <Twemoji emoji="🔊" size={14} />}</span>
        <span className="channel-name">{channel.name}</span>
        {hoveredChannel === channel.id && (
          <button
            className="channel-settings-icon"
            onClick={(e) => handleSettingsClick(e, channel)}
            title="Channel settings"
          >
            <Twemoji emoji="⚙️" size={14} />
          </button>
        )}
      </div>
    );
  };

  const getMemberInitial = (member) => {
    const name = member.displayName || member.username || member.id;
    return name.charAt(0).toUpperCase();
  };

  const getMemberProfilePicture = (member) => {
    // Check backend profile picture first, then fallback to localStorage
    if (member.profilePicture) {
      return member.profilePicture;
    }
    // Fallback to localStorage
    return localStorage.getItem(`profilePicture_${member.id}`) || null;
  };

  return (
    <>
      {editingChannel && (
        <div className="channel-edit-backdrop" onClick={handleCancelEdit} />
      )}
      <div className="channel-list">
        {textChannels.length > 0 && (
          <div className="channel-group">
            <h4>Text Channels</h4>
            {textChannels.map(channel => <div key={channel.id}>{renderChannelItem(channel, selectedChannel?.id === channel.id, 'text')}</div>)}
          </div>
        )}

        {voiceChannels.length > 0 && (
          <div className="channel-group">
            <h4>Voice Channels</h4>
            {voiceChannels.map(channel => {
              const membersForChannel = voiceMembersByChannel[channel.id] || [];
              return (
              <div key={channel.id} className="channel-with-members">
                {renderChannelItem(channel, activeVoiceChannel?.id === channel.id, 'voice')}
                <div className="channel-members">
                  {membersForChannel.map(member => (
                    <VoiceMemberComponent 
                      key={member.id} 
                      member={member}
                      isSelected={selectedUserForControl?.id === member.id}
                      onSelect={onSelectUserForControl}
                      isSpeaking={speakingUsers[member.id]}
                      nameColor={member.nameColor}
                      getMemberProfilePicture={getMemberProfilePicture}
                      getMemberInitial={getMemberInitial}
                      userVolumes={userVolumes}
                      userMutes={userMutes}
                      onVolumeChange={onVolumeChange}
                      onToggleMute={onToggleMute}
                      currentUserId={currentUserId}
                    />
                  ))}
                </div>
              </div>
            );
            })}
          </div>
        )}
      </div>
    <>
      <CustomModal
        isOpen={modalInfo.open}
        title={modalInfo.title}
        message={modalInfo.message}
        type={modalInfo.type}
        onConfirm={() => closeModal(true)}
        onCancel={() => closeModal(false)}
      />
    </>
    </>
  );
}

export default ChannelList;
