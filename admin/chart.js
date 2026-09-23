(function (root, factory) {
  if (typeof module === 'object' && module && module.exports) module.exports = factory();
  else root.PaviloAdminChart = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const DAY_MS = 24 * 60 * 60 * 1000;

  function amount(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  function utcDay(ms) {
    return new Date(ms).toISOString().slice(0, 10);
  }

  function emptyDay(day) {
    return {
      day,
      label: day.slice(5),
      requests: 0,
      promptTokens: 0,
      completionTokens: 0,
      tokens: 0,
      errors: 0,
      channels: []
    };
  }

  // Zero-fills the UTC window shared by the overview strip and the usage page.
  // Rows outside that window are dropped. The chart itself never sees channel rows.
  function foldUsage(rows, { days = 7, now = Date.now() } = {}) {
    const count = Math.max(1, Number.isFinite(Number(days)) ? Math.floor(Number(days)) : 7);
    const end = Date.parse(`${utcDay(now)}T00:00:00.000Z`);
    const byDay = new Map();
    for (let i = 0; i < count; i += 1) {
      const day = utcDay(end - (count - 1 - i) * DAY_MS);
      byDay.set(day, emptyDay(day));
    }
    for (const row of rows || []) {
      const bucket = byDay.get(row && row.day);
      if (!bucket) continue;
      const prompt = amount(row.promptTokens);
      const completion = amount(row.completionTokens);
      const tokens = prompt + completion;
      const requests = amount(row.requests);
      const errors = amount(row.errors);
      bucket.requests += requests;
      bucket.promptTokens += prompt;
      bucket.completionTokens += completion;
      bucket.tokens += tokens;
      bucket.errors += errors;
      bucket.channels.push({
        id: row.channelId || '',
        requests,
        promptTokens: prompt,
        completionTokens: completion,
        tokens,
        errors
      });
    }
    const dayList = [...byDay.values()];
    const byChannel = new Map();
    for (const day of dayList) {
      day.channels.sort(byTokens);
      for (const channel of day.channels) {
        const existing = byChannel.get(channel.id) || {
          id: channel.id,
          requests: 0,
          promptTokens: 0,
          completionTokens: 0,
          tokens: 0,
          errors: 0
        };
        existing.requests += channel.requests;
        existing.promptTokens += channel.promptTokens;
        existing.completionTokens += channel.completionTokens;
        existing.tokens += channel.tokens;
        existing.errors += channel.errors;
        byChannel.set(channel.id, existing);
      }
    }
    return { days: dayList, channels: [...byChannel.values()].sort(byTokens) };
  }

  function byTokens(a, b) {
    return b.tokens - a.tokens || String(a.id).localeCompare(String(b.id));
  }

  function estimate(text) {
    let width = 0;
    for (const char of String(text)) width += char.charCodeAt(0) > 255 ? 11 : 6.4;
    return width;
  }

  function compact(value, formatValue) {
    const abs = Math.abs(value);
    if (abs < 10000) return formatValue(value);
    const scaled = abs >= 1000000 ? abs / 1000000 : abs / 1000;
    const suffix = abs >= 1000000 ? 'M' : 'k';
    const digits = scaled >= 100 ? Math.round(scaled) : Math.round(scaled * 10) / 10;
    return `${value < 0 ? '-' : ''}${digits}${suffix}`;
  }

  function tickValues(max) {
    if (!(max > 0)) return [0];
    if (Number.isInteger(max / 2)) return [0, max / 2, max];
    return [0, max];
  }

  function frameStops(max) {
    if (!(max > 0)) return [0];
    return [0, max / 2, max];
  }

  function axisLabels(values, formatValue) {
    const full = values.map((value) => formatValue(value));
    if (Math.max(...full.map(estimate)) <= 56) return full;
    return values.map((value) => compact(value, formatValue));
  }

  function fitLabel(text, maxWidth) {
    const label = String(text);
    if (estimate(label) <= maxWidth) return label;
    let kept = label;
    while (kept.length > 1 && estimate(`${kept}…`) > maxWidth) kept = kept.slice(0, -1);
    return `${kept}…`;
  }

  function tipRows(value, rows = []) {
    if (value == null || value === false || value === '') return rows;
    if (Array.isArray(value)) {
      value.forEach((item) => tipRows(item, rows));
      return rows;
    }
    if (typeof value === 'string') {
      value.split('\n').filter((line) => line !== '').forEach((text) => rows.push({ text, value: '' }));
      return rows;
    }
    if (typeof Node === 'function' && value instanceof Node) {
      if (value.textContent) rows.push({ text: value.textContent, value: '' });
      return rows;
    }
    if (typeof value === 'object') {
      rows.push({ text: String(value.text ?? ''), value: value.value == null ? '' : String(value.value) });
      return rows;
    }
    rows.push({ text: String(value), value: '' });
    return rows;
  }

  function el(name) {
    return document.createElementNS(SVG_NS, name);
  }

  function round(value) {
    return Math.round(value * 10) / 10;
  }

  // Monotone cubic through the real points. Control points stay inside each
  // day's span, so the curve does not invent a higher peak between observations.
  function smoothPath(pairs) {
    if (!pairs.length) return '';
    const head = `M ${pairs[0].x} ${pairs[0].y}`;
    if (pairs.length === 1) return head;
    const count = pairs.length;
    const delta = [];
    for (let index = 0; index < count - 1; index += 1) {
      const span = pairs[index + 1].x - pairs[index].x;
      delta.push(span === 0 ? 0 : (pairs[index + 1].y - pairs[index].y) / span);
    }
    const slope = new Array(count).fill(0);
    slope[0] = delta[0];
    slope[count - 1] = delta[count - 2];
    for (let index = 1; index < count - 1; index += 1) {
      if (delta[index - 1] * delta[index] <= 0) slope[index] = 0;
      else slope[index] = (delta[index - 1] + delta[index]) / 2;
    }
    for (let index = 0; index < count - 1; index += 1) {
      if (delta[index] === 0) {
        slope[index] = 0;
        slope[index + 1] = 0;
        continue;
      }
      const alpha = slope[index] / delta[index];
      const beta = slope[index + 1] / delta[index];
      const sum = alpha * alpha + beta * beta;
      if (sum > 9) {
        const scale = 3 / Math.sqrt(sum);
        slope[index] = scale * alpha * delta[index];
        slope[index + 1] = scale * beta * delta[index];
      }
    }
    let path = head;
    for (let index = 0; index < count - 1; index += 1) {
      const span = pairs[index + 1].x - pairs[index].x;
      const c1x = round(pairs[index].x + span / 3);
      const c1y = round(pairs[index].y + slope[index] * span / 3);
      const c2x = round(pairs[index + 1].x - span / 3);
      const c2y = round(pairs[index + 1].y - slope[index + 1] * span / 3);
      path += ` C ${c1x} ${c1y} ${c2x} ${c2y} ${pairs[index + 1].x} ${pairs[index + 1].y}`;
    }
    return path;
  }

  // Positions stay on SVG attributes. Admin style-src does not allow inline styles.
  function createChart({
    kind = 'line',
    categories = [],
    series = [],
    height = 160,
    width,
    yAxis = true,
    label = '',
    empty = '',
    formatValue = (value) => String(value),
    pointLabel,
    tooltip
  } = {}) {
    const root = document.createElement('div');
    root.setAttribute('class', 'chart');
    if (!categories.length) {
      const note = document.createElement('p');
      note.className = 'record-empty';
      note.textContent = empty || '';
      root.append(note);
      return root;
    }
    const values = categories.map((_, index) => {
      const raw = series[0] && series[0].values ? series[0].values[index] : 0;
      return amount(raw);
    });
    const tracks = (series.length ? series : [{}]).map((item, index) => ({
      label: item.label || '',
      axis: item.axis === 'end' ? 'end' : 'start',
      mark: item.mark === 'bar' ? 'bar' : 'line',
      tone: index === 0 ? '' : ' is-b',
      values: categories.map((_, slot) => Math.max(0, amount(item && item.values ? item.values[slot] : 0)))
    }));
    const named = tracks.filter((track) => track.label);
    if (named.length > 1) {
      const legend = document.createElement('div');
      legend.className = 'chart-legend';
      for (const track of named) {
        const item = document.createElement('span');
        item.className = [track.tone.trim(), track.mark === 'bar' ? 'is-bar' : ''].filter(Boolean).join(' ');
        const swatch = document.createElement('i');
        swatch.setAttribute('aria-hidden', 'true');
        const name = document.createElement('span');
        name.textContent = track.label;
        item.append(swatch, name);
        legend.append(item);
      }
      root.append(legend);
    }
    const svg = el('svg');
    svg.setAttribute('role', 'group');
    svg.setAttribute('aria-label', label || '');
    svg.setAttribute('data-kind', kind);
    root.append(svg);

    const fixed = amount(width);
    let drawn = 0;

    function paint(pixelWidth) {
      const viewWidth = Math.max(160, Math.round(pixelWidth));
      if (kind === 'bar') paintBars(viewWidth);
      else paintLine(viewWidth);
    }

    function paintLine(viewWidth) {
      const startMax = Math.max(0, ...tracks.filter((track) => track.axis === 'start').flatMap((track) => track.values), 0);
      const endMax = Math.max(0, ...tracks.filter((track) => track.axis === 'end').flatMap((track) => track.values), 0);
      const hasEnd = tracks.some((track) => track.axis === 'end');
      const startTicks = tickValues(startMax);
      const endTicks = hasEnd ? tickValues(endMax) : [];
      const startLabels = yAxis ? axisLabels(startTicks, formatValue) : [];
      const endLabels = yAxis && hasEnd ? axisLabels(endTicks, formatValue) : [];
      const padL = yAxis ? Math.max(36, Math.ceil(Math.max(...startLabels.map(estimate), 0)) + 14) : 8;
      const padR = endLabels.length ? Math.max(36, Math.ceil(Math.max(...endLabels.map(estimate), 0)) + 14) : 12;
      const padT = 12;
      const padB = 26;
      const viewHeight = height;
      const plotWidth = Math.max(1, viewWidth - padL - padR);
      const plotBottom = viewHeight - padB;
      const slot = plotWidth / categories.length;
      const yAt = (value, max) => {
        if (!(max > 0)) return plotBottom;
        return plotBottom - (Math.max(0, value) / max) * (plotBottom - padT);
      };
      const yOf = (track, index) => yAt(track.values[index], track.axis === 'end' ? endMax : startMax);
      const spots = categories.map((category, index) => ({
        index,
        cx: padL + slot * index + slot / 2,
        cy: Math.min(...tracks.map((track) => yOf(track, index))),
        label: category.label || ''
      }));

      const nodes = [];
      const frameMax = Math.max(startMax, endMax);
      frameStops(frameMax).forEach((value) => {
        const y = frameMax > 0 ? plotBottom - (value / frameMax) * (plotBottom - padT) : plotBottom;
        const line = el('line');
        line.setAttribute('class', 'chart-grid');
        line.setAttribute('x1', String(padL));
        line.setAttribute('x2', String(viewWidth - padR));
        line.setAttribute('y1', String(round(y)));
        line.setAttribute('y2', String(round(y)));
        nodes.push(line);
      });
      if (yAxis) {
        startTicks.forEach((value, index) => {
          const text = el('text');
          text.setAttribute('class', hasEnd ? 'chart-tick is-start' : 'chart-tick');
          text.setAttribute('x', String(padL - 8));
          text.setAttribute('y', String(round(yAt(value, startMax) + 4)));
          text.setAttribute('text-anchor', 'end');
          text.textContent = startLabels[index];
          nodes.push(text);
        });
        endTicks.forEach((value, index) => {
          const text = el('text');
          text.setAttribute('class', 'chart-tick is-end');
          text.setAttribute('x', String(viewWidth - padR + 8));
          text.setAttribute('y', String(round(yAt(value, endMax) + 4)));
          text.setAttribute('text-anchor', 'start');
          text.textContent = endLabels[index];
          nodes.push(text);
        });
      }

      const ordered = [
        ...tracks.filter((track) => track.mark === 'bar'),
        ...tracks.filter((track) => track.mark !== 'bar')
      ];
      const columnWidth = Math.min(22, slot * 0.42);
      for (const track of ordered) {
        if (track.mark === 'bar') {
          spots.forEach((spot, index) => {
            const y = yOf(track, index);
            const barHeight = Math.max(0, plotBottom - y);
            const column = el('rect');
            column.setAttribute('class', `chart-column${track.tone}`);
            column.setAttribute('data-axis', track.axis);
            column.setAttribute('data-index', String(spot.index));
            column.setAttribute('x', String(round(spot.cx - columnWidth / 2)));
            column.setAttribute('y', String(round(y)));
            column.setAttribute('width', String(round(columnWidth)));
            column.setAttribute('height', String(round(barHeight)));
            column.setAttribute('rx', barHeight >= 4 ? '2' : '0');
            nodes.push(column);
          });
          continue;
        }
        const anchors = spots.map((spot, index) => ({ x: round(spot.cx), y: round(yOf(track, index)) }));
        const line = el('path');
        line.setAttribute('class', `chart-line${track.tone}`);
        line.setAttribute('data-axis', track.axis);
        line.setAttribute('points', anchors.map((point) => `${point.x},${point.y}`).join(' '));
        line.setAttribute('d', smoothPath(anchors));
        line.setAttribute('fill', 'none');
        if (track.axis === 'end') line.setAttribute('stroke-dasharray', '5 4');
        nodes.push(line);
        spots.forEach((spot, index) => {
          const dot = el('circle');
          dot.setAttribute('class', `chart-dot${track.tone}`);
          dot.setAttribute('data-index', String(spot.index));
          dot.setAttribute('cx', String(round(spot.cx)));
          dot.setAttribute('cy', String(round(yOf(track, index))));
          dot.setAttribute('r', '3.5');
          nodes.push(dot);
        });
      }

      const showLabel = categories.length <= 5 || plotWidth / categories.length >= 36;
      const mid = Math.round((categories.length - 1) / 2);
      spots.forEach((spot, index) => {
        if (showLabel || index === 0 || index === categories.length - 1 || index === mid) {
          const text = el('text');
          text.setAttribute('class', 'chart-label');
          text.setAttribute('x', String(round(spot.cx)));
          text.setAttribute('y', String(viewHeight - 8));
          text.setAttribute('text-anchor', 'middle');
          text.textContent = spot.label;
          nodes.push(text);
        }
        if (categories[index] && categories[index].marker) {
          const mark = el('line');
          mark.setAttribute('class', 'chart-marker');
          mark.setAttribute('x1', String(round(spot.cx - 6)));
          mark.setAttribute('x2', String(round(spot.cx + 6)));
          mark.setAttribute('y1', String(viewHeight - 3));
          mark.setAttribute('y2', String(viewHeight - 3));
          nodes.push(mark);
        }
      });

      const hot = [];
      spots.forEach((spot) => {
        const hit = el('rect');
        hit.setAttribute('class', 'chart-hit');
        hit.setAttribute('data-index', String(spot.index));
        hit.setAttribute('role', 'button');
        hit.setAttribute('tabindex', '0');
        hit.setAttribute('aria-label', pointText(spot.index));
        hit.setAttribute('x', String(round(padL + slot * spot.index)));
        hit.setAttribute('y', '0');
        hit.setAttribute('width', String(round(slot)));
        hit.setAttribute('height', String(viewHeight));
        hit.setAttribute('fill', 'transparent');
        hit.addEventListener('pointerenter', () => activate(spot.index, 'pointer'));
        hit.addEventListener('pointerleave', () => deactivate('pointer'));
        hit.addEventListener('focus', () => activate(spot.index, 'focus'));
        hit.addEventListener('blur', () => deactivate('focus'));
        nodes.push(hit);
        hot.push({ node: hit, index: spot.index, base: 'chart-hit' });
        for (const dot of nodes) {
          if (dot.getAttribute('data-index') !== String(spot.index)) continue;
          const dotClass = (dot.getAttribute('class') || '').split(' ');
          if (!dotClass.includes('chart-dot') && !dotClass.includes('chart-column')) continue;
          hot.push({ node: dot, index: spot.index, base: dot.getAttribute('class') });
        }
      });

      const tip = buildTip();
      nodes.push(tip.group);
      svg.setAttribute('viewBox', `0 0 ${viewWidth} ${viewHeight}`);
      svg.setAttribute('width', '100%');
      svg.setAttribute('height', String(viewHeight));
      svg.replaceChildren(...nodes);
      bindTip(hot, tip, spots, viewWidth, viewHeight);
    }

    function paintBars(viewWidth) {
      const plotted = values.map((value) => Math.max(0, value));
      const max = Math.max(0, ...plotted);
      const labelW = Math.min(132, Math.max(48, Math.round(viewWidth * 0.34)));
      const padL = 8;
      const padR = 12;
      const padT = 20;
      const padB = 8;
      const rowH = 32;
      const barH = 14;
      const viewHeight = padT + categories.length * rowH + padB;
      const barX = padL + labelW + 8;
      const barArea = Math.max(1, viewWidth - barX - padR);
      const maxLabel = compactNeeded(max);
      const nodes = [];
      const axis = el('line');
      axis.setAttribute('class', 'chart-grid');
      axis.setAttribute('x1', String(barX));
      axis.setAttribute('x2', String(barX));
      axis.setAttribute('y1', String(padT));
      axis.setAttribute('y2', String(viewHeight - padB));
      nodes.push(axis);
      const cap = el('text');
      cap.setAttribute('class', 'chart-tick');
      cap.setAttribute('x', String(viewWidth - padR));
      cap.setAttribute('y', '12');
      cap.setAttribute('text-anchor', 'end');
      cap.textContent = maxLabel;
      nodes.push(cap);

      const spots = categories.map((category, index) => {
        const rowY = padT + index * rowH;
        const widthPx = max > 0 ? (plotted[index] / max) * barArea : 0;
        return {
          index,
          cx: barX + widthPx,
          cy: rowY + rowH / 2,
          rowY,
          widthPx
        };
      });
      spots.forEach((spot) => {
        const name = el('text');
        name.setAttribute('class', 'chart-bar-label');
        name.setAttribute('x', String(padL));
        name.setAttribute('y', String(round(spot.cy)));
        name.textContent = fitLabel(categories[spot.index].label || categories[spot.index].id || '', labelW);
        nodes.push(name);
        const bar = el('rect');
        bar.setAttribute('class', 'chart-bar');
        bar.setAttribute('data-index', String(spot.index));
        bar.setAttribute('x', String(barX));
        bar.setAttribute('y', String(round(spot.rowY + (rowH - barH) / 2)));
        bar.setAttribute('width', String(round(spot.widthPx)));
        bar.setAttribute('height', String(barH));
        bar.setAttribute('rx', spot.widthPx >= 6 ? '3' : '0');
        nodes.push(bar);
      });

      const hot = [];
      spots.forEach((spot) => {
        const hit = el('rect');
        hit.setAttribute('class', 'chart-hit');
        hit.setAttribute('data-index', String(spot.index));
        hit.setAttribute('role', 'button');
        hit.setAttribute('tabindex', '0');
        hit.setAttribute('aria-label', pointText(spot.index));
        hit.setAttribute('x', '0');
        hit.setAttribute('y', String(spot.rowY));
        hit.setAttribute('width', String(viewWidth));
        hit.setAttribute('height', String(rowH));
        hit.setAttribute('fill', 'transparent');
        hit.addEventListener('pointerenter', () => activate(spot.index, 'pointer'));
        hit.addEventListener('pointerleave', () => deactivate('pointer'));
        hit.addEventListener('focus', () => activate(spot.index, 'focus'));
        hit.addEventListener('blur', () => deactivate('focus'));
        nodes.push(hit);
        hot.push({ node: hit, index: spot.index, base: 'chart-hit' });
        const bar = nodes.find((node) => node.getAttribute('class') === 'chart-bar' && node.getAttribute('data-index') === String(spot.index));
        if (bar) hot.push({ node: bar, index: spot.index, base: 'chart-bar' });
      });
      const tip = buildTip();
      nodes.push(tip.group);
      svg.setAttribute('viewBox', `0 0 ${viewWidth} ${viewHeight}`);
      svg.setAttribute('width', '100%');
      svg.setAttribute('height', String(viewHeight));
      svg.replaceChildren(...nodes);
      bindTip(hot, tip, spots, viewWidth, viewHeight);
    }

    function compactNeeded(max) {
      const labels = axisLabels([max], formatValue);
      return labels[0];
    }

    function pointText(index) {
      if (typeof pointLabel === 'function') return pointLabel(index);
      const category = categories[index];
      const name = category ? (category.label || category.id || '') : '';
      return `${name}, ${formatValue(values[index])}`;
    }

    let pinned = false;
    let openIndex = -1;
    let showTip = () => {};
    let hideTip = () => {};

    function activate(index, via) {
      openIndex = index;
      if (via === 'focus') pinned = true;
      showTip(index);
    }

    function deactivate(via) {
      if (via === 'focus') pinned = false;
      if (via === 'pointer' && pinned) return;
      openIndex = -1;
      hideTip();
    }

    function buildTip() {
      const group = el('g');
      group.setAttribute('class', 'chart-tip');
      group.setAttribute('display', 'none');
      group.setAttribute('pointer-events', 'none');
      const bg = el('rect');
      bg.setAttribute('class', 'chart-tip-bg');
      bg.setAttribute('rx', '8');
      const text = el('text');
      text.setAttribute('class', 'chart-tip-text');
      group.append(bg, text);
      return { group, bg, text };
    }

    function bindTip(hot, tip, spots, viewWidth, viewHeight) {
      function setActive(index) {
        for (const item of hot) {
          item.node.setAttribute('class', item.index === index ? `${item.base} is-active` : item.base);
        }
      }
      hideTip = () => {
        setActive(-1);
        tip.group.setAttribute('display', 'none');
        tip.text.replaceChildren();
      };
      showTip = (index) => {
        const lines = tipRows(typeof tooltip === 'function' ? tooltip(index) : pointText(index));
        if (!lines.length) {
          hideTip();
          return;
        }
        setActive(index);
        const lineH = 16;
        const padX = 10;
        const padY = 8;
        const valueGap = 16;
        const boxW = Math.min(viewWidth - 8, Math.max(72, Math.max(...lines.map((line) => {
          return estimate(line.text) + (line.value ? estimate(line.value) + valueGap : 0);
        })) + padX * 2));
        const boxH = padY * 2 + lines.length * lineH;
        const spot = spots[index];
        let x = spot.cx - boxW / 2;
        let y = spot.cy - boxH - 10;
        if (y < 4) {
          x = spot.cx > viewWidth / 2 ? spot.cx - boxW - 14 : spot.cx + 14;
          y = spot.cy - boxH / 2;
        }
        if (y + boxH > viewHeight - 2) y = viewHeight - boxH - 2;
        y = Math.max(4, y);
        x = Math.max(4, Math.min(x, viewWidth - boxW - 4));
        tip.bg.setAttribute('width', String(round(boxW)));
        tip.bg.setAttribute('height', String(round(boxH)));
        tip.text.replaceChildren();
        lines.forEach((line, lineIndex) => {
          const span = el('tspan');
          span.setAttribute('x', String(padX));
          span.setAttribute('dy', lineIndex === 0 ? String(padY + 11) : String(lineH));
          if (lineIndex !== 1) span.setAttribute('class', 'is-soft');
          span.textContent = line.text;
          tip.text.append(span);
          if (!line.value) return;
          const value = el('tspan');
          value.setAttribute('x', String(round(boxW - padX)));
          value.setAttribute('dy', '0');
          value.setAttribute('text-anchor', 'end');
          if (lineIndex !== 1) value.setAttribute('class', 'is-soft');
          value.textContent = line.value;
          tip.text.append(value);
        });
        tip.group.setAttribute('transform', `translate(${round(x)} ${round(y)})`);
        tip.group.removeAttribute('display');
      };
      if (openIndex >= 0) showTip(openIndex);
    }

    function redraw() {
      const next = fixed > 0 ? fixed : Math.max(root.clientWidth || 0, 0);
      const pixelWidth = next > 0 ? next : 640;
      if (pixelWidth === drawn) return;
      drawn = pixelWidth;
      paint(pixelWidth);
    }

    redraw();
    if (!(fixed > 0)) {
      if (typeof ResizeObserver === 'function') {
        const observer = new ResizeObserver(() => redraw());
        observer.observe(root);
      }
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => {
          drawn = 0;
          redraw();
        });
      }
    }
    return root;
  }

  return { createChart, foldUsage };
});
