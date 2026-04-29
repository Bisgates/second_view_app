import { state } from './state.js';
import {
  $,
  maControl,
  maPopover,
  maPeriodList,
  maResetDefaults,
  maSelectAll,
  maClearAll,
  toggleMA,
  toggleMASettings,
} from './dom.js';
import {
  AVAILABLE_MA_PERIODS,
  DEFAULT_MA_PERIODS,
  MA_COLORS,
} from './config.js';
import { loadChart } from './data.js';
import { updateIndicatorVisibility, updateMarketStateVisibility } from './chart.js';
import { updateClock } from './clock.js';

let maHoverOpenTimer = null;
let maHoverCloseTimer = null;

function setupBtnGroup(groupId, onChange) {
  const group = $(groupId);
  group.querySelectorAll('.btn').forEach(btn => {
    btn.addEventListener('click', () => {
      group.querySelectorAll('.btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      onChange(btn.dataset.val);
    });
  });
}

export function setGroupValue(groupId, val) {
  const group = $(groupId);
  group.querySelectorAll('.btn').forEach(b => {
    b.classList.toggle('active', b.dataset.val === val);
  });
}

function normalizeMAPeriods(periods) {
  const available = new Set(AVAILABLE_MA_PERIODS);
  return [...new Set(periods.map(Number).filter(p => available.has(p)))].sort((a, b) => a - b);
}

function setMAPopoverOpen(open, pinned = state.maMenuPinned) {
  state.maMenuOpen = open;
  state.maMenuPinned = open ? pinned : false;
  maPopover.classList.toggle('hidden', !open);
  toggleMASettings.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function clearMAOpenTimer() {
  if (maHoverOpenTimer) {
    clearTimeout(maHoverOpenTimer);
    maHoverOpenTimer = null;
  }
}

function clearMACloseTimer() {
  if (maHoverCloseTimer) {
    clearTimeout(maHoverCloseTimer);
    maHoverCloseTimer = null;
  }
}

function scheduleMAOpen() {
  clearMAOpenTimer();
  maHoverOpenTimer = setTimeout(() => {
    setMAPopoverOpen(true, false);
  }, 200);
}

function scheduleMAClose() {
  clearMACloseTimer();
  if (state.maMenuPinned) return;
  maHoverCloseTimer = setTimeout(() => {
    setMAPopoverOpen(false, false);
  }, 220);
}

function renderMAPeriodOptions() {
  maPeriodList.innerHTML = '';
  AVAILABLE_MA_PERIODS.forEach(period => {
    const label = document.createElement('label');
    label.className = 'ma-option';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = String(period);
    input.checked = state.selectedMAPeriods.includes(period);

    input.addEventListener('change', async () => {
      const checked = [...maPeriodList.querySelectorAll('input:checked')]
        .map(el => Number(el.value));
      const next = normalizeMAPeriods(checked);
      if (next.length === 0) {
        input.checked = true;
        return;
      }
      state.selectedMAPeriods = next;
      await loadChart();
    });

    const text = document.createElement('span');
    const dot = document.createElement('i');
    dot.className = 'ma-color-dot';
    dot.style.background = MA_COLORS[String(period)] || '#94a3b8';

    const value = document.createElement('span');
    value.textContent = `MA${period}`;

    text.appendChild(dot);
    text.appendChild(value);
    label.appendChild(input);
    label.appendChild(text);
    maPeriodList.appendChild(label);
  });
}

function syncMAToggleState() {
  toggleMA.classList.toggle('active', state.showMA);
}

function syncMAPeriodInputs() {
  maPeriodList.querySelectorAll('input').forEach(input => {
    input.checked = state.selectedMAPeriods.includes(Number(input.value));
  });
}

function initMAControls() {
  renderMAPeriodOptions();
  syncMAToggleState();

  toggleMA.addEventListener('click', function () {
    state.showMA = !state.showMA;
    syncMAToggleState();
    updateIndicatorVisibility();
  });

  toggleMASettings.addEventListener('mouseenter', () => {
    clearMACloseTimer();
    if (!state.maMenuOpen) scheduleMAOpen();
  });

  toggleMASettings.addEventListener('mouseleave', () => {
    clearMAOpenTimer();
    scheduleMAClose();
  });

  maControl.addEventListener('mouseenter', () => {
    clearMACloseTimer();
  });

  maControl.addEventListener('mouseleave', () => {
    clearMAOpenTimer();
    scheduleMAClose();
  });

  toggleMASettings.addEventListener('click', event => {
    event.stopPropagation();
    const nextOpen = !state.maMenuOpen || !state.maMenuPinned;
    setMAPopoverOpen(nextOpen, nextOpen);
  });

  maResetDefaults.addEventListener('click', async () => {
    state.selectedMAPeriods = [...DEFAULT_MA_PERIODS];
    syncMAPeriodInputs();
    await loadChart();
  });

  maSelectAll.addEventListener('click', async () => {
    state.selectedMAPeriods = [...AVAILABLE_MA_PERIODS];
    syncMAPeriodInputs();
    await loadChart();
  });

  maClearAll.addEventListener('click', async () => {
    state.selectedMAPeriods = [...DEFAULT_MA_PERIODS];
    state.showMA = false;
    syncMAToggleState();
    syncMAPeriodInputs();
    updateIndicatorVisibility();
    await loadChart();
  });

  document.addEventListener('click', event => {
    if (!maControl.contains(event.target)) {
      setMAPopoverOpen(false, false);
    }
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && state.maMenuOpen) {
      setMAPopoverOpen(false, false);
    }
  });
}

export function initControls() {
  setupBtnGroup('chartTypeGroup', v => {
    state.chartType = v;
    loadChart();
  });
  setupBtnGroup('resGroup', v => {
    state.resolution = parseInt(v);
    loadChart();
  });
  setupBtnGroup('sessionGroup', v => {
    state.session = v;
    loadChart();
  });
  setupBtnGroup('tzGroup', v => {
    state.tz = v;
    updateClock();
    loadChart();
  });

  initMAControls();

  $('toggleFilter').addEventListener('click', function () {
    state.spikeFilter = !state.spikeFilter;
    this.classList.toggle('active', state.spikeFilter);
    loadChart();
  });

  $('toggleMarketState').addEventListener('click', function () {
    state.showMarketState = !state.showMarketState;
    this.classList.toggle('active', state.showMarketState);
    updateMarketStateVisibility();
  });
}
