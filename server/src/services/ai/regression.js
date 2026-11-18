// Ridge regression with standardisation and k-fold cross-validation (dependency-free).
import { mean, std, round } from '../../utils/helpers.js';

function solve(A, b) {
  // Gaussian elimination with partial pivoting
  const n = A.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    [M[c], M[piv]] = [M[piv], M[c]];
    if (Math.abs(M[c][c]) < 1e-12) throw new Error('Singular matrix');
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / M[i][i]);
}

export function fitRidge(X, y, lambda = 1.0) {
  const p = X[0].length;
  const mu = Array.from({ length: p }, (_, j) => mean(X.map((r) => r[j])));
  const sd = Array.from({ length: p }, (_, j) => std(X.map((r) => r[j])) || 1);
  const Z = X.map((r) => r.map((v, j) => (v - mu[j]) / sd[j]));
  const yMean = mean(y);
  const yc = y.map((v) => v - yMean);
  const XtX = Array.from({ length: p }, (_, i) => Array.from({ length: p }, (_, j) =>
    Z.reduce((s, r) => s + r[i] * r[j], 0) + (i === j ? lambda : 0)));
  const Xty = Array.from({ length: p }, (_, i) => Z.reduce((s, r, k) => s + r[i] * yc[k], 0));
  const w = solve(XtX, Xty);
  return { weights: w, intercept: yMean, mu, sd, lambda };
}

export function predictRidge(model, x) {
  return model.intercept + x.reduce((s, v, j) => s + model.weights[j] * ((v - model.mu[j]) / model.sd[j]), 0);
}

// Per-feature contribution to a prediction (in target units), for explainability.
export function contributions(model, x, featureNames) {
  return featureNames.map((name, j) => ({
    feature: name,
    value: x[j],
    contribution: round(model.weights[j] * ((x[j] - model.mu[j]) / model.sd[j]), 3),
  })).sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
}

export function metrics(yTrue, yPred) {
  const n = yTrue.length;
  const m = mean(yTrue);
  const ssRes = yTrue.reduce((s, v, i) => s + (v - yPred[i]) ** 2, 0);
  const ssTot = yTrue.reduce((s, v) => s + (v - m) ** 2, 0);
  return {
    r2: round(1 - ssRes / (ssTot || 1), 4),
    rmse: round(Math.sqrt(ssRes / n), 4),
    mae: round(yTrue.reduce((s, v, i) => s + Math.abs(v - yPred[i]), 0) / n, 4),
  };
}

export function crossValidate(X, y, lambda = 1.0, k = 5) {
  const n = X.length;
  const idx = [...Array(n).keys()];
  // deterministic shuffle
  let seed = 42;
  for (let i = n - 1; i > 0; i--) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    const j = seed % (i + 1);
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  const preds = new Array(n);
  for (let f = 0; f < k; f++) {
    const test = idx.filter((_, i) => i % k === f);
    const testSet = new Set(test);
    const train = idx.filter((i) => !testSet.has(i));
    const model = fitRidge(train.map((i) => X[i]), train.map((i) => y[i]), lambda);
    for (const i of test) preds[i] = predictRidge(model, X[i]);
  }
  return metrics(y, preds);
}
