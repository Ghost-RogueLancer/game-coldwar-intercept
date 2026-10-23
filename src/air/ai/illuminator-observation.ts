import type { AirTrack } from "../types.js";

// Shared with outgoing reports: network identities are opaque track numbers,
// never a lookup into authoritative aircraft positions.
export function tacticalTrackNumber(targetId: string) {
  let hash = 2166136261;
  for (const character of targetId) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `T-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function observedIlluminatorPosition(input: {
  shooterId: string;
  guidance: string;
  tracks: ReadonlyMap<string, AirTrack>;
  networkTracks: ReadonlyMap<string, AirTrack>;
  time: number;
}) {
  if (input.guidance !== "semi-active-radar") return undefined;
  const number = tacticalTrackNumber(input.shooterId);
  const candidates = [input.tracks.get(input.shooterId),
    input.networkTracks.get(`link16:${number}`), input.networkTracks.get(`link11:${number}`)];
  let best: AirTrack | undefined;
  for (const track of candidates) {
    if (!track || !Number.isFinite(track.lastUpdate) || track.lastUpdate > input.time ||
        input.time - track.lastUpdate > 5 || !Number.isFinite(track.quality) || track.quality < .2 ||
        !Number.isFinite(track.uncertainty) || track.uncertainty < 0 ||
        ![track.position.x, track.position.y, track.position.z].every(Number.isFinite)) continue;
    if (!best || (Math.abs(track.lastUpdate - best.lastUpdate) < .5
      ? track.quality > best.quality || (track.quality === best.quality && track.uncertainty < best.uncertainty)
      : track.lastUpdate > best.lastUpdate)) best = track;
  }
  return best?.position.clone();
}
