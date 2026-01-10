
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL } from '@ffmpeg/util';
import { Logger } from '../utils/Logger';

export class FFmpegConverter {
    private ffmpeg: FFmpeg | null = null;
    private loaded = false;

    public async load() {
        if (this.loaded) return;

        this.ffmpeg = new FFmpeg();

        // Listen to logs
        this.ffmpeg.on('log', ({ message }) => {
            Logger.info(`[FFmpeg] ${message}`);
        });

        Logger.info("[FFmpeg] Loading WASM from public/ffmpeg...");

        try {
            const baseURL = window.location.origin + '/ffmpeg';
            await this.ffmpeg.load({
                coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
                wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
            });

            this.loaded = true;
            Logger.info("[FFmpeg] Loaded successfully.");
        } catch (e) {
            Logger.error("[FFmpeg] Load failed", e);
            throw e;
        }
    }

    /**
     * Converts a file (e.g. m4a/alac) to a WAV Blob.
     * Also captures embedded lyrics from FFmpeg output.
     */
    public async convertToWav(file: File): Promise<{ blob: Blob; lyrics?: string }> {
        if (!this.ffmpeg || !this.loaded) {
            await this.load();
        }
        const ffmpeg = this.ffmpeg!;

        const fileName = 'input_audio';
        // Get extension
        const ext = file.name.split('.').pop() || 'm4a';
        const inputName = `${fileName}.${ext}`;
        const outputName = 'output.wav';

        // Write file to in-memory FS
        const data = await file.arrayBuffer();
        await ffmpeg.writeFile(inputName, new Uint8Array(data));

        Logger.info(`[FFmpeg] Starting conversion: ${inputName} -> ${outputName}`);

        // Capture logs during conversion to extract lyrics
        const logs: string[] = [];
        const logHandler = ({ message }: { message: string }) => {
            logs.push(message);
        };
        ffmpeg.on('log', logHandler);

        // Run conversion
        // -i input -y (overwrite) output
        await ffmpeg.exec(['-i', inputName, outputName]);

        ffmpeg.off('log', logHandler);

        Logger.info(`[FFmpeg] Conversion done.`);

        // Parse logs for lyrics
        let extractedLyrics: string | undefined;
        let collectedLyrics = "";
        let inLyrics = false;

        for (const line of logs) {
            const trimmed = line.trim();

            // Start of lyrics: "lyrics : [00:23.35]..."
            if (trimmed.startsWith('lyrics') && trimmed.includes(':')) {
                inLyrics = true;
                const firstColon = trimmed.indexOf(':');
                const content = trimmed.substring(firstColon + 1).trim();
                collectedLyrics += content + "\n";
                continue;
            }

            // Continuation lines: ": [00:26.00]..." or lines without a key
            if (inLyrics) {
                if (trimmed.startsWith(':')) {
                    collectedLyrics += trimmed.substring(1).trim() + "\n";
                } else if (/^\w+\s*:/.test(trimmed)) {
                    // Encountered next metadata key, stop collecting
                    inLyrics = false;
                }
            }
        }

        if (collectedLyrics.trim()) {
            Logger.info(`[FFmpeg] Extracted embedded lyrics from conversion logs!`);
            extractedLyrics = collectedLyrics.trim();
        }

        // Read output
        const fileData = await ffmpeg.readFile(outputName);
        const dataArray = fileData as Uint8Array;

        const blob = new Blob([dataArray.buffer as ArrayBuffer], { type: 'audio/wav' });

        return { blob, lyrics: extractedLyrics };
    }
    /**
     * Probes the file to extract metadata (specifically lyrics) from logs.
     */
    public async readMetadata(file: File): Promise<{ lyrics?: string }> {
        if (!this.ffmpeg || !this.loaded) {
            await this.load();
        }
        const ffmpeg = this.ffmpeg!;
        const fileName = 'probe_input';
        const ext = file.name.split('.').pop() || 'tmp';
        const inputName = `${fileName}.${ext}`;

        try {
            const data = await file.arrayBuffer();
            await ffmpeg.writeFile(inputName, new Uint8Array(data));

            const logs: string[] = [];

            // Temporary listener for this operation
            const logHandler = ({ message }: { message: string }) => {
                logs.push(message);
            };
            ffmpeg.on('log', logHandler);

            Logger.info(`[FFmpeg] Probing metadata for ${file.name}`);

            // We just need to probe, so we can run a command that outputs info.
            // 'ffmpeg -i input' typically exits with 1 because no output is specified, but prints logs.
            try {
                await ffmpeg.exec(['-i', inputName]);
            } catch (e) {
                // Ignore error, we expect it to fail due to missing output
            }

            ffmpeg.off('log', logHandler);
            await ffmpeg.deleteFile(inputName);

            // Parse logs for lyrics
            // Format seen: 
            // lyrics : [00:23.35]Line 1
            //        : [00:26.00]Line 2
            let collectedLyrics = "";
            let inLyrics = false;

            for (const line of logs) {
                const trimmed = line.trim();

                // Start of lyrics
                // Log format usually: "  lyrics          : [00:23.35]..."
                if (trimmed.startsWith('lyrics') && trimmed.includes(':')) {
                    inLyrics = true;
                    // Extract value after first colon
                    const firstColon = trimmed.indexOf(':');
                    const content = trimmed.substring(firstColon + 1).trim();
                    collectedLyrics += content + "\n";
                    continue;
                }

                // Continuation lines usually start with colon in the log output like "  : [timestamp]..."
                // OR they are just indented. The user logs showed: "[INFO][FFmpeg] : [00:26.00]..."
                // which implies the raw message was " : [00:26.00]..."
                if (inLyrics) {
                    // Heuristic: If it looks like a continuation (starts with : or just timestamp bracket)
                    // If it encounters another metadata key (e.g. "  genre           : ..."), stop.

                    // Check if it's a new key (roughly: word followed by colon)
                    // But strictly, continuation lines often start with whitespace then colon, or just whitespace.
                    // The user logs show ": [00....".

                    if (trimmed.startsWith(':')) {
                        collectedLyrics += trimmed.substring(1).trim() + "\n";
                    } else if (/^\w+\s*:/.test(trimmed)) {
                        // Encountered next key
                        inLyrics = false;
                    } else {
                        // Maybe just text line?
                        // If it looks like a lyric line (has timestamp or just text), add it?
                        collectedLyrics += trimmed + "\n";
                    }
                }
            }

            if (collectedLyrics.trim()) {
                Logger.info("[FFmpeg] Extracted lyrics from logs.");
                return { lyrics: collectedLyrics.trim() };
            }

            return {};

        } catch (e) {
            Logger.warn("[FFmpeg] Metadata probe failed", e);
            return {};
        }
    }
}
