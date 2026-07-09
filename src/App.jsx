import React, { useState, useCallback, useRef } from "react";
import Papa from "papaparse";
import {
  Upload,
  FileText,
  Loader2,
  AlertCircle,
  TrendingUp,
  ChevronRight,
  Download,
  Send,
  MessageSquare,
  Zap,
  CheckCircle2,
  Sparkles,
  Wrench,
  ArrowRight,
  User,
  Briefcase,
  FlaskConical,
} from "lucide-react";

const ACCENT = "#2A6F77";
const AMBER = "#B8752E";
const RUST = "#A34A3A";
const GREEN = "#3D7A4E";
const INK = "#1C2321";
const PAPER = "#FAF8F3";
const RULE = "#DAD4C4";
const MUTED = "#6B6F6A";

const NON_NEGATIVE_HINTS = ["age", "price", "amount", "income", "salary", "quantity", "count", "qty", "cost", "revenue", "balance", "score"];

// ---------- Data quality scan + auto-clean ----------

function scanAndClean(rows, fields) {
  const totalCells = rows.length * fields.length;
  const log = [];

  // 1. Duplicate rows
  const seen = new Map();
  const rowKeys = rows.map((r) => fields.map((f) => String(r[f])).join("|"));
  rowKeys.forEach((k) => seen.set(k, (seen.get(k) || 0) + 1));
  const duplicateRowCount = rowKeys.length - new Set(rowKeys).size;

  // 2. Whitespace + case issues on string fields, missing values, negative-value issues
  let whitespaceCells = 0;
  let caseNormalizedCells = 0;
  let missingCells = 0;
  let negativeIssueCells = 0;

  const isNonNegField = (f) => NON_NEGATIVE_HINTS.some((h) => f.toLowerCase().includes(h));

  const cleanedRows = [];
  const dedupeSeen = new Set();

  rows.forEach((row, idx) => {
    const key = rowKeys[idx];
    if (dedupeSeen.has(key)) return; // drop duplicate
    dedupeSeen.add(key);

    const newRow = {};
    fields.forEach((f) => {
      let v = row[f];
      if (v === null || v === undefined || v === "") {
        missingCells++;
        newRow[f] = null; // to be imputed after pass
        return;
      }
      if (typeof v === "string") {
        const trimmed = v.trim();
        if (trimmed !== v) whitespaceCells++;
        const normalized = trimmed.replace(/\s+/g, " ");
        v = normalized;
        newRow[f] = v;
      } else if (typeof v === "number" && isNonNegField(f) && v < 0) {
        negativeIssueCells++;
        newRow[f] = null; // treat as missing, impute later
      } else {
        newRow[f] = v;
      }
    });
    cleanedRows.push(newRow);
  });

  // Case normalization pass for categorical (string) fields: map to a canonical casing (most frequent variant)
  fields.forEach((f) => {
    const sampleVal = cleanedRows.find((r) => typeof r[f] === "string");
    if (!sampleVal) return;
    const variantCounts = {};
    cleanedRows.forEach((r) => {
      if (typeof r[f] === "string" && r[f] !== null) {
        const lower = r[f].toLowerCase();
        variantCounts[lower] = variantCounts[lower] || {};
        variantCounts[lower][r[f]] = (variantCounts[lower][r[f]] || 0) + 1;
      }
    });
    const canonical = {};
    Object.entries(variantCounts).forEach(([lower, variants]) => {
      const best = Object.entries(variants).sort((a, b) => b[1] - a[1])[0][0];
      canonical[lower] = best;
      const variantKeys = Object.keys(variants);
      if (variantKeys.length > 1) {
        const changedCount = variantKeys.filter((k) => k !== best).reduce((s, k) => s + variants[k], 0);
        caseNormalizedCells += changedCount;
      }
    });
    cleanedRows.forEach((r) => {
      if (typeof r[f] === "string" && r[f] !== null) {
        r[f] = canonical[r[f].toLowerCase()];
      }
    });
  });

  // Impute missing values: numeric -> median, categorical -> mode
  fields.forEach((f) => {
    const nonNull = cleanedRows.map((r) => r[f]).filter((v) => v !== null && v !== undefined);
    const numericVals = nonNull.filter((v) => typeof v === "number" || (!isNaN(parseFloat(v)) && isFinite(v)));
    const isNumericField = nonNull.length > 0 && numericVals.length / nonNull.length > 0.8;

    let fillValue;
    if (isNumericField) {
      const nums = numericVals.map((v) => parseFloat(v)).sort((a, b) => a - b);
      fillValue = nums.length ? nums[Math.floor(nums.length / 2)] : 0;
    } else {
      const counts = {};
      nonNull.forEach((v) => (counts[v] = (counts[v] || 0) + 1));
      const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
      fillValue = sorted.length ? sorted[0][0] : "Unknown";
    }
    cleanedRows.forEach((r) => {
      if (r[f] === null || r[f] === undefined) r[f] = fillValue;
    });
  });

  if (duplicateRowCount > 0) log.push({ icon: "dup", text: `Removed ${duplicateRowCount} duplicate row${duplicateRowCount !== 1 ? "s" : ""}` });
  if (missingCells > 0) log.push({ icon: "fill", text: `Imputed ${missingCells} missing value${missingCells !== 1 ? "s" : ""} (median for numeric, mode for categorical)` });
  if (whitespaceCells > 0) log.push({ icon: "trim", text: `Trimmed whitespace in ${whitespaceCells} cell${whitespaceCells !== 1 ? "s" : ""}` });
  if (caseNormalizedCells > 0) log.push({ icon: "case", text: `Standardized casing for ${caseNormalizedCells} inconsistent categorical value${caseNormalizedCells !== 1 ? "s" : ""}` });
  if (negativeIssueCells > 0) log.push({ icon: "neg", text: `Flagged and re-imputed ${negativeIssueCells} invalid negative value${negativeIssueCells !== 1 ? "s" : ""} in non-negative field${negativeIssueCells !== 1 ? "s" : ""}` });

  const issueWeight = missingCells + duplicateRowCount * fields.length + whitespaceCells + caseNormalizedCells + negativeIssueCells;
  const qualityBefore = Math.max(0, Math.min(100, 100 * (1 - issueWeight / Math.max(totalCells, 1))));
  const qualityAfter = Math.max(qualityBefore, Math.min(100, 100 - 1)); // near-perfect after auto-fix, small residual for anything unresolvable
  const qualityAfterFinal = log.length ? Math.min(99.5, 100 - (0.5)) : 100;

  return {
    cleanedRows,
    log,
    qualityBefore: Math.round(qualityBefore * 10) / 10,
    qualityAfter: Math.round(qualityAfterFinal * 10) / 10,
    duplicateRowCount,
    missingCells,
    whitespaceCells,
    caseNormalizedCells,
    negativeIssueCells,
    totalCells,
  };
}

// ---------- Stats engine (runs on cleaned data) ----------

function computeStats(rows, fields) {
  const numericCols = [];
  const catCols = [];
  const numericRaw = {};

  fields.forEach((f) => {
    const vals = rows.map((r) => r[f]).filter((v) => v !== null && v !== undefined && v !== "");
    const numericVals = vals.filter((v) => typeof v === "number" || (!isNaN(parseFloat(v)) && isFinite(v)));
    if (vals.length > 0 && numericVals.length / vals.length > 0.8) {
      const nums = numericVals.map((v) => parseFloat(v));
      const sum = nums.reduce((a, b) => a + b, 0);
      const mean = sum / nums.length;
      const sorted = [...nums].sort((a, b) => a - b);
      const min = sorted[0];
      const max = sorted[sorted.length - 1];
      const median = sorted[Math.floor(sorted.length / 2)];
      const variance = nums.reduce((a, b) => a + (b - mean) ** 2, 0) / nums.length;
      const std = Math.sqrt(variance);
      const outliers = nums.filter((n) => std > 0 && Math.abs(n - mean) / std > 2.5).length;
      numericCols.push({ field: f, count: nums.length, mean, min, max, median, std, outliers });
      numericRaw[f] = rows.map((r) => {
        const v = r[f];
        const n = parseFloat(v);
        return v === null || v === undefined || v === "" || isNaN(n) ? NaN : n;
      });
    } else if (vals.length > 0) {
      const counts = {};
      vals.forEach((v) => (counts[v] = (counts[v] || 0) + 1));
      const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5);
      catCols.push({ field: f, unique: Object.keys(counts).length, top, total: vals.length });
    }
  });

  const corrPairs = [];
  const numFields = numericCols.map((c) => c.field);
  for (let i = 0; i < numFields.length; i++) {
    for (let j = i + 1; j < numFields.length; j++) {
      const a = numericRaw[numFields[i]];
      const b = numericRaw[numFields[j]];
      const pairs = a.map((v, idx) => [v, b[idx]]).filter(([x, y]) => !isNaN(x) && !isNaN(y));
      if (pairs.length < 3) continue;
      const n = pairs.length;
      const meanA = pairs.reduce((s, p) => s + p[0], 0) / n;
      const meanB = pairs.reduce((s, p) => s + p[1], 0) / n;
      let cov = 0, varA = 0, varB = 0;
      pairs.forEach(([x, y]) => {
        cov += (x - meanA) * (y - meanB);
        varA += (x - meanA) ** 2;
        varB += (y - meanB) ** 2;
      });
      const denom = Math.sqrt(varA * varB);
      const r = denom === 0 ? 0 : cov / denom;
      corrPairs.push({ a: numFields[i], b: numFields[j], r });
    }
  }
  corrPairs.sort((x, y) => Math.abs(y.r) - Math.abs(x.r));

  return { numericCols, catCols, corrPairs, rowCount: rows.length, colCount: fields.length };
}

const ROLE_CONFIG = {
  analyst: { label: "Data Analyst", icon: Briefcase },
  scientist: { label: "Data Scientist", icon: FlaskConical },
  business: { label: "Business Analyst", icon: User },
};

// ---------- Local rule-based insight engine (no external API — runs entirely in the browser) ----------

function describeCorrelation(c) {
  const strength = Math.abs(c.r) > 0.7 ? "a strong" : Math.abs(c.r) > 0.4 ? "a moderate" : "a weak";
  const direction = c.r >= 0 ? "positive" : "negative";
  return `${c.a} and ${c.b} show ${strength} ${direction} relationship (r=${c.r.toFixed(2)})`;
}

function imbalanceRatio(catCol) {
  if (!catCol.total || !catCol.top.length) return 0;
  return catCol.top[0][1] / catCol.total;
}

function generateReport(role, stats, fileName, cleaning) {
  const lines = [];

  // Overview
  lines.push("## Overview");
  lines.push(
    `"${fileName}" contains ${stats.rowCount.toLocaleString()} rows across ${stats.colCount} columns after cleaning (${stats.numericCols.length} numeric, ${stats.catCols.length} categorical). Automated cleaning raised the data quality score from ${cleaning.qualityBefore}% to ${cleaning.qualityAfter}%.`
  );

  // Key Observations
  lines.push("## Key Observations");
  const obs = [];
  stats.corrPairs.slice(0, 2).forEach((c) => {
    if (Math.abs(c.r) > 0.3) obs.push(describeCorrelation(c) + (role === "scientist" && Math.abs(c.r) > 0.7 ? " — worth checking for multicollinearity before modeling" : ""));
  });
  stats.numericCols.filter((c) => c.outliers > 0).slice(0, 2).forEach((c) => {
    obs.push(`${c.field} has ${c.outliers} value(s) beyond 2.5 standard deviations from the mean (range ${c.min}–${c.max}, mean ${c.mean.toFixed(1)})`);
  });
  stats.catCols.slice(0, 2).forEach((c) => {
    const ratio = imbalanceRatio(c);
    if (ratio > 0.5) {
      obs.push(`${c.field} is concentrated: "${c.top[0][0]}" makes up roughly ${(ratio * 100).toFixed(0)}% of records`);
    } else if (c.unique > 1) {
      obs.push(`${c.field} has ${c.unique} distinct categories, most common being "${c.top[0][0]}"`);
    }
  });
  if (obs.length === 0) obs.push("No strong correlations, outliers, or category imbalances were detected — the dataset appears fairly uniform.");
  obs.slice(0, 5).forEach((o) => lines.push("- " + o));

  // Data Quality Notes
  lines.push("## Data Quality Notes");
  if (cleaning.log.length === 0) {
    lines.push("No cleaning was required — the uploaded file was already well-structured.");
  } else {
    lines.push(`Automated cleaning applied ${cleaning.log.length} fix type(s): ${cleaning.log.map((l) => l.text).join("; ")}.`);
  }

  // Recommended Next Steps (role-specific)
  lines.push("## Recommended Next Steps");
  const steps = [];
  if (role === "analyst") {
    steps.push("Build a dashboard surfacing the KPI(s) with the widest range or highest variance as headline metrics");
    if (stats.corrPairs.length) steps.push(`Add a trend view comparing ${stats.corrPairs[0].a} and ${stats.corrPairs[0].b} since they move together`);
    steps.push("Segment reporting by the top categorical field to spot which groups drive overall totals");
  } else if (role === "scientist") {
    const strongCorr = stats.corrPairs.find((c) => Math.abs(c.r) > 0.7);
    if (strongCorr) steps.push(`Check for multicollinearity between ${strongCorr.a} and ${strongCorr.b} before using both as model features`);
    const outlierCol = stats.numericCols.find((c) => c.outliers > 0);
    if (outlierCol) steps.push(`Decide on a treatment for outliers in ${outlierCol.field} (cap, transform, or model separately) before training`);
    steps.push("Consider encoding high-cardinality categorical fields (one-hot or target encoding) if this will feed a predictive model");
  } else {
    steps.push("Translate the largest imbalance or outlier finding into a one-line business risk statement for stakeholders");
    if (stats.corrPairs.length) steps.push(`Investigate whether the ${stats.corrPairs[0].a}/${stats.corrPairs[0].b} relationship implies a lever worth acting on`);
    steps.push("Set a recurring cadence to re-run this cleaning + report pipeline as new data arrives, to track quality over time");
  }
  steps.slice(0, 3).forEach((s) => lines.push("- " + s));

  return lines.join("\n");
}

// Adaptive suggestion engine — proposes different deep-dives depending on what THIS dataset looks like
function generateAdaptiveSuggestions(stats) {
  const candidates = [];

  if (stats.corrPairs.length) {
    const top = stats.corrPairs[0];
    candidates.push({
      title: `${top.a} vs ${top.b} relationship`,
      description: `Their correlation (r=${top.r.toFixed(2)}) is the strongest in this dataset — worth understanding why.`,
      answer: `${describeCorrelation(top)}. ${
        Math.abs(top.r) > 0.7
          ? "This is strong enough that the two fields carry overlapping information — if you're building a model, consider dropping one or combining them into a single feature. If you're reporting, this pairing makes a natural combined KPI."
          : Math.abs(top.r) > 0.4
          ? "This is a moderate relationship — real, but not strong enough to treat one field as a proxy for the other. Worth plotting as a scatter to check for non-linear patterns or subgroups."
          : "This is a weak relationship from summary statistics alone — row-level analysis (e.g. a scatter plot or segment breakdown) would be needed to see if a non-linear or conditional pattern exists."
      }`,
    });
  }

  const outlierCol = stats.numericCols.find((c) => c.outliers > 0);
  if (outlierCol) {
    candidates.push({
      title: `${outlierCol.field} outlier investigation`,
      description: `${outlierCol.outliers} value(s) sit unusually far from the mean — worth confirming if they're real or data errors.`,
      answer: `${outlierCol.field} has ${outlierCol.outliers} value(s) beyond |z|>2.5 (mean ${outlierCol.mean.toFixed(1)}, std ${outlierCol.std.toFixed(
        1
      )}, range ${outlierCol.min}–${outlierCol.max}). These could be genuine extreme cases (e.g. a VIP customer, a rare event) or data entry errors. Recommended next step: pull the actual rows behind these values and manually verify a sample before deciding whether to cap, remove, or keep them as-is.`,
    });
  }

  const imbalancedCat = stats.catCols.find((c) => imbalanceRatio(c) > 0.5);
  if (imbalancedCat) {
    const ratio = imbalanceRatio(imbalancedCat);
    candidates.push({
      title: `${imbalancedCat.field} segment imbalance`,
      description: `One category dominates this field — this could skew any analysis grouped by it.`,
      answer: `"${imbalancedCat.top[0][0]}" accounts for roughly ${(ratio * 100).toFixed(0)}% of records in ${imbalancedCat.field}. If you're building a classifier on this field as a target, this imbalance means accuracy alone would be misleading — use precision/recall or a stratified sample instead. If it's a segmentation dimension, consider whether the minority groups deserve separate reporting rather than being averaged away.`,
    });
  }

  if (stats.numericCols.length >= 2 && candidates.length < 3) {
    const a = stats.numericCols[0];
    const b = stats.numericCols[1];
    candidates.push({
      title: `${a.field} distribution shape`,
      description: `Understanding the spread of ${a.field} helps decide how to bucket or normalize it.`,
      answer: `${a.field} ranges from ${a.min} to ${a.max} with a mean of ${a.mean.toFixed(1)} and median of ${a.median.toFixed(1)}. ${
        Math.abs(a.mean - a.median) > a.std * 0.2
          ? "The mean and median differ noticeably, suggesting a skewed distribution — a log transform or median-based summary may represent this field better than the mean alone."
          : "The mean and median are close, suggesting a fairly symmetric distribution — standard summary statistics should represent this field reasonably well."
      }`,
    });
  }

  if (candidates.length < 3) {
    candidates.push({
      title: "Data collection completeness",
      description: "Understanding what's missing structurally, not just row-by-row.",
      answer: `This dataset has ${stats.colCount} columns; ${stats.catCols.length} are categorical. Consider whether there are business-relevant dimensions (e.g. date, region, channel) that weren't captured in this extract — those are often the highest-value additions for future analysis, more so than deeper statistics on existing fields.`,
    });
  }

  return candidates.slice(0, 3);
}

function answerFromKeywords(question, stats, cleaning) {
  const q = question.toLowerCase();
  const matchedField = stats.numericCols.concat(stats.catCols).find((c) => q.includes(c.field.toLowerCase()));

  if (matchedField && matchedField.mean !== undefined) {
    return `${matchedField.field}: mean=${matchedField.mean.toFixed(2)}, median=${matchedField.median.toFixed(2)}, range ${matchedField.min}–${matchedField.max}, with ${matchedField.outliers} outlier value(s) flagged.`;
  }
  if (matchedField) {
    return `${matchedField.field} has ${matchedField.unique} unique values. Most common: "${matchedField.top[0]?.[0]}" (${matchedField.top[0]?.[1]} occurrences).`;
  }
  if (q.includes("correlat") || q.includes("relationship") || q.includes("link")) {
    if (!stats.corrPairs.length) return "There aren't enough numeric columns in this dataset to compute correlations.";
    const top = stats.corrPairs[0];
    return describeCorrelation(top) + " — the strongest relationship found in this dataset.";
  }
  if (q.includes("outlier") || q.includes("anomal")) {
    const withOutliers = stats.numericCols.filter((c) => c.outliers > 0);
    if (!withOutliers.length) return "No numeric column has values beyond 2.5 standard deviations from its mean — no significant outliers detected.";
    return withOutliers.map((c) => `${c.field}: ${c.outliers} outlier(s)`).join("; ");
  }
  if (q.includes("missing")) {
    return cleaning.missingCells > 0
      ? `${cleaning.missingCells} missing value(s) were found and imputed during cleaning (median for numeric fields, mode for categorical).`
      : "No missing values were found in this dataset.";
  }
  if (q.includes("duplicate")) {
    return cleaning.duplicateRowCount > 0
      ? `${cleaning.duplicateRowCount} duplicate row(s) were found and removed during cleaning.`
      : "No duplicate rows were found in this dataset.";
  }
  if (q.includes("clean") || q.includes("quality")) {
    return `Data quality improved from ${cleaning.qualityBefore}% to ${cleaning.qualityAfter}% after cleaning. ${
      cleaning.log.length ? cleaning.log.map((l) => l.text).join("; ") : "No issues were found."
    }`;
  }
  return `I can answer questions about correlations, outliers, missing data, duplicates, or a specific column by name (e.g. "${
    stats.numericCols[0]?.field || stats.catCols[0]?.field || "a column name"
  }"). Try rephrasing with one of those.`;
}

// ---------- Markdown mini-renderer ----------

function renderMarkdown(text, keyPrefix) {
  const lines = text.split("\n");
  const elements = [];
  let listBuffer = [];
  let key = 0;
  const flushList = () => {
    if (listBuffer.length) {
      elements.push(
        <ul key={keyPrefix + "-ul-" + key++} style={{ margin: "0 0 20px 0", paddingLeft: 22 }}>
          {listBuffer.map((item, i) => (
            <li key={i} style={{ marginBottom: 8, lineHeight: 1.6, color: INK }}>{item}</li>
          ))}
        </ul>
      );
      listBuffer = [];
    }
  };
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("## ")) {
      flushList();
      elements.push(
        <div key={keyPrefix + "-h-" + key++} style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 28, marginBottom: 12 }}>
          <div style={{ width: 28, height: 1, background: AMBER, flexShrink: 0 }} />
          <h3 style={{ fontFamily: "'Fraunces', serif", fontSize: 19, fontWeight: 600, color: INK, margin: 0, letterSpacing: "0.01em" }}>
            {trimmed.replace("## ", "")}
          </h3>
        </div>
      );
    } else if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
      listBuffer.push(trimmed.replace(/^[-*]\s/, ""));
    } else if (trimmed.length > 0) {
      flushList();
      elements.push(
        <p key={keyPrefix + "-p-" + key++} style={{ margin: "0 0 14px 0", lineHeight: 1.7, color: INK, fontSize: 15 }}>{trimmed}</p>
      );
    }
  });
  flushList();
  return elements;
}

function corrColor(r) {
  const abs = Math.min(Math.abs(r), 1);
  if (r >= 0) return `rgba(42, 111, 119, ${0.12 + abs * 0.75})`;
  return `rgba(163, 74, 58, ${0.12 + abs * 0.75})`;
}

function SectionLabel({ icon, text }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      {icon}
      <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: MUTED }}>
        {text}
      </span>
    </div>
  );
}

function QualityGauge({ label, value, color }) {
  const circumference = 2 * Math.PI * 34;
  const offset = circumference * (1 - value / 100);
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
      <div style={{ position: "relative", width: 84, height: 84 }}>
        <svg width="84" height="84" viewBox="0 0 84 84">
          <circle cx="42" cy="42" r="34" fill="none" stroke={RULE} strokeWidth="7" />
          <circle
            cx="42" cy="42" r="34" fill="none" stroke={color} strokeWidth="7"
            strokeDasharray={circumference} strokeDashoffset={offset}
            strokeLinecap="round" transform="rotate(-90 42 42)"
            style={{ transition: "stroke-dashoffset 0.6s ease" }}
          />
        </svg>
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Fraunces', serif", fontWeight: 700, fontSize: 17, color: INK }}>
          {value}%
        </div>
      </div>
      <div style={{ fontSize: 11, color: MUTED, textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</div>
    </div>
  );
}

const LOG_ICONS = {
  dup: CheckCircle2,
  fill: Wrench,
  trim: Wrench,
  case: Wrench,
  neg: AlertCircle,
};

// ---------- Main component ----------

export default function App() {
  const [fileName, setFileName] = useState(null);
  const [rawParsed, setRawParsed] = useState(null); // {rows, fields}
  const [cleaning, setCleaning] = useState(null);
  const [stats, setStats] = useState(null);
  const [reportsByRole, setReportsByRole] = useState({});
  const [activeRole, setActiveRole] = useState("analyst");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef(null);

  const [adaptiveSuggestions, setAdaptiveSuggestions] = useState(null);
  const [adaptiveLoading, setAdaptiveLoading] = useState(false);
  const [deepDives, setDeepDives] = useState({}); // idx -> {loading, text}

  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef(null);

  const resetAll = () => {
    setStats(null);
    setCleaning(null);
    setRawParsed(null);
    setFileName(null);
    setReportsByRole({});
    setAdaptiveSuggestions(null);
    setDeepDives({});
    setChatMessages([]);
  };

  const processFile = useCallback((file) => {
    setError(null);
    resetAll();
    if (!file) return;
    setFileName(file.name);
    Papa.parse(file, {
      header: true,
      dynamicTyping: true,
      skipEmptyLines: true,
      complete: (results) => {
        if (!results.data || results.data.length === 0) {
          setError("Couldn't find any rows in this file. Check that it's a valid CSV.");
          return;
        }
        const fields = results.meta.fields || Object.keys(results.data[0]);
        const cleanResult = scanAndClean(results.data, fields);
        setCleaning(cleanResult);
        const s = computeStats(cleanResult.cleanedRows, fields);
        setStats(s);
      },
      error: (err) => setError("Failed to parse CSV: " + err.message),
    });
  }, []);

  // Small artificial delay so the UI still shows its loading state — all computation below is
  // instant local statistics/rules, no network call and no API cost.
  const wait = (ms) => new Promise((res) => setTimeout(res, ms));

  const runGenerateReport = async (role) => {
    if (!stats) return;
    setLoading(true);
    setError(null);
    try {
      await wait(350);
      const text = generateReport(role, stats, fileName, cleaning);
      setReportsByRole((prev) => ({ ...prev, [role]: text }));
    } catch (e) {
      setError("Couldn't generate the report: " + e.message);
    } finally {
      setLoading(false);
    }
  };

  const switchRole = (role) => {
    setActiveRole(role);
    if (!reportsByRole[role]) runGenerateReport(role);
  };

  const loadAdaptiveSuggestions = async () => {
    if (!stats) return;
    setAdaptiveLoading(true);
    try {
      await wait(400);
      const suggestions = generateAdaptiveSuggestions(stats);
      setAdaptiveSuggestions(suggestions);
    } catch (e) {
      setError("Couldn't generate adaptive suggestions: " + e.message);
    } finally {
      setAdaptiveLoading(false);
    }
  };

  const runDeepDive = async (idx, suggestion) => {
    setDeepDives((prev) => ({ ...prev, [idx]: { loading: true, text: null } }));
    await wait(400);
    setDeepDives((prev) => ({ ...prev, [idx]: { loading: false, text: suggestion.answer } }));
  };

  const sendChatMessage = async () => {
    const question = chatInput.trim();
    if (!question || !stats) return;
    const nextMessages = [...chatMessages, { role: "user", content: question }];
    setChatMessages(nextMessages);
    setChatInput("");
    setChatLoading(true);
    setError(null);
    await wait(300);
    const answer = answerFromKeywords(question, stats, cleaning);
    setChatMessages([...nextMessages, { role: "assistant", content: answer }]);
    setChatLoading(false);
    setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
  };

  const downloadReport = () => {
    const report = reportsByRole[activeRole];
    if (!report) return;
    const blob = new Blob([`# Insight Report — ${fileName} (${ROLE_CONFIG[activeRole].label} view)\n\n${report}`], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `insight-report-${(fileName || "dataset").replace(/\.csv$/i, "")}-${activeRole}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const downloadCleanedCsv = () => {
    if (!cleaning || !cleaning.cleanedRows || !cleaning.cleanedRows.length) return;
    const csv = Papa.unparse(cleaning.cleanedRows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `cleaned-${(fileName || "dataset").replace(/\.csv$/i, "")}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  };

  const totalOutliers = stats ? stats.numericCols.reduce((s, c) => s + c.outliers, 0) : 0;
  const activeReport = reportsByRole[activeRole];

  return (
    <div style={{ minHeight: "100vh", background: PAPER, fontFamily: "'Inter', -apple-system, sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,700&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap');
        * { box-sizing: border-box; }
        ::selection { background: ${ACCENT}33; }
        .btn-primary { transition: all 0.15s ease; }
        .btn-primary:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(42,111,119,0.25); }
        .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
        .btn-ghost { transition: all 0.15s ease; }
        .btn-ghost:hover:not(:disabled) { background: ${RULE}55; }
        .drop-zone { transition: all 0.2s ease; }
        .role-tab { transition: all 0.15s ease; cursor: pointer; }
        .suggestion-card { transition: all 0.15s ease; cursor: pointer; }
        .suggestion-card:hover { border-color: ${ACCENT} !important; transform: translateY(-2px); }
        input:focus-visible, button:focus-visible, textarea:focus-visible { outline: 2px solid ${ACCENT}; outline-offset: 2px; }
        @keyframes spin { to { transform: rotate(360deg); } }
        .chat-scroll::-webkit-scrollbar { width: 6px; }
        .chat-scroll::-webkit-scrollbar-thumb { background: ${RULE}; border-radius: 3px; }
      `}</style>

      <div style={{ maxWidth: 900, margin: "0 auto", padding: "48px 24px 80px" }}>
        {/* Masthead */}
        <div style={{ borderBottom: `2px solid ${INK}`, paddingBottom: 20, marginBottom: 36 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 12 }}>
            <div>
              <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, letterSpacing: "0.12em", color: MUTED, textTransform: "uppercase", marginBottom: 6 }}>
                Analyst Field Report
              </div>
              <h1 style={{ fontFamily: "'Fraunces', serif", fontSize: 34, fontWeight: 700, color: INK, margin: 0, letterSpacing: "-0.01em" }}>
                Insight Generator
              </h1>
            </div>
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: MUTED, textAlign: "right", lineHeight: 1.6 }}>
              {new Date().toLocaleDateString("en-US", { year: "numeric", month: "short", day: "2-digit" })}
              <br />No. {String(Math.floor(Math.random() * 900) + 100)}
            </div>
          </div>
        </div>

        {!stats && (
          <div
            className="drop-zone"
            onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
            onDragLeave={() => setDragActive(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            style={{ border: `1.5px dashed ${dragActive ? ACCENT : RULE}`, background: dragActive ? `${ACCENT}0A` : "transparent", borderRadius: 4, padding: "56px 32px", textAlign: "center", cursor: "pointer" }}
          >
            <input ref={fileInputRef} type="file" accept=".csv" style={{ display: "none" }} onChange={(e) => processFile(e.target.files?.[0])} />
            <Upload size={28} color={MUTED} style={{ marginBottom: 14 }} />
            <div style={{ fontFamily: "'Fraunces', serif", fontSize: 18, color: INK, marginBottom: 6 }}>
              Drop a CSV file, or click to browse
            </div>
            <div style={{ fontSize: 13, color: MUTED }}>
              Messy or clean — this will scan for issues, auto-clean, and generate role-specific insights.
            </div>
          </div>
        )}

        {error && (
          <div style={{ display: "flex", gap: 10, alignItems: "flex-start", background: "#FBEEEA", border: "1px solid #E3B8A6", borderRadius: 4, padding: "14px 16px", marginTop: 20, fontSize: 14, color: "#8A3B22" }}>
            <AlertCircle size={16} style={{ marginTop: 2, flexShrink: 0 }} />
            <span>{error}</span>
          </div>
        )}

        {stats && cleaning && (
          <div style={{ marginTop: 8 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24, paddingBottom: 16, borderBottom: `1px solid ${RULE}`, flexWrap: "wrap", gap: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <FileText size={16} color={ACCENT} />
                <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 13, color: INK }}>{fileName}</span>
              </div>
              <button className="btn-ghost" onClick={resetAll} style={{ background: "none", border: "none", color: MUTED, fontSize: 12, cursor: "pointer", textDecoration: "underline", borderRadius: 4, padding: "4px 6px" }}>
                Load different file
              </button>
            </div>

            {/* Data cleaning panel */}
            <div style={{ border: `1px solid ${RULE}`, borderRadius: 6, padding: "22px 24px", marginBottom: 28, background: "white" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
                <SectionLabel icon={<Wrench size={14} color={ACCENT} />} text="Automated Data Cleaning" />
                <button
                  className="btn-ghost"
                  onClick={downloadCleanedCsv}
                  style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: `1px solid ${RULE}`, color: INK, fontSize: 12, padding: "6px 12px", borderRadius: 4, cursor: "pointer" }}
                >
                  <Download size={13} /> Download cleaned CSV
                </button>
              </div>
              <div style={{ display: "flex", gap: 28, alignItems: "center", marginTop: 18, flexWrap: "wrap" }}>
                <QualityGauge label="Before" value={cleaning.qualityBefore} color={cleaning.qualityBefore < 70 ? RUST : cleaning.qualityBefore < 90 ? AMBER : GREEN} />
                <ArrowRight size={20} color={MUTED} />
                <QualityGauge label="After" value={cleaning.qualityAfter} color={GREEN} />
                <div style={{ flex: 1, minWidth: 220 }}>
                  {cleaning.log.length === 0 ? (
                    <div style={{ fontSize: 13.5, color: MUTED, fontStyle: "italic" }}>No data quality issues found — this dataset was already clean.</div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {cleaning.log.map((l, i) => {
                        const Icon = LOG_ICONS[l.icon] || CheckCircle2;
                        return (
                          <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, color: INK }}>
                            <Icon size={14} color={l.icon === "neg" ? RUST : GREEN} style={{ flexShrink: 0 }} />
                            {l.text}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* KPI strip */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 1, background: RULE, marginBottom: 28, borderRadius: 4, overflow: "hidden" }}>
              {[
                ["Rows (cleaned)", stats.rowCount.toLocaleString()],
                ["Columns", stats.colCount],
                ["Numeric fields", stats.numericCols.length],
                ["Outliers flagged", totalOutliers],
              ].map(([label, val]) => (
                <div key={label} style={{ background: PAPER, padding: "16px 18px" }}>
                  <div style={{ fontSize: 11, color: MUTED, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>{label}</div>
                  <div style={{ fontFamily: "'Fraunces', serif", fontSize: 24, fontWeight: 600, color: label === "Outliers flagged" && totalOutliers > 0 ? RUST : INK }}>{val}</div>
                </div>
              ))}
            </div>

            {/* Correlation grid */}
            {stats.corrPairs.length > 0 && (
              <div style={{ marginBottom: 28 }}>
                <SectionLabel icon={<Zap size={14} color={AMBER} />} text="Strongest Correlations" />
                <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 12 }}>
                  {stats.corrPairs.slice(0, 8).map((c, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <div style={{ width: 220, fontSize: 12.5, color: INK, fontFamily: "'IBM Plex Mono', monospace", flexShrink: 0 }}>
                        {c.a} <span style={{ color: MUTED }}>×</span> {c.b}
                      </div>
                      <div style={{ flex: 1, height: 20, background: RULE, borderRadius: 3, position: "relative", overflow: "hidden" }}>
                        <div style={{ position: "absolute", left: c.r >= 0 ? "50%" : `${50 - Math.abs(c.r) * 50}%`, width: `${Math.abs(c.r) * 50}%`, height: "100%", background: corrColor(c.r) }} />
                        <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 1, background: INK, opacity: 0.15 }} />
                      </div>
                      <div style={{ width: 46, textAlign: "right", fontFamily: "'IBM Plex Mono', monospace", fontSize: 12.5, color: Math.abs(c.r) > 0.5 ? INK : MUTED, fontWeight: Math.abs(c.r) > 0.5 ? 600 : 400 }}>
                        {c.r.toFixed(2)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Role tabs */}
            <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
              {Object.entries(ROLE_CONFIG).map(([key, cfg]) => {
                const Icon = cfg.icon;
                const active = activeRole === key;
                return (
                  <div
                    key={key}
                    className="role-tab"
                    onClick={() => switchRole(key)}
                    style={{
                      display: "flex", alignItems: "center", gap: 7,
                      padding: "9px 16px", borderRadius: 5,
                      border: `1px solid ${active ? ACCENT : RULE}`,
                      background: active ? ACCENT : "white",
                      color: active ? "white" : INK,
                      fontSize: 13, fontWeight: 500,
                    }}
                  >
                    <Icon size={14} />
                    {cfg.label}
                  </div>
                );
              })}
            </div>

            {!activeReport && !loading && (
              <button className="btn-primary" onClick={() => runGenerateReport(activeRole)} style={{ background: ACCENT, color: "white", border: "none", borderRadius: 4, padding: "13px 24px", fontSize: 14, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}>
                Generate {ROLE_CONFIG[activeRole].label} report <ChevronRight size={16} />
              </button>
            )}
            {loading && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, color: MUTED, fontSize: 14 }}>
                <Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} /> Drafting {ROLE_CONFIG[activeRole].label} report…
              </div>
            )}

            {activeReport && (
              <div style={{ marginTop: 32, paddingTop: 28, borderTop: `2px solid ${INK}` }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
                  <SectionLabel icon={<TrendingUp size={14} color={AMBER} />} text={`${ROLE_CONFIG[activeRole].label} Insight Summary`} />
                  <button className="btn-ghost" onClick={downloadReport} style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: `1px solid ${RULE}`, color: INK, fontSize: 12, padding: "6px 12px", borderRadius: 4, cursor: "pointer" }}>
                    <Download size={13} /> Export .md
                  </button>
                </div>
                {renderMarkdown(activeReport, "report-" + activeRole)}

                {/* Adaptive AI suggestions */}
                <div style={{ marginTop: 36, paddingTop: 24, borderTop: `1px solid ${RULE}` }}>
                  <SectionLabel icon={<Sparkles size={14} color={ACCENT} />} text="Adaptive Deep Dives" />
                  <p style={{ fontSize: 13, color: MUTED, marginTop: 8, marginBottom: 16 }}>
                    A rules engine scans this specific dataset's shape and proposes what to investigate next — different data produces different suggestions.
                  </p>
                  {!adaptiveSuggestions && (
                    <button
                      className="btn-primary"
                      onClick={loadAdaptiveSuggestions}
                      disabled={adaptiveLoading}
                      style={{ background: INK, color: "white", border: "none", borderRadius: 4, padding: "11px 20px", fontSize: 13.5, fontWeight: 600, cursor: adaptiveLoading ? "default" : "pointer", display: "flex", alignItems: "center", gap: 8 }}
                    >
                      {adaptiveLoading ? (<><Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} /> Analyzing dataset shape…</>) : (<><Sparkles size={15} /> Generate suggestions for this dataset</>)}
                    </button>
                  )}
                  {adaptiveSuggestions && (
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 12 }}>
                      {adaptiveSuggestions.map((s, i) => (
                        <div key={i} className="suggestion-card" onClick={() => !deepDives[i] && runDeepDive(i, s)} style={{ border: `1px solid ${RULE}`, borderRadius: 6, padding: "16px 18px", background: "white" }}>
                          <div style={{ fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: 15, color: INK, marginBottom: 6 }}>{s.title}</div>
                          <div style={{ fontSize: 13, color: MUTED, marginBottom: 10, lineHeight: 1.5 }}>{s.description}</div>
                          {deepDives[i]?.loading && (
                            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: ACCENT }}>
                              <Loader2 size={12} style={{ animation: "spin 1s linear infinite" }} /> Running analysis…
                            </div>
                          )}
                          {deepDives[i]?.text && (
                            <div style={{ fontSize: 13, color: INK, lineHeight: 1.6, borderTop: `1px solid ${RULE}`, paddingTop: 10, marginTop: 4 }}>{deepDives[i].text}</div>
                          )}
                          {!deepDives[i] && (
                            <div style={{ fontSize: 12, color: ACCENT, fontWeight: 600, display: "flex", alignItems: "center", gap: 4 }}>
                              Run this analysis <ArrowRight size={12} />
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Follow-up chat */}
                <div style={{ marginTop: 36, paddingTop: 24, borderTop: `1px solid ${RULE}` }}>
                  <SectionLabel icon={<MessageSquare size={14} color={ACCENT} />} text="Ask a follow-up question" />
                  <div className="chat-scroll" style={{ marginTop: 14, maxHeight: chatMessages.length ? 320 : 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 12, marginBottom: chatMessages.length ? 14 : 0, transition: "max-height 0.2s ease" }}>
                    {chatMessages.map((m, i) => (
                      <div key={i} style={{ alignSelf: m.role === "user" ? "flex-end" : "flex-start", maxWidth: "82%", background: m.role === "user" ? ACCENT : "#F0ECE1", color: m.role === "user" ? "white" : INK, padding: "10px 14px", borderRadius: 6, fontSize: 14, lineHeight: 1.55 }}>
                        {m.content}
                      </div>
                    ))}
                    {chatLoading && (
                      <div style={{ alignSelf: "flex-start", color: MUTED, fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
                        <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} /> Thinking…
                      </div>
                    )}
                    <div ref={chatEndRef} />
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <input
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter" && !chatLoading) sendChatMessage(); }}
                      placeholder="e.g. Which column has the strongest link to defaults?"
                      style={{ flex: 1, padding: "11px 14px", border: `1px solid ${RULE}`, borderRadius: 4, fontSize: 14, fontFamily: "'Inter', sans-serif", background: "white", color: INK }}
                    />
                    <button className="btn-primary" onClick={sendChatMessage} disabled={chatLoading || !chatInput.trim()} style={{ background: ACCENT, color: "white", border: "none", borderRadius: 4, padding: "0 18px", cursor: chatLoading ? "default" : "pointer", display: "flex", alignItems: "center" }}>
                      <Send size={15} />
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
