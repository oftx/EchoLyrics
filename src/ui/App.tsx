import { useEffect, useState, useRef, useCallback, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { LyricsManager, DisplayMode } from '@/core/services/LyricsManager';
import { SongInformation } from '@/core/interfaces/SongInformation';
import { NeteaseNetworkProvider } from "@/core/providers/NeteaseNetworkProvider";
import { QQMusicNetworkProvider } from "@/core/providers/QQMusicNetworkProvider";
import { LRCLibNetworkProvider } from "@/core/providers/LRCLibNetworkProvider";

import { LyricsData } from '@/core/models/LyricsData';
import { Logger, LogEntry } from '@/core/utils/Logger';
import { ExportManagerModal } from './components/ExportManagerModal';

import { MetadataService } from '@/core/services/MetadataService';
import { SearchQueryResolver } from '@/core/utils/SearchQueryResolver';
import { LyricTypeDetector } from '@/core/utils/LyricTypeDetector';

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
    const [lyricOffset, setLyricOffset] = useState(0); // Global offset in ms
    // const [currentSongSignature, setCurrentSongSignature] = useState<string>(""); // Unused
    const [showCandidates, setShowCandidates] = useState(false);
    const [candidates, setCandidates] = useState<any[]>([]);
    const [displayMode, setDisplayMode] = useState<DisplayMode>(manager.getDisplayMode());

    const handleDisplayModeChange = (mode: DisplayMode) => {
        manager.setDisplayMode(mode);
        setDisplayMode(mode);
    };


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

    // Handle playback safely when source changes
    useEffect(() => {
        if (audioSrc && audioRef.current) {
            const playPromise = audioRef.current.play();
            if (playPromise !== undefined) {
                playPromise.catch(error => {
                    // AbortError is expected when switching songs
                    if (error.name === 'AbortError') return;

                    // NotSupportedError is expected if format is not natively supported.
                    // The 'onError' event handler will catch this and trigger transcoding.
                    if (error.name === 'NotSupportedError') return;

                    console.error("Playback failed:", error);
                });
            }
        }
    }, [audioSrc]);

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
        setCurrentTime(-lyricOffset); // Initial synced time
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
        // setCurrentSongSignature(signature);

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
                // Dynamic import for code splitting
                const { FFmpegConverter } = await import('@/core/services/FFmpegConverter');
                const converter = new FFmpegConverter();
                const result = await converter.convertToWav(currentItem.audioFile);
                const wavUrl = URL.createObjectURL(result.blob);
                setAudioSrc(wavUrl);
                setStatusMsg("Transcoding complete. Playing...");
                setAudioSrc(wavUrl);
                setStatusMsg("Transcoding complete. Playing...");
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

    // Auto-next when audio ends
    const handleAudioEnded = () => {
        if (currentIndex < playlist.length - 1) {
            playTrack(playlist[currentIndex + 1], currentIndex + 1);
        }
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
            // startTime is the desired Synced Time
            // RealTime = SyncedTime + Offset
            const targetRealTime = startTime + lyricOffset;
            audioRef.current.currentTime = targetRealTime / 1000;

            setCurrentTime(startTime);
            // Instant update of active index
            if (lyrics) {
                const idx = manager.getSynchronizer().findLineIndex(lyrics, startTime);
                setActiveLineIndex(idx);
            }
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
        let finalTitle = searchTitle;
        let finalArtist = searchArtist;

        // Optimized: If title or artist is empty, try to fill from MusicBrainz
        if ((!finalTitle || !finalArtist) && currentIndex >= 0 && currentIndex < playlist.length) {
            const currentItem = playlist[currentIndex];
            if (currentItem.isrc) {
                setStatusMsg("Fetching info from MusicBrainz...");
                try {
                    const resolver = new SearchQueryResolver();
                    // Use a temporary object for resolution
                    const tempInfo: SongInformation = {
                        title: finalTitle || "",
                        artists: [finalArtist || ""],
                        album: "",
                        duration: 0,
                        sourceId: "temp",
                        isrc: currentItem.isrc
                    };

                    const results = await resolver.resolveQueries(tempInfo);
                    if (results.length > 0) {
                        const best = results[0];
                        // If one field was empty, fill it. 
                        // Note: resolveQueries returns prioritized results.
                        if (!finalTitle && best.title) {
                            finalTitle = best.title;
                            setSearchTitle(finalTitle);
                        }
                        if (!finalArtist && best.artist) {
                            finalArtist = best.artist;
                            setSearchArtist(finalArtist);
                        }
                        if (finalTitle || finalArtist) {
                            setStatusMsg("Info updated from MusicBrainz.");
                        }
                    } else {
                        setStatusMsg("No info found on MusicBrainz.");
                    }
                } catch (e) {
                    console.warn("MB Auto-fill failed", e);
                    setStatusMsg("MusicBrainz lookup failed.");
                }
            }
        }

        if (!finalTitle) {
            if (currentIndex >= 0 && playlist[currentIndex]?.isrc) {
                setStatusMsg("Could not info from MusicBrainz. Please enter manually.");
            } else {
                setStatusMsg("Please enter a title.");
            }
            return;
        }

        setStatusMsg("Searching...");
        setLyrics(null);

        // Find current item's filename to use as persistence ID
        let persistenceId = undefined;
        if (currentIndex >= 0 && currentIndex < playlist.length) {
            persistenceId = playlist[currentIndex].name;
        }

        const song: SongInformation = {
            title: finalTitle,
            artists: [finalArtist],
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
            const realTime = audioRef.current.currentTime * 1000;
            const syncedTime = realTime - lyricOffset;

            setCurrentTime(syncedTime);
            // Sync lyrics
            if (lyrics) {
                const idx = manager.getSynchronizer().findLineIndex(lyrics, syncedTime);
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

            {/* Song Info Header - MOVED UP */}
            {audioSrc && (
                <div className="song-info">
                    <h2 className="song-title">{lyrics?.metadata?.title || searchTitle || 'Unknown Title'}</h2>
                    <p className="song-artist">{lyrics?.metadata?.artist || searchArtist || 'Unknown Artist'}</p>
                </div>
            )}

            {/* Main Lyrics View - MOVED UP */}
            {/* Render conditional to prevent showing empty container if no song/lyrics? Or just standard view */}
            {/* Keeping original logic: always render container, content depends on state */}
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
                                    displayMode={displayMode}
                                    centerRatio={0.5} // Explicitly set for main view too if needed, or default
                                    onLineClick={handleLyricClick}
                                />
                            ) : <div className="lyrics-placeholder">No Lyrics Loaded</div>}
                        </div>
                    </>
                )}
            </div>

            {/* PiP Portal - Keep logical definition here or at bottom. Does not affect layout. */}
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
                                displayMode={displayMode}
                                centerRatio={0.5}
                                onLineClick={handleLyricClick}
                            />
                        ) : <div className="lyrics-placeholder">No Lyrics Loaded</div>}
                    </div>,
                    pipWindow.document.body
                )
            ) : null}

            {/* Search Controls - MOVED DOWN */}
            <div className="search-controls" style={{ marginTop: 'var(--space-5)' }}>
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

            {/* Status Bar - MOVED DOWN */}
            <div className="status-bar">
                <span>{statusMsg}</span>
                {/* Offset Controls */}
                {lyrics && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', borderLeft: '1px solid var(--border-subtle)', paddingLeft: 'var(--space-3)', borderRight: '1px solid var(--border-subtle)', paddingRight: 'var(--space-3)' }}>
                        <span style={{ fontSize: 'var(--text-xs)' }}>Offset:</span>
                        <button
                            className="btn btn-ghost btn-sm"
                            style={{ padding: '0 6px', height: '24px', minHeight: 'unset' }}
                            onClick={() => setLyricOffset(o => o - 100)}
                            title="Advance lyrics (Lyrics appear ealier)"
                        >
                            −
                        </button>
                        <span style={{ fontSize: 'var(--text-xs)', minWidth: '50px', textAlign: 'center', fontVariantNumeric: 'tabular-nums', cursor: 'pointer' }} onClick={() => setLyricOffset(0)} title="Click to reset">
                            {lyricOffset > 0 ? '+' : ''}{lyricOffset}ms
                        </span>
                        <button
                            className="btn btn-ghost btn-sm"
                            style={{ padding: '0 6px', height: '24px', minHeight: 'unset' }}
                            onClick={() => setLyricOffset(o => o + 100)}
                            title="Delay lyrics (Lyrics appear later)"
                        >
                            +
                        </button>
                    </div>
                )}
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
                {lyrics && (
                    <div className="display-mode-controls" style={{ marginLeft: 'auto' }}>
                        <select
                            className="select select-sm select-display-mode"
                            value={displayMode}
                            onChange={(e) => handleDisplayModeChange(e.target.value as DisplayMode)}
                        >
                            <option value={DisplayMode.Original}>Original</option>
                            <option value={DisplayMode.Translation}>Translation</option>
                            <option value={DisplayMode.Both}>Both</option>
                        </select>
                    </div>
                )}
            </div>

            {/* Candidates Modal - Keep near status bar contextually */}
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
                            {candidates.map((cand, idx) => {
                                // Detect lyric types
                                const types = LyricTypeDetector.getLyricTypes(cand.lyricText, cand.translationText);

                                // Check if this is the currently selected lyric
                                const isCurrentlySelected = lyrics?.metadata?.['source'] === cand.source &&
                                    lyrics?.metadata?.['title'] === cand.title &&
                                    lyrics?.metadata?.['artist'] === cand.artist;

                                return (
                                    <div
                                        key={idx}
                                        onClick={() => handleSelectCandidate(idx)}
                                        className={`candidate-item ${isCurrentlySelected ? 'candidate-item--selected' : ''}`}
                                    >
                                        <div className="candidate-main">
                                            <div className="candidate-title">{cand.title}</div>
                                            <div className="candidate-artist">{cand.artist}</div>
                                            <div className="candidate-meta">
                                                <span className="candidate-source">{cand.source}</span>
                                            </div>
                                        </div>
                                        <div className="candidate-side">
                                            <div className="candidate-badges">
                                                {types.hasTranslation && (
                                                    <span className="candidate-badge candidate-badge--translation" title="Has translation">
                                                        🌐
                                                    </span>
                                                )}
                                                {types.hasKaraoke && (
                                                    <span className="candidate-badge candidate-badge--karaoke" title="Word-by-word karaoke">
                                                        🎤
                                                    </span>
                                                )}
                                                {types.isPlainText && (
                                                    <span className="candidate-badge candidate-badge--plaintext" title="Plain text (unsynced)">
                                                        📄
                                                    </span>
                                                )}
                                            </div>
                                            <div className="candidate-score" title="Match Score">
                                                <span className="candidate-score-label">Score</span>
                                                <span className="candidate-score-value">{cand.score.toFixed(0)}</span>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            )}

            {/* Audio Player - MOVED DOWN */}
            {audioSrc && (
                <div className="audio-player-wrapper">
                    <audio
                        ref={audioRef}
                        src={audioSrc}
                        controls={useNativePlayer}
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
                                        audioRef.current.play().catch(e => {
                                            if (e.name !== 'AbortError') console.error(e);
                                        });
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
                                {formatTime((currentTime + lyricOffset) / 1000)} / {formatTime(audioDuration)}
                            </span>
                            <input
                                type="range"
                                className="custom-player-progress"
                                min={0}
                                max={audioDuration || 100}
                                value={(currentTime + lyricOffset) / 1000}
                                onChange={(e) => {
                                    if (audioRef.current) {
                                        const t = parseFloat(e.target.value);
                                        audioRef.current.currentTime = t;

                                        const synced = (t * 1000) - lyricOffset;
                                        setCurrentTime(synced);
                                        if (lyrics) {
                                            const idx = manager.getSynchronizer().findLineIndex(lyrics, synced);
                                            setActiveLineIndex(idx);
                                        }
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

            {/* Logs Viewer - MOVED TO BOTTOM */}
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
function LyricsList({ lyrics, activeLineIndex, currentTime, autoScroll, displayMode, centerRatio = 0.5, onLineClick }: {
    lyrics: LyricsData,
    activeLineIndex: number,
    currentTime: number,
    autoScroll: boolean,
    displayMode: DisplayMode,
    centerRatio?: number,
    onLineClick?: (time: number) => void
}) {
    const containerRef = useRef<HTMLDivElement>(null);

    // Auto-scroll for PiP mode (Since main window uses its own ref logic, we probably want self-contained logic here too)
    // The main window logic was doing `lyricsContainerRef` scrolling.

    const isUserScrolling = useRef(false);
    const userScrollTimeout = useRef<NodeJS.Timeout | null>(null);

    const scrollToActive = useCallback(() => {
        if (!containerRef.current || isUserScrolling.current) return;

        const activeEl = containerRef.current.querySelector(`[data-index="${activeLineIndex}"]`) as HTMLElement;
        const visualActiveEl = activeEl || containerRef.current.querySelector('.lyric-line--active') as HTMLElement;

        if (visualActiveEl) {
            const container = containerRef.current.parentElement;
            if (container) {
                let centerTargetEl = visualActiveEl;

                if (displayMode === DisplayMode.Both && visualActiveEl.classList.contains('lyric-line--translation')) {
                    const prev = visualActiveEl.previousElementSibling as HTMLElement;
                    if (prev && !prev.classList.contains('lyric-line--translation')) {
                        centerTargetEl = prev;
                    }
                }

                const activeRect = centerTargetEl.getBoundingClientRect();

                let groupHeight = centerTargetEl.clientHeight;
                let groupTop = activeRect.top;

                const nextSibling = centerTargetEl.nextElementSibling as HTMLElement;
                if (displayMode === DisplayMode.Both && nextSibling && nextSibling.classList.contains('lyric-line--translation')) {
                    const nextRect = nextSibling.getBoundingClientRect();
                    const combinedBottom = Math.max(activeRect.bottom, nextRect.bottom);
                    groupHeight = combinedBottom - activeRect.top;
                }

                const containerRect = container.getBoundingClientRect();
                const currentScroll = container.scrollTop;
                const containerHeight = container.clientHeight;

                const targetScroll = currentScroll + (groupTop - containerRect.top) - (containerHeight * centerRatio) + (groupHeight / 2);

                container.scrollTo({
                    top: targetScroll,
                    behavior: 'smooth'
                });
            } else {
                visualActiveEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }
    }, [activeLineIndex, displayMode, centerRatio]);

    const prevActiveLineIndex = useRef(activeLineIndex);

    useLayoutEffect(() => {
        if (autoScroll && activeLineIndex !== -1) {
            // Scroll Anchoring: Compensate for the shrinking of the previous line
            // If we advanced sequentially (N -> N+1)
            if (activeLineIndex === prevActiveLineIndex.current + 1 && containerRef.current) {
                const prevLine = containerRef.current.querySelector(`[data-index="${prevActiveLineIndex.current}"]`) as HTMLElement;
                if (prevLine && containerRef.current.parentElement) {
                    // The previous line just shrank from 1.5em to 1em (approx factor 0.5 difference)
                    // We measure its CURRENT (shrunk) height. 
                    // The "lost" height is approx 0.5 * currentHeight.
                    const h = prevLine.clientHeight;
                    const delta = h * 0.5;

                    // We need to scroll UP (reduce scrollTop) to push the content DOWN 
                    // to counteract the fact that content moved UP due to shrinking.
                    containerRef.current.parentElement.scrollTop -= delta;
                }
            }

            scrollToActive();
            prevActiveLineIndex.current = activeLineIndex;
        }
    }, [activeLineIndex, autoScroll, scrollToActive]);

    useEffect(() => {
        const container = containerRef.current?.parentElement;
        if (!container) return;
        const resizeObserver = new ResizeObserver(() => {
            if (autoScroll && activeLineIndex !== -1) scrollToActive();
        });
        resizeObserver.observe(container);
        return () => resizeObserver.disconnect();
    }, [autoScroll, activeLineIndex, scrollToActive]);

    // User Interaction Listener
    useEffect(() => {
        const container = containerRef.current?.parentElement;
        if (!container) return;

        const handleUserInteration = () => {
            isUserScrolling.current = true;
            if (userScrollTimeout.current) {
                clearTimeout(userScrollTimeout.current);
            }
            userScrollTimeout.current = setTimeout(() => {
                isUserScrolling.current = false;
                // Optional: Snap back immediately? Or wait for next time update?
                // Let's ensure it snaps back if needed
                // scrollToActive(); 
            }, 750);
        };

        container.addEventListener('wheel', handleUserInteration, { passive: true });
        container.addEventListener('touchstart', handleUserInteration, { passive: true });
        // Also listen for mousedown on scrollbar
        container.addEventListener('mousedown', handleUserInteration, { passive: true });

        return () => {
            container.removeEventListener('wheel', handleUserInteration);
            container.removeEventListener('touchstart', handleUserInteration);
            container.removeEventListener('mousedown', handleUserInteration);
            if (userScrollTimeout.current) clearTimeout(userScrollTimeout.current);
        };
    }, []);

    return (
        <>
            {/* Unsynced Warning */}
            {lyrics && lyrics.isSynced === false && (
                <div style={{
                    position: 'absolute',
                    top: '10px',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    background: 'rgba(245, 158, 11, 0.2)', // Warning color background
                    border: '1px solid rgba(245, 158, 11, 0.4)',
                    color: '#fbbf24',
                    padding: '4px 12px',
                    borderRadius: '16px',
                    fontSize: '0.75rem',
                    zIndex: 10,
                    pointerEvents: 'none'
                }}>
                    Lyrics not synced to timeline
                </div>
            )}

            <div ref={containerRef} className={`lyrics-content lyrics-mode-${displayMode.toLowerCase()}`}>
                {lyrics.lines.map((line, idx) => {
                    // Skip empty lines
                    const lineText = line.syllables
                        ? line.syllables.map(s => s.text).join('')
                        : line.text;

                    if (!lineText.trim()) return null;

                    // Filtering Logic
                    const isOriginal = line.layer === 0 || line.layer === undefined;
                    const isTranslation = line.layer === 1;

                    if (displayMode === DisplayMode.Original && !isOriginal) return null;
                    if (displayMode === DisplayMode.Translation && !isTranslation) {
                        // Special case: If NO translation lines exist at all, should we fallback? 
                        // For now, strict filtering.
                        return null;
                    }

                    let isActive = idx === activeLineIndex;
                    if (lyrics.isSynced === false) isActive = false; // Disable highlighting for unsynced

                    // Fix Highlight Logic: 
                    // 1. If Hidden Partner: If the "Actual Active" index is hidden (e.g. translation hidden), 
                    //    but this line is the visible partner (same timestamp), highlight this one.
                    // 2. If Both Mode: If this line is the partner of the active line (same timestamp),
                    //    ALSO highlight it.
                    if (!isActive) {
                        const activeLine = lyrics.lines[activeLineIndex];
                        if (activeLine && Math.abs(activeLine.startTime - line.startTime) < 50) { // < 50ms tolerance
                            if (displayMode === DisplayMode.Both) {
                                isActive = true;
                            } else {
                                // If NOT both mode, only highlight if the ACTUAL active line is hidden?
                                // Actually, in single modes, we filtered out the other lines above.
                                // So if we are here, we are the VISIBLE line. 
                                // If the active index was the Invisible one, we should take the highlight.
                                // Logic: If activeLine is NOT visible (filtered out), then WE take highlight.
                                const activeIsOriginal = activeLine.layer === 0 || activeLine.layer === undefined;
                                const activeIsTranslation = activeLine.layer === 1;

                                const activeHidden = (displayMode === DisplayMode.Original && !activeIsOriginal) ||
                                    (displayMode === DisplayMode.Translation && !activeIsTranslation);

                                if (activeHidden) {
                                    isActive = true;
                                }
                            }
                        }
                    }
                    return (
                        <div
                            key={idx}
                            data-index={idx}
                            onClick={() => onLineClick && onLineClick(line.startTime)}
                            className={`lyric-line ${isActive ? 'lyric-line--active' : 'lyric-line--inactive'} ${line.layer === 1 ? 'lyric-line--translation' : ''}`}
                        >
                            {line.syllables ? (
                                <div>
                                    {line.syllables.map((syl, sylIdx) => {
                                        const sylAbsStart = line.startTime + syl.startTime;
                                        const sylAbsEnd = sylAbsStart + syl.duration;
                                        const isSylPassed = currentTime >= sylAbsEnd;
                                        const isSylActive = currentTime >= sylAbsStart && currentTime < sylAbsEnd;

                                        let sylClass = 'lyric-syllable';
                                        let opacityStyle: React.CSSProperties = {};

                                        if (isActive) {
                                            if (isSylPassed) {
                                                sylClass += ' lyric-syllable--passed';
                                                // Fully visible
                                                opacityStyle.opacity = 1;
                                            } else if (isSylActive) {
                                                sylClass += ' lyric-syllable--active';
                                                // Calculate progress through this syllable (0 to 1)
                                                const progress = (currentTime - sylAbsStart) / syl.duration;
                                                // Map progress to opacity: 0.5 → 1.0
                                                const opacity = 0.5 + (progress * 0.5);
                                                opacityStyle.opacity = Math.min(1, Math.max(0.5, opacity));
                                            } else {
                                                sylClass += ' lyric-syllable--upcoming';
                                                // Dimmed
                                                opacityStyle.opacity = 0.5;
                                            }
                                        }

                                        return (
                                            <span key={sylIdx} className={sylClass} style={opacityStyle}>
                                                {syl.text}
                                            </span>
                                        );
                                    })}
                                </div>
                            ) : (
                                line.text
                            )}
                        </div>
                    );
                })}
            </div>
        </>
    );
}
