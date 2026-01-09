import { useEffect, useState, useRef } from 'react';
import { LyricsManager } from '@/core/services/LyricsManager';
import { SongInformation } from '@/core/interfaces/SongInformation';
import { NeteaseNetworkProvider } from "@/core/providers/NeteaseNetworkProvider";
import { LyricsData } from '@/core/models/LyricsData';
import { Logger, LogEntry } from '@/core/utils/Logger';

// Singleton instance for the app
const manager = new LyricsManager();
// manager.getSearcher().registerProvider(new MockNetworkProvider());
manager.getSearcher().registerProvider(new NeteaseNetworkProvider());

export default function App() {
    const [lyrics, setLyrics] = useState<LyricsData | null>(null);
    const [currentTime, setCurrentTime] = useState(0);
    const [activeLineIndex, setActiveLineIndex] = useState(-1);

    // Playback state
    const [audioSrc, setAudioSrc] = useState<string | null>(null);

    // Search form state
    const [searchTitle, setSearchTitle] = useState("Sample Song");
    const [searchArtist, setSearchArtist] = useState("Artist A");
    const [statusMsg, setStatusMsg] = useState("");
    const [logs, setLogs] = useState<LogEntry[]>([]);

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

    // Handle file selection
    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const file = e.target.files[0];
            const url = URL.createObjectURL(file);
            setAudioSrc(url);

            // Try to guess metadata from filename (Format: Artist - Title.mp3)
            const name = file.name.replace(/\.[^/.]+$/, "");
            if (name.includes("-")) {
                const parts = name.split("-");
                setSearchArtist(parts[0].trim());
                setSearchTitle(parts.slice(1).join("-").trim());
            } else {
                setSearchTitle(name);
                setSearchArtist("");
            }
            setStatusMsg("File loaded. Please check Title/Artist and Search Lyrics.");
            setCurrentTime(0);
        }
    };

    const handleSearch = async () => {
        if (!searchTitle) return;
        setStatusMsg("Searching...");
        setLyrics(null);

        const song: SongInformation = {
            title: searchTitle,
            artists: [searchArtist],
            album: "",
            duration: audioRef.current?.duration ? audioRef.current.duration * 1000 : 0,
            sourceId: "local"
        };

        const success = await manager.loadLyricsForSong(song);
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

            {/* File Input */}
            <div style={{ marginBottom: '20px', border: '1px dashed #666', padding: '10px' }}>
                <input type="file" accept="audio/*" onChange={handleFileSelect} />
            </div>

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
                <button onClick={handleSearch}>Search Lyrics</button>
            </div>

            <div style={{ color: '#aaa', marginBottom: '10px' }}>
                {statusMsg}
                {lyrics && lyrics.metadata && lyrics.metadata['source'] && (
                    <span style={{ marginLeft: '10px', fontSize: '0.8em', color: '#666', border: '1px solid #444', padding: '2px 6px', borderRadius: '4px' }}>
                        Source: {lyrics.metadata['source']}
                    </span>
                )}
            </div>

            {/* Native Audio Player */}
            {audioSrc && (
                <div style={{ marginBottom: '20px' }}>
                    <audio
                        ref={audioRef}
                        src={audioSrc}
                        controls
                        style={{ width: '100%' }}
                        onTimeUpdate={handleTimeUpdate}
                    />
                </div>
            )}

            {/* Manual Controls (Optional, synced with audio) */}
            {!audioSrc && (
                <div className="controls">
                    <p>Select a music file to start.</p>
                </div>
            )}

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

            {/* Lyrics View */}
            <div
                className="lyrics-view"
                ref={lyricsContainerRef}
                style={{
                    marginTop: '20px',
                    height: '400px',
                    overflowY: 'auto',
                    border: '1px solid #444',
                    padding: '20px',
                    borderRadius: '8px',
                    backgroundColor: '#1a1a1a',
                    position: 'relative'
                }}
            >
                {lyrics ? (
                    <div style={{ position: 'relative', minHeight: '100%' }}>
                        {lyrics.lines.map((line, idx) => {
                            const isActive = idx === activeLineIndex;
                            return (
                                <div
                                    key={idx}
                                    style={{
                                        margin: '14px 0',
                                        color: isActive ? '#4caf50' : '#888',
                                        fontWeight: isActive ? 'bold' : 'normal',
                                        fontSize: isActive ? '1.3em' : '1em',
                                        transition: 'all 0.2s ease',
                                        transform: isActive ? 'scale(1.05)' : 'scale(1)',
                                        transformOrigin: 'center center'
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
                                                // Inheritance manages base color (green or gray)
                                                // We only override for Karaoke effects

                                                if (isActive) {
                                                    if (isSylpassed) sylColor = '#4caf50'; // Finished
                                                    else if (isSylActive) sylColor = '#ffeb3b'; // Singing
                                                    else sylColor = '#fff'; // Waiting
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
                ) : <div style={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center', color: '#555' }}>No Lyrics Loaded</div>}
            </div>
        </div>
    )
}
