# YouTube Channel Pulse — MVP

A backend-free Chrome extension that adds a small 30-day activity pulse beside the channel metadata on YouTube watch pages. Hover over or click the badge to open its details.

From an idea of the wise antirez, see https://www.youtube.com/watch?v=YKZS7wON1Zw&amp;t=159s

## What it shows

- Activity label based on upload frequency and recency
- Number of public uploads in the last 30 days
- Current total views on videos published in that period
- Median views per recent video
- Public like-and-comment engagement rate
- Median recent-video reach relative to the public subscriber count

It deliberately does **not** call this “monthly active users.” YouTube does not expose another channel’s unique viewers publicly, and video views are not unique people.

## Install locally

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked** and select this folder.
4. Click the extension icon to open its settings.
5. Add a YouTube Data API v3 key and choose **Save and test**.
6. Open or reload a YouTube video.

To create a key, enable **YouTube Data API v3** in a Google Cloud project and create an API key. For a personal MVP, restrict the key to the YouTube Data API. Because a browser extension cannot keep a bundled secret, this version asks each tester to provide their own key.

## How the calculation works

The extension resolves the video's channel, retrieves its public uploads playlist, keeps uploads from the last 30 days, and requests public statistics for those videos. Results are stored in `chrome.storage.local` for six hours per channel.

“Recent views” means the current view counts of videos published during the 30-day window. It is not the number of views gained across the channel during that window. Measuring true 30-day gains would require periodic snapshots or channel-owner analytics.

The activity label is intentionally simple:

- **Active:** at least four uploads in 30 days and the latest was within 10 days
- **Steady:** the latest upload was within 21 days
- **Quiet:** otherwise

## MVP limitations

- YouTube can change its page DOM; the insertion selector may eventually need adjustment.
- Channels with more than 150 uploads in 30 days are shown with a `+` suffix.
- Hidden subscriber counts omit the reach ratio.
- Deleted, private, or statistics-disabled videos may be absent.
- API usage is subject to the tester's Google Cloud quota.

## Files

- `content.js` / `content.css`: page insertion and pulse interface
- `background.js`: YouTube API requests, calculations, and cache
- `options.html` / `options.css` / `options.js`: API-key setup and interactive UX preview
- `manifest.json`: Manifest V3 configuration
