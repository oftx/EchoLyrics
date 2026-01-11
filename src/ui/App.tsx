import { useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { LyricsManager } from '@/core/services/LyricsManager';
import { SongInformation } from '@/core/interfaces/SongInformation';
import { NeteaseNetworkProvider } from "@/core/providers/NeteaseNetworkProvider";
import { QQMusicNetworkProvider } from "@/core/providers/QQMusicNetworkProvider";
import { LRCLibNetworkProvider } from "@/core/providers/LRCLibNetworkProvider";

import { LyricsData } from '@/core/models/LyricsData';
import { Logger, LogEntry } from '@/core/utils/Logger';
import { ExportManagerModal } from './components/ExportManagerModal';
import { FFmpegConverter } from '@/core/services/FFmpegConverter';
import { MetadataService } from '@/core/services/MetadataService';

interface PlaylistItem {
    name: string;
    audioFile: File;
    lyricFile?: File;
    artist?: string;
    title?: string;
    isrc?: string;
}

// Singleton instance for the app
const manager = new LyricsManager();
const converter = new FFmpegConverter();
const metadataService = new MetadataService();

// ... existing registerProviders ...
// manager.getSearcher().registerProvider(new MockNetworkProvider());
manager.getSearcher().registerProvider(new NeteaseNetworkProvider());
manager.getSearcher().registerProvider(new QQMusicNetworkProvider());
manager.getSearcher().registerProvider(new LRCLibNetworkProvider());

// Helper function to format time as mm:ss
const formatTime = (seconds: number): string => {
    if (!isFinite(seconds) || isNaN(seconds) || seconds < 0) {
        return '0:00';
    }
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
};

export default function App() {
    const [lyrics, setLyrics] = useState<LyricsData | null>(null);
    const [currentTime, setCurrentTime] = useState(0);
    const [activeLineIndex, setActiveLineIndex] = useState(-1);
    const [currentSongSignature, setCurrentSongSignature] = useState<string>("");
    const [showCandidates, setShowCandidates] = useState(false);
    const [candidates, setCandidates] = useState<any[]>([]);


    // Playback state
    const [audioSrc, setAudioSrc] = useState<string | null>(null);
    const [playlist, setPlaylist] = useState<PlaylistItem[]>([]);
    const [currentIndex, setCurrentIndex] = useState<number>(-1);

    // Pop-out state
    const [pipWindow, setPipWindow] = useState<Window | null>(null);

    // Search form state
    const [searchTitle, setSearchTitle] = useState("Sample Song");
    const [searchArtist, setSearchArtist] = useState("Artist A");
    const [searchLimit, setSearchLimit] = useState(15);
    const [statusMsg, setStatusMsg] = useState("");
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [showExportModal, setShowExportModal] = useState(false);
    const [isConverting, setIsConverting] = useState(false);
    const [showLogs, setShowLogs] = useState(false);
    const [useNativePlayer, setUseNativePlayer] = useState(false);
    const [isPlaying, setIsPlaying] = useState(false);
    const [audioDuration, setAudioDuration] = useState(0);

    const audioRef = useRef<HTMLAudioElement>(null);
    const lyricsContainerRef = useRef<HTMLDivElement>(null);
    const pipContainerRef = useRef<HTMLDivElement>(null);
    const logContainerRef = useRef<HTMLDivElement>(null);

    // Subscribe to Logger
    useEffect(() => {
        return Logger.subscribe((entry) => {
            setLogs(prev => {
                const newLogs = [...prev, entry];
                if (newLogs.length > 100) return newLogs.slice(newLogs.length - 100);
                return newLogs;
            });
        });
    }, []);

    // Subscribe to LyricsManager updates
    useEffect(() => {
        const unsubscribe = manager.subscribe((data) => {
            // We only update if valid data is present. 
            // Or should we allow null?
            // If data is null, it means lyrics were cleared (or initial).
            setLyrics(data);
        });
        return unsubscribe;
    }, []);

    // Auto-scroll logs
    useEffect(() => {
        if (logContainerRef.current) {
            logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
        }
    }, [logs]);

    // Handle folder selection
    const handleFolderSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            const files = Array.from(e.target.files);
            const audioExtensions = ['.mp3', '.flac', '.wav', '.ogg', '.m4a'];
            const lyricExtensions = ['.lrc', '.txt', '.json', '.qrc'];

            const audioFiles: File[] = [];
            const lyricFiles: Map<string, File> = new Map();

            // First pass: sort files into audio and lyrics
            files.forEach(file => {
                const name = file.name;
                const lowerName = name.toLowerCase();
                const extIndex = name.lastIndexOf('.');
                if (extIndex === -1) return;

                const ext = lowerName.substring(extIndex);
                const baseName = name.substring(0, extIndex);

                if (audioExtensions.includes(ext)) {
                    audioFiles.push(file);
                } else if (lyricExtensions.includes(ext)) {
                    lyricFiles.set(baseName, file);
                }
            });

            // Second pass: Create playlist items
            const newPlaylist: PlaylistItem[] = audioFiles.map(audio => {
                const name = audio.name;
                const extIndex = name.lastIndexOf('.');
                const baseName = name.substring(0, extIndex);
                const lyric = lyricFiles.get(baseName);

                let artist = "";
                let title = baseName;

                if (baseName.includes("-")) {
                    const parts = baseName.split("-");
                    artist = parts[0].trim();
                    title = parts.slice(1).join("-").trim();
                }

                return {
                    name: baseName,
                    audioFile: audio,
                    lyricFile: lyric,
                    artist,
                    title
                };
            }).sort((a, b) => a.name.localeCompare(b.name));

            setPlaylist(newPlaylist);
            if (newPlaylist.length > 0) {
                playTrack(newPlaylist[0], 0);
            }
            setStatusMsg(`Loaded ${newPlaylist.length} songs.`);
        }
    };

    const playTrack = async (item: PlaylistItem, index: number) => {
        // Cleanup previous
        setLyrics(null);
        setCurrentTime(0);
        setIsConverting(false); // Reset
        setActiveLineIndex(-1);
        if (lyricsContainerRef.current) lyricsContainerRef.current.scrollTo(0, 0);
        if (pipContainerRef.current) pipContainerRef.current.scrollTo(0, 0);

        // Load Audio
        const url = URL.createObjectURL(item.audioFile);
        setAudioSrc(url);
        setCurrentIndex(index);

        // Update Search Info (Visual only)
        setSearchTitle(item.title || item.name);
        setSearchArtist(item.artist || "");

        // Generate signature for race condition check
        const signature = `${item.name}-${Date.now()}`;
        setCurrentSongSignature(signature);

        // Fetch Metadata (Async)
        // We do this concurrently with audio loading to save time, but before lyric search.
        let metaTitle = item.title;
        let metaArtist = item.artist;
        let embeddedLyrics = null;

        try {
            const metadata = await metadataService.parse(item.audioFile, { deepScan: false });
            if (metadata.title) metaTitle = metadata.title;
            if (metadata.artist) metaArtist = metadata.artist;
            if (metadata.lyrics) embeddedLyrics = metadata.lyrics;
            if (metadata.isrc) item.isrc = metadata.isrc;

            // Update the playlist item in place (optional, for caching in session)
            item.title = metaTitle;
            item.artist = metaArtist;

            // Update Visuals
            setSearchTitle(metaTitle || item.name);
            setSearchArtist(metaArtist || "");
        } catch (e) {
            console.warn("Metadata parse failed", e);
        }

        let localLrcContent: string | undefined = undefined;
        if (item.lyricFile) {
            try {
                localLrcContent = await item.lyricFile.text();
                // We no longer manually parse here. We pass it to the manager.
                setStatusMsg("Loaded local lyrics.");
            } catch (e) {
                console.error("Failed to read local lyric file", e);
            }
        }

        // Try to search online (or use embedded if available via manager)
        handleSearchForTrack(
            { ...item, title: metaTitle, artist: metaArtist },
            signature,
            embeddedLyrics || undefined,
            localLrcContent
        );
    };

    const handleAudioError = async (e: any) => {
        const error = e.target.error;
        const currentItem = playlist[currentIndex];

        console.log("[AudioError] Fired.", {
            code: error?.code,
            message: error?.message,
            fileName: currentItem?.name,
            ext: currentItem?.name?.split('.').pop()?.toLowerCase(),
            isConverting
        });

        // Check availability
        if (!currentItem) return;

        // Check if it's a file type that likely needs transcoding (m4a, alac, flac)
        const ext = currentItem.name.split('.').pop()?.toLowerCase();
        const isCandidate = ext === 'm4a' || ext === 'flac' || ext === 'alac';

        // Check if error implies format issue
        const isFormatError = error && (
            error.code === 3 ||
            error.code === 4 ||
            (error.message && typeof error.message === 'string' && error.message.includes("DEMUXER"))
        );

        // Should we transcode?
        if ((isCandidate || isFormatError) && error && !isConverting) {
            setStatusMsg("Format not native. Transcoding with FFmpeg...");
            setIsConverting(true);
            try {
                const result = await converter.convertToWav(currentItem.audioFile);
                const wavUrl = URL.createObjectURL(result.blob);
                setAudioSrc(wavUrl);
                setStatusMsg("Transcoding complete. Playing...");
                if (audioRef.current) {
                    audioRef.current.load();
                    audioRef.current.play();
                }
                // Note: Lyrics are already loaded by playTrack via MetadataService
                // No need to reload from FFmpeg - this caused duplicate lyrics
            } catch (err) {
                console.error("FFmpeg conversion failed", err);
                setStatusMsg("Transcoding failed. " + err);
            } finally {
                setIsConverting(false);
            }
            return;
        }

        setStatusMsg("Error playing audio: " + (error?.message || "Unknown error"));
    };

    const handleNext = () => {
        if (currentIndex < playlist.length - 1) {
            playTrack(playlist[currentIndex + 1], currentIndex + 1);
        }
    };

    const handlePrev = () => {
        if (currentIndex > 0) {
            playTrack(playlist[currentIndex - 1], currentIndex - 1);
        }
    };

    // Auto-next when audio ends
    const handleAudioEnded = () => {
        handleNext();
    };

    const togglePiP = async () => {
        if (pipWindow) {
            pipWindow.close();
            setPipWindow(null);
            return;
        }

        // Check compatibility
        if (!("documentPictureInPicture" in window)) {
            setStatusMsg("Picture-in-Picture API not supported in this browser.");
            return;
        }

        try {
            // @ts-expect-error strict dom types might not have it yet
            const win = await window.documentPictureInPicture.requestWindow({
                width: 400,
                height: 600,
            });

            // Copy styles
            // We need to copy regular stylesheets and styled-components/injected styles
            [...document.styleSheets].forEach((styleSheet) => {
                try {
                    const cssRules = [...styleSheet.cssRules].map((rule) => rule.cssText).join('');
                    const style = document.createElement('style');
                    style.textContent = cssRules;
                    win.document.head.appendChild(style);
                } catch (e) {
                    const link = document.createElement('link');
                    // If CORS prevents reading rules, link to it (works for same-origin or public)
                    if (styleSheet.href) {
                        link.rel = 'stylesheet';
                        link.type = styleSheet.type;
                        link.media = styleSheet.media.mediaText;
                        link.href = styleSheet.href;
                        win.document.head.appendChild(link);
                    }
                    console.log('e', e)
                }
            });

            // Handle close
            win.addEventListener("pagehide", () => {
                setPipWindow(null);
            });

            setPipWindow(win);
        } catch (err) {
            console.error("Failed to open PiP window:", err);
            setStatusMsg("Failed to open Pop-out window.");
        }
    };

    // Seek handler
    const handleLyricClick = (startTime: number) => {
        if (audioRef.current) {
            audioRef.current.currentTime = startTime / 1000;
            setCurrentTime(startTime);
            // Optional: Play if paused?
            // audioRef.current.play();
        }
    };

    // New Helper
    const handleSearchForTrack = async (item: PlaylistItem, signature: string, embeddedLyrics?: string, localLrcContent?: string) => {
        if (!item.title) return;
        setStatusMsg("Loading lyrics...");
        const song: SongInformation = {
            title: item.title,
            artists: item.artist ? [item.artist] : [],
            album: "",
            duration: 0,
            sourceId: "local_auto",
            persistenceId: item.name, // Use filename as stable ID,
            lyrics: embeddedLyrics,
            isrc: item.isrc
        };

        // We use a ref to track active request? 
        // Actually, simpler: check a ref that stores 'latestSignature'.
        // Let's create `latestSignatureRef` if we want to be safe, but passing signature to valid function works 
        // IF we compare it against a Ref that holds the "current target".
        // State `currentSongSignature` updates eventually.
        // Let's use a mutable ref for the synchronous "latest" check.

        latestSignatureRef.current = signature;

        const success = await manager.loadLyricsForSong(song, { localFileContent: localLrcContent });

        if (latestSignatureRef.current !== signature) {
            Logger.info("Ignoring stale lyric result.");
            return;
        }

        if (success) {
            setLyrics(manager.getCurrentLyrics());
            const current = manager.getCurrentLyrics();
            if (current?.metadata?.['source'] === 'Embedded (ID3)') {
                setStatusMsg("Loaded embedded lyrics.");
            } else {
                setStatusMsg("Lyrics found online!");
            }
        } else {
            setStatusMsg("No lyrics found.");
        }
    };

    // Use ref for race condition check
    const latestSignatureRef = useRef<string>("");

    // Handle opening candidates
    const handleShowCandidates = () => {
        const results = manager.getLastSearchResults();
        setCandidates(results);
        setShowCandidates(true);
    };

    const handleSelectCandidate = (index: number) => {
        const success = manager.selectLyric(index); // Defaults to save=true
        if (success) {
            setLyrics(manager.getCurrentLyrics());
            setShowCandidates(false);
            setStatusMsg(`Switched to candidate #${index + 1}`);
        }
    };



    const handleSearch = async () => {
        if (!searchTitle) return;
        setStatusMsg("Searching...");
        setLyrics(null);

        // Find current item's filename to use as persistence ID
        let persistenceId = undefined;
        if (currentIndex >= 0 && currentIndex < playlist.length) {
            persistenceId = playlist[currentIndex].name;
        }

        const song: SongInformation = {
            title: searchTitle,
            artists: [searchArtist],
            album: "",
            duration: audioRef.current?.duration ? audioRef.current.duration * 1000 : 0,
            sourceId: "local",
            persistenceId: persistenceId, // Bind this search to the current file
            isrc: (currentIndex >= 0 && currentIndex < playlist.length) ? playlist[currentIndex].isrc : undefined
        };

        const success = await manager.loadLyricsForSong(song, {
            ignoreCache: true, // Manual search always ignores cache to get fresh results
            limit: searchLimit
        });
        if (success) {
            setLyrics(manager.getCurrentLyrics());
            setStatusMsg("Lyrics found!");
        } else {
            setStatusMsg("No lyrics found.");
        }
    };

    // Sync loop using audio event
    const handleTimeUpdate = () => {
        if (audioRef.current) {
            const t = audioRef.current.currentTime * 1000;
            setCurrentTime(t);
            // Sync lyrics
            if (lyrics) {
                const idx = manager.getSynchronizer().findLineIndex(lyrics, t);
                setActiveLineIndex(idx);
            }
        }
    };



    return (
        <div className="app-container">
            <header className="app-header">
                <h1 className="app-title">Echo Lyrics</h1>
            </header>

            {/* Folder Input - Only show if no playlist */}
            {playlist.length === 0 && (
                <label className="upload-zone">
                    <span className="upload-zone-label">Select Music Folder</span>
                    <span className="upload-zone-trigger btn btn-secondary">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                            <polyline points="17 8 12 3 7 8" />
                            <line x1="12" y1="3" x2="12" y2="15" />
                        </svg>
                        Choose Files
                    </span>
                    <input
                        type="file"
                        // @ts-expect-error webkitdirectory is not standard
                        webkitdirectory=""
                        directory=""
                        onChange={handleFolderSelect}
                        multiple
                    />
                </label>
            )}

            {/* Playlist UI with header */}
            {playlist.length > 0 && (
                <div className="playlist-section">
                    <div className="playlist-header">
                        <span className="playlist-count">{playlist.length} songs</span>
                        <label className="btn btn-ghost btn-sm">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                <polyline points="17 8 12 3 7 8" />
                                <line x1="12" y1="3" x2="12" y2="15" />
                            </svg>
                            Change Folder
                            <input
                                type="file"
                                // @ts-expect-error webkitdirectory is not standard
                                webkitdirectory=""
                                directory=""
                                onChange={handleFolderSelect}
                                multiple
                                style={{ display: 'none' }}
                            />
                        </label>
                    </div>
                    <div className="playlist">
                        {playlist.map((item, idx) => (
                            <div
                                key={idx}
                                onClick={() => playTrack(item, idx)}
                                className={`playlist-item ${idx === currentIndex ? 'playlist-item--active' : ''}`}
                            >
                                <span className="playlist-item-index">{idx + 1}.</span>
                                <span className="playlist-item-name">{item.name}</span>
                                {item.lyricFile && <span className="playlist-item-badge">LRC</span>}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Playback Controls */}
            {audioSrc && (
                <div className="controls-bar">
                    <button className="btn btn-secondary" onClick={handlePrev} disabled={currentIndex <= 0}>
                        ← Prev
                    </button>
                    <button className="btn btn-secondary" onClick={handleNext} disabled={currentIndex >= playlist.length - 1}>
                        Next →
                    </button>
                </div>
            )}

            {/* Search Controls */}
            <div className="search-controls">
                <input
                    type="text"
                    className="input"
                    placeholder="Title"
                    value={searchTitle}
                    onChange={e => setSearchTitle(e.target.value)}
                />
                <input
                    type="text"
                    className="input"
                    placeholder="Artist"
                    value={searchArtist}
                    onChange={e => setSearchArtist(e.target.value)}
                />
                <div className="number-stepper">
                    <button
                        type="button"
                        className="number-stepper-btn"
                        onClick={() => setSearchLimit(Math.max(1, searchLimit - 1))}
                    >
                        −
                    </button>
                    <input
                        type="text"
                        className="number-stepper-input"
                        value={searchLimit}
                        onChange={e => {
                            const val = parseInt(e.target.value);
                            if (!isNaN(val) && val > 0) setSearchLimit(val);
                        }}
                    />
                    <button
                        type="button"
                        className="number-stepper-btn number-stepper-btn--plus"
                        onClick={() => setSearchLimit(searchLimit + 1)}
                    >
                        +
                    </button>
                </div>
                <button className="btn btn-primary" onClick={handleSearch}>Search Lyrics</button>
                <button className="btn btn-ghost" onClick={() => setShowExportModal(true)}>Export Lyrics</button>
            </div>

            {/* Status Bar */}
            <div className="status-bar">
                <span>{statusMsg}</span>
                {lyrics && lyrics.metadata && lyrics.metadata['source'] && (
                    <>
                        <span className="status-badge">
                            Source: {lyrics.metadata['source']}
                        </span>
                        <button className="btn btn-ghost btn-sm" onClick={handleShowCandidates}>
                            Switch Lyrics
                        </button>
                    </>
                )}
            </div>

            {/* Candidates Modal/Overlay */}
            {showCandidates && (
                <div className="modal-overlay" onClick={() => setShowCandidates(false)}>
                    <div
                        className="modal-content modal-content--candidates"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="modal-header">
                            <h3 className="modal-title">Select Lyrics</h3>
                        </div>
                        <div className="modal-body">
                            {candidates.map((cand, idx) => (
                                <div
                                    key={idx}
                                    onClick={() => handleSelectCandidate(idx)}
                                    className="candidate-item"
                                >
                                    <div className="candidate-title">{cand.title}</div>
                                    <div className="candidate-artist">{cand.artist}</div>
                                    <div className="candidate-source">{cand.source}</div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* Audio Player */}
            {audioSrc && (
                <div className="audio-player-wrapper">
                    <audio
                        ref={audioRef}
                        src={audioSrc}
                        controls={useNativePlayer}
                        autoPlay
                        onTimeUpdate={handleTimeUpdate}
                        onEnded={handleAudioEnded}
                        onError={handleAudioError}
                        onLoadedMetadata={() => setAudioDuration(audioRef.current?.duration || 0)}
                        onPlay={() => setIsPlaying(true)}
                        onPause={() => setIsPlaying(false)}
                        style={{ display: useNativePlayer ? 'block' : 'none', width: '100%' }}
                    />
                    {!useNativePlayer && (
                        <div className="custom-player">
                            <button
                                className="custom-player-btn custom-player-btn--play"
                                onClick={() => {
                                    if (audioRef.current?.paused) {
                                        audioRef.current.play();
                                    } else {
                                        audioRef.current?.pause();
                                    }
                                }}
                            >
                                {isPlaying ? (
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                                        <rect x="6" y="4" width="4" height="16" rx="1" />
                                        <rect x="14" y="4" width="4" height="16" rx="1" />
                                    </svg>
                                ) : (
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                                        <path d="M8 5.14v14.72a1 1 0 001.5.86l11-7.36a1 1 0 000-1.72l-11-7.36a1 1 0 00-1.5.86z" />
                                    </svg>
                                )}
                            </button>
                            <span className="custom-player-time">
                                {formatTime(currentTime / 1000)} / {formatTime(audioDuration)}
                            </span>
                            <input
                                type="range"
                                className="custom-player-progress"
                                min={0}
                                max={audioDuration || 100}
                                value={currentTime / 1000}
                                onChange={(e) => {
                                    if (audioRef.current) {
                                        audioRef.current.currentTime = parseFloat(e.target.value);
                                    }
                                }}
                            />
                            <button
                                className="custom-player-btn"
                                onClick={() => {
                                    if (audioRef.current) {
                                        audioRef.current.muted = !audioRef.current.muted;
                                    }
                                }}
                            >
                                🔊
                            </button>
                        </div>
                    )}
                    <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => setUseNativePlayer(!useNativePlayer)}
                        style={{ marginLeft: 'var(--space-2)', fontSize: 'var(--text-xs)' }}
                    >
                        {useNativePlayer ? 'Custom Player' : 'Native Player'}
                    </button>
                </div>
            )}

            {/* Empty State */}
            {!audioSrc && (
                <div className="card text-center" style={{ padding: 'var(--space-8)', marginBottom: 'var(--space-4)' }}>
                    <p className="text-muted">Select a music folder to start playing.</p>
                </div>
            )}

            {/* Logs Viewer - Collapsible */}
            <div className={`log-panel ${showLogs ? 'log-panel--open' : 'log-panel--closed'}`}>
                <div
                    className="log-panel-header"
                    onClick={() => setShowLogs(!showLogs)}
                    style={{ cursor: 'pointer', userSelect: 'none' }}
                >
                    <span>{showLogs ? '▼' : '▶'} Application Logs</span>
                    <span className="text-muted" style={{ marginLeft: 'auto', fontSize: 'var(--text-xs)' }}>
                        {logs.length} entries
                    </span>
                </div>
                {showLogs && (
                    <div ref={logContainerRef} className="log-panel-content">
                        {logs.map((log, i) => (
                            <div key={i} className="log-entry">
                                <span className="log-time">[{new Date(log.timestamp).toLocaleTimeString()}]</span>
                                <span className={`log-level log-level--${log.level}`}>[{log.level.toUpperCase()}]</span>
                                <span className="log-message">
                                    {log.message}
                                    {log.data && <span className="log-data"> {JSON.stringify(log.data)}</span>}
                                </span>
                            </div>
                        ))}
                        {logs.length === 0 && <div className="log-empty">No logs yet...</div>}
                    </div>
                )}
            </div>

            {/* Song Info Header */}
            {audioSrc && (
                <div className="song-info">
                    <h2 className="song-title">{lyrics?.metadata?.title || searchTitle || 'Unknown Title'}</h2>
                    <p className="song-artist">{lyrics?.metadata?.artist || searchArtist || 'Unknown Artist'}</p>
                </div>
            )}

            {/* Divider Line */}


            {/* Lyrics View - Rendered conditionally into PiP or Main */}
            {pipWindow ? (
                createPortal(
                    <div className="no-scrollbar" ref={pipContainerRef} style={{
                        height: '100vh',
                        width: '100%',
                        background: 'var(--bg-base)',
                        color: 'var(--text-primary)',
                        overflowY: 'auto',
                        padding: 'var(--space-5)',
                        boxSizing: 'border-box'
                    }}>
                        <div className="pip-header">
                            <h2 className="pip-title">
                                {lyrics?.metadata?.title || searchTitle || "Lyrics"}
                            </h2>
                            <div className="pip-artist">
                                {lyrics?.metadata?.artist || searchArtist || ""}
                            </div>
                        </div>
                        {lyrics ? (
                            <LyricsList
                                lyrics={lyrics}
                                activeLineIndex={activeLineIndex}
                                currentTime={currentTime}
                                autoScroll={true}
                                onLineClick={handleLyricClick}
                            />
                        ) : <div className="lyrics-placeholder">No Lyrics Loaded</div>}
                    </div>,
                    pipWindow.document.body
                )
            ) : null}

            {/* Main Lyrics View */}
            <div
                className="lyrics-container"
            >
                {pipWindow ? (
                    <div className="lyrics-pip-message">
                        <p>Lyrics are displayed in the pop-out window.</p>
                        <button className="btn btn-secondary" onClick={togglePiP}>
                            Restore Lyrics to Main Window
                        </button>
                    </div>
                ) : (
                    <>
                        <button
                            className="btn btn-ghost btn-sm lyrics-popout-btn"
                            onClick={togglePiP}
                        >
                            Pop Out Lyrics
                        </button>
                        <div className="lyrics-scroller no-scrollbar" ref={lyricsContainerRef}>
                            {lyrics ? (
                                <LyricsList
                                    lyrics={lyrics}
                                    activeLineIndex={activeLineIndex}
                                    currentTime={currentTime}
                                    autoScroll={true}
                                    onLineClick={handleLyricClick}
                                />
                            ) : <div className="lyrics-placeholder">No Lyrics Loaded</div>}
                        </div>
                    </>
                )}
            </div>
            {/* Export Modal */}
            <ExportManagerModal
                isOpen={showExportModal}
                onClose={() => setShowExportModal(false)}
                playlist={playlist}
                manager={manager}
            />
        </div >
    )
}

// Extracted Component for Reusability
function LyricsList({ lyrics, activeLineIndex, currentTime, autoScroll, onLineClick }: {
    lyrics: LyricsData,
    activeLineIndex: number,
    currentTime: number,
    autoScroll: boolean,
    onLineClick?: (time: number) => void
}) {
    const containerRef = useRef<HTMLDivElement>(null);

    // Auto-scroll for PiP mode (Since main window uses its own ref logic, we probably want self-contained logic here too)
    // The main window logic was doing `lyricsContainerRef` scrolling.

    useEffect(() => {
        if (autoScroll && activeLineIndex !== -1 && containerRef.current) {
            // Use data-index to find the specific element corresponding to the active line index
            // This is robust against skipped/null lines not being rendered in the DOM
            const activeEl = containerRef.current.querySelector(`[data-index="${activeLineIndex}"]`) as HTMLElement;
            if (activeEl) {
                const container = containerRef.current.parentElement;
                if (container) {
                    const activeRect = activeEl.getBoundingClientRect();
                    const containerRect = container.getBoundingClientRect();
                    const currentScroll = container.scrollTop;
                    const containerHeight = container.clientHeight;
                    const activeHeight = activeEl.clientHeight;

                    // Calculate the scroll position to center the element
                    const targetScroll = currentScroll + (activeRect.top - containerRect.top) - (containerHeight / 2) + (activeHeight / 2);

                    container.scrollTo({
                        top: targetScroll,
                        behavior: 'smooth'
                    });
                } else {
                    // Fallback if for some reason there is no parent (unlikely)
                    activeEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            }
        }
    }, [activeLineIndex, autoScroll]);

    return (
        <div ref={containerRef} className="lyrics-content">
            {lyrics.lines.map((line, idx) => {
                // Skip empty lines
                const lineText = line.syllables
                    ? line.syllables.map(s => s.text).join('').trim()
                    : (line.text || '').trim();
                if (!lineText) return null;

                const isActive = idx === activeLineIndex;
                return (
                    <div
                        key={idx}
                        data-index={idx}
                        onClick={() => onLineClick && onLineClick(line.startTime)}
                        className={`lyric-line ${isActive ? 'lyric-line--active' : 'lyric-line--inactive'}`}
                    >
                        {line.syllables ? (
                            <div>
                                {line.syllables.map((syl, sylIdx) => {
                                    const sylAbsStart = line.startTime + syl.startTime;
                                    const sylAbsEnd = sylAbsStart + syl.duration;
                                    const isSylPassed = currentTime >= sylAbsEnd;
                                    const isSylActive = currentTime >= sylAbsStart && currentTime < sylAbsEnd;

                                    let sylClass = 'lyric-syllable';
                                    if (isActive) {
                                        if (isSylPassed) sylClass += ' lyric-syllable--passed';
                                        else if (isSylActive) sylClass += ' lyric-syllable--active';
                                        else sylClass += ' lyric-syllable--upcoming';
                                    }

                                    return (
                                        <span key={sylIdx} className={sylClass}>
                                            {syl.text}
                                        </span>
                                    );
                                })}
                            </div>
                        ) : (
                            line.text
                        )}
                    </div>
                )
            })}
        </div>
    );
}
