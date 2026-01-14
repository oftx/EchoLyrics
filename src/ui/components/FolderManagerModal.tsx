import React, { useEffect, useState } from 'react';
import { FolderPersistenceService, FileSystemDirectoryHandle } from '../../core/services/FolderPersistenceService';

interface FolderManagerModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSelectFolder: (handle: FileSystemDirectoryHandle) => void;
}

export const FolderManagerModal: React.FC<FolderManagerModalProps> = ({ isOpen, onClose, onSelectFolder }) => {
    const [folders, setFolders] = useState<FileSystemDirectoryHandle[]>([]);
    const [isLoading, setIsLoading] = useState(false);

    const loadFolders = async () => {
        setIsLoading(true);
        const handles = await FolderPersistenceService.getSavedFolderHandles();
        setFolders(handles);
        setIsLoading(false);
    };

    useEffect(() => {
        if (isOpen) {
            loadFolders();
        }
    }, [isOpen]);

    const handleRemove = async (handle: FileSystemDirectoryHandle, e: React.MouseEvent) => {
        e.stopPropagation();
        if (confirm(`Remove access to folder "${handle.name}"?`)) {
            await FolderPersistenceService.removeFolderHandle(handle);
            await loadFolders();
        }
    };

    const handleAddNew = async () => {
        const handle = await FolderPersistenceService.selectFolder();
        if (handle) {
            // After adding, we want to select it immediately or just refresh?
            // Requirement says "select folder interface". Usually adding means selecting.
            // But let's just refresh the list and maybe user chooses? 
            // Or just pass it to onSelectFolder immediately?
            // "When user allows access... show change folder interface".
            // Let's just reload list.
            await loadFolders();
        }
    };

    if (!isOpen) return null;

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content" onClick={e => e.stopPropagation()} style={{ width: '500px', height: '500px', padding: '0', display: 'flex', flexDirection: 'column' }}>
                <div className="modal-header" style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '1.25rem',
                    flexShrink: 0
                }}>
                    <h2 className="modal-title" style={{ margin: 0, fontSize: '1.25rem', fontWeight: 600 }}>Manage Music Folders</h2>
                    <button
                        className="btn btn-ghost"
                        onClick={onClose}
                        style={{
                            color: 'var(--text-secondary)',
                            width: '32px',
                            height: '32px',
                            padding: 0,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            marginLeft: '1rem',
                            border: '1px solid rgba(255, 255, 255, 0.1)',
                            borderRadius: '4px'
                        }}
                    >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M18 6L6 18M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                <div className="modal-body" style={{
                    flex: 1,
                    overflowY: 'auto',
                    padding: '1.25rem',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'flex-start'
                }}>
                    {isLoading ? (
                        <div className="text-center p-4">Loading...</div>
                    ) : folders.length === 0 ? (
                        <div className="empty-state text-muted" style={{ padding: '2rem 0', textAlign: 'center' }}>
                            No saved folders found.
                        </div>
                    ) : (
                        <div className="folder-list" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            {folders.map((handle, idx) => (
                                <div
                                    key={handle.name + idx}
                                    className="folder-item"
                                    onClick={() => onSelectFolder(handle)}
                                    style={{
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        padding: '12px 16px',
                                        background: 'rgba(255, 255, 255, 0.05)',
                                        borderRadius: '12px',
                                        cursor: 'pointer',
                                        transition: 'background 0.2s',
                                        border: '1px solid rgba(255, 255, 255, 0.05)'
                                    }}
                                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)'}
                                    onMouseLeave={e => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)'}
                                >
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ opacity: 0.7 }}>
                                            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                                        </svg>
                                        <span style={{ fontWeight: 500, fontSize: '1rem' }}>{handle.name}</span>
                                    </div>
                                    <button
                                        className="btn btn-ghost btn-sm text-danger"
                                        onClick={(e) => handleRemove(handle, e)}
                                        title="Remove folder"
                                        style={{ padding: '8px', opacity: 0.8 }}
                                    >
                                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <path d="M3 6h18" />
                                            <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                                            <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                                        </svg>
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <div className="modal-footer" style={{
                    display: 'flex',
                    justifyContent: 'flex-end',
                    padding: '1.25rem',
                    flexShrink: 0
                }}>
                    <button className="btn btn-secondary" onClick={handleAddNew} style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        padding: '8px 16px',
                        background: 'rgba(255, 255, 255, 0.1)',
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                        borderRadius: '8px',
                        fontWeight: 500
                    }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M12 5v14M5 12h14" />
                        </svg>
                        Add New Folder
                    </button>
                </div>
            </div>
        </div>
    );
};
