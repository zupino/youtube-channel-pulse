const API_ROOT = "https://www.googleapis.com/youtube/v3";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_UPLOAD_PAGES = 3;

chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "OPEN_OPTIONS") {
    chrome.runtime.openOptionsPage();
    sendResponse({ ok: true });
    return false;
  }

  if (message?.type === "TEST_KEY") {
    testApiKey(message.apiKey)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: publicError(error) }));
    return true;
  }

  if (message?.type === "GET_PULSE") {
    getPulse(message.videoId)
      .then((pulse) => sendResponse({ ok: true, pulse }))
      .catch((error) => sendResponse({ ok: false, error: publicError(error) }));
    return true;
  }
});

async function getPulse(videoId) {
  if (!/^[\w-]{11}$/.test(videoId || "")) {
    throw new PulseError("INVALID_VIDEO", "This page does not contain a valid YouTube video ID.");
  }

  const { youtubeApiKey } = await chrome.storage.local.get("youtubeApiKey");
  if (!youtubeApiKey) {
    throw new PulseError("NO_API_KEY", "Add a YouTube Data API key to enable Channel Pulse.");
  }

  const video = await apiGet("videos", {
    part: "snippet",
    id: videoId,
    fields: "items(snippet(channelId))"
  }, youtubeApiKey);

  const channelId = video.items?.[0]?.snippet?.channelId;
  if (!channelId) {
    throw new PulseError("NO_CHANNEL", "The channel for this video could not be found.");
  }

  const cacheKey = `pulse:${channelId}`;
  const cached = await chrome.storage.local.get(cacheKey);
  if (cached[cacheKey] && Date.now() - cached[cacheKey].savedAt < CACHE_TTL_MS) {
    return { ...cached[cacheKey].pulse, cached: true };
  }

  const pulse = await buildPulse(channelId, youtubeApiKey);
  await chrome.storage.local.set({ [cacheKey]: { savedAt: Date.now(), pulse } });
  return pulse;
}

async function buildPulse(channelId, apiKey) {
  const channelResponse = await apiGet("channels", {
    part: "snippet,statistics,contentDetails",
    id: channelId,
    fields: "items(snippet(title),statistics(subscriberCount,hiddenSubscriberCount),contentDetails(relatedPlaylists(uploads)))"
  }, apiKey);

  const channel = channelResponse.items?.[0];
  if (!channel) throw new PulseError("NO_CHANNEL", "This channel is unavailable.");

  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const uploadsPlaylist = channel.contentDetails?.relatedPlaylists?.uploads;
  const recentUploads = [];
  let pageToken;
  let hitPageLimit = false;

  for (let page = 0; page < MAX_UPLOAD_PAGES; page += 1) {
    const response = await apiGet("playlistItems", {
      part: "contentDetails",
      playlistId: uploadsPlaylist,
      maxResults: "50",
      pageToken,
      fields: "nextPageToken,items(contentDetails(videoId,videoPublishedAt))"
    }, apiKey);

    let reachedCutoff = false;
    for (const item of response.items || []) {
      const publishedAt = item.contentDetails?.videoPublishedAt;
      if (!publishedAt || new Date(publishedAt) < cutoff) {
        reachedCutoff = true;
        continue;
      }
      recentUploads.push({ videoId: item.contentDetails.videoId, publishedAt });
    }

    pageToken = response.nextPageToken;
    if (reachedCutoff || !pageToken) break;
    if (page === MAX_UPLOAD_PAGES - 1 && pageToken) hitPageLimit = true;
  }

  const videoStats = [];
  for (let index = 0; index < recentUploads.length; index += 50) {
    const ids = recentUploads.slice(index, index + 50).map((upload) => upload.videoId).join(",");
    const response = await apiGet("videos", {
      part: "statistics",
      id: ids,
      fields: "items(id,statistics(viewCount,likeCount,commentCount))"
    }, apiKey);
    videoStats.push(...(response.items || []));
  }

  const views = videoStats.map((video) => numberValue(video.statistics?.viewCount));
  const totalViews = sum(views);
  const interactions = sum(videoStats.map((video) =>
    numberValue(video.statistics?.likeCount) + numberValue(video.statistics?.commentCount)
  ));
  const subscribersHidden = Boolean(channel.statistics?.hiddenSubscriberCount);
  const subscribers = subscribersHidden ? null : numberValue(channel.statistics?.subscriberCount);
  const medianViews = median(views);
  const latestUploadAt = recentUploads
    .map((upload) => upload.publishedAt)
    .sort()
    .at(-1) || null;

  return {
    channelId,
    channelTitle: channel.snippet?.title || "Channel",
    subscribers,
    subscribersHidden,
    uploads30d: recentUploads.length,
    totalRecentVideoViews: totalViews,
    medianRecentVideoViews: medianViews,
    engagementRate: totalViews ? interactions / totalViews : null,
    reachRatio: subscribers ? medianViews / subscribers : null,
    latestUploadAt,
    activity: activityLabel(recentUploads.length, latestUploadAt),
    capped: hitPageLimit,
    calculatedAt: new Date().toISOString(),
    cached: false
  };
}

async function testApiKey(apiKey) {
  if (!apiKey?.trim()) throw new PulseError("NO_API_KEY", "Enter an API key first.");
  await apiGet("videos", {
    part: "id",
    id: "dQw4w9WgXcQ",
    fields: "items(id)"
  }, apiKey.trim());
}

async function apiGet(resource, params, apiKey) {
  const url = new URL(`${API_ROOT}/${resource}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, value);
  }
  url.searchParams.set("key", apiKey);

  const response = await fetch(url);
  if (!response.ok) {
    let message = "YouTube did not return the requested data.";
    try {
      const body = await response.json();
      message = body.error?.message || message;
    } catch (_) {
      // Keep the safe fallback message.
    }
    const code = response.status === 403 ? "API_KEY_OR_QUOTA" : "YOUTUBE_API";
    throw new PulseError(code, message);
  }
  return response.json();
}

function activityLabel(uploadCount, latestUploadAt) {
  if (!uploadCount || !latestUploadAt) return "Quiet";
  const daysSinceLatest = (Date.now() - new Date(latestUploadAt).getTime()) / 86400000;
  if (uploadCount >= 4 && daysSinceLatest <= 10) return "Active";
  if (daysSinceLatest <= 21) return "Steady";
  return "Quiet";
}

function numberValue(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function publicError(error) {
  return {
    code: error?.code || "UNKNOWN",
    message: error?.message || "Channel Pulse could not load."
  };
}

class PulseError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}
