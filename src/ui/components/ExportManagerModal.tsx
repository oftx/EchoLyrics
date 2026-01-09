
import React, { useState, useEffect, useMemo } from 'react';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { SongInformation } from '../../core/interfaces/SongInformation';
import { LyricsManager } from '../../core/services/LyricsManager';
import { LyricResult } from '../../core/interfaces/LyricResult';

interface ExportManagerModalProps {
    isOpen: boolean;
    onClose: () => void;
    playlist: { name: string; title?: string; artist?: string; lyricFile?: File }[];
    manager: LyricsManager;
}

interface ExportCandidate {
    index: number;
    song: SongInformation;
    cacheStatus: 'ready' | 'missing';
    lyric: LyricResult | null;
    checked: boolean;
}

export const ExportManagerModal: React.FC<ExportManagerModalProps> = ({ isOpen, onClose, playlist, manager }) => {
    const [candidates, setCandidates] = useState<ExportCandidate[]>([]);
    const [template, setTemplate] = useState("${lyricArtist} - ${lyricTitle}");
    const [providerFilter, setProviderFilter] = useState("All"); // All, Netease Cloud Music, ...
    const [isExporting, setIsExporting] = useState(false);

    // Initial Load & Refresh
    useEffect(() => {
        if (!isOpen) return;

        const loadCandidates = () => {
            const newCandidates: ExportCandidate[] = playlist.map((item, idx) => {
                const song: SongInformation = {
                    title: item.title || "",
                    artists: item.artist ? [item.artist] : [],
                    album: "",
                    duration: 0,
                    sourceId: "local_auto",
                    persistenceId: item.name
                };

                const cached = manager.getLyricFromCache(song);
                return {
                    index: idx,
                    song: song,
                    cacheStatus: cached ? 'ready' : 'missing',
                    lyric: cached,
                    checked: !!cached // Default check if ready
                };
            });
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
            // Only select if ready AND matches provider filter
            const matchesProvider = providerFilter === "All" || (c.lyric?.source === providerFilter);
            return { ...c, checked: c.cacheStatus === 'ready' && matchesProvider };
        }));
    };

    const generateFilename = (song: SongInformation, lyric: LyricResult | null, index: number) => {
        if (!lyric) return "unknown.lrc";
        let str = template;
        str = str.replace(/\$\{id\}/g, (index).toString().padStart(2, '0'));
        str = str.replace(/\$\{title\}/g, song.title || "Unknown");
        str = str.replace(/\$\{artist\}/g, (song.artists && song.artists[0]) || "Unknown");
        str = str.replace(/\$\{lyricTitle\}/g, lyric.title || "Unknown");
        str = str.replace(/\$\{lyricArtist\}/g, lyric.artist || "Unknown");
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
                if (item.cacheStatus === 'ready' && item.lyric) {
                    // Check provider filter again just in case
                    if (providerFilter !== "All" && item.lyric.source !== providerFilter) continue;

                    const filename = generateFilename(item.song, item.lyric, item.index + 1);
                    zip.file(filename, item.lyric.lyricText);
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
        <div style={{
            position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
            background: 'rgba(0,0,0,0.8)', zIndex: 2000, display: 'flex', justifyContent: 'center', alignItems: 'center'
        }}>
            <div style={{
                background: '#222', width: '90%', maxWidth: '900px', height: '80%', display: 'flex', flexDirection: 'column',
                borderRadius: '8px', border: '1px solid #444', color: '#eee', padding: '20px'
            }}>
                <h2 style={{ marginTop: 0 }}>Export Lyrics</h2>

                <div style={{ display: 'flex', gap: '20px', marginBottom: '20px', alignItems: 'flex-start' }}>
                    <div style={{ flex: 1 }}>
                        <label style={{ display: 'block', marginBottom: '5px' }}>Filename Template:</label>
                        <input
                            type="text"
                            value={template}
                            onChange={(e) => setTemplate(e.target.value)}
                            style={{ padding: '5px', width: '100%', boxSizing: 'border-box' }}
                        />
                        <div style={{ fontSize: '12px', color: '#888', marginTop: '4px' }}>
                            Supported: {'${id}'}, {'${title}'}, {'${artist}'}, {'${lyricTitle}'}, {'${lyricArtist}'}
                        </div>
                    </div>
                    <div>
                        <label style={{ display: 'block', marginBottom: '5px' }}>Provider Filter:</label>
                        <select
                            value={providerFilter}
                            onChange={e => setProviderFilter(e.target.value)}
                            style={{ marginLeft: '10px', padding: '5px' }}
                        >
                            <option value="All">All Providers</option>
                            <option value="Netease Cloud Music">Netease Cloud Music</option>
                            {/* Can add more if we had them */}
                        </select>
                    </div>
                </div>

                <div style={{ marginBottom: '10px' }}>
                    <button onClick={() => handleSelectAll(true)}>Select All</button>
                    <button onClick={() => handleSelectAll(false)} style={{ marginLeft: '10px' }}>Select None</button>
                    <button onClick={handleSelectReady} style={{ marginLeft: '10px' }}>Select Ready & Matched</button>
                    <button onClick={() => setCandidates(c => c.map(x => ({ ...x, checked: !x.checked })))} style={{ marginLeft: '10px' }}>Invert</button>
                </div>

                <div style={{ flex: 1, overflowY: 'auto', border: '1px solid #444' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
                        <thead style={{ background: '#333', position: 'sticky', top: 0 }}>
                            <tr>
                                <th style={{ padding: '8px', textAlign: 'left' }}>#</th>
                                <th style={{ padding: '8px', textAlign: 'left' }}>Select</th>
                                <th style={{ padding: '8px', textAlign: 'left' }}>Song</th>
                                <th style={{ padding: '8px', textAlign: 'left' }}>Artist</th>
                                <th style={{ padding: '8px', textAlign: 'left' }}>Matched Title</th>
                                <th style={{ padding: '8px', textAlign: 'left' }}>Matched Artist</th>
                                <th style={{ padding: '8px', textAlign: 'left' }}>Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            {displayedCandidates.map((c, idx) => {
                                const isReady = c.cacheStatus === 'ready';
                                const matchesProvider = c.isMatch;
                                const effectiveReady = isReady && matchesProvider;
                                return (
                                    <tr key={idx} style={{ borderBottom: '1px solid #333', background: idx % 2 === 0 ? 'transparent' : '#2a2a2a' }}>
                                        <td style={{ padding: '8px' }}>{c.index + 1}</td>
                                        <td style={{ padding: '8px' }}>
                                            <input
                                                type="checkbox"
                                                checked={c.checked}
                                                onChange={() => handleToggle(idx)}
                                                disabled={!effectiveReady}
                                            />
                                        </td>
                                        <td style={{ padding: '8px' }}>{c.song.title}</td>
                                        <td style={{ padding: '8px' }}>{c.song.artists[0]}</td>
                                        <td style={{ padding: '8px', color: '#aaa' }}>{c.lyric?.title}</td>
                                        <td style={{ padding: '8px', color: '#aaa' }}>{c.lyric?.artist}</td>
                                        <td style={{ padding: '8px', color: effectiveReady ? '#4caf50' : '#f44336' }}>
                                            {effectiveReady ? "Ready" : (isReady ? "Provider Mismatch" : "Missing")}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>

                <div style={{ marginTop: '20px', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                    <button onClick={onClose} style={{ padding: '8px 20px', background: 'transparent', border: '1px solid #666', color: '#fff' }}>Close</button>
                    <button
                        onClick={handleExport}
                        disabled={isExporting}
                        style={{ padding: '8px 20px', background: '#4caf50', border: 'none', color: '#fff', cursor: 'pointer' }}
                    >
                        {isExporting ? "Exporting..." : "Export Selection"}
                    </button>
                </div>
            </div>
        </div>
    );
};
