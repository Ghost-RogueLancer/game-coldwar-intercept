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
  const usable: AirTrack[] = [];
  for (const track of candidates) {
    if (!track || !Number.isFinite(track.lastUpdate) || track.lastUpdate > input.time ||
        input.time - track.lastUpdate > 5 || !Number.isFinite(track.quality) || track.quality < .2 ||
        !Number.isFinite(track.uncertainty) || track.uncertainty < 0 ||
        ![track.position.x, track.position.y, track.position.z].every(Number.isFinite)) continue;
    usable.push(track);
  }
  // Anchor the quality tie window on the freshest admissible observation, so
  // chained pairwise ties cannot select a much older observation by iteration order.
  const freshest = Math.max(...usable.map(track => track.lastUpdate));
  const best = usable.filter(track => freshest - track.lastUpdate < .5)
    .sort((a, b) => b.quality - a.quality || a.uncertainty - b.uncertainty || b.lastUpdate - a.lastUpdate)[0];
  return best?.position.clone();
}
