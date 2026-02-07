import { state } from './state.js';
import { chartEl, rangeOverlay, rangeTooltip } from './dom.js';
import { formatRangeDuration } from './format.js';
import { getChart, setChartInteraction } from './chart.js';

const rangeState = { active: false, startX: 0, dragging: false };
const RANGE_MIN_PX = 4;

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

function hideRange() {
  rangeState.active = false;
  rangeState.dragging = false;
  rangeOverlay.style.display = 'none';
  rangeTooltip.style.display = 'none';
  setChartInteraction(true);
}

function nearestCandleByTime(candles, time) {
  let lo = 0;
  let hi = candles.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (candles[mid].time < time) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && Math.abs(candles[lo - 1].time - time) < Math.abs(candles[lo].time - time)) {
    return candles[lo - 1];
  }
  return candles[lo] || null;
}

export function initRangeSelection() {
  chartEl.addEventListener('mousedown', e => {
    const chart = getChart();
    if (e.button !== 0 || !chart || !state.data) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = chartEl.getBoundingClientRect();
    rangeState.active = true;
    rangeState.dragging = false;
    rangeState.startX = clamp(e.clientX - rect.left, 0, rect.width);
    setChartInteraction(false);
    rangeOverlay.style.display = 'block';
    rangeOverlay.style.left = `${rangeState.startX}px`;
    rangeOverlay.style.width = '0px';
    rangeTooltip.style.display = 'none';
  });

  document.addEventListener('mousemove', e => {
    if (!rangeState.active) return;
    e.preventDefault();
    const rect = chartEl.getBoundingClientRect();
    const curX = clamp(e.clientX - rect.left, 0, rect.width);
    const left = Math.min(rangeState.startX, curX);
    const width = Math.abs(curX - rangeState.startX);
    if (width > RANGE_MIN_PX) rangeState.dragging = true;
    rangeOverlay.style.left = `${left}px`;
    rangeOverlay.style.width = `${width}px`;
  });

  document.addEventListener('mouseup', e => {
    if (!rangeState.active) return;
    const chart = getChart();
    const rect = chartEl.getBoundingClientRect();
    const endX = clamp(e.clientX - rect.left, 0, rect.width);
    const width = Math.abs(endX - rangeState.startX);
    rangeState.active = false;

    if (!rangeState.dragging || width <= RANGE_MIN_PX || !chart || !state.data) {
      hideRange();
      return;
    }

    const leftX = Math.min(rangeState.startX, endX);
    const rightX = Math.max(rangeState.startX, endX);

    const tLeft = chart.timeScale().coordinateToTime(leftX);
    const tRight = chart.timeScale().coordinateToTime(rightX);
    if (tLeft == null || tRight == null || !state.data) {
      hideRange();
      return;
    }
    const candles = state.data.candles;
    const buyCandle = nearestCandleByTime(candles, tLeft);
    const sellCandle = nearestCandleByTime(candles, tRight);
    if (!buyCandle || !sellCandle) {
      hideRange();
      return;
    }

    const pct = ((sellCandle.close - buyCandle.close) / buyCandle.close) * 100;
    const sign = pct >= 0 ? '+' : '';
    const color = pct >= 0 ? '#22c55e' : '#ef4444';
    const duration = Math.abs(tRight - tLeft);
    rangeTooltip.innerHTML = `<span style="color:${color};font-weight:600">${sign}${pct.toFixed(2)}%</span> · ${formatRangeDuration(duration)} · 买 ${buyCandle.close.toFixed(2)} / 卖 ${sellCandle.close.toFixed(2)}`;

    const mid = clamp(leftX + width / 2, 16, rect.width - 16);
    rangeTooltip.style.left = `${mid}px`;
    rangeTooltip.style.display = 'block';
    setChartInteraction(true);
  });

  chartEl.addEventListener('click', () => {
    if (!rangeState.dragging) hideRange();
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') hideRange();
  });
}
