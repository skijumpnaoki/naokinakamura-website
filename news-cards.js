// Shared news-card rendering for the homepage (#news) and the /news archive page.
// Exposes window.NewsCards. Cards are built from the normalized post shape returned
// by the /api/news proxy: { id, type, title, excerpt, date, url, image, tags }.
(function (global) {
  'use strict';

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // Only allow plain http(s) image URLs (no characters that could break out of attributes).
  function safeImageUrl(url) {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return null;
    if (/["'<>\\]/.test(url)) return null;
    return url;
  }

  function formatNewsDate(dateStr, lang) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString(lang === 'ja' ? 'ja-JP' : 'en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  // The API returns stable, untranslated `type` + `tags` slugs, so the badge labels
  // live here. Prefer a known competition tag (gives the nice "World Cup" style badge),
  // then fall back to the post type, then a generic label for any future/unknown type.
  const COMPETITION_LABEL = {
    'world-cup':           { ja: 'ワールドカップ',  en: 'World Cup' },
    'continental-cup':     { ja: 'コンチネンタルC', en: 'Continental Cup' },
    'grand-prix':          { ja: 'グランプリ',      en: 'Grand Prix' },
    'summer-grand-prix':   { ja: 'サマーGP',        en: 'Summer Grand Prix' },
    'world-championships': { ja: '世界選手権',      en: 'World Championships' },
    'olympics':            { ja: 'オリンピック',    en: 'Olympics' },
    'fis-cup':             { ja: 'FISカップ',       en: 'FIS Cup' },
  };
  const TYPE_LABEL = {
    result:  { ja: '結果',       en: 'Result' },
    article: { ja: 'ジャーナル', en: 'Journal' },
    report:  { ja: 'レポート',   en: 'Report' },
  };
  const GENERIC_LABEL = { ja: '更新', en: 'Update' };
  function pickLabel(map, lang) { return map[lang] || map.en; }

  function newsCategory(post, lang) {
    const tags = Array.isArray(post.tags) ? post.tags : [];
    for (const t of tags) {
      if (COMPETITION_LABEL[t]) return pickLabel(COMPETITION_LABEL[t], lang);
    }
    if (TYPE_LABEL[post.type]) return pickLabel(TYPE_LABEL[post.type], lang);
    return pickLabel(GENERIC_LABEL, lang); // unknown / future type
  }

  // Articles open the on-site reader (/news/<id>); results/reports link out to their source.
  function newsHref(post) {
    if (post.type === 'article' && post.id) return { href: '/news/' + encodeURIComponent(post.id), external: false };
    if (post.url) return { href: post.url, external: true };
    return null;
  }

  // Build one card element (an <a> when linkable, else a <div>).
  function buildNewsCard(post, lang) {
    const link = newsHref(post);
    const card = document.createElement(link ? 'a' : 'div');
    card.className = 'news-card reveal';
    if (link) {
      card.href = link.href;
      if (link.external) { card.target = '_blank'; card.rel = 'noopener'; }
    }
    let html = '';
    const img = safeImageUrl(post.image);
    if (img) html += '<div class="news-thumb"><img src="' + escapeHtml(img) + '" alt="" loading="lazy"></div>';
    const dateStr = formatNewsDate(post.date, lang);
    if (dateStr) html += '<div class="news-date">' + escapeHtml(dateStr) + '</div>';
    html += '<div class="news-cat">' + escapeHtml(newsCategory(post, lang)) + '</div>';
    html += '<div class="news-title">' + escapeHtml(post.title) + '</div>';
    if (post.excerpt) html += '<div class="news-summary">' + escapeHtml(post.excerpt) + '</div>';
    card.innerHTML = html;
    return card;
  }

  global.NewsCards = { escapeHtml, safeImageUrl, formatNewsDate, newsCategory, newsHref, buildNewsCard };
})(window);
