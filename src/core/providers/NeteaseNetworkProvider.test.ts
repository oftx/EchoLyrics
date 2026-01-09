import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NeteaseNetworkProvider } from './NeteaseNetworkProvider';
import { SongInformation } from '../interfaces/SongInformation';

// Mock global fetch
const globalFetch = global.fetch;

describe('NeteaseNetworkProvider', () => {
    let provider: NeteaseNetworkProvider;

    beforeEach(() => {
        provider = new NeteaseNetworkProvider();
        global.fetch = vi.fn();
    });

    afterEach(() => {
        global.fetch = globalFetch;
    });

    it('should be named Netease Cloud Music', () => {
        expect(provider.name).toBe('Netease Cloud Music');
    });

    it('should return empty list if search API fails', async () => {
        const song: SongInformation = {
            title: 'Test Song',
            artists: ['Test Artist'],
            album: 'Test Album',
            duration: 120000,
            sourceId: '1'
        };

        // Mock search response error
        (global.fetch as any).mockResolvedValueOnce({
            json: () => Promise.resolve({ code: 500 })
        });

        const results = await provider.search(song);
        expect(results).toEqual([]);
    });

    it('should return empty list if no songs found', async () => {
        const song: SongInformation = {
            title: 'Nonexistent Song',
            artists: ['Nobody'],
            album: '',
            duration: 0,
            sourceId: '1'
        };

        // Mock empty search result
        (global.fetch as any).mockResolvedValueOnce({
            json: () => Promise.resolve({
                code: 200,
                result: { songs: [] }
            })
        });

        const results = await provider.search(song);
        expect(results).toEqual([]);
    });

    it('should fetch and parse lyrics for found songs', async () => {
        const song: SongInformation = {
            title: 'Halo',
            artists: ['Beyonce'],
            album: 'I Am... Sascha Fierce',
            duration: 261000,
            sourceId: '1'
        };

        // 1. Mock Search Response
        (global.fetch as any).mockResolvedValueOnce({
            json: () => Promise.resolve({
                code: 200,
                result: {
                    songs: [
                        {
                            id: 12345,
                            name: 'Halo',
                            ar: [{ name: 'Beyoncé' }],
                            al: { name: 'I Am... Sascha Fierce' },
                            dt: 261000
                        }
                    ]
                }
            })
        });

        // 2. Mock Lyric Response
        (global.fetch as any).mockResolvedValueOnce({
            json: () => Promise.resolve({
                code: 200,
                lrc: {
                    lyric: '[00:00.00]Hello world'
                }
            })
        });

        const results = await provider.search(song);

        expect(results).toHaveLength(1);
        expect(results[0].id).toBe('12345');
        expect(results[0].title).toBe('Halo');
        expect(results[0].artist).toBe('Beyoncé');
        expect(results[0].lyricText).toBe('[00:00.00]Hello world');
    });

    it('should filter out songs where generic lyric fetch fails', async () => {
        const song: SongInformation = {
            title: 'Halo',
            artists: ['Beyonce'],
            album: '',
            duration: 0,
            sourceId: '1'
        };

        // 1. Mock Search Response (2 songs)
        (global.fetch as any).mockResolvedValueOnce({
            json: () => Promise.resolve({
                code: 200,
                result: {
                    songs: [
                        { id: 101, name: 'S1', ar: [], al: {}, dt: 0 },
                        { id: 102, name: 'S2', ar: [], al: {}, dt: 0 }
                    ]
                }
            })
        });

        // 2. Mock Lyric Response for S1 (Failure)
        (global.fetch as any).mockResolvedValueOnce({
            json: () => Promise.resolve({ code: 404 })
        });

        // 3. Mock Lyric Response for S2 (Success)
        (global.fetch as any).mockResolvedValueOnce({
            json: () => Promise.resolve({
                code: 200,
                lrc: { lyric: '[00:00]Success' }
            })
        });

        const results = await provider.search(song);
        expect(results).toHaveLength(1);
        expect(results[0].id).toBe('102');
    });
});
