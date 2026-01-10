
import { parseBlob } from 'music-metadata';
import { Logger } from '../utils/Logger';

export interface AudioMetadata {
    title?: string;
    artist?: string;
    album?: string;
    lyrics?: string; // Embedded lyrics
    picture?: Blob; // Album art (future use)
}

export class MetadataService {

    /**
     * Parse metadata from an audio file.
     * Returns partial metadata (what is found).
     */
    public async parse(file: File): Promise<AudioMetadata> {
        try {
            // parseBlob takes the file (which is a Blob)
            const metadata = await parseBlob(file);
            const common = metadata.common;

            const result: AudioMetadata = {};

            if (common.title) result.title = common.title;
            if (common.artist) result.artist = common.artist;
            if (common.album) result.album = common.album;

            // PRIORITY 1: Check native tags for ©lyr which contains TIMESTAMPED lyrics (LRC format)
            if (metadata.native) {
                for (const [tagType, tags] of Object.entries(metadata.native)) {
                    for (const tag of tags) {
                        // ©lyr is iTunes standard for lyrics with timestamps
                        if (tag.id === '©lyr' && tag.value) {
                            Logger.info(`[Metadata] Found timestamped lyrics in native ${tagType}:©lyr`);
                            result.lyrics = String(tag.value);
                            break;
                        }
                    }
                    if (result.lyrics) break;
                }
            }

            // PRIORITY 2: If no native ©lyr, check common.lyrics (may not have timestamps)
            if (!result.lyrics && common.lyrics && common.lyrics.length > 0) {
                Logger.info(`[Metadata] Using common.lyrics (may lack timestamps)`);
                result.lyrics = common.lyrics[0].text;
            }

            // PRIORITY 3: Aggressive search in other native tags (USLT, etc.)
            if (!result.lyrics && metadata.native) {
                Logger.info(`[Metadata] Starting fallback search in native tags for ${file.name}`);
                for (const [tagType, tags] of Object.entries(metadata.native)) {
                    for (const tag of tags) {
                        const id = tag.id ? String(tag.id).toLowerCase() : "";
                        if (
                            (id === 'uslt' || id === 'unsynced lyrics' || id === 'unsyncedlyrics' || id === 'lyrics') &&
                            tag.value
                        ) {
                            Logger.info(`[Metadata] Found fallback lyrics in ${tagType} tag: ${tag.id}`);
                            if (typeof tag.value === 'object' && 'text' in (tag.value as any)) {
                                result.lyrics = (tag.value as any).text;
                            } else {
                                result.lyrics = String(tag.value);
                            }
                            break;
                        }
                    }
                    if (result.lyrics) break;
                }
            }

            // Final Fallback: FFmpeg Probe
            if (!result.lyrics) {
                Logger.info(`[Metadata] Lyrics still missing. Attempting FFmpeg probe for ${file.name}`);
                try {
                    const { FFmpegConverter } = await import('./FFmpegConverter');
                    const converter = new FFmpegConverter();
                    await converter.load();
                    const ffMetadata = await converter.readMetadata(file);
                    if (ffMetadata.lyrics) {
                        Logger.info(`[Metadata] FFmpeg probe found lyrics!`);
                        result.lyrics = ffMetadata.lyrics;
                    }
                } catch (e) {
                    Logger.warn(`[Metadata] FFmpeg fallback failed`, e);
                }
            }

            // Final debug logging
            if (result.lyrics) {
                Logger.info(`[Metadata] Successfully extracted lyrics. Length: ${result.lyrics.length}`);
            } else {
                Logger.warn(`[Metadata] FAILED to extract lyrics after aggressive search AND FFmpeg probe.`);
                // Dump all tags for debugging if still missing
                Logger.warn(`[Metadata] Full Native Dump:`, JSON.stringify(metadata.native, (key, value) => {
                    if (key === 'data') return '[Binary Data]';
                    return value;
                }));
            }

            return result;
        } catch (error) {
            Logger.warn(`[Metadata] Failed to parse ${file.name}`, error);
            return {};
        }
    }
}
