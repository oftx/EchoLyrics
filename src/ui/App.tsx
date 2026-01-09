import { useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { LyricsManager } from '@/core/services/LyricsManager';
import { SongInformation } from '@/core/interfaces/SongInformation';
import { NeteaseNetworkProvider } from "@/core/providers/NeteaseNetworkProvider";
import { StandardLrcParser } from '@/core/parsers/StandardLrcParser';
import { LyricsData } from '@/core/models/LyricsData';
import { Logger, LogEntry } from '@/core/utils/Logger';
import { ExportManagerModal } from './components/ExportManagerModal';
import { FFmpegConverter } from '@/core/services/FFmpegConverter';

interface PlaylistItem {
    name: string;
    audioFile: File;
    lyricFile?: File;
    artist?: string;
    title?: string;
}

// Singleton instance for the app
const manager = new LyricsManager();
const converter = new FFmpegConverter();
// manager.getSearcher().registerProvider(new MockNetworkProvider());
manager.getSearcher().registerProvider(new NeteaseNetworkProvider());

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
    const [isHoveringLyrics, setIsHoveringLyrics] = useState(false);
    const [showExportModal, setShowExportModal] = useState(false);
    const [isConverting, setIsConverting] = useState(false);

    const audioRef = useRef<HTMLAudioElement>(null);
    const lyricsContainerRef = useRef<HTMLDivElement>(null);
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

        // Load Lyrics
        if (item.lyricFile) {
            // Local file mode
            try {
                const text = await item.lyricFile.text();
                // Check if song changed while reading file (rare but possible)
                // For local files it's fast, but consistent logic is good.

                const parser = new StandardLrcParser();
                const parsedLyrics = parser.parse(text);
                // Inject metadata
                parsedLyrics.metadata = parsedLyrics.metadata || {};
                parsedLyrics.metadata['source'] = 'Local File';
                parsedLyrics.metadata['title'] = item.title || '';
                parsedLyrics.metadata['artist'] = item.artist || '';

                if (signature === currentSongSignature) {
                    // Wait, we need to read the state ref.. 
                    // actually closure captures old signature? No, `signature` is local const.
                    // But we need to compare against LATEST state.
                    // The state update `setCurrentSongSignature` is async, so `currentSongSignature` in closure is old.
                    // BUT, we defined `signature` right here. 
                    // We need a ref to track "latest request signature" to compare against.
                    // OR, `handleSearchForTrack` passes the signature.
                    setLyrics(parsedLyrics);
                    setStatusMsg("Loaded local lyrics.");
                }
            } catch (e) {
                console.error("Failed to parse local lyrics", e);
                setStatusMsg("Error parsing local lyrics.");
            }
        } else {
            // Try to search online
            handleSearchForTrack(item, signature);
        }
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
                const wavBlob = await converter.convertToWav(currentItem.audioFile);
                const wavUrl = URL.createObjectURL(wavBlob);
                setAudioSrc(wavUrl);
                setStatusMsg("Transcoding complete. Playing...");
                if (audioRef.current) {
                    audioRef.current.load();
                    audioRef.current.play();
                }
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
    const handleSearchForTrack = async (item: PlaylistItem, signature: string) => {
        if (!item.title) return;
        setStatusMsg("Searching online for lyrics...");
        const song: SongInformation = {
            title: item.title,
            artists: item.artist ? [item.artist] : [],
            album: "",
            duration: 0,
            sourceId: "local_auto",
            persistenceId: item.name // Use filename as stable ID
        };

        // We use a ref to track active request? 
        // Actually, simpler: check a ref that stores 'latestSignature'.
        // Let's create `latestSignatureRef` if we want to be safe, but passing signature to valid function works 
        // IF we compare it against a Ref that holds the "current target".
        // State `currentSongSignature` updates eventually.
        // Let's use a mutable ref for the synchronous "latest" check.

        latestSignatureRef.current = signature;

        const success = await manager.loadLyricsForSong(song);

        if (latestSignatureRef.current !== signature) {
            Logger.info("Ignoring stale lyric result.");
            return;
        }

        if (success) {
            setLyrics(manager.getCurrentLyrics());
            setStatusMsg("Lyrics found online!");
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
            persistenceId: persistenceId // Bind this search to the current file
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

    // Auto-scroll effect
    useEffect(() => {
        if (activeLineIndex !== -1 && lyricsContainerRef.current) {
            const container = lyricsContainerRef.current;
            const linesWrapper = container.firstElementChild as HTMLElement;
            if (linesWrapper && linesWrapper.children[activeLineIndex]) {
                const activeEl = linesWrapper.children[activeLineIndex] as HTMLElement;
                const containerHeight = container.clientHeight;
                const elementTop = activeEl.offsetTop;
                const elementHeight = activeEl.clientHeight;

                container.scrollTo({
                    top: elementTop - containerHeight / 2 + elementHeight / 2,
                    behavior: 'smooth'
                });
            }
        }
    }, [activeLineIndex]);

    return (
        <div className="app-container" style={{ padding: '20px', maxWidth: '800px', margin: '0 auto', textAlign: 'center' }}>
            <h1>Echo Lyrics</h1>


            {/* Folder Input */}
            <div style={{ marginBottom: '20px', border: '1px dashed #666', padding: '10px' }}>
                <label style={{ display: 'block', marginBottom: '5px', color: '#888' }}>
                    Select Music Folder
                </label>
                <input
                    type="file"
                    // @ts-expect-error webkitdirectory is not standard
                    webkitdirectory=""
                    directory=""
                    onChange={handleFolderSelect}
                    multiple
                />
            </div>

            {/* Playlist UI */}
            {
                playlist.length > 0 && (
                    <div className="playlist" style={{
                        maxHeight: '150px',
                        overflowY: 'auto',
                        marginBottom: '20px',
                        border: '1px solid #444',
                        background: '#1a1a1a',
                        textAlign: 'left'
                    }}>
                        {playlist.map((item, idx) => (
                            <div
                                key={idx}
                                onClick={() => playTrack(item, idx)}
                                style={{
                                    padding: '5px 10px',
                                    cursor: 'pointer',
                                    background: idx === currentIndex ? '#333' : 'transparent',
                                    color: idx === currentIndex ? '#fff' : '#aaa',
                                    borderBottom: '1px solid #222'
                                }}
                            >
                                <span style={{ marginRight: '10px' }}>{idx + 1}.</span>
                                {item.name}
                                {item.lyricFile && <span style={{ float: 'right', fontSize: '0.8em', color: '#4caf50' }}>LRC</span>}
                            </div>
                        ))}
                    </div>
                )
            }

            {/* Controls */}
            {
                audioSrc && (
                    <div style={{ marginBottom: '10px' }}>
                        <button onClick={handlePrev} disabled={currentIndex <= 0}>Prev</button>
                        <button onClick={handleNext} disabled={currentIndex >= playlist.length - 1} style={{ marginLeft: '10px' }}>Next</button>
                    </div>
                )
            }

            {/* Search Controls */}
            <div className="search-controls" style={{ marginBottom: '20px', display: 'flex', gap: '10px', justifyContent: 'center' }}>
                <input
                    type="text"
                    placeholder="Title"
                    value={searchTitle}
                    onChange={e => setSearchTitle(e.target.value)}
                    style={{ padding: '5px' }}
                />
                <input
                    type="text"
                    placeholder="Artist"
                    value={searchArtist}
                    onChange={e => setSearchArtist(e.target.value)}
                    style={{ padding: '5px' }}
                />
                <input
                    type="number"
                    placeholder="Limit"
                    value={searchLimit}
                    onChange={e => setSearchLimit(parseInt(e.target.value) || 15)}
                    style={{ padding: '5px', width: '60px' }}
                    title="Result Limit"
                />
                <button onClick={handleSearch}>Search Lyrics</button>
                <button onClick={() => setShowExportModal(true)} style={{ marginLeft: '10px' }}>Export Lyrics</button>
            </div>

            <div style={{ color: '#aaa', marginBottom: '10px' }}>
                {statusMsg}
                {lyrics && lyrics.metadata && lyrics.metadata['source'] && (
                    <>
                        <span style={{ marginLeft: '10px', fontSize: '0.8em', color: '#666', border: '1px solid #444', padding: '2px 6px', borderRadius: '4px' }}>
                            Source: {lyrics.metadata['source']}
                        </span>
                        <button
                            onClick={handleShowCandidates}
                            style={{ marginLeft: '10px', fontSize: '0.8em', background: '#333', border: '1px solid #555', color: '#ccc', cursor: 'pointer' }}
                        >
                            Switch Lyrics
                        </button>

                    </>
                )}
            </div>

            {/* Candidates Modal/Overlay */}
            {
                showCandidates && (
                    <div
                        onClick={() => setShowCandidates(false)}
                        style={{
                            position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
                            background: 'rgba(0,0,0,0.5)', zIndex: 999
                        }}
                    >
                        <div
                            onClick={(e) => e.stopPropagation()}
                            style={{
                                position: 'fixed', top: '20%', left: '50%', transform: 'translate(-50%, 0)',
                                background: '#222', border: '1px solid #666', padding: '20px', zIndex: 1000,
                                width: '300px', maxHeight: '400px', overflowY: 'auto',
                                borderRadius: '8px', boxShadow: '0 4px 10px rgba(0,0,0,0.5)'
                            }}
                        >
                            <h3 style={{ marginTop: 0 }}>Select Lyrics</h3>
                            {/* <button onClick={() => setShowCandidates(false)} style={{ float: 'right' }}>X</button> */}
                            <div style={{ marginTop: '10px' }}>
                                {candidates.map((cand, idx) => (
                                    <div
                                        key={idx}
                                        onClick={() => handleSelectCandidate(idx)}
                                        style={{ padding: '8px', borderBottom: '1px solid #333', cursor: 'pointer', textAlign: 'left' }}
                                    >
                                        <div style={{ fontWeight: 'bold' }}>{cand.title}</div>
                                        <div style={{ fontSize: '0.8em', color: '#888' }}>{cand.artist}</div>
                                        <div style={{ fontSize: '0.7em', color: '#555' }}>{cand.source}</div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                )
            }

            {/* Native Audio Player */}
            {
                audioSrc && (
                    <div style={{ marginBottom: '20px' }}>
                        <audio
                            ref={audioRef}
                            src={audioSrc}
                            controls
                            autoPlay
                            style={{ width: '100%' }}
                            onTimeUpdate={handleTimeUpdate}
                            onEnded={handleAudioEnded}
                            onError={handleAudioError}
                        />
                    </div>
                )
            }

            {/* Manual Controls (Optional, synced with audio) */}
            {
                !audioSrc && (
                    <div className="controls">
                        <p>Select a music file to start.</p>
                    </div>
                )
            }

            {/* Logs Viewer (New) */}
            <div className="log-viewer" style={{
                marginBottom: '20px',
                textAlign: 'left',
                border: '1px solid #333',
                background: '#111',
                padding: '10px',
                borderRadius: '4px'
            }}>
                <div style={{ fontSize: '0.8em', color: '#888', borderBottom: '1px solid #333', marginBottom: '5px', paddingBottom: '2px' }}>
                    Application Logs (Latest 100)
                </div>
                <div
                    ref={logContainerRef}
                    style={{ maxHeight: '150px', overflowY: 'auto', fontFamily: 'monospace', fontSize: '12px' }}
                >
                    {logs.map((log, i) => (
                        <div key={i} style={{ color: log.level === 'error' ? '#f44336' : log.level === 'warn' ? '#ff9800' : '#8bc34a', marginBottom: '2px' }}>
                            <span style={{ color: '#555', marginRight: '5px' }}>[{new Date(log.timestamp).toLocaleTimeString()}]</span>
                            <span style={{ fontWeight: 'bold', marginRight: '5px' }}>[{log.level.toUpperCase()}]</span>
                            {log.message}
                            {log.data && <span style={{ color: '#aaa', marginLeft: '5px' }}>{JSON.stringify(log.data)}</span>}
                        </div>
                    ))}
                    {logs.length === 0 && <div style={{ color: '#555', fontStyle: 'italic' }}>No logs yet...</div>}
                </div>
            </div>

            {/* Lyrics View - Rendered conditionally into PiP or Main */}
            {
                pipWindow ? (
                    createPortal(
                        <div className="no-scrollbar" style={{
                            height: '100vh',
                            width: '100%',
                            background: '#000',
                            color: '#fff',
                            overflowY: 'auto',
                            padding: '20px',
                            boxSizing: 'border-box'
                        }}>
                            <h2 style={{ fontSize: '1rem', textAlign: 'center', marginBottom: '5px' }}>
                                {lyrics?.metadata?.title || searchTitle || "Lyrics"}
                            </h2>
                            <div style={{ fontSize: '0.9rem', textAlign: 'center', marginBottom: '15px', color: '#aaa' }}>
                                {lyrics?.metadata?.artist || searchArtist || ""}
                            </div>
                            {/* We reuse the Logic for displaying lyrics but we need to pass the same internal structure. 
                            Since the Lyrics rendering logic is embedded in JSX below, I should probably extract it to a component.
                            But for this 'refactor-less' approach, I will duplicate the render logic OR wrap it.
                            Wrapping in a const is best.
                        */}
                            {/* 
                            Actually, extracting the Lyrics list to a component is cleaner but I'll stick to a shared render function variable
                            if possible, or just duplicate the simple list for now to stay fast.
                            The list logic relies on references for scrolling (`lyricsContainerRef`).
                            If we move to PiP, we need a NEW Ref for the PiP container.
                         */}
                            {lyrics ? (
                                <LyricsList
                                    lyrics={lyrics}
                                    activeLineIndex={activeLineIndex}
                                    currentTime={currentTime}
                                    autoScroll={true}
                                    onLineClick={handleLyricClick}
                                />
                            ) : <div style={{ textAlign: 'center', marginTop: '50%' }}>No Lyrics Loaded</div>}
                        </div>,
                        pipWindow.document.body
                    )
                ) : null
            }

            {/* Main Lyrics View */}
            <div
                className="lyrics-view no-scrollbar"
                ref={lyricsContainerRef}
                onMouseEnter={() => setIsHoveringLyrics(true)}
                onMouseLeave={() => setIsHoveringLyrics(false)}
                style={{
                    marginTop: '20px',
                    height: '400px',
                    overflowY: 'auto',
                    border: '1px solid #444',
                    background: '#1a1a1a',
                    padding: '20px',
                    borderRadius: '8px',
                    position: 'relative'
                }}
            >
                {pipWindow ? (
                    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', alignItems: 'center', justifyContent: 'center', color: '#888' }}>
                        <p>Lyrics are displayed in the pop-out window.</p>
                        <button onClick={togglePiP} className="restore-btn">
                            Restore Lyrics to Main Window
                        </button>
                    </div>
                ) : (
                    <>
                        {isHoveringLyrics && (
                            <button
                                onClick={togglePiP}
                                style={{
                                    position: 'absolute',
                                    top: '10px',
                                    right: '10px',
                                    zIndex: 10,
                                    padding: '5px 10px',
                                    background: 'rgba(0,0,0,0.7)',
                                    border: '1px solid #666',
                                    color: '#fff',
                                    borderRadius: '4px',
                                    cursor: 'pointer',
                                    fontSize: '0.8em'
                                }}
                            >
                                Pop Out Lyrics
                            </button>
                        )}
                        {lyrics ? (
                            <LyricsList
                                lyrics={lyrics}
                                activeLineIndex={activeLineIndex}
                                currentTime={currentTime}
                                autoScroll={false}
                                onLineClick={handleLyricClick}
                            />
                        ) : <div style={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center', color: '#555' }}>No Lyrics Loaded</div>}
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
            const activeEl = containerRef.current.children[activeLineIndex] as HTMLElement;
            if (activeEl) {
                activeEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }
    }, [activeLineIndex, autoScroll]);

    return (
        <div ref={containerRef} style={{ position: 'relative', minHeight: '100%' }}>
            {lyrics.lines.map((line, idx) => {
                const isActive = idx === activeLineIndex;
                return (
                    <div
                        key={idx}
                        onClick={() => onLineClick && onLineClick(line.startTime)}
                        style={{
                            margin: '14px 0',
                            color: isActive ? '#4caf50' : '#888',
                            fontWeight: isActive ? 'bold' : 'normal',
                            fontSize: isActive ? '1.3em' : '1em',
                            transition: 'all 0.2s ease',
                            transform: isActive ? 'scale(1.05)' : 'scale(1)',
                            transformOrigin: 'center center',
                            textAlign: 'center',
                            cursor: 'pointer' // Add pointer cursor
                        }}
                    >
                        {line.syllables ? (
                            <div>
                                {line.syllables.map((syl, sylIdx) => {
                                    const sylAbsStart = line.startTime + syl.startTime;
                                    const sylAbsEnd = sylAbsStart + syl.duration;
                                    const isSylpassed = currentTime >= sylAbsEnd;
                                    const isSylActive = currentTime >= sylAbsStart && currentTime < sylAbsEnd;

                                    let sylColor = 'inherit';
                                    if (isActive) {
                                        if (isSylpassed) sylColor = '#4caf50';
                                        else if (isSylActive) sylColor = '#ffeb3b';
                                        else sylColor = '#fff';
                                    }

                                    return (
                                        <span
                                            key={sylIdx}
                                            style={{
                                                color: sylColor,
                                                transition: 'color 0.05s linear',
                                                marginRight: '4px',
                                                display: 'inline-block'
                                            }}
                                        >
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
