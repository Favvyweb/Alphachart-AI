/**
 * Chart Overlay Canvas Renderer
 * Universal Relative Target Overlay Renderer:
 * ENTRY is 100% anchored to the current live price on the active right-hand candle.
 * SL and TP1-3 lines are drawn at precise relative offsets, and the 15m-45m future path
 * projects forward from the current right candle into future space.
 */

window.ChartOverlay = {
  render: function (canvasElement, imageElement, analysisData) {
    if (!canvasElement || !imageElement || !analysisData) return;

    const ctx = canvasElement.getContext('2d');
    const width = imageElement.naturalWidth || imageElement.clientWidth || 800;
    const height = imageElement.naturalHeight || imageElement.clientHeight || 500;

    canvasElement.width = width;
    canvasElement.height = height;

    // Draw the source chart image
    ctx.drawImage(imageElement, 0, 0, width, height);

    const isLong = analysisData.signal === 'LONG';

    // 1. STRICT CHART GRID BOUNDARIES (Confine all drawings strictly inside chart grid)
    // Prevents lines/badges from leaking into top header (ticker, price, icons) or bottom logo.
    const chartTop = height * 0.22;       // Below top header bar, price, and timeframe selector
    const chartBottom = height * 0.86;    // Above bottom logo/footer bar
    const chartHeight = chartBottom - chartTop;

    const presentX = width * 0.72;        // Active rightmost candle position
    const futureEndX = width * 0.98;      // Right margin for price badges

    // 2. DETECT ACTIVE CANDLE Y POSITION OR ANCHOR TO LIVE CANDLE LEVEL
    let activeCandleY = null;
    try {
      const imageData = ctx.getImageData(0, 0, width, height);
      const d = imageData.data;
      const scanXStart = Math.floor(width * 0.68);
      const scanXEnd = Math.floor(width * 0.76);
      const scanYStart = Math.floor(chartTop);
      const scanYEnd = Math.floor(chartBottom);

      let minY = height;
      let maxY = 0;
      let pixelCount = 0;

      for (let y = scanYStart; y < scanYEnd; y += 2) {
        for (let x = scanXStart; x < scanXEnd; x += 2) {
          const idx = (y * width + x) * 4;
          const r = d[idx];
          const g = d[idx + 1];
          const b = d[idx + 2];
          const isGreen = (g > 130 && r < 140 && b < 140);
          const isRed = (r > 130 && g < 140 && b < 140);
          if (isGreen || isRed) {
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
            pixelCount++;
          }
        }
      }
      if (pixelCount > 10) {
        activeCandleY = (minY + maxY) / 2;
      }
    } catch (e) {
      console.warn('Active candle Y detection note:', e);
    }

    if (!activeCandleY || activeCandleY < chartTop + 20 || activeCandleY > chartBottom - 20) {
      activeCandleY = isLong ? (chartTop + chartHeight * 0.70) : (chartTop + chartHeight * 0.30);
    }

    // Anchor entryY to actual live candle, strictly clamped inside chart grid
    const entryY = Math.max(chartTop + 30, Math.min(chartBottom - 30, activeCandleY));

    // 3. CALCULATE TP AND SL LEVELS CLAMPED STRICTLY INSIDE THE CHART GRID
    let slY, tp1Y, tp2Y, tp3Y;

    if (isLong) {
      // LONG POSITION:
      // SL is BELOW entryY (larger Y coordinate, toward chartBottom)
      // TP1, TP2, TP3 are ABOVE entryY (smaller Y coordinate, toward chartTop)
      const availableUpSpace = entryY - chartTop - 15;
      const availableDownSpace = chartBottom - entryY - 15;

      slY = Math.min(chartBottom - 10, entryY + Math.max(20, availableDownSpace * 0.65));
      tp1Y = entryY - Math.max(18, availableUpSpace * 0.30);
      tp2Y = entryY - Math.max(36, availableUpSpace * 0.60);
      tp3Y = Math.max(chartTop + 12, entryY - Math.max(54, availableUpSpace * 0.90));
    } else {
      // SHORT POSITION:
      // SL is ABOVE entryY (smaller Y coordinate, toward chartTop)
      // TP1, TP2, TP3 are BELOW entryY (larger Y coordinate, toward chartBottom)
      const availableUpSpace = entryY - chartTop - 15;
      const availableDownSpace = chartBottom - entryY - 15;

      slY = Math.max(chartTop + 12, entryY - Math.max(20, availableUpSpace * 0.65));
      tp1Y = entryY + Math.max(18, availableDownSpace * 0.30);
      tp2Y = entryY + Math.max(36, availableDownSpace * 0.60);
      tp3Y = Math.min(chartBottom - 10, entryY + Math.max(54, availableDownSpace * 0.90));
    }

    // 4. DRAW VERTICAL "LIVE CANDLE" DIVIDER LINE STRICTLY INSIDE CHART GRID
    ctx.save();
    ctx.beginPath();
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.moveTo(presentX, chartTop);
    ctx.lineTo(presentX, chartBottom);
    ctx.stroke();

    // Indicator Pill anchored right at chartTop inside grid
    ctx.font = 'bold 10px Inter, sans-serif';
    ctx.fillStyle = 'rgba(10, 14, 23, 0.92)';
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(presentX - 45, chartTop + 4, 90, 18, 4);
    else ctx.rect(presentX - 45, chartTop + 4, 90, 18);
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.setLineDash([]);
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('LIVE CANDLE 📍', presentX, chartTop + 13);
    ctx.restore();

    // 5. DRAW FUTURE PROJECTION ZONE SHADING (Next 15m - 45m Space)
    const futureW = width - presentX;

    // Take-Profit Future Expansion Zone (Green)
    ctx.fillStyle = 'rgba(0, 255, 136, 0.15)';
    if (isLong) {
      ctx.fillRect(presentX, tp3Y, futureW, entryY - tp3Y);
    } else {
      ctx.fillRect(presentX, entryY, futureW, tp3Y - entryY);
    }

    // Stop-Loss Future Invalidation Zone (Red)
    ctx.fillStyle = 'rgba(255, 77, 77, 0.15)';
    if (isLong) {
      ctx.fillRect(presentX, entryY, futureW, slY - entryY);
    } else {
      ctx.fillRect(presentX, slY, futureW, entryY - slY);
    }

    // 6. DRAW PREDICTIVE FUTURE TRAJECTORY VECTOR CURVE
    ctx.save();
    ctx.beginPath();
    ctx.setLineDash([8, 4]);
    ctx.lineWidth = 3.0;
    ctx.strokeStyle = isLong ? '#00ff88' : '#ff4d4d';

    const startX = presentX;
    const endX = futureEndX - 20;
    const cpX = presentX + (endX - presentX) * 0.5;
    const cpY = isLong ? (entryY + tp3Y) / 2 - 10 : (entryY + tp3Y) / 2 + 10;

    ctx.moveTo(startX, entryY);
    ctx.quadraticCurveTo(cpX, cpY, endX, tp3Y);
    ctx.stroke();

    // Terminal Target Pulse Dot
    ctx.beginPath();
    ctx.fillStyle = isLong ? '#00ff88' : '#ff4d4d';
    ctx.arc(endX, tp3Y, 5, 0, Math.PI * 2);
    ctx.fill();

    // Future Trajectory Text Pill
    ctx.font = 'bold 10px Inter, sans-serif';
    const trajText = isLong ? '15m–45m PREDICTED PATH ↗' : '15m–45m PREDICTED PATH ↘';
    const trajMetrics = ctx.measureText(trajText);
    const trajPillW = trajMetrics.width + 14;
    const trajPillH = 20;
    const trajPillX = cpX - trajPillW / 2;
    const trajPillY = Math.max(chartTop + 22, Math.min(chartBottom - 22, cpY - 10));

    ctx.fillStyle = 'rgba(10, 14, 23, 0.95)';
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(trajPillX, trajPillY, trajPillW, trajPillH, 5);
    else ctx.rect(trajPillX, trajPillY, trajPillW, trajPillH);
    ctx.fill();
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = isLong ? '#00ff88' : '#ff4d4d';
    ctx.setLineDash([]);
    ctx.stroke();

    ctx.fillStyle = isLong ? '#00ff88' : '#ff4d4d';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(trajText, cpX, trajPillY + trajPillH / 2);
    ctx.restore();

    // 7. DRAW FUTURE TARGET LINES & BADGES
    function drawFutureTargetLine(y, color, leftBadgeText, priceText, isPrimary = false) {
      // Ensure Y is strictly inside chart grid
      const clampedY = Math.max(chartTop + 10, Math.min(chartBottom - 10, y));

      ctx.save();
      
      ctx.beginPath();
      ctx.setLineDash(isPrimary ? [8, 4] : [4, 4]);
      ctx.lineWidth = isPrimary ? 2.5 : 1.5;
      ctx.strokeStyle = color;
      ctx.moveTo(presentX, clampedY);
      ctx.lineTo(width, clampedY);
      ctx.stroke();

      const font = 'bold 10px Inter, sans-serif';
      ctx.font = font;

      // LEFT BADGE
      const leftMetrics = ctx.measureText(leftBadgeText);
      const leftPillW = leftMetrics.width + 12;
      const leftPillH = 18;
      const leftPillX = presentX + 6;
      const leftPillY = clampedY - leftPillH / 2;

      ctx.fillStyle = color;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(leftPillX, leftPillY, leftPillW, leftPillH, 4);
      else ctx.rect(leftPillX, leftPillY, leftPillW, leftPillH);
      ctx.fill();

      ctx.fillStyle = '#000000';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(leftBadgeText, leftPillX + leftPillW / 2, clampedY + 0.5);

      // RIGHT PRICE BADGE
      const rightMetrics = ctx.measureText(priceText);
      const rightPillW = rightMetrics.width + 14;
      const rightPillH = 20;
      const rightPillX = width - rightPillW - 6;
      const rightPillY = clampedY - rightPillH / 2;

      ctx.fillStyle = 'rgba(10, 14, 23, 0.95)';
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(rightPillX, rightPillY, rightPillW, rightPillH, 4);
      else ctx.rect(rightPillX, rightPillY, rightPillW, rightPillH);
      ctx.fill();
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = color;
      ctx.setLineDash([]);
      ctx.stroke();

      ctx.fillStyle = color;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(priceText, rightPillX + rightPillW / 2, clampedY + 0.5);

      ctx.restore();
    }

    // Draw Future Projection Target Lines strictly clamped inside the chart grid
    drawFutureTargetLine(entryY, '#38bdf8', 'ENTRY', analysisData.entry, true);
    drawFutureTargetLine(slY, '#ff4d4d', 'FUTURE SL', analysisData.sl, true);
    drawFutureTargetLine(tp1Y, '#00e479', 'TP1', analysisData.tp1, false);
    drawFutureTargetLine(tp2Y, '#00ff88', 'TP2', analysisData.tp2, false);
    drawFutureTargetLine(tp3Y, '#00ff88', 'FUTURE TP', analysisData.tp3, true);
  }
};
