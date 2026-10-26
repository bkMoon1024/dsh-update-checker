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
 *  - Dedicated disclosure button per expandable row (aria-expanded, aria-controls),
 *    plus whole-row mouse toggle.
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
        statusLocalAhead: '本地 · 领先上游',
        statsLine: '本次扫描 %d 次请求 · %d 次缓存命中',
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
        filterIssues: '需关注',
        filterSource: '来源',
        filterSourceAll: '全部来源',
        filterSourceLocal: '本地',
        pendingUpdates: '有 %d 个插件可以更新',
        batchUpdateHintShort: '新建对话并填入更新清单，由你发送',
        reminderStatusOn: '已开启',
        reminderStatusOff: '已关闭',
        reminderConfigure: '设置',
        reminderCollapse: '收起',
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
        askAi: '让 AI 更新',
        askAiHint: '在输入框填好更新指令，发送后由 AI 执行',
        askAiCopied: '已复制更新指令，粘贴到输入框发送即可',
        askAiNoSession: '当前没有打开的会话，请先新建会话',
        updateAction: '让 AI 更新',
        askAiPrompt: '帮我更新 %s 插件',
        batchUpdate: '一键更新',
        batchUpdateHint: '新建一个对话，把更新清单填进输入框，由你确认后发送',
        batchUpdateSent: '已新建对话并填好更新清单',
        batchUpdateDraft: '已填入输入框，按发送即可',
        batchUpdateEmpty: '当前没有可更新的插件',
        batchUpdatePrompt: '帮我更新这些检测到新版本的 DSH 插件，逐个更新，完成后告诉我每个插件的结果。',
        batchUpdateProfile: 'profile：%s，插件装在该 profile 下。',
        reminderTitle: '有 %d 个插件可以更新',
        reminderEntry: '插件更新',
        reminderPending: '%d 个可更新',
        reminderIgnoreOnce: '忽略本次提醒',
        reminderIgnoreAll: '全部忽略',
        reminderCheck: '立即检查',
        reminderChecking: '检查中…',
        reminderCheckingElapsed: '检查中… %ds',
        reminderCheckFailed: '检查失败，请稍后再试',
        reminderCheckTimeout: '检查超时，请稍后再试',
        reminderCheckedNow: '刚刚已检查',
        reminderEmpty: '没有待更新的插件。',
        reminderNever: '还没检查过插件更新。',
        reminderError: '上次检查失败',
        reminderNoToken: 'GitHub 匿名限额较低，配置 token 可减少失败',
        reminderIgnored: '已忽略，出现新版本时会再次提醒',
        reminderSection: '后台提醒',
        reminderAutoCheck: '自动检查',
        reminderEnabled: '定时检查插件更新',
        reminderEnabledHint: '开启后会在后台定期检查，发现新版本时在左下角提醒。',
        reminderInterval: '检查频率',
        reminderIntervalMin: '每 %d 分钟',
        reminderIntervalHour: '每 %d 小时',
        reminderLastAt: '上次检查：%s',
        reminderNeverChecked: '尚未检查',
        reminderSaveFailed: '设置保存失败',
        every30m: '每 30 分钟',
        every1h: '每小时',
        every2h: '每 2 小时',
        every6h: '每 6 小时',
        everyCustom: '每 %d 分钟',
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
        statusLocalAhead: 'Local · ahead of upstream',
        statsLine: 'This scan: %d requests · %d cache hits',
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
        filterIssues: 'Attention',
        filterSource: 'Source',
        filterSourceAll: 'All sources',
        filterSourceLocal: 'Local',
        pendingUpdates: '%d plugin updates available',
        batchUpdateHintShort: 'Opens a new conversation with the list filled in — you send it',
        reminderStatusOn: 'On',
        reminderStatusOff: 'Off',
        reminderConfigure: 'Settings',
        reminderCollapse: 'Done',
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
        askAi: 'Ask AI to update',
        askAiHint: 'Fills the composer with an update request for the AI to run',
        askAiCopied: 'Update request copied — paste it in the composer to send',
        askAiNoSession: 'No open session — start one first',
        updateAction: 'Ask AI to update',
        askAiPrompt: 'Please update the %s plugin',
        batchUpdate: 'Update all',
        batchUpdateHint: 'Opens a new conversation with the update list in the composer, for you to send',
        batchUpdateSent: 'Opened a new conversation with the update list filled in',
        batchUpdateDraft: 'Filled the composer — press send',
        batchUpdateEmpty: 'Nothing to update right now',
        batchUpdatePrompt: 'Please update these DSH plugins that have newer versions. Update them one by one and report the result for each.',
        batchUpdateProfile: 'Profile: %s — the plugins are installed in this profile.',
        reminderTitle: '%d plugin updates available',
        reminderEntry: 'Plugin updates',
        reminderPending: '%d to update',
        reminderIgnoreOnce: 'Dismiss for now',
        reminderIgnoreAll: 'Ignore all',
        reminderCheck: 'Check now',
        reminderChecking: 'Checking…',
        reminderCheckingElapsed: 'Checking… %ds',
        reminderCheckFailed: 'Check failed — try again',
        reminderCheckTimeout: 'The check timed out — try again',
        reminderCheckedNow: 'Checked just now',
        reminderEmpty: 'Nothing to update.',
        reminderNever: 'Plugin updates have not been checked yet.',
        reminderError: 'Last check failed',
        reminderNoToken: 'Anonymous GitHub quota is low — set a token to reduce failures',
        reminderIgnored: 'Dismissed; it returns when a newer version appears',
        reminderSection: 'Background reminder',
        reminderAutoCheck: 'Auto check',
        reminderEnabled: 'Check for plugin updates on a schedule',
        reminderEnabledHint: 'Checks in the background and shows a reminder in the bottom-left corner when updates appear.',
        reminderInterval: 'Frequency',
        reminderIntervalMin: 'Every %d min',
        reminderIntervalHour: 'Every %d h',
        reminderLastAt: 'Last check: %s',
        reminderNeverChecked: 'Not checked yet',
        reminderSaveFailed: 'Could not save settings',
        every30m: 'Every 30 min',
        every1h: 'Hourly',
        every2h: 'Every 2 hours',
        every6h: 'Every 6 hours',
        everyCustom: 'Every %d min',
      },
    };

    const STATUS_KEY = {
      update: 'statusUpdate',
      latest: 'statusLatest',
      local: 'statusLocal',
      'local-latest': 'statusLocalLatest',
      'local-behind': 'statusLocalBehind',
      'local-ahead': 'statusLocalAhead',
      branch: 'statusBranch',
      unknown: 'statusUnknown',
      error: 'statusError',
    };

    const STATUS_TONE = {
      update: 'brand',
      // An up-to-date plugin is the resting state, not an achievement: keeping
      // every healthy row green turns the list into a wall of success color.
      latest: 'neutral',
      'local-latest': 'neutral',
      'local-ahead': 'neutral',
      local: 'neutral',
      branch: 'neutral',
      'local-behind': 'warn',
      unknown: 'warn',
      error: 'error',
    };

    const STATUS_COLOR = {
      update: 'var(--dsw-alias-link, #4176e6)',
      latest: 'var(--dsw-alias-state-success-primary, #12b886)',
      local: 'var(--dsw-alias-label-caption, rgba(128,128,128,0.7))',
      'local-latest': 'var(--dsw-alias-state-success-primary, #12b886)',
      'local-ahead': 'var(--dsw-alias-state-success-primary, #12b886)',
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
      'local-ahead': 4,
      branch: 5,
      local: 6,
    };

    /** Status → filter chip group ('branch' and 'local' show under All only). */
    const FILTER_OF = {
      update: 'updates',
      'local-behind': 'updates',
      latest: 'current',
      'local-latest': 'current',
      'local-ahead': 'current',
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

    // Release notes and repo/page URLs come from arbitrary upstream
    // repositories — untrusted input. Only http(s) may become an anchor:
    // `javascript:` and friends render as plain text (React does not
    // sanitize URL schemes for us).
    const SAFE_HREF_RE = /^https?:\/\//i;
    function safeHref(href) {
      return typeof href === 'string' && SAFE_HREF_RE.test(href) ? href : '';
    }

    function renderInlineNodes(nodes, keyBase) {
      return nodes.map((node, index) => {
        const key = `${keyBase}-${index}`;
        if (node.t === 'b') return h('strong', { key, style: { fontWeight: 600, color: 'var(--dsw-alias-label-primary, inherit)' } }, node.text);
        if (node.t === 'c') return h('code', { key, className: 'dsh-uc-md-code' }, node.text);
        if (node.t === 'a') {
          const href = safeHref(node.href);
          if (href) return h('a', { key, href, target: '_blank', rel: 'noreferrer', className: 'dsh-uc-link-strong' }, node.text);
          return h('span', { key }, node.text);
        }
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

    function IconArrowUp({ size = 16, className }) {
      return h('svg', {
        width: size,
        height: size,
        className,
        viewBox: '0 0 16 16',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.4,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': 'true',
      },
        h('path', { d: 'M8 12.5v-9' }),
        h('path', { d: 'M4.2 7.3L8 3.5l3.8 3.8' }),
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
      if ((row.status === 'local-behind' || row.status === 'local-latest' || row.status === 'local-ahead') && row.latest) {
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
      // A tag-only fallback with zero tags would expand to an empty box.
      return releases.length > 0 || row.status === 'update';
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
            safeHref(release.url) ? h('a', {
              href: safeHref(release.url),
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

    /**
     * Composer actions for the open session, or undefined when no session is
     * mounted. `setDraft` / `submit` are the host's own input actions, so a
     * plugin hands text over instead of driving the editor itself.
     */
    function resolveUiSession(ctx) {
      let uiSession;
      try {
        uiSession = typeof ctx.get === 'function' ? ctx.get('uiSession') : undefined;
      } catch {
        uiSession = undefined;
      }
      return uiSession ?? ctx.uiSession;
    }

    function resolveInputActions(ctx) {
      return resolveUiSession(ctx)?.adapter?.current?.getSnapshot?.()?.props?.inputActions;
    }

    /** Workspace navigation, which owns the "new conversation" entry point. */
    function resolveWorkspaceNavigation(ctx) {
      let navigation;
      try {
        navigation = typeof ctx.get === 'function' ? ctx.get('uiWorkspace') : undefined;
      } catch {
        navigation = undefined;
      }
      return navigation ?? ctx.uiWorkspace;
    }

    function copyToClipboard(text) {
      try {
        if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
          void navigator.clipboard.writeText(text);
          return true;
        }
      } catch {
        /* no clipboard either */
      }
      return false;
    }

    /**
     * Prefill the composer with an update request for one plugin. Returns the
     * outcome so callers can tell the user what happened: 'draft' when the
     * composer took the text, 'clipboard' when only a copy was possible.
     */
    function fillComposerDraft(ctx, text) {
      const actions = resolveInputActions(ctx);
      if (actions && typeof actions.setDraft === 'function') {
        try {
          actions.setDraft(text);
          return 'draft';
        } catch {
          /* fall through to the clipboard */
        }
      }
      return copyToClipboard(text) ? 'clipboard' : 'none';
    }

    /**
     * Start a fresh conversation and leave the text in its composer, unsent.
     *
     * `uiWorkspace.startSession()` only kicks off creation: the new session is
     * mounted asynchronously, so the composer that can take the draft does not
     * exist yet when it returns. We therefore watch the main binding until it
     * points at a different session that has input actions, then fill it.
     *
     * Returns 'session' when a new conversation was started (the draft lands as
     * soon as its composer mounts), and falls back to the current composer, the
     * clipboard, or nothing when no new conversation can be started.
     */
    function draftInNewSession(ctx, text) {
      const navigation = resolveWorkspaceNavigation(ctx);
      const source = resolveUiSession(ctx)?.adapter?.current;
      const start = navigation?.startSession;
      if (typeof start !== 'function' || typeof source?.getSnapshot !== 'function') {
        return fillComposerDraft(ctx, text);
      }
      const before = source.getSnapshot()?.key;
      let settled = false;
      let unsubscribe = () => {};
      let timer = null;
      const settle = (outcome) => {
        if (settled) return outcome;
        settled = true;
        try { unsubscribe(); } catch { /* already gone */ }
        if (timer !== null) clearTimeout(timer);
        return outcome;
      };
      // The new session's binding carries its own input actions; the old one's
      // must not be reused, or the draft would land in the previous chat.
      const fillIfReady = () => {
        const snapshot = source.getSnapshot?.();
        if (!snapshot || snapshot.key === before) return false;
        const actions = snapshot.props?.inputActions;
        if (!actions || typeof actions.setDraft !== 'function') return false;
        try {
          actions.setDraft(text);
        } catch {
          return settle(copyToClipboard(text) ? 'clipboard' : 'none');
        }
        return settle('session');
      };
      try {
        const started = start.call(navigation);
        if (started && typeof started.catch === 'function') started.catch(() => settle('none'));
      } catch {
        return fillComposerDraft(ctx, text);
      }
      if (fillIfReady()) return 'session';
      try {
        unsubscribe = source.subscribe?.(() => { fillIfReady(); }) ?? (() => {});
      } catch {
        /* no subscription channel: the timeout below still covers us */
      }
      timer = setTimeout(() => {
        if (settled) return;
        copyToClipboard(text);
        settle('clipboard');
      }, 10000);
      timer.unref?.();
      return 'session';
    }

    /** Rows whose upstream is ahead: the ones a batch update should cover. */
    function isActionable(row) {
      return row?.status === 'update' || row?.status === 'local-behind';
    }

    /**
     * One prompt covering every actionable row. The spec is included because it
     * is the only thing that tells the AI *how* each plugin is installed: an npm
     * or GitHub spec is re-added, a `file:` / `link:` spec is a local checkout
     * that has to be pulled instead.
     */
    function buildBatchPrompt(rows, t, profileDir) {
      const list = rows.map((row, index) => {
        const from = row.installed || '?';
        const to = row.latest || '?';
        const spec = row.spec ? `（${row.spec}）` : '';
        return `${index + 1}. ${row.name}  ${from} → ${to}${spec}`;
      });
      const profile = typeof profileDir === 'string' && profileDir !== ''
        ? profileDir.replace(/[\\/]+$/, '').split(/[\\/]/).pop()
        : '';
      const parts = [t('batchUpdatePrompt')];
      if (profile) parts.push(t('batchUpdateProfile').replace('%s', profile));
      parts.push(list.join('\n'));
      return parts.join('\n');
    }

    function PluginRow({ row, t, open, onToggle, onAskAi }) {
      const notes = hasNotesRow(row);
      // Mount notes on first open and keep them mounted afterwards, so the
      // close animation still has content while never parsing markdown for
      // rows the user never expands.
      const [everOpen, setEverOpen] = useState(open);
      useEffect(() => { if (open) setEverOpen(true); }, [open]);
      const linkUrl = safeHref(row.repoUrl || row.pageUrl || row.homepage || '');
      const sourceLabel = row.kind === 'npm' ? 'npm' : row.kind === 'github' ? 'GitHub' : row.kind === 'file' ? t('localPath') : (row.kind || 'link');
      const tone = STATUS_TONE[row.status] ?? 'neutral';
      // A local checkout that trails upstream needs the same action as an npm
      // row with a newer version; gating on `update` alone left those rows with
      // no button at all while still listing them under "有更新".
      const canUpdate = isActionable(row);
      const notesId = `dsh-uc-notes-${row.name.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
      const hasDetails = notes || row.spec || row.description;

      return h('div', {
        className: 'dsh-uc-card',
        'data-open': open ? 'true' : 'false',
        'data-status': row.status,
        'data-has-update': canUpdate ? 'true' : 'false',
      },
        h('div', {
          className: `dsh-uc-row${hasDetails ? ' dsh-uc-row-clickable' : ''}`,
          onClick: hasDetails ? () => onToggle(row.name) : undefined,
        },
          h('div', { className: 'dsh-uc-icon-box', 'data-tone': tone },
            h(SourceIcon, { kind: row.kind }),
          ),
          h('div', { className: 'dsh-uc-row-info' },
            h('div', { className: 'dsh-uc-row-title-row' },
              h('span', { className: 'dsh-uc-row-title' }, row.name),
              h(Badge, { status: row.status, label: t(STATUS_KEY[row.status] ?? 'statusUnknown') }),
              h('span', { className: 'dsh-uc-row-version' }, renderVersionLine(row, t)),
            ),
            row.description ? h('div', { className: 'dsh-uc-row-desc' }, row.description) : null,
            row.error ? h('div', { className: 'dsh-uc-row-err' },
              h(IconWarning, { size: 12 }),
              row.error,
            ) : null,
          ),
          h('div', { className: 'dsh-uc-row-right' },
            canUpdate ? h('button', {
              type: 'button',
              className: 'dsh-uc-btn dsh-uc-btn-sm dsh-uc-row-update',
              title: t('askAiHint'),
              onClick: (event) => { event.stopPropagation(); onAskAi(row); },
            }, t('updateAction')) : null,
            linkUrl ? h('a', {
              href: linkUrl,
              target: '_blank',
              rel: 'noreferrer',
              className: 'dsh-uc-row-link',
              title: linkUrl,
              onClick: (event) => event.stopPropagation(),
            }, `${sourceLabel} ↗`) : null,
            hasDetails ? h('button', {
              type: 'button',
              className: 'dsh-uc-chevron-btn',
              'aria-expanded': open,
              'aria-controls': notesId,
              'aria-label': `${row.name} - ${open ? t('hideNotes') : t('viewNotes')}`,
              onClick: (event) => { event.stopPropagation(); onToggle(row.name); },
            }, h(IconChevron)) : null,
          ),
        ),
        hasDetails ? h('div', {
          id: notesId,
          className: 'dsh-uc-collapse',
          'data-open': open ? 'true' : 'false',
          'aria-hidden': open ? 'false' : 'true',
        },
          h('div', { className: 'dsh-uc-collapse-inner' },
            h('div', { className: 'dsh-uc-details' },
              // The row already shows a one-line clamp, so the full text only
              // mounts once the panel has actually been opened.
              everOpen || open
                ? (row.description ? h('div', { className: 'dsh-uc-detail-desc' }, row.description) : null) : null,
              row.spec ? h('div', { className: 'dsh-uc-row-spec' }, row.spec) : null,
              // A row can be expandable for its description alone; only an
              // upstream with notes should claim there are notes to read.
              notes && (everOpen || open) ? h(ReleaseNotes, { row, t }) : null,
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

    const INTERVAL_LABEL_KEY = { 30: 'every30m', 60: 'every1h', 120: 'every2h', 360: 'every6h' };
    const INTERVAL_CHOICES = [30, 60, 120, 360];

    /**
     * Background-reminder controls. Leads the page, above the plugin list, so
     * the one setting people come here to change is visible without scrolling
     * past every installed plugin.
     */
    function ReminderSettings({ rpcCall, t }) {
      const [state, setState] = useState(null);
      const [saving, setSaving] = useState(false);
      const [failed, setFailed] = useState(false);
      const [expanded, setExpanded] = useState(false);

      useEffect(() => {
        let alive = true;
        rpcCall('reminder.state', undefined)
          .then((value) => { if (alive) setState(value); })
          .catch(() => { /* the block stays hidden when the host is unreachable */ });
        return () => { alive = false; };
      }, []);

      const save = async (patch) => {
        setSaving(true);
        setFailed(false);
        try {
          const value = await rpcCall('config.set', patch);
          setState((previous) => ({ ...previous, config: value?.config ?? previous?.config }));
        } catch {
          setFailed(true);
        } finally {
          setSaving(false);
        }
      };

      if (!state?.config) return null;
      const config = state.config;
      // config.json may hold an interval written outside the presets (hand
      // edit, older build); show it instead of silently selecting 30 min.
      const intervalOptions = INTERVAL_CHOICES.includes(config.intervalMinutes)
        ? INTERVAL_CHOICES
        : [...INTERVAL_CHOICES, config.intervalMinutes].sort((a, b) => a - b);
      const intervalLabel = INTERVAL_LABEL_KEY[config.intervalMinutes]
        ? t(INTERVAL_LABEL_KEY[config.intervalMinutes])
        : t('everyCustom').replace('%d', String(config.intervalMinutes));
      // The switch and the current frequency are what people come here to see;
      // the picker, the explanation and the error text stay behind "设置".
      return h('div', {
        className: 'dsh-uc-card dsh-uc-settings-card',
        'data-expanded': expanded ? 'true' : 'false',
      },
        h('div', { className: 'dsh-uc-settings-head' },
          h('div', { className: 'dsh-uc-settings-title' }, t('reminderSection')),
          state.lastCheckAt
            ? h('div', { className: 'dsh-uc-settings-meta' },
              t('reminderLastAt').replace('%s', formatRelative(state.lastCheckAt, t)))
            : h('div', { className: 'dsh-uc-settings-meta' }, t('reminderNeverChecked')),
        ),
        h('div', { className: 'dsh-uc-settings-bar' },
          h('label', { className: 'dsh-uc-settings-toggle' },
            h('input', {
              type: 'checkbox',
              className: 'dsh-uc-switch',
              checked: config.enabled,
              disabled: saving,
              onChange: (event) => { void save({ enabled: event.target.checked }); },
            }),
            h('span', { className: 'dsh-uc-settings-toggle-label' }, t('reminderAutoCheck')),
          ),
          h('span', { className: 'dsh-uc-settings-summary' },
            h('span', { 'data-on': config.enabled ? 'true' : 'false' },
              config.enabled ? t('reminderStatusOn') : t('reminderStatusOff')),
            config.enabled ? h('span', { className: 'dsh-uc-settings-summary-sep' }, '·') : null,
            config.enabled ? h('span', null, intervalLabel) : null,
          ),
          h('button', {
            type: 'button',
            className: 'dsh-uc-btn dsh-uc-btn-ghost dsh-uc-btn-sm dsh-uc-settings-more',
            'aria-expanded': expanded,
            onClick: () => setExpanded(!expanded),
          }, expanded ? t('reminderCollapse') : t('reminderConfigure')),
        ),
        expanded ? h('div', { className: 'dsh-uc-settings-detail' },
          h('div', { className: 'dsh-uc-settings-row' },
            h('span', { className: 'dsh-uc-settings-label' }, t('reminderInterval')),
            h('select', {
              className: 'dsh-uc-select',
              value: String(config.intervalMinutes),
              disabled: saving || !config.enabled,
              onChange: (event) => { void save({ intervalMinutes: Number(event.target.value) }); },
            }, intervalOptions.map((minutes) => h('option', { key: minutes, value: String(minutes) },
              INTERVAL_LABEL_KEY[minutes] ? t(INTERVAL_LABEL_KEY[minutes]) : t('everyCustom').replace('%d', String(minutes))))),
          ),
          h('div', { className: 'dsh-uc-settings-hint' }, t('reminderEnabledHint')),
        ) : null,
        state.lastError ? h('div', { className: 'dsh-uc-settings-error' },
          `${t('reminderError')}: ${state.lastError}`) : null,
        failed ? h('div', { className: 'dsh-uc-settings-error' }, t('reminderSaveFailed')) : null,
      );
    }

    /**
     * Footer entry beside the host's own update indicator: one line above the
     * settings group, because the settings row itself exposes no slot.
     */
    function UpdateReminder({ wide, t, rpcCall, askAi, sendAi }) {
      const [state, setState] = useState(null);
      const [open, setOpen] = useState(false);
      const [anchor, setAnchor] = useState(null);
      const [busy, setBusy] = useState(false);
      const [elapsed, setElapsed] = useState(0);
      const [note, setNote] = useState('');

      const reload = async () => {
        try {
          setState(await rpcCall('reminder.state', undefined));
        } catch { /* the next poll retries */ }
      };

      useEffect(() => {
        let alive = true;
        const tick = async () => {
          try {
            const value = await rpcCall('reminder.state', undefined);
            if (alive) setState(value);
          } catch { /* the next poll retries */ }
        };
        void tick();
        const timer = setInterval(() => { void tick(); }, 60_000);
        return () => { alive = false; clearInterval(timer); };
      }, []);

      // The panel is fixed-positioned outside the sidebar's overflow, so
      // click-away and Esc are handled on the document instead of the tree.
      useEffect(() => {
        if (!open) return undefined;
        const onPointer = (event) => {
          const target = event.target;
          if (target && typeof target.closest === 'function' && target.closest('[data-dsh-uc-reminder]')) return;
          setOpen(false);
        };
        const onKey = (event) => { if (event.key === 'Escape') setOpen(false); };
        document.addEventListener('pointerdown', onPointer, true);
        document.addEventListener('keydown', onKey);
        return () => {
          document.removeEventListener('pointerdown', onPointer, true);
          document.removeEventListener('keydown', onKey);
        };
      }, [open]);

      const pending = state?.pending ?? [];
      if (!state?.visible || pending.length === 0) return null;

      const toggle = (event) => {
        if (open) { setOpen(false); return; }
        const rect = event.currentTarget.getBoundingClientRect();
        setAnchor({ left: rect.left, bottom: window.innerHeight - rect.top + 8 });
        setOpen(true);
      };

      const checkNow = async () => {
        if (busy) return;
        setBusy(true);
        setNote('');
        setElapsed(0);
        const startedAt = Date.now();
        // A scan can take tens of seconds on the anonymous GitHub quota, and
        // a button that only says "checking" reads as a dead button.
        const ticker = setInterval(() => {
          setElapsed(Math.round((Date.now() - startedAt) / 1000));
        }, 500);
        // The scan itself is bounded; this covers a lost RPC response, which
        // would otherwise leave the button disabled for the whole session.
        const watchdog = setTimeout(() => {
          setBusy(false);
          setNote(t('reminderCheckTimeout'));
        }, 90_000);
        let failure = '';
        try {
          await rpcCall('check.run', { force: true });
        } catch {
          failure = t('reminderCheckFailed');
        }
        clearInterval(ticker);
        clearTimeout(watchdog);
        await reload();
        setBusy(false);
        setNote(failure || t('reminderCheckedNow'));
      };

      const ignore = async (mode) => {
        try {
          setState(await rpcCall('reminder.ignore', { mode }));
          setOpen(false);
        } catch { /* keep the entry visible and let the user retry */ }
      };

      const ask = (row) => {
        const outcome = askAi(t('askAiPrompt').replace('%s', row.name));
        if (outcome !== 'none') setOpen(false);
      };

      // One request for the whole pending set, into a fresh conversation: the
      // user asked for a draft they send themselves, so nothing is submitted.
      const updateAll = () => {
        const outcome = sendAi(buildBatchPrompt(pending, t, state?.profileDir));
        if (outcome === 'session' || outcome === 'draft') {
          setOpen(false);
          return;
        }
        setNote(outcome === 'clipboard' ? t('askAiCopied') : t('askAiNoSession'));
      };

      return h('div', {
        className: `dsh-uc-reminder${wide ? '' : ' dsh-uc-reminder-rail'}`,
        'data-dsh-uc-reminder': 'true',
      },
        h('button', {
          type: 'button',
          className: 'dsh-uc-reminder-btn',
          'aria-expanded': open,
          'aria-haspopup': 'dialog',
          'aria-label': t('reminderTitle').replace('%d', String(pending.length)),
          title: t('reminderTitle').replace('%d', String(pending.length)),
          onClick: toggle,
        },
          h(IconArrowUp, { size: wide ? 16 : 18 }),
          wide ? h('span', { className: 'dsh-uc-reminder-label' }, t('reminderEntry')) : null,
          wide ? h('span', { className: 'dsh-uc-reminder-count' }, pending.length) : null,
        ),
        open && anchor !== null ? h('div', {
          className: 'dsh-uc-reminder-panel',
          role: 'dialog',
          'aria-label': t('reminderTitle').replace('%d', String(pending.length)),
          style: { left: anchor.left, bottom: anchor.bottom },
        },
          h('div', { className: 'dsh-uc-reminder-panel-head' },
            h('div', { className: 'dsh-uc-reminder-panel-title' },
              t('reminderTitle').replace('%d', String(pending.length))),
            h('button', {
              type: 'button',
              className: 'dsh-uc-btn dsh-uc-btn-ghost dsh-uc-btn-sm',
              onClick: () => setOpen(false),
              'aria-label': t('hideNotes'),
            }, '×'),
          ),
          h('div', { className: 'dsh-uc-reminder-panel-body' },
            pending.map((row) => h('div', { key: row.name, className: 'dsh-uc-reminder-row' },
              h('div', { className: 'dsh-uc-reminder-row-info' },
                h('div', { className: 'dsh-uc-reminder-row-name' }, row.name),
                h('div', { className: 'dsh-uc-reminder-row-version' },
                  h('span', { className: 'dsh-uc-mono' }, row.installed || '?'),
                  h('span', { className: 'dsh-uc-version-arrow' }, '→'),
                  h('span', { className: 'dsh-uc-mono dsh-uc-version-latest-brand' }, row.latest || '?'),
                ),
              ),
              h('button', {
                type: 'button',
                className: 'dsh-uc-btn dsh-uc-btn-sm dsh-uc-row-update',
                onClick: () => ask(row),
              }, t('updateAction')),
            )),
          ),
          h('div', { className: 'dsh-uc-reminder-panel-foot' },
            h('button', {
              type: 'button',
              className: 'dsh-uc-btn dsh-uc-btn-primary dsh-uc-btn-sm',
              title: t('batchUpdateHint'),
              onClick: updateAll,
            }, t('batchUpdate')),
            h('button', {
              type: 'button',
              className: 'dsh-uc-btn dsh-uc-btn-secondary dsh-uc-btn-sm',
              disabled: busy,
              onClick: checkNow,
            }, busy
              ? t('reminderCheckingElapsed').replace('%ds', String(elapsed))
              : t('reminderCheck')),
            h('button', {
              type: 'button',
              className: 'dsh-uc-btn dsh-uc-btn-ghost dsh-uc-btn-sm',
              onClick: () => { void ignore('once'); },
            }, t('reminderIgnoreOnce')),
            h('button', {
              type: 'button',
              className: 'dsh-uc-btn dsh-uc-btn-ghost dsh-uc-btn-sm',
              onClick: () => { void ignore('all'); },
            }, t('reminderIgnoreAll')),
          ),
          h('div', { className: 'dsh-uc-reminder-panel-note', role: 'status' },
            note || (state.lastCheckAt
              ? t('reminderLastAt').replace('%s', formatRelative(state.lastCheckAt, t))
              : t('reminderNeverChecked'))),
        ) : null,
      );
    }

    function Page(props) {
      const { rpcCall, t, askAi, sendAi, close } = props;
      const [running, setRunning] = useState(false);
      const [data, setData] = useState(null);
      const [loadingCache, setLoadingCache] = useState(true);
      const [error, setError] = useState('');
      const [notice, setNotice] = useState('');
      const [filter, setFilter] = useState('all');
      const [sortMode, setSortMode] = useState('status');
      const [openNames, setOpenNames] = useState(() => new Set());
      // Install source is a different axis from update status: a local checkout
      // can also be behind upstream, so mixing both into one chip row made the
      // counts read as if they excluded each other.
      const [sourceFilter, setSourceFilter] = useState('all');

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
          setData(await rpcCall('check.run', { force: true }));
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

      // Hand the update request to the AI instead of installing anything here:
      // the plugin stays a checker, and the user keeps the send button.
      const onAskAi = (row) => {
        const text = t('askAiPrompt').replace('%s', row.name);
        const outcome = askAi(text);
        setNotice(outcome === 'draft' ? '' : outcome === 'clipboard' ? t('askAiCopied') : t('askAiNoSession'));
        if (outcome !== 'none') {
          try { close?.(); } catch { /* panel already gone */ }
        }
      };

      const rows = data?.rows ?? [];
      const actionable = rows.filter(isActionable);

      // Same handover as the per-row button, but for every actionable row at
      // once — into a new conversation, still unsent.
      const onBatchUpdate = () => {
        if (actionable.length === 0) {
          setNotice(t('batchUpdateEmpty'));
          return;
        }
        const outcome = sendAi(buildBatchPrompt(actionable, t, data?.profileDir));
        setNotice(outcome === 'session' ? t('batchUpdateSent')
          : outcome === 'draft' ? t('batchUpdateDraft')
            : outcome === 'clipboard' ? t('askAiCopied') : t('askAiNoSession'));
        if (outcome === 'session' || outcome === 'draft') {
          try { close?.(); } catch { /* panel already gone */ }
        }
      };

      // Derived lists are memoized so toggling one row's notes (an openNames
      // update) does not re-run the group count + filter + sort pipeline.
      const chipList = useMemo(() => {
        const groups = [
          { id: 'updates', label: t('filterUpdates'), count: 0 },
          { id: 'current', label: t('statusLatest'), count: 0 },
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

      // Install-source options, derived from what is actually installed: a
      // profile with no GitHub plugins should not offer an empty GitHub filter.
      const sourceList = useMemo(() => {
        const seen = new Map();
        for (const row of rows) {
          const kind = row.kind || 'other';
          seen.set(kind, (seen.get(kind) ?? 0) + 1);
        }
        const labelOf = (kind) => (kind === 'npm' ? 'npm' : kind === 'github' ? 'GitHub' : kind === 'file' ? t('filterSourceLocal') : kind);
        return [...seen.entries()]
          .map(([kind, count]) => ({ id: kind, label: labelOf(kind), count }))
          .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
      }, [rows, t]);

      // If the selected group vanished after a re-check (e.g. the only local-only
      // plugin gained an update), fall back to showing all rows instead of an
      // empty list that hides the newly available updates.
      const activeFilter = filter === 'all' || chipList.some((item) => item.id === filter) ? filter : 'all';
      const activeSource = sourceFilter === 'all' || sourceList.some((item) => item.id === sourceFilter) ? sourceFilter : 'all';

      const visible = useMemo(() => rows
        .filter((row) => activeFilter === 'all' || FILTER_OF[row.status] === activeFilter)
        .filter((row) => activeSource === 'all' || (row.kind || 'other') === activeSource)
        .sort((a, b) => {
          if (sortMode === 'name') return a.name.localeCompare(b.name);
          return (STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99) || a.name.localeCompare(b.name);
        }), [rows, activeFilter, activeSource, sortMode]);

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
            h('div', { className: 'dsh-uc-header-buttons' },
              actionable.length > 0 ? h('button', {
                type: 'button',
                className: 'dsh-uc-btn dsh-uc-btn-primary',
                title: t('batchUpdateHint'),
                onClick: onBatchUpdate,
              }, `${t('batchUpdate')} (${actionable.length})`) : null,
              h('button', {
                type: 'button',
                className: actionable.length > 0 ? 'dsh-uc-btn dsh-uc-btn-secondary' : 'dsh-uc-btn dsh-uc-btn-primary',
                disabled: running,
                onClick: run,
              },
                h(IconRefresh, { size: 14, className: running ? 'dsh-uc-spin' : undefined }),
                running ? t('checking') : t('check'),
              ),
            ),
            // The batch button never installs anything itself, so say what it
            // does where it is, instead of leaving that to a hover title.
            actionable.length > 0 ? h('div', { className: 'dsh-uc-header-hint' }, t('batchUpdateHintShort')) : null,
            data?.at ? h('div', {
              className: 'dsh-uc-header-meta',
              title: formatDate(data.at),
            },
              `${t('lastAt')}: ${formatRelative(data.at, t)}`,
              stale ? h('span', { className: 'dsh-uc-stale' }, ` · ${t('staleHint')}`) : null,
            ) : (!loadingCache && !running ? h('div', { className: 'dsh-uc-header-meta' }, t('never')) : null),
          ),
        ),
        h(ReminderSettings, { rpcCall, t }),
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
        notice ? h('div', { className: 'dsh-uc-banner', 'data-tone': 'notice' },
          h('div', { className: 'dsh-uc-banner-text' }, h('span', null, notice)),
          h('button', {
            type: 'button',
            className: 'dsh-uc-btn dsh-uc-btn-ghost dsh-uc-btn-sm',
            onClick: () => setNotice(''),
          }, '×'),
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
            sourceList.length > 1 ? h('select', {
              className: 'dsh-uc-select',
              value: activeSource,
              'aria-label': t('filterSource'),
              onChange: (event) => setSourceFilter(event.target.value),
            },
              h('option', { value: 'all' }, t('filterSourceAll')),
              sourceList.map((item) => h('option', { key: item.id, value: item.id }, `${item.label} (${item.count})`)),
            ) : null,
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
            onAskAi,
          })),
        ) : null,
        data?.stats ? h('div', { className: 'dsh-uc-stats' },
          t('statsLine')
            .replace('%d', String(data.stats.requests ?? 0))
            .replace('%d', String(data.stats.cacheHits ?? 0)),
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
.dsh-uc-header-buttons {
  display: flex;
  align-items: center;
  gap: 8px;
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

/* What the batch button will hand over, stated in place. */
.dsh-uc-header-hint {
  max-width: 320px;
  font-size: 11px;
  line-height: 15px;
  text-align: right;
  color: var(--dsw-alias-label-caption, rgba(128,128,128,0.75));
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
  background: var(--dsw-alias-button-primary-fill, #4c6ef5);
  color: var(--dsw-alias-label-primary-foreground, #ffffff);
  border-color: transparent;
  box-shadow: var(--dsw-shadow-lv1, 0 1px 2px rgba(0,0,0,0.08));
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
  background: color-mix(in srgb, var(--dsw-alias-link, #4176e6) 12%, transparent) !important;
  border-color: color-mix(in srgb, var(--dsw-alias-link, #4176e6) 40%, transparent) !important;
  color: var(--dsw-alias-link, #4176e6) !important;
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
  background: color-mix(in srgb, var(--dsw-alias-link, #4176e6) 12%, transparent);
  color: var(--dsw-alias-link, #4176e6);
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
  border-color: color-mix(in srgb, var(--dsw-alias-link, #4176e6) 35%, var(--dsw-alias-border-l1, rgba(128,128,128,0.3)));
}
.dsh-uc-card[data-open="true"] {
  border-color: var(--dsw-alias-border-l2, rgba(128,128,128,0.6));
  background: var(--dsw-alias-bg-layer-1, rgba(128,128,128,0.06));
  box-shadow: var(--dsw-shadow-lv2, 0 4px 18px rgba(0,0,0,0.04));
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
  background: color-mix(in srgb, var(--dsw-alias-link, #4176e6) 12%, transparent);
  color: var(--dsw-alias-link, #4176e6);
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
  font-family: var(--ds-font-family-code, ui-monospace, SFMono-Regular, Consolas, monospace);
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
/* In the title row the version sits beside the name, so it takes the smaller
   caption size and never forces the row onto a third line by itself. */
.dsh-uc-row-title-row .dsh-uc-row-version {
  font-size: 12px;
  line-height: 16px;
  min-width: 0;
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
  color: var(--dsw-alias-link, #4176e6);
  font-weight: 600;
}
.dsh-uc-mono {
  font-family: var(--ds-font-family-code, ui-monospace, SFMono-Regular, Consolas, monospace);
}
.dsh-uc-row-spec {
  font-size: 11px;
  font-family: var(--ds-font-family-code, ui-monospace, SFMono-Regular, Consolas, monospace);
  color: var(--dsw-alias-label-caption, rgba(128,128,128,0.7));
  word-break: break-all;
  line-height: 14px;
}
/* Full description inside the expanded panel, where the clamp does not apply. */
.dsh-uc-detail-desc {
  font-size: 12px;
  line-height: 1.6;
  color: var(--dsw-alias-label-secondary, rgba(128,128,128,0.85));
}
.dsh-uc-row-desc {
  font-size: 12px;
  color: var(--dsw-alias-label-secondary, rgba(128,128,128,0.85));
  line-height: 1.5;
  /* One line by default: the description is context, not the thing being
     scanned. The full text is one click away, with the release notes. */
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 1;
  overflow: hidden;
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
.dsh-uc-chevron-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 2px;
  margin: -2px;
  border: 0;
  border-radius: 5px;
  background: none;
  color: var(--dsw-alias-label-caption, rgba(128,128,128,0.7));
  cursor: pointer;
  flex: none;
  transition: color 140ms ease, background 120ms ease;
}
.dsh-uc-chevron-btn svg {
  transform: rotate(0deg);
  transition: transform 240ms cubic-bezier(0.23, 1, 0.32, 1);
}
.dsh-uc-card[data-open="true"] .dsh-uc-chevron-btn {
  color: var(--dsw-alias-label-primary, inherit);
}
.dsh-uc-card[data-open="true"] .dsh-uc-chevron-btn svg {
  transform: rotate(180deg);
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
  font-family: var(--ds-font-family-code, ui-monospace, SFMono-Regular, Consolas, monospace);
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
  font-family: var(--ds-font-family-code, ui-monospace, SFMono-Regular, Consolas, monospace);
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
  font-family: var(--ds-font-family-code, ui-monospace, SFMono-Regular, Consolas, monospace);
  font-size: 11px;
  background: rgba(128,128,128,0.08);
  border-radius: 4px;
  padding: 2px 5px;
  border: .5px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.2));
}
.dsh-uc-md-pre {
  font-family: var(--ds-font-family-code, ui-monospace, SFMono-Regular, Consolas, monospace);
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
  color: var(--dsw-alias-link, #4176e6);
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
  background: color-mix(in srgb, var(--dsw-alias-link, #4176e6) 12%, transparent);
  color: var(--dsw-alias-link, #4176e6);
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

/* Scan Stats */
.dsh-uc-stats {
  padding: 4px 2px 0;
  font-size: 11px;
  color: var(--dsw-alias-label-caption, rgba(128,128,128,0.65));
  text-align: right;
  font-variant-numeric: tabular-nums;
}

/* Row Action */
.dsh-uc-row-update {
  flex: none;
  height: 26px;
  padding: 0 10px;
  border-radius: var(--dsw-radius-sm, 5px);
  border: 1px solid color-mix(in srgb, var(--dsw-alias-link, #4176e6) 32%, transparent);
  background: color-mix(in srgb, var(--dsw-alias-link, #4176e6) 8%, transparent);
  color: var(--dsw-alias-link, #4176e6);
  font-size: 12px;
  font-weight: 500;
}

/* Settings Block */
.dsh-uc-settings-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 14px;
}
.dsh-uc-settings-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}
.dsh-uc-settings-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary, inherit);
}
.dsh-uc-settings-meta {
  font-size: 11px;
  color: var(--dsw-alias-label-caption, rgba(128,128,128,0.65));
  font-variant-numeric: tabular-nums;
}
/* The always-visible line: switch, current state, and the disclosure. */
.dsh-uc-settings-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.dsh-uc-settings-toggle {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  user-select: none;
  flex: none;
}
.dsh-uc-settings-toggle-label {
  font-size: 13px;
  color: var(--dsw-alias-label-primary, inherit);
}
.dsh-uc-settings-summary {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  font-size: 12px;
  color: var(--dsw-alias-label-secondary, rgba(128,128,128,0.85));
}
.dsh-uc-settings-summary [data-on="true"] {
  color: var(--dsw-alias-link, #4176e6);
  font-weight: 500;
}
.dsh-uc-settings-summary-sep {
  color: var(--dsw-alias-label-caption, rgba(128,128,128,0.6));
}
.dsh-uc-settings-more {
  margin-left: auto;
  flex: none;
}
.dsh-uc-settings-detail {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 10px;
  border-top: .5px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.2));
}
.dsh-uc-settings-row {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
  color: var(--dsw-alias-label-primary, inherit);
}
.dsh-uc-settings-label {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}
.dsh-uc-settings-hint {
  font-size: 11px;
  line-height: 16px;
  color: var(--dsw-alias-label-secondary, rgba(128,128,128,0.85));
}
.dsh-uc-settings-error {
  font-size: 11px;
  color: var(--dsw-alias-state-error-primary, #e03131);
}
.dsh-uc-switch {
  flex: none;
  width: 16px;
  height: 16px;
  accent-color: var(--dsw-alias-link, #4176e6);
  cursor: pointer;
}
.dsh-uc-select {
  flex: none;
  height: 28px;
  padding: 0 8px;
  border-radius: var(--dsw-radius-sm, 5px);
  border: 1px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.35));
  background: var(--dsw-alias-bg-layer-1, transparent);
  color: var(--dsw-alias-label-primary, inherit);
  font-family: inherit;
  font-size: 12px;
}
.dsh-uc-select:disabled {
  opacity: 0.5;
}

/* Footer Reminder */
.dsh-uc-reminder {
  position: relative;
  display: flex;
  width: 100%;
  flex: none;
}
.dsh-uc-reminder-rail {
  width: 36px;
  justify-content: center;
}
.dsh-uc-reminder-btn {
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  width: calc(100% + 4px);
  height: 42px;
  margin: 0 -2px;
  padding: 0 10px 0 8px;
  border: none;
  border-radius: 12px;
  background: transparent;
  color: var(--dsw-alias-label-secondary, rgba(128,128,128,0.85));
  font-family: inherit;
  font-size: 14px;
  line-height: 22px;
  cursor: pointer;
  overflow: hidden;
}
.dsh-uc-reminder-rail .dsh-uc-reminder-btn {
  width: 36px;
  height: 36px;
  margin: 0;
  padding: 0;
  justify-content: center;
  border-radius: 10px;
}
.dsh-uc-reminder-btn:hover,
.dsh-uc-reminder-btn[aria-expanded="true"] {
  background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,0.12));
  color: var(--dsw-alias-label-primary, inherit);
}
.dsh-uc-reminder-label {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.dsh-uc-reminder-count {
  margin-left: auto;
  min-width: 16px;
  height: 16px;
  padding: 0 5px;
  border-radius: 8px;
  background: var(--dsw-alias-link, #4176e6);
  color: #fff;
  font-size: 10px;
  font-weight: 600;
  line-height: 16px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}
.dsh-uc-reminder-panel {
  position: fixed;
  z-index: 30;
  display: flex;
  flex-direction: column;
  width: 360px;
  max-width: calc(100vw - 24px);
  max-height: 60vh;
  border-radius: 12px;
  border: 1px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.3));
  background: var(--dsw-alias-bg-layer-2, #fff);
  box-shadow: var(--dsw-elevation-prominent, 0 8px 28px rgba(0,0,0,0.18));
  overflow: hidden;
}
.dsh-uc-reminder-panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: .5px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.25));
}
.dsh-uc-reminder-panel-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary, inherit);
}
.dsh-uc-reminder-panel-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  overflow-y: auto;
  min-height: 0;
}
.dsh-uc-reminder-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-1, rgba(128,128,128,0.05));
}
.dsh-uc-reminder-row-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}
.dsh-uc-reminder-row-name {
  font-size: 12px;
  font-weight: 500;
  color: var(--dsw-alias-label-primary, inherit);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsh-uc-reminder-row-version {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  color: var(--dsw-alias-label-secondary, rgba(128,128,128,0.85));
}
.dsh-uc-reminder-panel-foot {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  padding: 10px 12px;
  border-top: .5px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.25));
}
.dsh-uc-reminder-panel-note {
  padding: 0 12px 10px;
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary, rgba(128,128,128,0.75));
}

/* Focus Visible */
.dsh-uc-btn:focus-visible,
.dsh-uc-chip:focus-visible,
.dsh-uc-chevron-btn:focus-visible,
.dsh-uc-row-link:focus-visible,
.dsh-uc-link-strong:focus-visible {
  outline: 2px solid var(--dsw-alias-link, #4176e6);
  outline-offset: 2px;
}

/* Hover Gating */
@media (hover: hover) and (pointer: fine) {
  .dsh-uc-btn-primary:hover:not(:disabled) {
    background: var(--dsw-alias-button-primary-hover, #4176e6);
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
  .dsh-uc-chevron-btn:hover {
    background: var(--dsw-alias-bg-layer-2, rgba(128,128,128,0.12));
  }
  .dsh-uc-link-strong:hover {
    text-decoration: underline;
  }
}

/* Reduced Motion: scoped to this page — a global selector here would slow
   every transition in the host UI while the page is mounted. */
@media (prefers-reduced-motion: reduce) {
  .dsh-uc-page,
  .dsh-uc-page *,
  .dsh-uc-page *::before,
  .dsh-uc-page *::after {
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

        // Shared by the settings page and the footer panel: the per-row button
        // fills the current composer, the batch button opens a new conversation
        // and fills that one instead. Neither presses send.
        const askAi = (text) => fillComposerDraft(ctx, text);
        const sendAi = (text) => draftInNewSession(ctx, text);

        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'update-checker',
          order: 86,
          label: () => t('sectionLabel'),
          inject: () => ({ rpcCall, t, askAi, sendAi }),
        }, Page));

        // One row above the settings group in the sidebar footer — the closest
        // spot a plugin can reach to the host's own update indicator, since the
        // settings trigger row itself exposes no slot.
        ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
          name: 'sidebar.footer.action',
          id: 'update-reminder',
          locale: NS,
          inject: () => ({ rpcCall, t, askAi, sendAi }),
        }, UpdateReminder));
      },
      _internals: { parseMarkdownBody, parseInline, fillComposerDraft, draftInNewSession, buildBatchPrompt, isActionable, safeHref },
    };
  },
});
