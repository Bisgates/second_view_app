import { state } from './state.js';
import { MA_PERIODS, MA_COLORS } from './config.js';
import { legend, maLegend, volLegend } from './dom.js';
import { formatTime, formatVol } from './format.js';

export function updateMALegend(d) {
  if (!state.showMA) {
    maLegend.innerHTML = '';
    return;
  }
  let html = '<span style="color:#94a3b8">MA</span> &nbsp;';
  MA_PERIODS.forEach(p => {
    const key = String(p);
    const color = MA_COLORS[key] || '#94a3b8';
    const val = (d && d.mas && d.mas[key] !== undefined) ? d.mas[key].toFixed(3) : '';
    html += `<span style="color:${color}">MA${p}:${val}</span> &nbsp;`;
  });
  maLegend.innerHTML = html;
}

export function updateVolLegend(d) {
  let html = '<span style="color:#94a3b8">成交量</span> &nbsp;';
  if (d && d.vol !== undefined) {
    html += `<span style="color:#e2e8f0">VOL: ${formatVol(d.vol)}</span>`;
  }
  if (d && d.volMa !== undefined) {
    html += ` &nbsp;<span style="color:#ef4444">MA20: ${formatVol(d.volMa)}</span>`;
  }
  volLegend.innerHTML = html;
}

export function updateLegend(d) {
  if (!d || !d.main) {
    legend.innerHTML = '';
    return;
  }
  const m = d.main;
  let html = '';
  if (d.time) html += `<span class="legend-time">${formatTime(d.time)}</span> &nbsp; `;
  if (m.open !== undefined) {
    html += `O <span class="legend-value">${m.open.toFixed(2)}</span> `;
    html += `H <span class="legend-value">${m.high.toFixed(2)}</span> `;
    html += `L <span class="legend-value">${m.low.toFixed(2)}</span> `;
    html += `C <span class="legend-value">${m.close.toFixed(2)}</span>`;
  } else if (m.value !== undefined) {
    html += `Price <span class="legend-value">${m.value.toFixed(2)}</span>`;
  }
  legend.innerHTML = html;
}
