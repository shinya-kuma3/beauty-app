export const tags = [
  ['skin', 'スキンケア', '肌の洗浄、保湿、日焼け対策、顔のお手入れ'],
  ['hair', 'ヘアケア', '髪や頭皮の洗浄、シャンプー、コンディショナー'],
  ['nail', '爪ケア', '爪、甘皮、指先、ネイルのケア'],
  ['body', 'ボディケア', '身体や手足の洗浄、保湿、ボディクリーム'],
  ['makeup', 'メイク', '化粧品、ベースメイク、アイメイク、メイク方法'],
  ['ingredient', '成分', '化粧品の配合成分、成分名、成分の特徴'],
  ['sensitive', '敏感肌', '刺激を感じやすい肌、やさしいケア、肌への配慮'],
  ['dry', '乾燥肌', '乾燥、つっぱり、保湿、肌のうるおい'],
  ['oily', '脂性肌', '皮脂、べたつき、テカリ、脂性肌のケア'],
  ['research', '研究', '論文、研究結果、調査、検証方法の紹介'],
  ['new-product', '新商品', '新発売の化粧品、美容製品、商品情報'],
].map(([id, label, description]) => ({ id, label, description }));
const number = (env, key, fallback, min, max) => {
  const n = Number(env[key] ?? fallback);
  return Number.isFinite(n)
    ? Math.min(max, Math.max(min, Math.floor(n)))
    : fallback;
};
export function settings(env) {
  return {
    embeddingModel: env.EMBEDDING_MODEL || '@cf/baai/bge-m3',
    summaryModel: env.GEMINI_MODEL || 'gemini-3.1-flash-lite',
    fallbackModel: env.FALLBACK_MODEL || '@cf/qwen/qwen3-30b-a3b-fp8',
    summaryProvider: ['auto', 'gemini', 'workers'].includes(
      env.SUMMARY_PROVIDER,
    )
      ? env.SUMMARY_PROVIDER
      : 'auto',
    threshold: Number.isFinite(Number(env.TAG_THRESHOLD ?? 0.55))
      ? Math.min(1, Math.max(-1, Number(env.TAG_THRESHOLD ?? 0.55)))
      : 0.55,
    inputChars: number(env, 'SUMMARY_INPUT_CHARS', 3000, 100, 3000),
    embeddingChars: number(env, 'EMBEDDING_INPUT_CHARS', 1200, 100, 3000),
    outputTokens: number(env, 'SUMMARY_MAX_TOKENS', 512, 128, 1024),
    videoOutputTokens: number(env, 'VIDEO_MAX_TOKENS', 1536, 512, 2048),
    dailyCalls: number(env, 'AI_DAILY_CALL_LIMIT', 30, 0, 1000),
    dailyTokens: number(env, 'AI_DAILY_TOKEN_LIMIT', 600000, 0, 1000000),
    maxVideos: number(env, 'YOUTUBE_VIDEOS_PER_RUN', 3, 0, 20),
    maxVideoSeconds: number(env, 'YOUTUBE_MAX_SECONDS', 1800, 60, 7200),
    jobLimit: number(env, 'JOBS_PER_RUN', 1, 1, 1),
    ingestPerMinute: number(env, 'INGEST_REQUESTS_PER_MINUTE', 60, 1, 600),
  };
}
