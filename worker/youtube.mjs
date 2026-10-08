import { settings } from './config.mjs';
import { now, contentHash } from './core.mjs';
function duration(value) {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(value);
  return m
    ? Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0)
    : 0;
}
async function youtube(env, path, params) {
  const url = new URL(`https://www.googleapis.com/youtube/v3/${path}`);
  for (const [key, value] of Object.entries(params))
    url.searchParams.set(key, value);
  url.searchParams.set('key', env.YOUTUBE_API_KEY);
  const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`youtube_http_${response.status}`);
  return response.json();
}
export async function discoverVideos(env) {
  if (!env.YOUTUBE_API_KEY)
    return { state: 'waiting', code: 'youtube_key_missing', added: 0 };
  const cfg = settings(env);
  let added = 0,
    inspected = 0;
  const channels = (
    await env.DB.prepare(
      "SELECT * FROM channels WHERE enabled=1 AND state='approved' ORDER BY COALESCE(last_checked_at,''),id LIMIT 3",
    ).all()
  ).results;
  for (const channel of channels) {
    if (added >= cfg.maxVideos || inspected >= 12) break;
    let playlist = channel.uploads_playlist,
      author = channel.title,
      watermark = channel.last_video_published_at;
    if (!playlist) {
      const found = await youtube(env, 'channels', {
        part: 'contentDetails,snippet',
        ...(channel.channel_id
          ? { id: channel.channel_id }
          : { forHandle: channel.handle }),
      });
      const item = found.items?.[0];
      if (!item) continue;
      playlist = item.contentDetails.relatedPlaylists.uploads;
      author = item.snippet.title;
      await env.DB.prepare(
        'UPDATE channels SET channel_id=?,uploads_playlist=?,title=? WHERE id=?',
      )
        .bind(item.id, playlist, author, channel.id)
        .run();
    }
    const uploads = await youtube(env, 'playlistItems', {
      part: 'snippet,contentDetails',
      playlistId: playlist,
      maxResults: '20',
    });
    const ids = (uploads.items ?? []).map((v) => v.contentDetails.videoId);
    if (!ids.length) continue;
    const metadata = await youtube(env, 'videos', {
      part: 'snippet,contentDetails,status',
      id: ids.join(','),
    });
    for (const video of (metadata.items ?? []).sort((a, b) =>
      channel.last_video_published_at
        ? (a.snippet.publishedAt ?? '').localeCompare(
            b.snippet.publishedAt ?? '',
          )
        : 0,
    )) {
      if (added >= cfg.maxVideos || inspected >= 12) break;
      if (
        video.status.privacyStatus !== 'public' ||
        video.snippet.liveBroadcastContent !== 'none'
      )
        continue;
      if (
        channel.last_video_published_at &&
        video.snippet.publishedAt &&
        video.snippet.publishedAt <= channel.last_video_published_at
      )
        continue;
      const seconds = duration(video.contentDetails.duration);
      if (!seconds) continue;
      inspected++;
      const row = {
        id: crypto.randomUUID(),
        title: video.snippet.title.slice(0, 120),
        raw_summary: '',
        video_id: video.id,
      };
      row.content_hash = await contentHash(row);
      const time = now();
      const insert = env.DB.prepare(
        "INSERT OR IGNORE INTO sources(id,type,source_url,author,title,raw_summary,language,fetched_at,video_id,video_seconds,content_hash,ai_status) VALUES(?,'youtube',?,?,?,?,?,?,?,?,?,?)",
      ).bind(
        row.id,
        `https://www.youtube.com/watch?v=${video.id}`,
        author,
        row.title,
        '',
        video.snippet.defaultAudioLanguage ?? 'und',
        time,
        video.id,
        seconds,
        row.content_hash,
        seconds > cfg.maxVideoSeconds ? 'skipped_duration' : 'queued',
      );
      const statements = [insert];
      if (seconds <= cfg.maxVideoSeconds)
        statements.push(
          env.DB.prepare(
            "INSERT OR IGNORE INTO ai_jobs(id,entity_type,entity_id,content_hash,next_attempt_at,created_at) SELECT ?,'source',id,content_hash,?,? FROM sources WHERE id=?",
          ).bind(crypto.randomUUID(), time, time, row.id),
        );
      const [result] = await env.DB.batch(statements);
      if (
        video.snippet.publishedAt &&
        (!watermark || video.snippet.publishedAt > watermark)
      )
        watermark = video.snippet.publishedAt;
      if (result.meta.changes) {
        added++;
      }
    }
    await env.DB.prepare(
      'UPDATE channels SET last_checked_at=?,last_video_published_at=? WHERE id=?',
    )
      .bind(now(), watermark ?? null, channel.id)
      .run();
  }
  return { state: 'complete', added };
}
