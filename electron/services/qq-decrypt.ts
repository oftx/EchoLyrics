import zlib from 'zlib';
import { manualTripleDesDecrypt } from '../utils/QQMusicCrypto';

const QRC_KEY = Buffer.from("!@#)(*$%123ZXC!@!@#)(NHL");

export async function fetchQQWithDecrypt(relativePath: string, queryParams: any) {
    const songid = queryParams.songid;
    const title = queryParams.title || '';
    const artist = queryParams.artist || '';
    const album = queryParams.album || '';
    const duration = parseInt(queryParams.duration || '0', 10);

    if (!songid) {
        throw new Error('Missing songid');
    }

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
                songID: Number(songid),
                songName: Buffer.from(title).toString('base64'),
                singerName: Buffer.from(artist).toString('base64'),
                albumName: Buffer.from(album).toString('base64'),
                interval: duration,
                qrc: 1,
                qrc_t: 0,
                crypt: 1,
                roma: 1,
                trans: 1,
                type: 0
            }
        }
    };

    const targetUrl = 'https://u.y.qq.com/cgi-bin/musicu.fcg';

    // Use Node.js native fetch (v18+)
    const response = await fetch(targetUrl, {
        method: 'POST',
        body: JSON.stringify(postPayload),
        headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'okhttp/3.14.9',
            'Cookie': 'tmeLoginType=-1;',
            'Referer': 'https://y.qq.com/'
        }
    });

    if (!response.ok) {
        throw new Error(`QQ API failed with status ${response.status}`);
    }

    const json: any = await response.json();

    // Extract data
    const data = json?.request?.data || {};

    // Decrypt
    if (data.lyric) {
        data.lyric = processLyric(data.lyric);
    }
    if (data.trans) {
        data.trans = processLyric(data.trans);
    }

    return data;
}

function processLyric(input: string): string {
    if (!input) return "";

    // Check if Hex (Encrypted QRC)
    if (/^[0-9a-fA-F]+$/.test(input)) {
        try {
            const dec = decryptQrc(input);
            return dec || "";
        } catch (e) {
            // console.warn("[QQDecrypt] Failed to decrypt hex, trying base64 fallback");
        }
    }

    // Fallback: Base64 Decode
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

        // Zlib Decompress
        const result = zlib.inflateSync(decryptedBytes);
        return result.toString('utf-8');
    } catch (e) {
        console.error('[QQDecrypt] Decryption failed:', e);
        return null;
    }
}
