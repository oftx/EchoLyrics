
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
     */
    public async convertToWav(file: File): Promise<Blob> {
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

        // Run conversion
        // -i input -y (overwrite) output
        await ffmpeg.exec(['-i', inputName, outputName]);

        Logger.info(`[FFmpeg] Conversion done.`);

        // Read output
        const fileData = await ffmpeg.readFile(outputName);
        const dataArray = fileData as Uint8Array;

        const blob = new Blob([dataArray.buffer as ArrayBuffer], { type: 'audio/wav' });

        // Cleanup?
        // await ffmpeg.deleteFile(inputName);
        // await ffmpeg.deleteFile(outputName);

        return blob;
    }
}
