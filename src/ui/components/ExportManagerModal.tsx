
import React, { useState, useEffect, useMemo } from 'react';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { SongInformation } from '../../core/interfaces/SongInformation';
import { LyricsManager } from '../../core/services/LyricsManager';
import { LyricResult } from '../../core/interfaces/LyricResult';
import { MetadataService } from '../../core/services/MetadataService';

interface ExportManagerModalProps {
    isOpen: boolean;
    onClose: () => void;
    playlist: { name: string; title?: string; artist?: string; lyricFile?: File; audioFile: File }[];
    manager: LyricsManager;
}

interface ExportCandidate {
    index: number;
    song: SongInformation;
    cacheStatus: 'ready' | 'missing' | 'embedded';
    lyric: LyricResult | null;
    checked: boolean;
    embeddedLyrics?: string;
    metadataTitle?: string;
    metadataArtist?: string;
}

export const ExportManagerModal: React.FC<ExportManagerModalProps> = ({ isOpen, onClose, playlist, manager }) => {
    const [candidates, setCandidates] = useState<ExportCandidate[]>([]);
    const [template, setTemplate] = useState("${lyricArtist} - ${lyricTitle}");
    const [providerFilter, setProviderFilter] = useState("All"); // All, Netease Cloud Music, ...
    const [availableProviders, setAvailableProviders] = useState<string[]>([]);
    const [isExporting, setIsExporting] = useState(false);
    const [isScanning, setIsScanning] = useState(false);

    // Initial Load & Refresh
    useEffect(() => {
        if (!isOpen) return;

        const loadCandidates = async () => {
            const providers = manager.getProviders();
            setAvailableProviders(providers.map(p => p.name));

            const metadataService = new MetadataService();
            const newCandidates: ExportCandidate[] = [];

            for (let idx = 0; idx < playlist.length; idx++) {
                const item = playlist[idx];
                const song: SongInformation = {
                    title: item.title || item.name.replace(/\.[^/.]+$/, ''),
                    artists: item.artist ? [item.artist] : [],
                    album: "",
                    duration: 0,
                    sourceId: "local_auto",
                    persistenceId: item.name
                };

                // Check cache first
                const cached = manager.getLyricFromCache(song);

                if (cached) {
                    newCandidates.push({
                        index: idx,
                        song: song,
                        cacheStatus: 'ready',
                        lyric: cached,
                        checked: true,
                        // For cached items, we don't strictly have the separate metadata handy unless we re-parse,
                        // but the 'song' object itself is already constructed from metadata if available (cached song objects usually are).
                        // However, strictly speaking, if it's cached, the 'Matched' columns will use the cached lyric info anyway.
                        // If we want to show metadata fallback for Matched columns even when cached, we'd need to parse.
                        // For optimization, we'll assume if it's cached, we rely on the cached matches.
                    });
                } else {
                    // Try to get embedded lyrics and metadata from audio file
                    let embeddedLyrics: string | undefined;
                    let metaTitle: string | undefined;
                    let metaArtist: string | undefined;
                    try {
                        const metadata = await metadataService.parse(item.audioFile, { deepScan: false });
                        if (metadata.lyrics) {
                            embeddedLyrics = metadata.lyrics;
                        }
                        // Get title/artist from metadata for export naming
                        if (metadata.title) metaTitle = metadata.title;
                        if (metadata.artist) metaArtist = metadata.artist;
                    } catch (e) {
                        // Ignore parsing errors
                    }

                    // Update song info with metadata (fallback to playlist item info, then filename)
                    const updatedSong: SongInformation = {
                        ...song,
                        title: metaTitle || item.title || item.name.replace(/\.[^/.]+$/, ''),
                        artists: metaArtist ? [metaArtist] : (item.artist ? [item.artist] : [])
                    };

                    newCandidates.push({
                        index: idx,
                        song: updatedSong,
                        cacheStatus: embeddedLyrics ? 'embedded' : 'missing',
                        lyric: null,
                        checked: !!embeddedLyrics,
                        embeddedLyrics: embeddedLyrics,
                        metadataTitle: metaTitle,
                        metadataArtist: metaArtist
                    });
                }
            }
            setCandidates(newCandidates);
        };

        loadCandidates();
    }, [isOpen, playlist, manager]);

    // Filtering Logic (Effects which items satisfy the "Readiness" criteria based on Provider)
    // We don't hide items, we just update their 'Status' column display or availability.
    // Actually, 'cacheStatus' is absolute. 'providerFilter' affects whether we consider it "Exportable".

    const displayedCandidates = useMemo(() => {
        return candidates.map(c => {
            const isMatch = providerFilter === "All" || (c.lyric?.source === providerFilter);
            return {
                ...c,
                isMatch // Helper to know if it passes filter
            };
        });
    }, [candidates, providerFilter]);

    const handleToggle = (index: number) => {
        setCandidates(prev => {
            const next = [...prev];
            next[index] = { ...next[index], checked: !next[index].checked };
            return next;
        });
    };

    const handleSelectAll = (select: boolean) => {
        setCandidates(prev => prev.map(c => ({ ...c, checked: select })));
    };

    const handleSelectReady = () => {
        setCandidates(prev => prev.map(c => {
            // Select if ready or embedded AND matches provider filter (embedded always matches)
            const matchesProvider = providerFilter === "All" || (c.lyric?.source === providerFilter);
            const isExportable = (c.cacheStatus === 'ready' && matchesProvider) || c.cacheStatus === 'embedded';
            return { ...c, checked: isExportable };
        }));
    };

    const handleDeepScan = async () => {
        setIsScanning(true);
        const metadataService = new MetadataService();

        // Find candidates that are missing lyrics
        const missingIndices = candidates
            .map((c, i) => (c.cacheStatus === 'missing' ? i : -1))
            .filter(i => i !== -1);

        if (missingIndices.length === 0) {
            alert("No missing lyrics to scan.");
            setIsScanning(false);
            return;
        }

        // Process in chunks or parallel? Sequential is safer for FFmpeg single core
        // But the MetadataService creates new instance... wait, FFmpegConverter is single instance? 
        // MetadataService imports FFmpegConverter dynamically. 
        // FFmpegConverter is a class. If we instantiate new one each time, it might be heavy.
        // But let's stick to simple sequential for now.

        const newCandidates = [...candidates];

        for (const idx of missingIndices) {
            const item = playlist[idx]; // We need original file
            // Oh wait, candidates doesn't store the File object directly in 'song'.
            // But 'playlist' prop has it.
            if (!item) continue;

            try {
                // Force deep scan
                const metadata = await metadataService.parse(item.audioFile, { deepScan: true });
                if (metadata.lyrics) {
                    // Update candidate
                    newCandidates[idx] = {
                        ...newCandidates[idx],
                        cacheStatus: 'embedded',
                        embeddedLyrics: metadata.lyrics,
                        // If we found new metadata, maybe update title/artist too?
                        metadataTitle: metadata.title || newCandidates[idx].metadataTitle,
                        metadataArtist: metadata.artist || newCandidates[idx].metadataArtist,
                        checked: true // Auto-select found ones
                    };
                    // Force update UI incrementally if we want? 
                    // React batching might hide it, but let's set it at the end or use functional update if needed.
                    // For better UX, let's update state every item or every few items.
                    setCandidates([...newCandidates]);
                }
            } catch (e) {
                console.warn("Deep scan failed for", item.name, e);
            }
        }

        setCandidates(newCandidates);
        setIsScanning(false);
    };

    const generateFilename = (song: SongInformation, lyric: LyricResult | null, index: number) => {
        let str = template;
        str = str.replace(/\$\{id\}/g, (index).toString().padStart(2, '0'));
        str = str.replace(/\$\{title\}/g, song.title || "Unknown");
        str = str.replace(/\$\{artist\}/g, (song.artists && song.artists[0]) || "Unknown");
        str = str.replace(/\$\{lyricTitle\}/g, lyric?.title || song.title || "Unknown");
        str = str.replace(/\$\{lyricArtist\}/g, lyric?.artist || (song.artists && song.artists[0]) || "Unknown");
        // Sanitize
        return str.replace(/[<>:"/\\|?*]/g, "_") + ".lrc";
    };

    const handleExport = async () => {
        setIsExporting(true);
        try {
            const zip = new JSZip();
            const selected = candidates.filter(c => c.checked);
            let count = 0;

            for (const item of selected) {
                let lyricText: string | null = null;

                if (item.cacheStatus === 'ready' && item.lyric) {
                    // Check provider filter
                    if (providerFilter !== "All" && item.lyric.source !== providerFilter) continue;
                    lyricText = item.lyric.lyricText;
                } else if (item.cacheStatus === 'embedded' && item.embeddedLyrics) {
                    // Embedded lyrics bypass provider filter
                    lyricText = item.embeddedLyrics;
                }

                if (lyricText) {
                    const filename = generateFilename(item.song, item.lyric, item.index + 1);
                    zip.file(filename, lyricText);
                    count++;
                }
            }

            if (count === 0) {
                alert("No valid lyrics selected for export.");
                setIsExporting(false);
                return;
            }

            const blob = await zip.generateAsync({ type: "blob" });
            saveAs(blob, "lyrics_export.zip");
            onClose();
        } catch (e) {
            console.error("Export failed", e);
            alert("Export failed: " + e);
        } finally {
            setIsExporting(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="modal-overlay">
            <div className="modal-content modal-content--export">
                <div className="modal-header">
                    <h2 className="modal-title">Export Lyrics</h2>
                </div>

                <div className="modal-body">
                    <div style={{ display: 'flex', gap: 'var(--space-5)', marginBottom: 'var(--space-5)', alignItems: 'flex-start' }}>
                        <div style={{ flex: 1 }}>
                            <label className="input-label">Filename Template:</label>
                            <input
                                type="text"
                                className="input"
                                value={template}
                                onChange={(e) => setTemplate(e.target.value)}
                            />
                            <div className="text-muted" style={{ fontSize: 'var(--text-xs)', marginTop: 'var(--space-1)' }}>
                                Supported: {'${id}'}, {'${title}'}, {'${artist}'}, {'${lyricTitle}'}, {'${lyricArtist}'}
                            </div>
                        </div>
                        <div>
                            <label className="input-label">Provider Filter:</label>
                            <select
                                value={providerFilter}
                                onChange={e => setProviderFilter(e.target.value)}
                                className="input select"
                            >
                                <option value="All">All Providers</option>
                                {availableProviders.map(p => (
                                    <option key={p} value={p}>{p}</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    <div className="controls-bar" style={{ justifyContent: 'flex-start', marginBottom: 'var(--space-4)' }}>
                        <button className="btn btn-ghost btn-sm" onClick={() => handleSelectAll(true)}>Select All</button>
                        <button className="btn btn-ghost btn-sm" onClick={() => handleSelectAll(false)}>Select None</button>
                        <button className="btn btn-ghost btn-sm" onClick={handleSelectReady}>Select Ready</button>
                        <button className="btn btn-ghost btn-sm" onClick={() => setCandidates(c => c.map(x => ({ ...x, checked: !x.checked })))}>Invert</button>
                        <button
                            className="btn btn-secondary btn-sm"
                            onClick={handleDeepScan}
                            disabled={isScanning}
                            style={{ marginLeft: 'auto' }}
                        >
                            {isScanning ? "Scanning..." : "Deep Scan Missing"}
                        </button>
                    </div>

                    <div className="table-wrapper" style={{ flex: 1, overflowY: 'auto' }}>
                        <table className="table">
                            <thead>
                                <tr>
                                    <th>#</th>
                                    <th>Select</th>
                                    <th>Song</th>
                                    <th>Artist</th>
                                    <th>Matched Title</th>
                                    <th>Matched Artist</th>
                                    <th>Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                {displayedCandidates.map((c, idx) => {
                                    const isReady = c.cacheStatus === 'ready';
                                    const isEmbedded = c.cacheStatus === 'embedded';
                                    const matchesProvider = c.isMatch;
                                    const effectiveReady = (isReady && matchesProvider) || isEmbedded;
                                    const statusClass = effectiveReady ? 'table-status--ready' : (isReady ? 'table-status--mismatch' : 'table-status--missing');
                                    const statusText = isEmbedded ? 'Embedded' : (effectiveReady ? 'Ready' : (isReady ? 'Provider Mismatch' : 'Missing'));
                                    return (
                                        <tr key={idx}>
                                            <td>{c.index + 1}</td>
                                            <td>
                                                <input
                                                    type="checkbox"
                                                    checked={c.checked}
                                                    onChange={() => handleToggle(idx)}
                                                    disabled={!effectiveReady}
                                                />
                                            </td>
                                            <td>{c.song.title}</td>
                                            <td className="text-secondary">{c.song.artists[0]}</td>
                                            <td className="text-muted">{c.lyric?.title || c.metadataTitle || ''}</td>
                                            <td className="text-muted">{c.lyric?.artist || c.metadataArtist || ''}</td>
                                            <td className={statusClass}>
                                                {statusText}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>

                <div className="modal-footer">
                    <button className="btn btn-ghost" onClick={onClose}>Close</button>
                    <button
                        className="btn btn-primary"
                        onClick={handleExport}
                        disabled={isExporting}
                    >
                        {isExporting ? "Exporting..." : "Export Selection"}
                    </button>
                </div>
            </div>
        </div>
    );
};
