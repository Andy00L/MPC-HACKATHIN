/**
 * components/ledger/charts.tsx
 * Data-driven replacements for the wireframe's sketch charts (TrendSketch/BarSketch/
 * DonutSketch/MiniTable). Each accepts the contract's series shape — { label, value }[]
 * — instead of hardcoded sample points, and renders the same parchment-tinted visuals.
 *
 * Every chart is hardened against the awkward inputs real data produces: empty series,
 * all-zero values, negative values, a single point, and a very large value. None of them
 * throw; when there is genuinely nothing to draw they render a small "no data" note.
 * Each guard is commented inline.
 */
import type { CSSProperties } from "react";
import { WF, SERIES_COLORS } from "./tokens";

// The series shape the engine produces (ChartSpec.series). Re-declared structurally here
// for prop typing; the engine's contract remains the source of truth for the real value.
export interface ChartSeriesPoint {
  label: string;
  value: number;
}
export type TableRow = Record<string, string | number>;

// Shared empty/placeholder state. Used whenever a chart has no drawable data.
function NoData({ height, label = "no data" }: { height: number; label?: string }) {
  return (
    <div
      style={{
        width: "100%",
        height,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        border: `1.5px dashed ${WF.sepiaSoft}`,
        borderRadius: 4,
        color: WF.inkSoft,
        fontFamily: WF.data,
        fontSize: 11,
        letterSpacing: 0.4,
        textTransform: "uppercase",
      }}
    >
      {label}
    </div>
  );
}

/**
 * BarChart — comparison bars (e.g. spend by category/merchant). Heights scale to the
 * largest value; the tallest bar is accented. Bars widen/narrow to fit the count.
 */
export function BarChart({
  series,
  width = 432,
  height = 120,
  color = WF.pine,
  style,
}: {
  series: ChartSeriesPoint[];
  width?: number;
  height?: number;
  color?: string;
  style?: CSSProperties;
}) {
  // Guard: nothing to draw.
  if (!series || series.length === 0) return <NoData height={height} />;

  // Guard: negatives are meaningless as a bar height, so clamp them to 0.
  const values = series.map((point) => Math.max(point.value, 0));
  const max = Math.max(...values);
  // Guard: all-zero (or all-negative) input — avoid divide-by-zero; bars render flat.
  const denom = max > 0 ? max : 1;

  const barWidth = width / (series.length * 1.6);
  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} style={{ display: "block", ...style }}>
      <line x1="0" y1={height - 1} x2={width} y2={height - 1} stroke={WF.sepiaSoft} strokeWidth="1" />
      {series.map((point, index) => {
        const clamped = values[index];
        const barHeight = (height - 6) * (clamped / denom);
        // Accent the tallest bar (only when there is real spend to accent).
        const isPeak = max > 0 && clamped === max;
        return (
          <rect
            key={`${point.label}-${index}`}
            x={index * barWidth * 1.6 + barWidth * 0.3}
            y={(height - 6) - barHeight}
            width={barWidth}
            height={barHeight}
            fill={isPeak ? WF.pumpkin : color}
            opacity={isPeak ? 0.92 : 0.78}
            rx="1.5"
          >
            {/* hover tooltip — gives the label/value the sketch never showed */}
            <title>{`${point.label}: ${point.value.toLocaleString("en-US")}`}</title>
          </rect>
        );
      })}
    </svg>
  );
}

/**
 * TrendChart — a line over time. Unlike bars, negatives are allowed (a line can dip
 * below its start), so it scales between the series min and max. Handles 0, 1, and N
 * points without throwing.
 */
export function TrendChart({
  series,
  width = 432,
  height = 150,
  color = WF.pumpkin,
  style,
}: {
  series: ChartSeriesPoint[];
  width?: number;
  height?: number;
  color?: string;
  style?: CSSProperties;
}) {
  // Guard: nothing to draw.
  if (!series || series.length === 0) return <NoData height={height} />;

  const pad = 6;
  const values = series.map((point) => point.value);
  const vmin = Math.min(...values);
  const vmax = Math.max(...values);
  const range = vmax - vmin;

  // Map a value to a y-coordinate. Guard: a flat series (range 0, incl. all-zero) would
  // divide by zero, so it draws as a centred horizontal line instead.
  const yOf = (value: number): number =>
    range === 0 ? height / 2 : height - pad - ((value - vmin) / range) * (height - 2 * pad);

  // Map an index to an x-coordinate. Guard: a single point has no span, so it sits at
  // the mid-x; otherwise points spread evenly across the width.
  const xOf = (index: number): number => (series.length === 1 ? width / 2 : (index / (series.length - 1)) * width);

  const gridlines = [0.25, 0.5, 0.75];
  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} style={{ display: "block", ...style }}>
      <line x1="0" y1={height - 1} x2={width} y2={height - 1} stroke={WF.sepiaSoft} strokeWidth="1" />
      {gridlines.map((fraction) => (
        <line key={fraction} x1="0" y1={height * fraction} x2={width} y2={height * fraction} stroke={WF.sepiaSoft} strokeWidth="0.5" strokeDasharray="2 4" />
      ))}
      {series.length === 1 ? (
        // Single point: a polyline needs two points, so draw a dot.
        <circle cx={xOf(0)} cy={yOf(values[0])} r="3.5" fill={color} />
      ) : (
        <polyline
          points={series.map((point, index) => `${xOf(index)},${yOf(point.value)}`).join(" ")}
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}

/**
 * DonutChart — share of a whole (e.g. spend by category), with a compact legend. Slices
 * are sized from the series sum; negatives clamp to 0. A zero sum renders an empty ring
 * rather than NaN arcs.
 */
export function DonutChart({
  series,
  size = 110,
  showLegend = true,
  style,
}: {
  series: ChartSeriesPoint[];
  size?: number;
  showLegend?: boolean;
  style?: CSSProperties;
}) {
  // Guard: nothing to draw.
  if (!series || series.length === 0) return <NoData height={size} />;

  const radius = size / 2 - 8;
  const center = size / 2;
  const circumference = 2 * Math.PI * radius;

  // Guard: shares can't be negative; clamp. Sum drives the arc lengths.
  const values = series.map((point) => Math.max(point.value, 0));
  const sum = values.reduce((total, value) => total + value, 0);

  const ring = (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {sum === 0 ? (
        // Guard: zero sum — draw a single empty ring, never NaN arcs.
        <circle cx={center} cy={center} r={radius} fill="none" stroke={WF.sepiaSoft} strokeWidth="13" />
      ) : (
        (() => {
          let offset = 0;
          return series.map((point, index) => {
            const length = (values[index] / sum) * circumference;
            const element = (
              <circle
                key={`${point.label}-${index}`}
                cx={center}
                cy={center}
                r={radius}
                fill="none"
                stroke={SERIES_COLORS[index % SERIES_COLORS.length]}
                strokeWidth="13"
                strokeDasharray={`${length} ${circumference - length}`}
                strokeDashoffset={-offset}
                transform={`rotate(-90 ${center} ${center})`}
              />
            );
            offset += length;
            return element;
          });
        })()
      )}
    </svg>
  );

  if (!showLegend) return <div style={style}>{ring}</div>;

  return (
    <div style={{ display: "flex", gap: 16, alignItems: "center", ...style }}>
      {ring}
      <div style={{ display: "flex", flexDirection: "column", gap: 7, fontFamily: WF.data, fontSize: 11.5, color: WF.ink }}>
        {series.map((point, index) => {
          // Percent of the whole; 0 when the sum is 0 (guarded so we never divide by zero).
          const percent = sum === 0 ? 0 : Math.round((values[index] / sum) * 100);
          return (
            <span key={`${point.label}-${index}`} style={{ whiteSpace: "nowrap" }}>
              <b style={{ color: SERIES_COLORS[index % SERIES_COLORS.length] }}>●</b> {point.label} · {percent}%
            </span>
          );
        })}
      </div>
    </div>
  );
}

/**
 * DataTable — a ranked/detail table. Columns are derived from the keys of the first row;
 * numeric cells are right-aligned and thousands-formatted. Renders an empty state when
 * there are no rows. Scrolls vertically so a long result (the engine returns up to 50)
 * never overflows the page.
 */
export function DataTable({ rows, maxHeight = 240, style }: { rows: TableRow[]; maxHeight?: number; style?: CSSProperties }) {
  // Guard: no rows.
  if (!rows || rows.length === 0) return <NoData height={64} label="no rows" />;

  // Columns come from the first row's keys (the engine builds rows with stable keys).
  const columns = Object.keys(rows[0]);
  const headerCell: CSSProperties = {
    textAlign: "left",
    padding: "0 8px 5px 0",
    borderBottom: `1.5px solid ${WF.sepia}`,
    color: WF.inkSoft,
    fontSize: 10,
    letterSpacing: 0.5,
    textTransform: "uppercase",
    fontWeight: 600,
    position: "sticky",
    top: 0,
    background: WF.page,
  };

  return (
    <div style={{ maxHeight, overflowY: "auto", fontFamily: WF.data, fontSize: 11.5, color: WF.ink, ...style }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column} style={headerCell}>
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {columns.map((column) => {
                const cell = row[column];
                const isNumber = typeof cell === "number";
                return (
                  <td
                    key={column}
                    style={{
                      padding: "6px 8px 6px 0",
                      borderBottom: `0.5px solid ${WF.sepiaSoft}`,
                      textAlign: isNumber ? "right" : "left",
                      fontVariantNumeric: isNumber ? "tabular-nums" : "normal",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {isNumber ? (cell as number).toLocaleString("en-US", { maximumFractionDigits: 2 }) : String(cell)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
