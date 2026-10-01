/**
 * Client half of dsh-update-checker: a settings-section page with a one-click
 * update check across installed third-party plugins, with release notes.
 *
 * UI design:
 *  - Status filter chips (All / Updates / Up to date / Local / Attention) that
 *    double as the summary line; default sort puts update-available first.
 *  - Release notes rendered from a small safe markdown subset (headings,
 *    lists, quotes, code fences, bold, inline code, links) via an AST — no
 *    innerHTML anywhere.
 *  - Full state coverage: cache skeleton, never-checked CTA, stale-cache
 *    hint (>24h), error banner with retry, expand/collapse-all.
 *  - Row expand state lives in the page (survives re-checks), cards with
 *    pending updates carry a brand accent bar.
 * Hand-written module-loader factory; React comes from the browser table.
 */
window.__ModuleLoader__.load({
  id: 'dsh-update-checker',
  factory(require) {
    const React = require('react');
    const { useState, useEffect, useMemo } = React;
    const h = React.createElement;
    const Fragment = React.Fragment;

    const NS = 'dsh-update-checker';
    const CHANNEL = '/dsh-update-checker';
    const STALE_MS = 24 * 60 * 60 * 1000;

    const dict = {
      zh: {
        sectionLabel: '插件更新',
        intro: '一键检查本机已安装的第三方插件在上游（npm / GitHub）是否有新版本，并展示更新内容。仅做检查，不会安装或修改任何内容。',
        check: '检查更新',
        checking: '正在检查…',
        lastAt: '上次检查',
        never: '尚未检查过',
        statusUpdate: '有更新',
        statusLatest: '已是最新',
        statusLocal: '本地安装',
        statusLocalLatest: '本地 · 与上游一致',
        statusLocalBehind: '本地 · 上游有新版',
        statusBranch: '跟踪分支',
        statusUnknown: '无法比较',
        statusError: '检查失败',
        installed: '已装',
        latestLabel: '最新',
        upstream: '上游',
        viewNotes: '更新内容',
        hideNotes: '收起',
        noNotes: '上游没有提供这些版本的发行说明。',
        empty: '当前 profile 没有可检查的第三方插件。',
        pageError: '检查请求失败',
        localPath: '本地路径',
        releaseNotesNote: '发行说明来自 GitHub Releases。',
        tagOnlyNote: '该仓库没有提供 Release 说明正文，以下仅为版本标签。',
        filterAll: '全部',
        filterUpdates: '有更新',
        filterLocal: '本地',
        filterIssues: '需关注',
        expandAll: '展开全部',
        collapseAll: '收起全部',
        sortByStatus: '按状态',
        sortByName: '按名称',
        staleHint: '缓存已超过一天，建议重新检查',
        emptyNever: '还没有检查过。点一下，扫完所有已装插件的上游动态。',
        retry: '重试',
        relJustNow: '刚刚',
        relMin: '%d 分钟前',
        relHour: '%d 小时前',
        relDay: '%d 天前',
      },
      en: {
        sectionLabel: 'Plugin Updates',
        intro: 'One-click check which installed third-party plugins have newer upstream versions (npm / GitHub), with release notes. Check only: nothing is installed or changed.',
        check: 'Check for updates',
        checking: 'Checking…',
        lastAt: 'Last check',
        never: 'Never checked',
        statusUpdate: 'Update available',
        statusLatest: 'Up to date',
        statusLocal: 'Local install',
        statusLocalLatest: 'Local · matches upstream',
        statusLocalBehind: 'Local · behind upstream',
        statusBranch: 'Tracking branch',
        statusUnknown: 'Cannot compare',
        statusError: 'Check failed',
        installed: 'Installed',
        latestLabel: 'Latest',
        upstream: 'Upstream',
        viewNotes: 'Release notes',
        hideNotes: 'Hide',
        noNotes: 'Upstream provides no release notes for these versions.',
        empty: 'No third-party plugins to check in this profile.',
        pageError: 'Check request failed',
        localPath: 'Local path',
        releaseNotesNote: 'Release notes from GitHub Releases.',
        tagOnlyNote: 'No release notes published upstream; tags only.',
        filterAll: 'All',
        filterUpdates: 'Updates',
        filterLocal: 'Local',
        filterIssues: 'Attention',
        expandAll: 'Expand all',
        collapseAll: 'Collapse all',
        sortByStatus: 'By status',
        sortByName: 'By name',
        staleHint: 'cache is over a day old — consider re-checking',
        emptyNever: 'Never checked yet. One click scans every installed plugin.',
        retry: 'Retry',
        relJustNow: 'just now',
        relMin: '%d min ago',
        relHour: '%d h ago',
        relDay: '%d d ago',
      },
    };

    const STATUS_KEY = {
      update: 'statusUpdate',
      latest: 'statusLatest',
      local: 'statusLocal',
      'local-latest': 'statusLocalLatest',
      'local-behind': 'statusLocalBehind',
      branch: 'statusBranch',
      unknown: 'statusUnknown',
      error: 'statusError',
    };

    const STATUS_COLOR = {
      update: 'var(--dsw-alias-brand-primary,#4f6ef7)',
      latest: 'var(--dsw-alias-state-success-primary,#10b981)',
      local: 'var(--dsw-alias-label-tertiary,#8b93a1)',
      'local-latest': 'var(--dsw-alias-state-success-primary,#10b981)',
      'local-behind': 'var(--dsw-alias-state-warn-primary,#b45309)',
      branch: 'var(--dsw-alias-label-tertiary,#8b93a1)',
      unknown: 'var(--dsw-alias-state-warn-primary,#b45309)',
      error: 'var(--dsw-alias-state-error-primary,#dc2626)',
    };

    /** Sort priority: what needs attention floats to the top. */
    const STATUS_ORDER = {
      update: 0,
      'local-behind': 1,
      error: 2,
      unknown: 3,
      latest: 4,
      'local-latest': 4,
      branch: 5,
      local: 6,
    };

    /** Status → filter chip group ('branch' stays ungrouped, visible under All). */
    const FILTER_OF = {
      update: 'updates',
      'local-behind': 'updates',
      latest: 'current',
      'local-latest': 'current',
      local: 'local',
      error: 'issues',
      unknown: 'issues',
    };

    const styles = {
      page: { display: 'flex', flexDirection: 'column', gap: 14 },
      intro: { fontSize: 13, lineHeight: 1.6, color: 'var(--dsw-alias-label-secondary,#6b7280)' },
      toolbar: { display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
      toolbarRight: { display: 'flex', alignItems: 'center', gap: 4, marginLeft: 'auto' },
      primary: {
        font: 'inherit', cursor: 'pointer', border: 'none',
        background: 'var(--dsw-alias-button-primary-fill, var(--dsw-alias-brand-primary,#4f6ef7))',
        color: 'var(--dsw-alias-label-primary-foreground,#fff)',
        height: 36, padding: '0 18px', borderRadius: 999, fontSize: 13, fontWeight: 500,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
      },
      primaryDisabled: { cursor: 'default', opacity: 0.6 },
      spinner: {
        width: 13, height: 13, borderRadius: '50%', display: 'inline-block', flexShrink: 0,
        border: '2px solid rgba(255,255,255,.35)', borderTopColor: '#fff',
        animation: 'dsh-uc-spin .8s linear infinite',
      },
      ghost: {
        font: 'inherit', cursor: 'pointer', border: 'none', background: 'transparent',
        color: 'var(--dsw-alias-label-tertiary,#8b93a1)', fontSize: 12,
        height: 28, padding: '0 10px', borderRadius: 8, whiteSpace: 'nowrap',
      },
      meta: { fontSize: 12, color: 'var(--dsw-alias-label-tertiary,#8b93a1)', display: 'inline-flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' },
      stale: { color: 'var(--dsw-alias-state-warn-primary,#b45309)' },
      chips: { display: 'flex', gap: 8, flexWrap: 'wrap' },
      chip: {
        font: 'inherit', cursor: 'pointer', fontSize: 12,
        border: '1px solid var(--dsw-alias-border-l2,#e5e7eb)',
        background: 'var(--dsw-alias-bg-layer-1,#fff)',
        color: 'var(--dsw-alias-label-secondary,#6b7280)',
        height: 26, padding: '0 12px', borderRadius: 999,
        display: 'inline-flex', alignItems: 'center', gap: 5,
      },
      chipOn: {
        borderColor: 'var(--dsw-alias-brand-primary,#4f6ef7)',
        color: 'var(--dsw-alias-brand-primary,#4f6ef7)',
        background: 'var(--dsw-alias-bg-layer-2,#f3f4f6)', fontWeight: 500,
      },
      chipCount: { fontSize: 11, opacity: 0.75 },
      card: {
        background: 'var(--dsw-alias-bg-layer-1,#fff)',
        border: '1px solid var(--dsw-alias-border-l2,#e5e7eb)',
        borderRadius: 14, padding: '14px 18px',
      },
      cardUpdate: {
        borderLeft: '3px solid var(--dsw-alias-brand-primary,#4f6ef7)',
        paddingLeft: 15,
      },
      cardTop: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
      name: { fontSize: 13, fontWeight: 600, color: 'var(--dsw-alias-label-primary,inherit)', wordBreak: 'break-all' },
      mono: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' },
      badge: { fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' },
      dot: { width: 7, height: 7, borderRadius: '50%', display: 'inline-block', flexShrink: 0 },
      spacer: { flex: 1 },
      chevron: {
        fontSize: 11, color: 'var(--dsw-alias-label-tertiary,#8b93a1)', flexShrink: 0,
        transition: 'transform .15s ease', display: 'inline-flex', alignItems: 'center',
      },
      link: { font: 'inherit', fontSize: 12, color: 'var(--dsw-alias-label-tertiary,#8b93a1)', textDecoration: 'none' },
      linkStrong: { font: 'inherit', fontSize: 12, color: 'var(--dsw-alias-brand-primary,#4f6ef7)', textDecoration: 'none' },
      versionLine: { marginTop: 8, fontSize: 13, color: 'var(--dsw-alias-label-primary,inherit)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
      arrow: { color: 'var(--dsw-alias-label-tertiary,#8b93a1)' },
      latestText: { color: 'var(--dsw-alias-brand-primary,#4f6ef7)', fontWeight: 600 },
      spec: { marginTop: 6, fontSize: 11, color: 'var(--dsw-alias-label-tertiary,#8b93a1)', wordBreak: 'break-all' },
      desc: { marginTop: 6, fontSize: 12, color: 'var(--dsw-alias-label-secondary,#6b7280)', lineHeight: 1.5 },
      errText: { marginTop: 6, fontSize: 12, color: 'var(--dsw-alias-state-error-primary,#dc2626)' },
      toggle: {
        font: 'inherit', cursor: 'pointer', border: '1px solid var(--dsw-alias-border-l2,#d1d5db)',
        background: 'var(--dsw-alias-bg-layer-1,#fff)', color: 'var(--dsw-alias-label-secondary,#6b7280)',
        height: 26, padding: '0 12px', borderRadius: 999, fontSize: 12,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      },
      notes: { marginTop: 10, borderTop: '1px solid var(--dsw-alias-border-l2,#eceef2)', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 12 },
      noteHead: { fontSize: 11, color: 'var(--dsw-alias-label-tertiary,#8b93a1)' },
      releaseTag: { fontSize: 12, fontWeight: 600, color: 'var(--dsw-alias-label-primary,inherit)', display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' },
      releaseDate: { fontSize: 11, fontWeight: 400, color: 'var(--dsw-alias-label-tertiary,#8b93a1)' },
      releaseBody: {
        marginTop: 4, fontSize: 12, lineHeight: 1.6,
        color: 'var(--dsw-alias-label-secondary,#6b7280)',
      },
      md: { display: 'flex', flexDirection: 'column', gap: 6 },
      mdH: { fontWeight: 600, color: 'var(--dsw-alias-label-primary,inherit)', margin: 0 },
      mdList: { margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 2 },
      mdQuote: {
        margin: 0, padding: '2px 0 2px 10px',
        borderLeft: '3px solid var(--dsw-alias-border-l2,#e5e7eb)',
        color: 'var(--dsw-alias-label-tertiary,#8b93a1)',
      },
      mdHr: { border: 'none', borderTop: '1px solid var(--dsw-alias-border-l2,#eceef2)', margin: '4px 0' },
      mdCode: {
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: 11,
        background: 'var(--dsw-alias-bg-layer-2,#f3f4f6)', borderRadius: 4, padding: '1px 5px',
      },
      mdPre: {
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: 11,
        background: 'var(--dsw-alias-bg-layer-2,#f3f4f6)', borderRadius: 8, padding: '8px 10px',
        margin: 0, whiteSpace: 'pre', overflowX: 'auto',
      },
      skeleton: { display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 2 },
      skeletonBar: {
        height: 12, borderRadius: 6,
        background: 'var(--dsw-alias-bg-layer-2,#eceef2)',
        animation: 'dsh-uc-shimmer 1.4s ease-in-out infinite',
      },
      emptyCard: {
        background: 'var(--dsw-alias-bg-layer-1,#fff)',
        border: '1px dashed var(--dsw-alias-border-l2,#d1d5db)',
        borderRadius: 14, padding: '34px 20px', display: 'flex', flexDirection: 'column',
        alignItems: 'center', gap: 14, textAlign: 'center',
      },
      emptyText: { fontSize: 13, color: 'var(--dsw-alias-label-secondary,#6b7280)', lineHeight: 1.6 },
      pageError: {
        background: 'var(--dsw-alias-bg-layer-2,#f3f4f6)', borderLeft: '3px solid var(--dsw-alias-state-error-primary,#dc2626)',
        borderRadius: 10, padding: '10px 14px', fontSize: 12, color: 'var(--dsh-alias-state-error-primary,#dc2626)',
        display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
      },
    };

    function formatDate(iso) {
      if (!iso) return '';
      try {
        const date = new Date(iso);
        if (Number.isNaN(date.getTime())) return '';
        return date.toLocaleString(undefined, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
      } catch {
        return '';
      }
    }

    function formatRelative(iso, t) {
      if (!iso) return '';
      try {
        const ms = Date.now() - new Date(iso).getTime();
        if (Number.isNaN(ms)) return '';
        if (ms < 60 * 1000) return t('relJustNow');
        const minutes = Math.floor(ms / 60000);
        if (minutes < 60) return t('relMin').replace('%d', String(minutes));
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return t('relHour').replace('%d', String(hours));
        return t('relDay').replace('%d', String(Math.floor(hours / 24)));
      } catch {
        return '';
      }
    }

    // --- markdown-lite: pure string → AST (no React, no HTML) -----------------
    // Blocks: {type:'h',level,inline} {type:'p',inline} {type:'ul'|'ol',items}
    //         {type:'quote',inline} {type:'hr'} {type:'code',text}
    // Inline: {t:'txt'|'b'|'c'|'a', text, href?}
    const INLINE_RE = /(`[^`]+`)|(!\[[^\]]*\]\([^)\s]+\))|(\[[^\]]*\]\([^)\s]+\))|(\*\*[^*]+\*\*)|(https?:\/\/[^\s)]+)/g;

    function parseInline(text) {
      const nodes = [];
      let last = 0;
      INLINE_RE.lastIndex = 0;
      let match;
      while ((match = INLINE_RE.exec(text)) !== null) {
        if (match.index > last) nodes.push({ t: 'txt', text: text.slice(last, match.index) });
        const token = match[0];
        if (token.startsWith('`')) {
          nodes.push({ t: 'c', text: token.slice(1, -1) });
        } else if (token.startsWith('![')) {
          const close = token.indexOf('](');
          const href = token.slice(close + 2, -1);
          nodes.push({ t: 'a', text: token.slice(2, close) || href, href });
        } else if (token.startsWith('[')) {
          const close = token.indexOf('](');
          nodes.push({ t: 'a', text: token.slice(1, close), href: token.slice(close + 2, -1) });
        } else if (token.startsWith('**')) {
          nodes.push({ t: 'b', text: token.slice(2, -2) });
        } else {
          const href = token.replace(/[.,;:!?]+$/, '');
          nodes.push({ t: 'a', text: href, href });
        }
        last = match.index + token.length;
      }
      if (last < text.length) nodes.push({ t: 'txt', text: text.slice(last) });
      return nodes;
    }

    function parseMarkdownBody(text) {
      const blocks = [];
      if (typeof text !== 'string' || !text) return blocks;
      const lines = text.split(/\r\n|\r|\n/);
      let para = null;
      let list = null;
      let quote = null;
      let fence = null;
      const flushPara = () => { if (para) { blocks.push({ type: 'p', inline: parseInline(para.join(' ')) }); para = null; } };
      const flushList = () => { if (list) { blocks.push(list); list = null; } };
      const flushQuote = () => { if (quote) { blocks.push({ type: 'quote', inline: parseInline(quote.join(' ')) }); quote = null; } };
      const flushAll = () => { flushPara(); flushList(); flushQuote(); };
      for (const line of lines) {
        if (fence) {
          if (/^\s*```/.test(line)) { blocks.push({ type: 'code', text: fence.join('\n') }); fence = null; }
          else fence.push(line);
          continue;
        }
        if (/^\s*```/.test(line)) { flushAll(); fence = []; continue; }
        if (!line.trim()) { flushAll(); continue; }
        const heading = line.match(/^#{1,4}\s+(.*)$/);
        if (heading) {
          flushAll();
          blocks.push({ type: 'h', level: heading[0].match(/^#+/)[0].length, inline: parseInline(heading[1].trim()) });
          continue;
        }
        const bullet = line.match(/^\s*([-*+]|\d+[.)])\s+(.*)$/);
        if (bullet) {
          flushPara(); flushQuote();
          const kind = /^[-*+]/.test(bullet[1]) ? 'ul' : 'ol';
          if (!list || list.type !== kind) { flushList(); list = { type: kind, items: [] }; }
          list.items.push(parseInline(bullet[2].trim()));
          continue;
        }
        if (/^\s*>/.test(line)) { flushPara(); flushList(); if (!quote) quote = []; quote.push(line.replace(/^\s*>\s?/, '')); continue; }
        if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { flushAll(); blocks.push({ type: 'hr' }); continue; }
        flushList(); flushQuote();
        if (!para) para = [];
        para.push(line.trim());
      }
      if (fence) blocks.push({ type: 'code', text: fence.join('\n') });
      flushAll();
      return blocks;
    }

    function renderInlineNodes(nodes, keyBase) {
      return nodes.map((node, index) => {
        const key = `${keyBase}-${index}`;
        if (node.t === 'b') return h('strong', { key }, node.text);
        if (node.t === 'c') return h('code', { key, style: styles.mdCode }, node.text);
        if (node.t === 'a') return h('a', { key, href: node.href, target: '_blank', rel: 'noreferrer', style: styles.linkStrong }, node.text);
        return h('span', { key }, node.text);
      });
    }

    function Markdown({ text }) {
      const blocks = useMemo(() => parseMarkdownBody(text), [text]);
      if (!blocks.length) return null;
      return h('div', { style: styles.md }, blocks.map((block, index) => {
        const key = `b${index}`;
        switch (block.type) {
          case 'h':
            return h('div', { key, style: { ...styles.mdH, fontSize: Math.max(11, 13 - Math.min(block.level, 3)) } },
              renderInlineNodes(block.inline, key));
          case 'p':
            return h('div', { key }, renderInlineNodes(block.inline, key));
          case 'ul':
          case 'ol':
            return h(block.type, { key, style: styles.mdList },
              block.items.map((item, itemIndex) => h('li', { key: itemIndex }, renderInlineNodes(item, `${key}-${itemIndex}`))));
          case 'quote':
            return h('blockquote', { key, style: styles.mdQuote }, renderInlineNodes(block.inline, key));
          case 'hr':
            return h('hr', { key, style: styles.mdHr });
          case 'code':
            return h('pre', { key, style: styles.mdPre }, block.text);
          default:
            return null;
        }
      }));
    }

    function Badge({ status, label }) {
      return h('span', { style: styles.badge },
        h('span', { style: { ...styles.dot, background: STATUS_COLOR[status] ?? STATUS_COLOR.unknown } }),
        label,
      );
    }

    function versionLine(row, t) {
      const installed = row.installed || '?';
      if (row.status === 'update') {
        return h(Fragment, null,
          h('span', null, `${t('installed')} `),
          h('span', { style: styles.mono }, installed),
          h('span', { style: styles.arrow }, '→'),
          h('span', { style: { ...styles.mono, ...styles.latestText } }, row.latest || '?'),
        );
      }
      if ((row.status === 'local-behind' || row.status === 'local-latest') && row.latest) {
        return h(Fragment, null,
          h('span', { style: styles.mono }, installed),
          h('span', { style: styles.arrow }, '·'),
          h('span', null, `${t('upstream')} `),
          h('span', { style: { ...styles.mono, ...(row.status === 'local-behind' ? styles.latestText : {}) } }, row.latest),
        );
      }
      if (row.latest && row.latest !== installed) {
        return h(Fragment, null,
          h('span', null, `${t('installed')} `),
          h('span', { style: styles.mono }, installed),
          h('span', { style: styles.arrow }, '·'),
          h('span', null, `${t('latestLabel')} `),
          h('span', { style: styles.mono }, row.latest),
        );
      }
      return h('span', { style: styles.mono }, installed);
    }

    function ReleaseNotes({ row, t }) {
      if (row.releasesSource === 'jsdelivr' || row.releasesSource === 'tags') {
        return h('div', { style: styles.notes },
          h('div', { style: styles.noteHead }, t('tagOnlyNote')),
          h('div', { style: styles.mono }, row.releases.map((release) => release.tag).join('  ')),
        );
      }
      if (row.releases.length === 0) {
        return h('div', { style: styles.notes }, h('div', { style: styles.noteHead }, t('noNotes')));
      }
      return h('div', { style: styles.notes },
        h('div', { style: styles.noteHead }, t('releaseNotesNote')),
        ...row.releases.map((release, index) => h('div', { key: `${release.tag}-${index}` },
          h('div', { style: styles.releaseTag },
            h('span', { style: styles.mono }, release.tag),
            release.date ? h('span', { style: styles.releaseDate }, formatDate(release.date)) : null,
            release.url ? h('a', { href: release.url, target: '_blank', rel: 'noreferrer', style: styles.linkStrong }, '↗') : null,
          ),
          release.body ? h('div', { style: styles.releaseBody }, h(Markdown, { text: release.body })) : null,
        )),
      );
    }

    function hasNotesRow(row) {
      const releases = row.releases ?? [];
      return releases.length > 0
        || row.status === 'update'
        || row.releasesSource === 'jsdelivr'
        || row.releasesSource === 'tags';
    }

    function PluginRow({ row, t, open, onToggle }) {
      const releases = row.releases ?? [];
      const notes = hasNotesRow(row);
      const linkUrl = row.repoUrl || row.pageUrl || row.homepage || '';
      const sourceLabel = row.kind === 'npm' ? 'npm' : row.kind === 'github' ? 'GitHub' : row.kind === 'file' ? t('localPath') : row.kind;
      const isUpdate = FILTER_OF[row.status] === 'updates';
      return h('div', { style: { ...styles.card, ...(isUpdate ? styles.cardUpdate : {}) } },
        h('div', {
          style: { ...styles.cardTop, ...(notes ? { cursor: 'pointer' } : {}) },
          onClick: notes ? () => onToggle(row.name) : undefined,
        },
          h('span', { style: { ...styles.name, ...styles.mono } }, row.name),
          h(Badge, { status: row.status, label: t(STATUS_KEY[row.status] ?? 'statusUnknown') }),
          h('span', { style: styles.spacer }),
          linkUrl ? h('a', {
            href: linkUrl, target: '_blank', rel: 'noreferrer', style: styles.link,
            onClick: (event) => event.stopPropagation(),
          }, sourceLabel + ' ↗') : h('span', { style: styles.link }, sourceLabel),
          notes ? h('span', { style: { ...styles.chevron, transform: open ? 'rotate(90deg)' : 'none' } }, '▶') : null,
        ),
        h('div', { style: styles.versionLine }, versionLine(row, t)),
        row.spec ? h('div', { style: { ...styles.spec, ...styles.mono } }, row.spec) : null,
        row.description ? h('div', { style: styles.desc }, row.description) : null,
        row.error ? h('div', { style: styles.errText }, `⚠ ${row.error}`) : null,
        notes ? h('div', { style: { marginTop: 10 } },
          h('button', {
            style: styles.toggle,
            onClick: () => onToggle(row.name),
          }, `${open ? t('hideNotes') : t('viewNotes')}${releases.length ? ` (${releases.length})` : ''}`),
          open ? h(ReleaseNotes, { row, t }) : null,
        ) : null,
      );
    }

    function Skeleton() {
      return h('div', { style: styles.skeleton },
        h('div', { style: { ...styles.skeletonBar, width: '58%' } }),
        h('div', { style: { ...styles.skeletonBar, width: '92%' } }),
        h('div', { style: { ...styles.skeletonBar, width: '74%' } }),
      );
    }

    function Page(props) {
      const { rpcCall, t } = props;
      const [running, setRunning] = useState(false);
      const [data, setData] = useState(null);
      const [loadingCache, setLoadingCache] = useState(true);
      const [error, setError] = useState('');
      const [filter, setFilter] = useState('all');
      const [sortMode, setSortMode] = useState('status');
      const [openNames, setOpenNames] = useState(() => new Set());

      useEffect(() => {
        let alive = true;
        rpcCall('check.last', undefined)
          .then((value) => { if (alive && value) setData(value); })
          .catch(() => {})
          .finally(() => { if (alive) setLoadingCache(false); });
        return () => { alive = false; };
      }, []);

      const run = async () => {
        if (running) return;
        setRunning(true);
        setError('');
        try {
          setData(await rpcCall('check.run', undefined));
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        } finally {
          setRunning(false);
        }
      };

      const toggleOpen = (name) => {
        setOpenNames((previous) => {
          const next = new Set(previous);
          if (next.has(name)) next.delete(name); else next.add(name);
          return next;
        });
      };

      const rows = data?.rows ?? [];
      const groups = [
        { id: 'updates', label: t('filterUpdates'), count: 0 },
        { id: 'current', label: t('statusLatest'), count: 0 },
        { id: 'local', label: t('filterLocal'), count: 0 },
        { id: 'issues', label: t('filterIssues'), count: 0 },
      ];
      for (const row of rows) {
        const group = FILTER_OF[row.status];
        if (group) groups.find((item) => item.id === group).count += 1;
      }
      const chipList = [{ id: 'all', label: t('filterAll'), count: rows.length }, ...groups.filter((item) => item.count > 0)];

      const visible = rows
        .filter((row) => filter === 'all' || FILTER_OF[row.status] === filter)
        .sort((a, b) => {
          if (sortMode === 'name') return a.name.localeCompare(b.name);
          return (STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99) || a.name.localeCompare(b.name);
        });

      const expandable = visible.filter(hasNotesRow);
      const allExpanded = expandable.length > 0 && expandable.every((row) => openNames.has(row.name));
      const setAllOpen = (open) => {
        setOpenNames(open ? new Set(expandable.map((row) => row.name)) : new Set());
      };

      const stale = !!data?.at && Date.now() - new Date(data.at).getTime() > STALE_MS;
      const neverChecked = !loadingCache && !data && !running;

      return h('div', { style: styles.page },
        h('div', { style: styles.intro }, t('intro')),
        h('div', { style: styles.toolbar },
          h('button', { style: { ...styles.primary, ...(running ? styles.primaryDisabled : {}) }, disabled: running, onClick: run },
            running ? h('span', { style: styles.spinner }) : null,
            running ? t('checking') : t('check')),
          data ? h('span', { style: styles.meta, title: formatDate(data.at) },
            `${t('lastAt')}: ${formatRelative(data.at, t)}`,
            stale ? h('span', { style: styles.stale }, ` · ${t('staleHint')}`) : null,
          ) : (loadingCache || running ? null : h('span', { style: styles.meta }, t('never'))),
          h('div', { style: styles.toolbarRight },
            rows.length > 1 ? h('button', {
              style: styles.ghost, onClick: () => setSortMode(sortMode === 'status' ? 'name' : 'status'),
            }, sortMode === 'status' ? `⇅ ${t('sortByStatus')}` : `⇅ ${t('sortByName')}`) : null,
            expandable.length >= 2 ? h('button', { style: styles.ghost, onClick: () => setAllOpen(!allExpanded) },
              allExpanded ? t('collapseAll') : t('expandAll')) : null,
          ),
        ),
        error ? h('div', { style: styles.pageError },
          h('span', null, `${t('pageError')}: ${error}`),
          h('button', { style: { ...styles.ghost, color: 'var(--dsw-alias-state-error-primary,#dc2626)', fontWeight: 500 }, onClick: run }, t('retry')),
        ) : null,
        loadingCache && !data && !running ? h(Skeleton) : null,
        neverChecked ? h('div', { style: styles.emptyCard },
          h('div', { style: styles.emptyText }, t('emptyNever')),
          h('button', { style: styles.primary, onClick: run }, t('check')),
        ) : null,
        data && rows.length === 0 ? h('div', { style: styles.emptyCard }, h('div', { style: styles.emptyText }, t('empty'))) : null,
        rows.length > 0 ? h('div', { style: styles.chips },
          chipList.map((chip) => h('button', {
            key: chip.id,
            style: { ...styles.chip, ...(filter === chip.id ? styles.chipOn : {}) },
            onClick: () => setFilter(chip.id),
          }, chip.label, h('span', { style: styles.chipCount }, chip.count))),
        ) : null,
        ...visible.map((row) => h(PluginRow, {
          key: row.name, row, t,
          open: openNames.has(row.name),
          onToggle: toggleOpen,
        })),
      );
    }

    return {
      inject: ['slots', 'connection', 'locale'],
      apply(ctx) {
        const browserLang = (typeof navigator !== 'undefined' && navigator.language) || 'zh';
        const fallbackDict = browserLang.toLowerCase().startsWith('zh') ? dict.zh : dict.en;
        const bound = typeof ctx.locale?.bind === 'function' ? ctx.locale.bind(NS) : null;
        const t = (key) => {
          const value = bound ? bound(key) : undefined;
          if (typeof value === 'string' && value.length > 0 && value !== key) return value;
          return fallbackDict[key] ?? key;
        };
        if (ctx.locale && typeof ctx.locale.register === 'function') {
          ctx.effect(() => ctx.locale.register(NS, dict));
        }
        // keyframes for the button spinner and cache skeleton (added once)
        if (typeof document !== 'undefined' && !document.getElementById('dsh-update-checker-style')) {
          const element = document.createElement('style');
          element.id = 'dsh-update-checker-style';
          element.textContent = '@keyframes dsh-uc-spin{to{transform:rotate(360deg)}}@keyframes dsh-uc-shimmer{0%{opacity:.45}50%{opacity:.85}100%{opacity:.45}}';
          document.head.appendChild(element);
          try {
            if (typeof ctx.effect === 'function') ctx.effect(() => { element.remove(); });
          } catch { /* style cleanup is best-effort */ }
        }
        const rpcCall = async (endpoint, payload) => {
          const result = await ctx.connection.rpc.call(CHANNEL, endpoint, payload);
          if (result && result.ok) return result.value;
          throw new Error(result?.error?.message || 'rpc failed');
        };
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'update-checker',
          order: 86,
          label: () => t('sectionLabel'),
          inject: () => ({ rpcCall, t }),
        }, Page));
      },
      _internals: { parseMarkdownBody, parseInline },
    };
  },
});
