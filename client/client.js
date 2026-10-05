/**
 * Client half of dsh-update-checker: a settings-section page with a one-click
 * update check across installed third-party plugins, with release notes.
 *
 * Rebuilt on the approved translucent design language from skills-manager:
 *  - Translucent neutral system: hairline .5px borders, layered rgba surfaces, zero opaque hex fills.
 *  - 860px centered shell with 18px/600/-0.02em header + 13px secondary intro.
 *  - Tactile press feedback (:active scale ~0.97) on all interactive controls.
 *  - 32x32 tinted icon container with source-specific vector glyphs (npm / GitHub / local).
 *  - Color-mix tinted pill badges (brand / success / warn / error / neutral), no plain dot badges.
 *  - Fluid 0fr -> 1fr grid expand/collapse with 280ms cubic-bezier and visibility step.
 *  - Continuously mounted SVG chevron rotating 0deg -> 180deg.
 *  - Fully keyboard-operable trigger rows (Enter/Space, aria-expanded, aria-controls).
 *  - Refined translucent markdown typography for release notes.
 *  - Native states: shimmer skeleton card, centered CTA with 48px tinted icon circle, error banner.
 *
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

    const STATUS_TONE = {
      update: 'brand',
      latest: 'success',
      'local-latest': 'success',
      local: 'neutral',
      branch: 'neutral',
      'local-behind': 'warn',
      unknown: 'warn',
      error: 'error',
    };

    const STATUS_COLOR = {
      update: 'var(--dsw-alias-brand-primary, #4c6ef5)',
      latest: 'var(--dsw-alias-state-success-primary, #12b886)',
      local: 'var(--dsw-alias-label-caption, rgba(128,128,128,0.7))',
      'local-latest': 'var(--dsw-alias-state-success-primary, #12b886)',
      'local-behind': 'var(--dsw-alias-state-warn-primary, #e8590c)',
      branch: 'var(--dsw-alias-label-caption, rgba(128,128,128,0.7))',
      unknown: 'var(--dsw-alias-state-warn-primary, #e8590c)',
      error: 'var(--dsw-alias-state-error-primary, #e03131)',
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

    function formatDate(iso) {
      if (!iso) return '';
      try {
        const date = new Date(iso);
        if (Number.isNaN(date.getTime())) return '';
        return date.toLocaleString(undefined, {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        });
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
        if (node.t === 'b') return h('strong', { key, style: { fontWeight: 600, color: 'var(--dsw-alias-label-primary, inherit)' } }, node.text);
        if (node.t === 'c') return h('code', { key, className: 'dsh-uc-md-code' }, node.text);
        if (node.t === 'a') return h('a', { key, href: node.href, target: '_blank', rel: 'noreferrer', className: 'dsh-uc-link-strong' }, node.text);
        return h('span', { key }, node.text);
      });
    }

    function Markdown({ text }) {
      const blocks = useMemo(() => parseMarkdownBody(text), [text]);
      if (!blocks.length) return null;
      return h('div', { className: 'dsh-uc-md' }, blocks.map((block, index) => {
        const key = `b${index}`;
        switch (block.type) {
          case 'h':
            return h('div', {
              key,
              className: 'dsh-uc-md-h',
              style: {
                fontSize: Math.max(12, 14 - Math.min(block.level, 3)),
              },
            }, renderInlineNodes(block.inline, key));
          case 'p':
            return h('div', { key, className: 'dsh-uc-md-p' }, renderInlineNodes(block.inline, key));
          case 'ul':
          case 'ol':
            return h(block.type, { key, className: 'dsh-uc-md-list' },
              block.items.map((item, itemIndex) => h('li', { key: itemIndex, className: 'dsh-uc-md-item' }, renderInlineNodes(item, `${key}-${itemIndex}`))));
          case 'quote':
            return h('blockquote', { key, className: 'dsh-uc-md-quote' }, renderInlineNodes(block.inline, key));
          case 'hr':
            return h('hr', { key, className: 'dsh-uc-md-hr' });
          case 'code':
            return h('pre', { key, className: 'dsh-uc-md-pre' }, block.text);
          default:
            return null;
        }
      }));
    }

    /* Vector SVG Icons matching skills-manager style */
    function IconChevron({ size = 14, className }) {
      return h('svg', {
        width: size,
        height: size,
        className,
        viewBox: '0 0 16 16',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.3,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': 'true',
      }, h('path', { d: 'M4 6L7.29289 9.29289C7.68342 9.68342 8.31658 9.68342 8.70711 9.29289L12 6' }));
    }

    function IconRefresh({ size = 14, className }) {
      return h('svg', {
        width: size,
        height: size,
        className,
        viewBox: '0 0 16 16',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.3,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': 'true',
      },
        h('path', { d: 'M14.5 8c0 1.29-.38 2.54-1.1 3.61-.71 1.07-1.73 1.9-2.91 2.39-1.19.5-2.5.63-3.76.38-1.26-.25-2.42-.87-3.33-1.78-.91-.91-1.53-2.07-1.78-3.33-.25-1.26-.12-2.57.38-3.76.5-1.19 1.33-2.2 2.4-2.91C5.46 1.88 6.71 1.5 8 1.5c1.9 0 3.7.8 5 2.1l1.5 1.5' }),
        h('path', { d: 'M14.5 1.5V5.1h-3.6' }),
      );
    }

    function IconWarning({ size = 14, className }) {
      return h('svg', {
        width: size,
        height: size,
        className,
        viewBox: '0 0 16 16',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.2,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': 'true',
      },
        h('path', { d: 'M6.87 2.6a1.33 1.33 0 0 1 2.26 0l5.34 9.33A1.33 1.33 0 0 1 13.33 14H2.67a1.33 1.33 0 0 1-1.14-2.07Z' }),
        h('path', { d: 'M8 6v3m0 2.33h.01' }),
      );
    }

    function IconBoxPackage({ size = 16, className }) {
      return h('svg', {
        width: size,
        height: size,
        className,
        viewBox: '0 0 16 16',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.2,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': 'true',
      },
        h('path', { d: 'M8 1.6L14 4.8V11.2L8 14.4L2 11.2V4.8L8 1.6Z' }),
        h('path', { d: 'M8 1.6V14.4' }),
        h('path', { d: 'M14 4.8L8 8L2 4.8' }),
      );
    }

    function IconGithub({ size = 15, className }) {
      return h('svg', {
        width: size,
        height: size,
        className,
        viewBox: '0 0 16 16',
        fill: 'currentColor',
        'aria-hidden': 'true',
      }, h('path', { d: 'M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.012 8.012 0 0 0 16 8c0-4.42-3.58-8-8-8z' }));
    }

    function IconFolder({ size = 15, className }) {
      return h('svg', {
        width: size,
        height: size,
        className,
        viewBox: '0 0 16 16',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.1,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': 'true',
      },
        h('path', { d: 'M12.4 13.6H2.05c-.55 0-1-.45-1-1V3.4c0-.55.45-1 1-1h2.72c.24 0 .48.09.66.25l1.51 1.34c.18.16.42.25.66.25h4.8c.55 0 1 .45 1 1v1.93' }),
        h('path', { d: 'M2.56 7.94c.12-.44.51-.75.97-.75h10.12c.66 0 1.14.62.97 1.26l-1.17 4.4c-.12.44-.51.75-.97.75H2.35c-.66 0-1.14-.62-.97-1.26l1.18-4.4z' }),
      );
    }

    function SourceIcon({ kind }) {
      if (kind === 'github') return h(IconGithub, { size: 15 });
      if (kind === 'file') return h(IconFolder, { size: 15 });
      return h(IconBoxPackage, { size: 16 });
    }

    function Badge({ status, label }) {
      const tone = STATUS_TONE[status] ?? 'neutral';
      return h('span', { className: 'dsh-uc-badge', 'data-tone': tone }, label);
    }

    function renderVersionLine(row, t) {
      const installed = row.installed || '?';
      if (row.status === 'update') {
        return h(Fragment, null,
          h('span', { className: 'dsh-uc-version-label' }, `${t('installed')} `),
          h('span', { className: 'dsh-uc-mono' }, installed),
          h('span', { className: 'dsh-uc-version-arrow' }, '→'),
          h('span', { className: 'dsh-uc-mono dsh-uc-version-latest-brand' }, row.latest || '?'),
        );
      }
      if ((row.status === 'local-behind' || row.status === 'local-latest') && row.latest) {
        return h(Fragment, null,
          h('span', { className: 'dsh-uc-mono' }, installed),
          h('span', { className: 'dsh-uc-version-dot' }, '·'),
          h('span', { className: 'dsh-uc-version-label' }, `${t('upstream')} `),
          h('span', { className: `dsh-uc-mono${row.status === 'local-behind' ? ' dsh-uc-version-latest-brand' : ''}` }, row.latest),
        );
      }
      if (row.latest && row.latest !== installed) {
        return h(Fragment, null,
          h('span', { className: 'dsh-uc-version-label' }, `${t('installed')} `),
          h('span', { className: 'dsh-uc-mono' }, installed),
          h('span', { className: 'dsh-uc-version-dot' }, '·'),
          h('span', { className: 'dsh-uc-version-label' }, `${t('latestLabel')} `),
          h('span', { className: 'dsh-uc-mono' }, row.latest),
        );
      }
      return h('span', { className: 'dsh-uc-mono' }, installed);
    }

    function hasNotesRow(row) {
      const releases = row.releases ?? [];
      return releases.length > 0
        || row.status === 'update'
        || row.releasesSource === 'jsdelivr'
        || row.releasesSource === 'tags';
    }

    function ReleaseNotes({ row, t }) {
      const releases = row.releases ?? [];
      if (row.releasesSource === 'jsdelivr' || row.releasesSource === 'tags') {
        return h('div', { className: 'dsh-uc-notes' },
          h('div', { className: 'dsh-uc-note-head' }, t('tagOnlyNote')),
          h('div', { className: 'dsh-uc-tag-list' },
            releases.map((release) => h('span', {
              key: release.tag,
              className: 'dsh-uc-tag-pill',
            }, release.tag)),
          ),
        );
      }
      if (releases.length === 0) {
        return h('div', { className: 'dsh-uc-notes' },
          h('div', { className: 'dsh-uc-note-head' }, t('noNotes')),
        );
      }
      return h('div', { className: 'dsh-uc-notes' },
        h('div', { className: 'dsh-uc-note-head' }, t('releaseNotesNote')),
        releases.map((release, index) => h('div', {
          key: `${release.tag}-${index}`,
          className: 'dsh-uc-release-item',
        },
          h('div', { className: 'dsh-uc-release-head' },
            h('span', { className: 'dsh-uc-release-tag' }, release.tag),
            release.date ? h('span', { className: 'dsh-uc-release-date' }, formatDate(release.date)) : null,
            release.url ? h('a', {
              href: release.url,
              target: '_blank',
              rel: 'noreferrer',
              className: 'dsh-uc-link-strong dsh-uc-release-link',
            }, 'GitHub ↗') : null,
          ),
          release.body ? h('div', { className: 'dsh-uc-release-body' },
            h(Markdown, { text: release.body }),
          ) : null,
        )),
      );
    }

    function PluginRow({ row, t, open, onToggle }) {
      const notes = hasNotesRow(row);
      const linkUrl = row.repoUrl || row.pageUrl || row.homepage || '';
      const sourceLabel = row.kind === 'npm' ? 'npm' : row.kind === 'github' ? 'GitHub' : row.kind === 'file' ? t('localPath') : (row.kind || 'link');
      const tone = STATUS_TONE[row.status] ?? 'neutral';
      const isUpdate = row.status === 'update';
      const notesId = `dsh-uc-notes-${row.name.replace(/[^a-zA-Z0-9_-]/g, '_')}`;

      return h('div', {
        className: 'dsh-uc-card',
        'data-open': open ? 'true' : 'false',
        'data-status': row.status,
        'data-has-update': isUpdate ? 'true' : 'false',
      },
        h('div', {
          role: notes ? 'button' : undefined,
          tabIndex: notes ? 0 : undefined,
          'aria-expanded': notes ? open : undefined,
          'aria-controls': notes ? notesId : undefined,
          'aria-label': notes ? `${row.name} - ${open ? t('hideNotes') : t('viewNotes')}` : undefined,
          className: `dsh-uc-row${notes ? ' dsh-uc-row-clickable' : ''}`,
          onClick: notes ? () => onToggle(row.name) : undefined,
          onKeyDown: notes ? (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              onToggle(row.name);
            }
          } : undefined,
        },
          h('div', { className: 'dsh-uc-icon-box', 'data-tone': tone },
            h(SourceIcon, { kind: row.kind }),
          ),
          h('div', { className: 'dsh-uc-row-info' },
            h('div', { className: 'dsh-uc-row-title-row' },
              h('span', { className: 'dsh-uc-row-title' }, row.name),
              h(Badge, { status: row.status, label: t(STATUS_KEY[row.status] ?? 'statusUnknown') }),
            ),
            h('div', { className: 'dsh-uc-row-version' }, renderVersionLine(row, t)),
            row.spec ? h('div', { className: 'dsh-uc-row-spec' }, row.spec) : null,
            row.description ? h('div', { className: 'dsh-uc-row-desc' }, row.description) : null,
            row.error ? h('div', { className: 'dsh-uc-row-err' },
              h(IconWarning, { size: 12 }),
              row.error,
            ) : null,
          ),
          h('div', { className: 'dsh-uc-row-right' },
            linkUrl ? h('a', {
              href: linkUrl,
              target: '_blank',
              rel: 'noreferrer',
              className: 'dsh-uc-row-link',
              title: linkUrl,
              onClick: (event) => event.stopPropagation(),
              onKeyDown: (event) => event.stopPropagation(),
            }, `${sourceLabel} ↗`) : null,
            notes ? h('span', {
              className: 'dsh-uc-chevron',
              'aria-hidden': true,
            }, h(IconChevron)) : null,
          ),
        ),
        notes ? h('div', {
          id: notesId,
          className: 'dsh-uc-collapse',
          'data-open': open ? 'true' : 'false',
          'aria-hidden': open ? 'false' : 'true',
        },
          h('div', { className: 'dsh-uc-collapse-inner' },
            h('div', { className: 'dsh-uc-details' },
              h(ReleaseNotes, { row, t }),
            ),
          ),
        ) : null,
      );
    }

    function Skeleton() {
      return h('div', { className: 'dsh-uc-card dsh-uc-skeleton-card' },
        h('div', { className: 'dsh-uc-skeleton-bar', style: { width: '38%', height: 14 } }),
        h('div', { className: 'dsh-uc-skeleton-bar', style: { width: '62%', height: 12 } }),
        h('div', { className: 'dsh-uc-skeleton-bar', style: { width: '84%', height: 11 } }),
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
          .catch(() => {
            // Cache load failed: fall back to a live check instead of stranding
            // the page on the never-checked empty state; if that also fails,
            // run() surfaces the error banner.
            if (alive) void run();
          })
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

      // Derived lists are memoized so toggling one row's notes (an openNames
      // update) does not re-run the group count + filter + sort pipeline.
      const chipList = useMemo(() => {
        const groups = [
          { id: 'updates', label: t('filterUpdates'), count: 0 },
          { id: 'current', label: t('statusLatest'), count: 0 },
          { id: 'local', label: t('filterLocal'), count: 0 },
          { id: 'issues', label: t('filterIssues'), count: 0 },
        ];
        for (const row of rows) {
          const group = FILTER_OF[row.status];
          if (group) {
            const item = groups.find((g) => g.id === group);
            if (item) item.count += 1;
          }
        }
        return [{ id: 'all', label: t('filterAll'), count: rows.length }, ...groups.filter((item) => item.count > 0)];
      }, [rows, t]);

      // If the selected group vanished after a re-check (e.g. the only local-only
      // plugin gained an update), fall back to showing all rows instead of an
      // empty list that hides the newly available updates.
      const activeFilter = filter === 'all' || chipList.some((item) => item.id === filter) ? filter : 'all';

      const visible = useMemo(() => rows
        .filter((row) => activeFilter === 'all' || FILTER_OF[row.status] === activeFilter)
        .sort((a, b) => {
          if (sortMode === 'name') return a.name.localeCompare(b.name);
          return (STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99) || a.name.localeCompare(b.name);
        }), [rows, activeFilter, sortMode]);

      const expandable = useMemo(() => visible.filter(hasNotesRow), [visible]);
      const allExpanded = expandable.length > 0 && expandable.every((row) => openNames.has(row.name));
      const setAllOpen = (open) => {
        setOpenNames(open ? new Set(expandable.map((row) => row.name)) : new Set());
      };

      const stale = !!data?.at && Date.now() - new Date(data.at).getTime() > STALE_MS;
      const neverChecked = !loadingCache && !data && !running;

      return h('div', { className: 'dsh-uc-page' },
        h('div', { className: 'dsh-uc-header' },
          h('div', { className: 'dsh-uc-header-info' },
            h('h1', { className: 'dsh-uc-header-title' }, t('sectionLabel')),
            h('p', { className: 'dsh-uc-header-desc' }, t('intro')),
          ),
          h('div', { className: 'dsh-uc-header-actions' },
            h('button', {
              type: 'button',
              className: 'dsh-uc-btn dsh-uc-btn-primary',
              disabled: running,
              onClick: run,
            },
              h(IconRefresh, { size: 14, className: running ? 'dsh-uc-spin' : undefined }),
              running ? t('checking') : t('check'),
            ),
            data?.at ? h('div', {
              className: 'dsh-uc-header-meta',
              title: formatDate(data.at),
            },
              `${t('lastAt')}: ${formatRelative(data.at, t)}`,
              stale ? h('span', { className: 'dsh-uc-stale' }, ` · ${t('staleHint')}`) : null,
            ) : (!loadingCache && !running ? h('div', { className: 'dsh-uc-header-meta' }, t('never')) : null),
          ),
        ),
        error ? h('div', { className: 'dsh-uc-banner', 'data-tone': 'error' },
          h('div', { className: 'dsh-uc-banner-text' },
            h(IconWarning, { size: 16 }),
            h('span', null, `${t('pageError')}: ${error}`),
          ),
          h('button', {
            type: 'button',
            className: 'dsh-uc-btn dsh-uc-btn-secondary dsh-uc-btn-sm',
            onClick: run,
          }, t('retry')),
        ) : null,
        loadingCache && !data && !running ? h(Skeleton) : null,
        neverChecked ? h('div', { className: 'dsh-uc-empty-card' },
          h('div', { className: 'dsh-uc-empty-icon' },
            h(IconRefresh, { size: 22 }),
          ),
          h('p', { className: 'dsh-uc-empty-desc' }, t('emptyNever')),
          h('button', {
            type: 'button',
            className: 'dsh-uc-btn dsh-uc-btn-primary',
            onClick: run,
          },
            h(IconRefresh, { size: 14 }),
            t('check'),
          ),
        ) : null,
        data && rows.length === 0 ? h('div', { className: 'dsh-uc-empty-card' },
          h('p', { className: 'dsh-uc-empty-desc' }, t('empty')),
        ) : null,
        rows.length > 0 ? h('div', { className: 'dsh-uc-toolbar' },
          h('div', { className: 'dsh-uc-chips' },
            chipList.map((chip) => h('button', {
              key: chip.id,
              type: 'button',
              className: `dsh-uc-chip${activeFilter === chip.id ? ' dsh-uc-chip-active' : ''}`,
              onClick: () => setFilter(chip.id),
            },
              chip.label,
              h('span', { className: 'dsh-uc-chip-count' }, chip.count),
            )),
          ),
          h('div', { className: 'dsh-uc-toolbar-actions' },
            rows.length > 1 ? h('button', {
              type: 'button',
              className: 'dsh-uc-btn dsh-uc-btn-ghost dsh-uc-btn-sm',
              onClick: () => setSortMode(sortMode === 'status' ? 'name' : 'status'),
            }, sortMode === 'status' ? `⇅ ${t('sortByStatus')}` : `⇅ ${t('sortByName')}`) : null,
            expandable.length >= 2 ? h('button', {
              type: 'button',
              className: 'dsh-uc-btn dsh-uc-btn-ghost dsh-uc-btn-sm',
              onClick: () => setAllOpen(!allExpanded),
            }, allExpanded ? t('collapseAll') : t('expandAll')) : null,
          ),
        ) : null,
        rows.length > 0 ? h('div', { className: 'dsh-uc-list' },
          visible.map((row) => h(PluginRow, {
            key: row.name,
            row,
            t,
            open: openNames.has(row.name),
            onToggle: toggleOpen,
          })),
        ) : null,
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

        // Keyframes, interaction states, and accessibility adaptations
        if (typeof document !== 'undefined' && !document.getElementById('dsh-update-checker-style')) {
          const element = document.createElement('style');
          element.id = 'dsh-update-checker-style';
          element.textContent = `
/* Layout & Page Container */
.dsh-uc-page {
  box-sizing: border-box;
  width: 100%;
  max-width: 860px;
  margin: 0 auto;
  padding: 0 0 48px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  color: var(--dsw-alias-label-primary, inherit);
  font-family: inherit;
  -webkit-font-smoothing: antialiased;
}
.dsh-uc-page * {
  box-sizing: border-box;
}

/* Page Header */
.dsh-uc-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  padding-top: 4px;
}
.dsh-uc-header-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
  min-width: 0;
}
.dsh-uc-header-title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  line-height: 26px;
  letter-spacing: -0.02em;
  color: var(--dsw-alias-label-primary, inherit);
}
.dsh-uc-header-desc {
  margin: 0;
  font-size: var(--dsh-content-font-size-secondary, 13px);
  line-height: 20px;
  color: var(--dsw-alias-label-secondary, rgba(128,128,128,0.85));
}
.dsh-uc-header-actions {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 6px;
  flex: none;
}
.dsh-uc-header-meta {
  font-size: 11px;
  color: var(--dsw-alias-label-caption, rgba(128,128,128,0.75));
  white-space: nowrap;
}
.dsh-uc-stale {
  color: var(--dsw-alias-state-warn-label, #e8590c);
  font-weight: 500;
}

/* Generic Button Primitives */
.dsh-uc-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 32px;
  padding: 0 12px;
  border-radius: 7px;
  font-size: var(--dsh-content-font-size-secondary, 13px);
  font-weight: 500;
  line-height: 1;
  cursor: pointer;
  border: .5px solid transparent;
  transition: transform 120ms ease-out, background 140ms ease, border-color 140ms ease, color 140ms ease, box-shadow 140ms ease, opacity 140ms ease;
  user-select: none;
  text-decoration: none;
  -webkit-tap-highlight-color: transparent;
}
.dsh-uc-btn:active:not(:disabled) {
  transform: scale(0.97);
}
.dsh-uc-btn:disabled {
  opacity: .5;
  cursor: not-allowed;
  transform: none;
}
.dsh-uc-btn-primary {
  background: var(--dsw-alias-brand-primary, #4c6ef5);
  color: #ffffff;
  border-color: transparent;
  box-shadow: 0 1px 2px rgba(0,0,0,0.08);
}
.dsh-uc-btn-secondary {
  border-color: var(--dsw-alias-border-l1, rgba(128,128,128,0.3));
  background: var(--dsw-alias-bg-layer-1, rgba(128,128,128,0.05));
  color: var(--dsw-alias-label-primary, inherit);
}
.dsh-uc-btn-ghost {
  border-color: transparent;
  background: transparent;
  color: var(--dsw-alias-label-secondary, rgba(128,128,128,0.85));
}
.dsh-uc-btn-sm {
  height: 26px;
  padding: 0 8px;
  font-size: calc(var(--dsh-content-font-size-secondary, 13px) - 1px);
  border-radius: 5px;
}

/* Spinner & Keyframes (REQUIRED CONTRACT: dsh-uc-spin and dsh-uc-shimmer) */
.dsh-uc-spin {
  animation: dsh-uc-spin 800ms linear infinite;
}
@keyframes dsh-uc-spin {
  to { transform: rotate(360deg); }
}
@keyframes dsh-uc-shimmer {
  0% { opacity: .45; }
  50% { opacity: .85; }
  100% { opacity: .45; }
}

/* Toolbar & Filter Chips */
.dsh-uc-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
  padding: 2px 0;
}
.dsh-uc-chips {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.dsh-uc-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 26px;
  padding: 0 10px;
  border-radius: 13px;
  border: .5px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.25));
  background: var(--dsw-alias-bg-layer-1, rgba(128,128,128,0.05));
  color: var(--dsw-alias-label-secondary, rgba(128,128,128,0.85));
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  user-select: none;
  transition: transform 120ms ease, background 140ms ease, border-color 140ms ease, color 140ms ease;
  -webkit-tap-highlight-color: transparent;
}
.dsh-uc-chip:active {
  transform: scale(0.97);
}
.dsh-uc-chip-active {
  background: color-mix(in srgb, var(--dsw-alias-brand-primary, #4c6ef5) 12%, transparent) !important;
  border-color: color-mix(in srgb, var(--dsw-alias-brand-primary, #4c6ef5) 40%, transparent) !important;
  color: var(--dsw-alias-brand-primary, #4c6ef5) !important;
}
.dsh-uc-chip-count {
  font-size: 11px;
  opacity: 0.8;
  font-variant-numeric: tabular-nums;
}
.dsh-uc-toolbar-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
}

/* Pill Badges (translucent tinted, no dot) */
.dsh-uc-badge {
  display: inline-flex;
  align-items: center;
  height: 20px;
  padding: 0 8px;
  border-radius: 10px;
  font-size: 11px;
  font-weight: 500;
  line-height: 1;
  letter-spacing: .01em;
  white-space: nowrap;
  flex: none;
}
.dsh-uc-badge[data-tone="brand"] {
  background: color-mix(in srgb, var(--dsw-alias-brand-primary, #4c6ef5) 12%, transparent);
  color: var(--dsw-alias-brand-primary, #4c6ef5);
}
.dsh-uc-badge[data-tone="success"] {
  background: color-mix(in srgb, var(--dsw-alias-state-success-primary, #12b886) 12%, transparent);
  color: var(--dsw-alias-state-success-primary, #12b886);
}
.dsh-uc-badge[data-tone="neutral"] {
  background: var(--dsw-alias-bg-layer-2, rgba(128,128,128,0.14));
  color: var(--dsw-alias-label-secondary, rgba(128,128,128,0.9));
}
.dsh-uc-badge[data-tone="warn"] {
  background: color-mix(in srgb, var(--dsw-alias-state-warn-primary, #e8590c) 14%, transparent);
  color: var(--dsw-alias-state-warn-label, #e8590c);
}
.dsh-uc-badge[data-tone="error"] {
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #e03131) 14%, transparent);
  color: var(--dsw-alias-state-error-primary, #e03131);
}

/* Plugin Card List */
.dsh-uc-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.dsh-uc-card {
  display: flex;
  flex-direction: column;
  border-radius: var(--dsw-radius-lg, 10px);
  border: .5px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.3));
  background: var(--dsw-alias-bg-layer-1, rgba(128,128,128,0.04));
  transition: border-color 160ms ease, background 160ms ease, box-shadow 160ms ease;
  overflow: hidden;
}
.dsh-uc-card[data-has-update="true"] {
  border-color: color-mix(in srgb, var(--dsw-alias-brand-primary, #4c6ef5) 35%, var(--dsw-alias-border-l1, rgba(128,128,128,0.3)));
}
.dsh-uc-card[data-open="true"] {
  border-color: var(--dsw-alias-border-l2, rgba(128,128,128,0.6));
  background: var(--dsw-alias-bg-layer-1, rgba(128,128,128,0.06));
  box-shadow: 0 4px 18px rgba(0,0,0,0.04);
}

/* Card Trigger Row */
.dsh-uc-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  width: 100%;
  min-height: 52px;
  padding: 10px 14px;
  border: none;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  user-select: none;
  transition: background 140ms ease;
}
.dsh-uc-row-clickable {
  cursor: pointer;
}
.dsh-uc-row-clickable:active {
  background: var(--dsw-alias-bg-layer-2, rgba(128,128,128,0.08));
  transform: scale(0.995);
}

/* 32x32 Icon Container */
.dsh-uc-icon-box {
  width: 32px;
  height: 32px;
  border-radius: 7px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  margin-top: 1px;
  transition: transform 140ms ease;
  background: color-mix(in srgb, var(--dsw-alias-brand-primary, #4c6ef5) 12%, transparent);
  color: var(--dsw-alias-brand-primary, #4c6ef5);
}
.dsh-uc-icon-box[data-tone="success"] {
  background: color-mix(in srgb, var(--dsw-alias-state-success-primary, #12b886) 12%, transparent);
  color: var(--dsw-alias-state-success-primary, #12b886);
}
.dsh-uc-icon-box[data-tone="neutral"] {
  background: var(--dsw-alias-bg-layer-2, rgba(128,128,128,0.14));
  color: var(--dsw-alias-label-secondary, rgba(128,128,128,0.9));
}
.dsh-uc-icon-box[data-tone="warn"] {
  background: color-mix(in srgb, var(--dsw-alias-state-warn-primary, #e8590c) 14%, transparent);
  color: var(--dsw-alias-state-warn-label, #e8590c);
}
.dsh-uc-icon-box[data-tone="error"] {
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #e03131) 14%, transparent);
  color: var(--dsw-alias-state-error-primary, #e03131);
}

/* Trigger Info */
.dsh-uc-row-info {
  display: flex;
  flex-direction: column;
  gap: 3px;
  flex: 1;
  min-width: 0;
}
.dsh-uc-row-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.dsh-uc-row-title {
  font-size: 14px;
  font-weight: 600;
  font-family: var(--dsh-code-font-family, ui-monospace, SFMono-Regular, Consolas, monospace);
  color: var(--dsw-alias-label-primary, inherit);
  letter-spacing: -0.01em;
}
.dsh-uc-row-version {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--dsh-content-font-size-secondary, 13px);
  color: var(--dsw-alias-label-secondary, rgba(128,128,128,0.85));
  flex-wrap: wrap;
  line-height: 18px;
}
.dsh-uc-version-label {
  font-size: 12px;
  color: var(--dsw-alias-label-caption, rgba(128,128,128,0.7));
}
.dsh-uc-version-dot, .dsh-uc-version-arrow {
  color: var(--dsw-alias-label-caption, rgba(128,128,128,0.6));
  user-select: none;
  font-size: 12px;
}
.dsh-uc-version-latest-brand {
  color: var(--dsw-alias-brand-primary, #4c6ef5);
  font-weight: 600;
}
.dsh-uc-mono {
  font-family: var(--dsh-code-font-family, ui-monospace, SFMono-Regular, Consolas, monospace);
}
.dsh-uc-row-spec {
  font-size: 11px;
  font-family: var(--dsh-code-font-family, ui-monospace, SFMono-Regular, Consolas, monospace);
  color: var(--dsw-alias-label-caption, rgba(128,128,128,0.7));
  word-break: break-all;
  line-height: 14px;
}
.dsh-uc-row-desc {
  font-size: 12px;
  color: var(--dsw-alias-label-secondary, rgba(128,128,128,0.85));
  line-height: 1.5;
}
.dsh-uc-row-err {
  font-size: 12px;
  color: var(--dsw-alias-state-error-primary, #e03131);
  font-weight: 500;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  line-height: 16px;
}

/* Trigger Row Right Side */
.dsh-uc-row-right {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: none;
  margin-top: 2px;
}
.dsh-uc-row-link {
  font-size: 12px;
  color: var(--dsw-alias-label-caption, rgba(128,128,128,0.75));
  text-decoration: none;
  padding: 3px 6px;
  border-radius: 5px;
  transition: color 120ms ease, background 120ms ease;
  white-space: nowrap;
}
.dsh-uc-chevron {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--dsw-alias-label-caption, rgba(128,128,128,0.7));
  transform: rotate(0deg);
  transition: transform 240ms cubic-bezier(0.23, 1, 0.32, 1), color 140ms ease;
  flex: none;
}
.dsh-uc-card[data-open="true"] .dsh-uc-chevron {
  transform: rotate(180deg);
  color: var(--dsw-alias-label-primary, inherit);
}

/* Expandable Release Notes */
.dsh-uc-collapse {
  display: grid;
  grid-template-rows: 0fr;
  opacity: 0;
  visibility: hidden;
  transition: grid-template-rows 280ms cubic-bezier(0.23, 1, 0.32, 1), opacity 200ms ease-out, visibility 280ms step-end;
}
.dsh-uc-collapse[data-open="true"] {
  grid-template-rows: 1fr;
  opacity: 1;
  visibility: visible;
  transition: grid-template-rows 280ms cubic-bezier(0.23, 1, 0.32, 1), opacity 200ms ease-out, visibility 0s step-start;
}
.dsh-uc-collapse-inner {
  min-height: 0;
  overflow: hidden;
}
.dsh-uc-details {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px 14px 14px;
  border-top: .5px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.2));
  transform: translateY(-4px);
  transition: transform 240ms cubic-bezier(0.23, 1, 0.32, 1);
}
.dsh-uc-collapse[data-open="true"] .dsh-uc-details {
  transform: translateY(0);
}

/* Release Notes Items */
.dsh-uc-notes {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.dsh-uc-note-head {
  font-size: 11px;
  font-weight: 500;
  color: var(--dsw-alias-label-caption, rgba(128,128,128,0.75));
  letter-spacing: 0.01em;
}
.dsh-uc-release-item {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-top: 10px;
}
.dsh-uc-release-item:not(:first-child) {
  border-top: .5px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.18));
}
.dsh-uc-release-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.dsh-uc-release-tag {
  font-size: 12px;
  font-weight: 600;
  font-family: var(--dsh-code-font-family, ui-monospace, SFMono-Regular, Consolas, monospace);
  color: var(--dsw-alias-label-primary, inherit);
}
.dsh-uc-release-date {
  font-size: 11px;
  color: var(--dsw-alias-label-caption, rgba(128,128,128,0.7));
}
.dsh-uc-release-link {
  margin-left: auto;
  font-size: 11px;
}
.dsh-uc-release-body {
  font-size: 12px;
  line-height: 1.6;
  color: var(--dsw-alias-label-secondary, rgba(128,128,128,0.85));
}

/* Tag list for tag-only / jsdelivr mode */
.dsh-uc-tag-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 4px;
}
.dsh-uc-tag-pill {
  font-family: var(--dsh-code-font-family, ui-monospace, SFMono-Regular, Consolas, monospace);
  font-size: 11px;
  background: var(--dsw-alias-bg-layer-2, rgba(128,128,128,0.12));
  color: var(--dsw-alias-label-secondary, rgba(128,128,128,0.9));
  padding: 2px 7px;
  border-radius: 4px;
  border: .5px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.25));
}

/* Restyled Markdown Elements */
.dsh-uc-md {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.dsh-uc-md-h {
  font-weight: 600;
  color: var(--dsw-alias-label-primary, inherit);
  letter-spacing: -0.01em;
  margin: 4px 0 0;
}
.dsh-uc-md-p {
  margin: 0;
  line-height: 1.6;
}
.dsh-uc-md-list {
  margin: 0;
  padding-left: 18px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.dsh-uc-md-item {
  line-height: 1.5;
}
.dsh-uc-md-quote {
  margin: 0;
  padding: 3px 0 3px 12px;
  border-left: 2px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.3));
  color: var(--dsw-alias-label-secondary, rgba(128,128,128,0.85));
}
.dsh-uc-md-hr {
  border: none;
  border-top: .5px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.2));
  margin: 6px 0;
}
.dsh-uc-md-code {
  font-family: var(--dsh-code-font-family, ui-monospace, SFMono-Regular, Consolas, monospace);
  font-size: 11px;
  background: rgba(128,128,128,0.08);
  border-radius: 4px;
  padding: 2px 5px;
  border: .5px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.2));
}
.dsh-uc-md-pre {
  font-family: var(--dsh-code-font-family, ui-monospace, SFMono-Regular, Consolas, monospace);
  font-size: 11px;
  background: var(--dsw-alias-markdown-code-block, rgba(128,128,128,0.06));
  border-radius: 8px;
  padding: 10px 12px;
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  overflow-x: auto;
  border: .5px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.25));
  line-height: 1.5;
  color: var(--dsw-alias-label-secondary, rgba(128,128,128,0.9));
}

/* Links */
.dsh-uc-link-strong {
  font-size: 12px;
  color: var(--dsw-alias-brand-primary, #4c6ef5);
  text-decoration: none;
  border-radius: 3px;
  padding: 1px 3px;
  transition: color 120ms ease, opacity 120ms ease;
}
.dsh-uc-link-strong:active {
  opacity: 0.7;
}

/* Empty States & Banners */
.dsh-uc-empty-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 44px 24px;
  border-radius: var(--dsw-radius-lg, 10px);
  border: .5px dashed var(--dsw-alias-border-l1, rgba(128,128,128,0.35));
  background: var(--dsw-alias-bg-layer-1, rgba(128,128,128,0.03));
  margin: 8px 0;
  gap: 10px;
}
.dsh-uc-empty-icon {
  width: 48px;
  height: 48px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in srgb, var(--dsw-alias-brand-primary, #4c6ef5) 12%, transparent);
  color: var(--dsw-alias-brand-primary, #4c6ef5);
  margin-bottom: 2px;
}
.dsh-uc-empty-desc {
  margin: 0;
  font-size: var(--dsh-content-font-size-secondary, 13px);
  color: var(--dsw-alias-label-secondary, rgba(128,128,128,0.85));
  max-width: 440px;
  line-height: 1.5;
}

.dsh-uc-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 14px;
  border-radius: var(--dsw-radius-lg, 10px);
  border: .5px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.3));
  background: var(--dsw-alias-bg-layer-1, rgba(128,128,128,0.06));
  color: var(--dsw-alias-label-secondary, rgba(128,128,128,0.85));
  font-size: var(--dsh-content-font-size-secondary, 13px);
}
.dsh-uc-banner[data-tone="error"] {
  border-color: var(--dsw-alias-state-error-primary, #e03131);
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #e03131) 8%, transparent);
  color: var(--dsw-alias-state-error-primary, #e03131);
}
.dsh-uc-banner-text {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
}

/* Skeleton */
.dsh-uc-skeleton-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px 18px;
}
.dsh-uc-skeleton-bar {
  border-radius: 6px;
  background: var(--dsw-alias-bg-layer-2, rgba(128,128,128,0.12));
  animation: dsh-uc-shimmer 1.4s ease-in-out infinite;
}

/* Focus Visible */
.dsh-uc-btn:focus-visible,
.dsh-uc-chip:focus-visible,
.dsh-uc-row-clickable:focus-visible,
.dsh-uc-row-link:focus-visible,
.dsh-uc-link-strong:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary, #4c6ef5);
  outline-offset: 2px;
}

/* Hover Gating */
@media (hover: hover) and (pointer: fine) {
  .dsh-uc-btn-primary:hover:not(:disabled) {
    filter: brightness(1.06);
  }
  .dsh-uc-btn-secondary:hover:not(:disabled) {
    background: var(--dsw-alias-bg-layer-2, rgba(128,128,128,0.15));
    border-color: var(--dsw-alias-border-l2, rgba(128,128,128,0.5));
  }
  .dsh-uc-btn-ghost:hover:not(:disabled) {
    background: var(--dsw-alias-bg-layer-2, rgba(128,128,128,0.12));
    color: var(--dsw-alias-label-primary, inherit);
  }
  .dsh-uc-chip:hover {
    background: var(--dsw-alias-bg-layer-2, rgba(128,128,128,0.12));
    color: var(--dsw-alias-label-primary, inherit);
  }
  .dsh-uc-card:hover {
    border-color: var(--dsw-alias-border-l2, rgba(128,128,128,0.5));
    background: var(--dsw-alias-bg-layer-1, rgba(128,128,128,0.07));
  }
  .dsh-uc-row-link:hover {
    color: var(--dsw-alias-label-primary, inherit);
    background: var(--dsw-alias-bg-layer-2, rgba(128,128,128,0.12));
  }
  .dsh-uc-link-strong:hover {
    text-decoration: underline;
  }
}

/* Reduced Motion */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    transition-duration: 1ms !important;
    animation-duration: 1ms !important;
  }
}
`;
          document.head.appendChild(element);
          try {
            if (typeof ctx.effect === 'function') ctx.effect(() => () => { element.remove(); });
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
