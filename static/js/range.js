import { state } from './state.js';
import { chartEl, rangeOverlay, rangeTooltip } from './dom.js';
import { formatRangeDuration } from './format.js';
import { getChart, getCrosshairBar, setChartInteraction } from './chart.js';

let active = false;
let startX = 0;
let startBar = null;
let viewHandler = null;

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

function hideRange() {
  active = false;
  startBar = null;
  rangeOverlay.style.display = 'none';
  rangeTooltip.style.display = 'none';
  setChartInteraction(true);
  unsubView();
}

function subView() {
  unsubView();
  const chart = getChart();
  if (chart) {
    viewHandler = () => hideRange();
    chart.timeScale().subscribeVisibleLogicalRangeChange(viewHandler);
  }
}

function unsubView() {
  if (viewHandler) {
    const chart = getChart();
    if (chart) chart.timeScale().unsubscribeVisibleLogicalRangeChange(viewHandler);
    viewHandler = null;
  }
}

function tooltipHTML(buyPrice, sellPrice, duration) {
  const pct = ((sellPrice - buyPrice) / buyPrice) * 100;
  const sign = pct >= 0 ? '+' : '';
  const color = pct >= 0 ? '#22c55e' : '#ef4444';
  return `<span style="color:${color};font-weight:600">${sign}${pct.toFixed(2)}%</span> · ${formatRangeDuration(duration)} · 买 ${buyPrice.toFixed(2)} / 卖 ${sellPrice.toFixed(2)}`;
}

export function initRangeSelection() {
  chartEl.addEventListener('mousedown', e => {
    if (e.button !== 0 || !state.data) return;

    // dismiss existing result on click
    if (rangeTooltip.style.display === 'block') {
      hideRange();
      return;
    }

    const bar = getCrosshairBar();
    if (!bar) return;

    e.preventDefault();
    e.stopPropagation();

    active = true;
    startBar = bar;
    startX = clamp(e.clientX - chartEl.getBoundingClientRect().left, 0, chartEl.clientWidth);

    rangeOverlay.style.display = 'block';
    rangeOverlay.style.left = `${startX}px`;
    rangeOverlay.style.width = '0px';
    rangeTooltip.style.display = 'none';

    setChartInteraction(false);
  });

  document.addEventListener('mousemove', e => {
    if (!active) return;

    const rect = chartEl.getBoundingClientRect();
    const curX = clamp(e.clientX - rect.left, 0, rect.width);
    const left = Math.min(startX, curX);
    const width = Math.abs(curX - startX);
    rangeOverlay.style.left = `${left}px`;
    rangeOverlay.style.width = `${width}px`;

    const bar = getCrosshairBar();
    if (bar && startBar) {
      rangeTooltip.innerHTML = tooltipHTML(startBar.price, bar.price, Math.abs(bar.time - startBar.time));
      const mid = clamp(left + width / 2, 16, rect.width - 16);
      rangeTooltip.style.left = `${mid}px`;
      rangeTooltip.style.display = 'block';
    }
  });

  document.addEventListener('mouseup', () => {
    if (!active) return;
    active = false;
    setChartInteraction(true);

    if (!startBar || !getCrosshairBar()) {
      hideRange();
      return;
    }

    // overlay + tooltip freeze at current pixel position
    // dismiss on any zoom/scroll
    subView();
  });

  document.addEventListener('mousedown', e => {
    if (!active && rangeTooltip.style.display === 'block' && !chartEl.contains(e.target)) {
      hideRange();
    }
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') hideRange();
  });
}
