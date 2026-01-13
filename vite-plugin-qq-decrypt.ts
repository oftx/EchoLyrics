import { Plugin, ViteDevServer } from 'vite';
import zlib from 'zlib';
import https from 'https';
import { manualTripleDesDecrypt } from './src/core/utils/QQMusicCrypto';

export function qqMusicDecryptPlugin(): Plugin {
    return {
        name: 'vite-plugin-qq-decrypt',
        configureServer(server: ViteDevServer) {
            server.middlewares.use('/api/qq-decrypt', async (req, res, next) => {
                const url = new URL(req.url || '', `http://${req.headers.host}`);
                const songmid = url.searchParams.get('songmid');
                const songid = url.searchParams.get('songid');

                if (!songmid) {
                    res.statusCode = 400;
                    res.end(JSON.stringify({ error: 'Missing songmid' }));
                    return;
                }

                try {
                    // Extract metadata from query
                    const title = url.searchParams.get('title') || '';
                    const artist = url.searchParams.get('artist') || '';
                    const album = url.searchParams.get('album') || '';
                    const duration = parseInt(url.searchParams.get('duration') || '0', 10);

                    // Use POST API (GetPlayLyricInfo) to get QRC
                    const postPayload = {
                        comm: {
                            ct: 11,
                            cv: "1003006",
                            v: "1003006",
                            os_ver: "15",
                            phonetype: "24122RKC7C",
                            tmeAppID: "qqmusiclight",
                            nettype: "NETWORK_WIFI",
                            udid: "0"
                        },
                        request: {
                            method: "GetPlayLyricInfo",
                            module: "music.musichallSong.PlayLyricInfo",
                            param: {
                                songID: Number(songid || 0),
                                songName: Buffer.from(title).toString('base64'),
                                singerName: Buffer.from(artist).toString('base64'),
                                albumName: Buffer.from(album).toString('base64'),
                                interval: duration, // seconds
                                qrc: 1, // Request QRC
                                qrc_t: 0,
                                crypt: 1, // Request Encrypted
                                roma: 1,
                                trans: 1,
                                type: 0
                            }
                        }
                    };

                    const fetchLyrics = () => new Promise<any>((resolve, reject) => {
                        const targetUrl = new URL('https://u.y.qq.com/cgi-bin/musicu.fcg');
                        const body = JSON.stringify(postPayload);

                        const request = https.request(targetUrl, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'Content-Length': Buffer.byteLength(body),
                                'User-Agent': 'okhttp/3.14.9',
                                'Cookie': 'tmeLoginType=-1;',
                                'Referer': 'https://y.qq.com/'
                            }
                        }, (response) => {
                            let data = '';
                            response.on('data', (chunk) => data += chunk);
                            response.on('end', () => {
                                try {
                                    resolve(JSON.parse(data));
                                } catch (e) {
                                    resolve({});
                                }
                            });
                        });
                        request.on('error', reject);
                        request.write(body);
                        request.end();
                    });

                    const response = await fetchLyrics();

                    // Extract data from the nested response structure
                    // response.request.data if success
                    const data = response?.request?.data || {};

                    // Decrypt if present
                    if (data.lyric) {
                        data.lyric = processLyric(data.lyric);
                    }
                    if (data.trans) {
                        data.trans = processLyric(data.trans);
                    }

                    res.setHeader('Content-Type', 'application/json');
                    res.end(JSON.stringify(data));

                } catch (error) {
                    console.error('[QQDecrypt] Error:', error);
                    res.statusCode = 500;
                    res.end(JSON.stringify({ error: 'Internal Server Error' }));
                }
            });
        }
    };
}

const QRC_KEY = Buffer.from("!@#)(*$%123ZXC!@!@#)(NHL");

function processLyric(input: string): string {
    if (!input) return "";

    // Check if Hex (Encrypted QRC)
    if (/^[0-9a-fA-F]+$/.test(input)) {
        try {
            return decryptQrc(input) || "";
        } catch (e) {
            console.warn("[QQDecrypt] Failed to decrypt hex, trying base64 fallback");
        }
    }

    // Fallback: Base64 Decode (Standard LRC)
    try {
        return Buffer.from(input, 'base64').toString('utf-8');
    } catch {
        return input;
    }
}

function decryptQrc(hexString: string): string | null {
    if (!hexString) return null;

    try {
        const encryptedBytes = Buffer.from(hexString, 'hex');
        const decryptedBytes = manualTripleDesDecrypt(encryptedBytes, QRC_KEY);

        // Zlib Decompress (inflateSync for raw Deflate)
        const result = zlib.inflateSync(decryptedBytes);
        return result.toString('utf-8');
    } catch (e) {
        console.error('[QQDecrypt] Decryption failed:', e);
        return null;
    }
}
