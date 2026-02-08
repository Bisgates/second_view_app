import { state } from './state.js';
import { chartEl, rangeOverlay, rangeTooltip, rangePriceLeft, rangePriceRight, rangeDivider, rangePriceMid, rangeSubLeft, rangeSubRight } from './dom.js';
import { formatRangeDuration } from './format.js';
import { getChart, getCrosshairBar, setChartInteraction } from './chart.js';

let active = false;
let frozen = false;
let startX = 0;
let startBar = null;
let endBar = null;
let viewHandler = null;

// split state
let splitActive = false;
let splitBar = null;

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

function ordered(a, b) {
  if (a.time <= b.time) return { left: a, right: b };
  return { left: b, right: a };
}

function pctHTML(buyPrice, sellPrice) {
  const pct = ((sellPrice - buyPrice) / buyPrice) * 100;
  const sign = pct >= 0 ? '+' : '';
  const color = pct >= 0 ? '#22c55e' : '#ef4444';
  return `<span style="color:${color};font-weight:600">${sign}${pct.toFixed(2)}%</span>`;
}

function tooltipContent(leftBar, rightBar) {
  const dur = Math.abs(rightBar.time - leftBar.time);
  return `${pctHTML(leftBar.price, rightBar.price)} · ${formatRangeDuration(dur)}`;
}

function subTooltipContent(fromBar, toBar) {
  const dur = Math.abs(toBar.time - fromBar.time);
  return `${pctHTML(fromBar.price, toBar.price)} · ${formatRangeDuration(dur)}`;
}

function applyPriceTagClass(el, isUp) {
  el.classList.remove('up', 'down');
  el.classList.add(isUp ? 'up' : 'down');
}

function updatePriceTags(leftBar, rightBar, overlayLeft, overlayWidth) {
  const isUp = rightBar.price >= leftBar.price;
  const chartHeight = chartEl.clientHeight;
  const vertCenter = Math.round(chartHeight * 0.5);

  // Left price tag — centered on the left edge line
  rangePriceLeft.textContent = `$${leftBar.price.toFixed(2)}`;
  applyPriceTagClass(rangePriceLeft, isUp);
  rangePriceLeft.style.display = 'block';
  rangePriceLeft.style.top = `${vertCenter}px`;
  rangePriceLeft.style.left = `${overlayLeft}px`;
  rangePriceLeft.style.transform = 'translate(-50%, -50%)';

  // Right price tag — centered on the right edge line
  rangePriceRight.textContent = `$${rightBar.price.toFixed(2)}`;
  applyPriceTagClass(rangePriceRight, isUp);
  rangePriceRight.style.display = 'block';
  rangePriceRight.style.top = `${vertCenter}px`;
  rangePriceRight.style.left = `${overlayLeft + overlayWidth}px`;
  rangePriceRight.style.transform = 'translate(-50%, -50%)';
}

function hidePriceTags() {
  rangePriceLeft.style.display = 'none';
  rangePriceRight.style.display = 'none';
}

function hideSplit() {
  splitActive = false;
  splitBar = null;
  rangeDivider.style.display = 'none';
  rangePriceMid.style.display = 'none';
  rangeSubLeft.style.display = 'none';
  rangeSubRight.style.display = 'none';
}

function hideRange() {
  active = false;
  frozen = false;
  startBar = null;
  endBar = null;
  rangeOverlay.style.display = 'none';
  rangeTooltip.style.display = 'none';
  hidePriceTags();
  hideSplit();
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

function getOverlayBounds() {
  const left = parseFloat(rangeOverlay.style.left) || 0;
  const width = parseFloat(rangeOverlay.style.width) || 0;
  return { left, width };
}

function updateSplitDisplay(x, leftBar, rightBar) {
  const { left: ovLeft, width: ovWidth } = getOverlayBounds();
  const clampedX = clamp(x, ovLeft, ovLeft + ovWidth);
  const chartHeight = chartEl.clientHeight;
  const vertCenter = Math.round(chartHeight * 0.5);

  // Divider line
  rangeDivider.style.display = 'block';
  rangeDivider.style.left = `${clampedX}px`;

  // Mid price tag
  if (splitBar) {
    const isUpLeft = splitBar.price >= leftBar.price;
    rangePriceMid.textContent = `$${splitBar.price.toFixed(2)}`;
    applyPriceTagClass(rangePriceMid, isUpLeft);
    rangePriceMid.style.display = 'block';
    rangePriceMid.style.top = `${vertCenter}px`;
    rangePriceMid.style.left = `${clampedX}px`;
    rangePriceMid.style.transform = 'translate(-50%, -50%)';

    // Sub tooltips
    const leftDur = subTooltipContent(leftBar, splitBar);
    const rightDur = subTooltipContent(splitBar, rightBar);

    rangeSubLeft.innerHTML = leftDur;
    rangeSubLeft.style.display = 'block';
    rangeSubLeft.style.left = `${(ovLeft + clampedX) / 2}px`;

    rangeSubRight.innerHTML = rightDur;
    rangeSubRight.style.display = 'block';
    rangeSubRight.style.left = `${(clampedX + ovLeft + ovWidth) / 2}px`;
  }
}

export function initRangeSelection() {
  chartEl.addEventListener('mousedown', e => {
    if (e.button !== 0 || !state.data) return;

    // If frozen and Shift held, enter split mode
    if (frozen && e.shiftKey) {
      const rect = chartEl.getBoundingClientRect();
      const x = clamp(e.clientX - rect.left, 0, rect.width);
      const { left: ovLeft, width: ovWidth } = getOverlayBounds();

      // Only start split if click is within overlay
      if (x >= ovLeft && x <= ovLeft + ovWidth) {
        e.preventDefault();
        e.stopPropagation();
        splitActive = true;
        splitBar = getCrosshairBar();
        setChartInteraction(false);
        unsubView(); // pause dismiss-on-scroll while splitting

        const { left: lb, right: rb } = ordered(startBar, endBar);
        updateSplitDisplay(x, lb, rb);
        return;
      }
    }

    // Dismiss existing result on click
    if (frozen) {
      hideRange();
      return;
    }

    const bar = getCrosshairBar();
    if (!bar) return;

    e.preventDefault();
    e.stopPropagation();

    active = true;
    frozen = false;
    startBar = bar;
    endBar = null;
    startX = clamp(e.clientX - chartEl.getBoundingClientRect().left, 0, chartEl.clientWidth);

    rangeOverlay.style.display = 'block';
    rangeOverlay.style.left = `${startX}px`;
    rangeOverlay.style.width = '0px';
    rangeTooltip.style.display = 'none';
    hidePriceTags();
    hideSplit();

    setChartInteraction(false);
  });

  document.addEventListener('mousemove', e => {
    if (splitActive) {
      const rect = chartEl.getBoundingClientRect();
      const x = clamp(e.clientX - rect.left, 0, rect.width);
      splitBar = getCrosshairBar() || splitBar;

      const { left: lb, right: rb } = ordered(startBar, endBar);
      updateSplitDisplay(x, lb, rb);
      return;
    }

    if (!active) return;

    const rect = chartEl.getBoundingClientRect();
    const curX = clamp(e.clientX - rect.left, 0, rect.width);
    const left = Math.min(startX, curX);
    const width = Math.abs(curX - startX);
    rangeOverlay.style.left = `${left}px`;
    rangeOverlay.style.width = `${width}px`;

    const bar = getCrosshairBar();
    if (bar && startBar) {
      const { left: lb, right: rb } = ordered(startBar, bar);
      rangeTooltip.innerHTML = tooltipContent(lb, rb);
      const mid = clamp(left + width / 2, 16, rect.width - 16);
      rangeTooltip.style.left = `${mid}px`;
      rangeTooltip.style.display = 'block';

      updatePriceTags(lb, rb, left, width);
    }
  });

  document.addEventListener('mouseup', () => {
    if (splitActive) {
      splitActive = false;
      setChartInteraction(true);
      // Freeze the divider — keep sub-tooltips visible
      // Re-subscribe to dismiss on scroll/zoom
      subView();
      return;
    }

    if (!active) return;
    active = false;

    const curBar = getCrosshairBar();
    if (!startBar || !curBar) {
      hideRange();
      return;
    }

    endBar = curBar;
    frozen = true;

    // Final update with ordered bars
    const { left: lb, right: rb } = ordered(startBar, endBar);
    rangeTooltip.innerHTML = tooltipContent(lb, rb);

    const { left: ovLeft, width: ovWidth } = getOverlayBounds();
    updatePriceTags(lb, rb, ovLeft, ovWidth);

    setChartInteraction(true);
    subView();
  });

  document.addEventListener('mousedown', e => {
    if (!active && !splitActive && frozen && !chartEl.contains(e.target)) {
      hideRange();
    }
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') hideRange();
  });
}
