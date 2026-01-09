import { LyricsProvider } from "../interfaces/LyricsProvider";
import { LyricResult } from "../interfaces/LyricResult";
import { SongInformation } from "../interfaces/SongInformation";

export class MockNetworkProvider implements LyricsProvider {
    public name = "MockNetwork";

    public async search(song: SongInformation): Promise<LyricResult[]> {
        // Simulate network delay
        await new Promise(resolve => setTimeout(resolve, 500));

        // Return a dummy result that effectively matches
        return [{
            lyricText: "[00:00.00]Mock <00:00.00>Lyrics <00:00.50>for <00:01.00>Karaoke <00:01.50>Mode <00:02.00>Testing",
            source: this.name,
            score: 0, // Will be calculated by service
            title: song.title,
            artist: song.artists[0],
            album: song.album
        }];
    }
}
