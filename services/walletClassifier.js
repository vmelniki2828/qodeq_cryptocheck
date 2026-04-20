const DAY_MS = 24 * 60 * 60 * 1000;

const extractCounterparty = (tx, walletAddress) => {
  const owner =
    tx?.ownerAddress ||
    tx?.owner_address ||
    tx?.fromAddress ||
    tx?.from_address ||
    tx?.from;
  const to =
    tx?.toAddress ||
    tx?.to_address ||
    tx?.to;

  if (owner && owner !== walletAddress) return owner;
  if (to && to !== walletAddress) return to;
  return null;
};

const getTimestamp = (tx) => {
  const raw = tx?.timestamp || tx?.block_timestamp || tx?.blockTimeStamp || tx?.time;
  const ts = Number(raw);
  return Number.isFinite(ts) ? ts : null;
};

const getAmount = (tx) => {
  const raw = tx?.amount || tx?.quant || tx?.value || 0;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  // В TRON amount часто в sun
  return n > 1_000_000 ? n / 1_000_000 : n;
};

export const classifyWalletByRules = async (walletAddress) => {
  const now = Date.now();
  const reasons = [];
  let score = 50;

  let txs = [];
  try {
    const url = `https://apilist.tronscanapi.com/api/transaction?sort=-timestamp&count=true&limit=200&start=0&address=${encodeURIComponent(walletAddress)}`;
    const response = await fetch(url);
    if (response.ok) {
      const json = await response.json();
      txs = Array.isArray(json?.data) ? json.data : [];
    }
  } catch (error) {
    // Оставляем пустой список — классификация перейдет в unknown c низкой уверенностью
  }

  if (txs.length === 0) {
    return {
      walletType: 'unknown',
      score: 50,
      confidence: 10,
      reasons: ['Недостаточно данных по транзакциям для классификации'],
      metrics: {
        txCountSample: 0,
        txCount24h: 0,
        uniqueCounterparties: 0,
        smallTxRatio: 0,
        activeHoursSpan: 0,
        contractInteractionRatio: 0
      }
    };
  }

  const timestamps = [];
  const counterparties = new Set();
  let txCount24h = 0;
  let smallTxCount = 0;
  let contractInteractions = 0;

  for (const tx of txs) {
    const ts = getTimestamp(tx);
    if (ts) {
      timestamps.push(ts);
      if (now - ts <= DAY_MS) {
        txCount24h++;
      }
    }

    const cp = extractCounterparty(tx, walletAddress);
    if (cp) counterparties.add(cp);

    const amount = getAmount(tx);
    if (amount > 0 && amount < 10) {
      smallTxCount++;
    }

    const contractType = String(tx?.contractType || tx?.contract_type || '').toLowerCase();
    if (contractType && !contractType.includes('transfer')) {
      contractInteractions++;
    }
  }

  const txCountSample = txs.length;
  const uniqueCounterparties = counterparties.size;
  const smallTxRatio = txCountSample > 0 ? smallTxCount / txCountSample : 0;
  const contractInteractionRatio = txCountSample > 0 ? contractInteractions / txCountSample : 0;

  let activeHoursSpan = 0;
  if (timestamps.length > 1) {
    const minTs = Math.min(...timestamps);
    const maxTs = Math.max(...timestamps);
    activeHoursSpan = (maxTs - minTs) / (60 * 60 * 1000);
  }

  if (txCount24h > 200) {
    score += 20;
    reasons.push(`Высокая активность за 24ч: ${txCount24h} транзакций`);
  }
  if (uniqueCounterparties > 80) {
    score += 20;
    reasons.push(`Много контрагентов: ${uniqueCounterparties}`);
  }
  if (smallTxRatio > 0.7) {
    score += 10;
    reasons.push(`Высокая доля мелких транзакций: ${(smallTxRatio * 100).toFixed(1)}%`);
  }
  if (activeHoursSpan > 18) {
    score += 10;
    reasons.push(`Почти круглосуточная активность: ${activeHoursSpan.toFixed(1)}ч`);
  }
  if (contractInteractionRatio > 0.6) {
    score += 10;
    reasons.push(`Высокая доля контрактных операций: ${(contractInteractionRatio * 100).toFixed(1)}%`);
  }

  if (txCountSample < 20) {
    score -= 15;
    reasons.push(`Мало транзакций в выборке: ${txCountSample}`);
  }
  if (uniqueCounterparties < 10) {
    score -= 20;
    reasons.push(`Мало контрагентов: ${uniqueCounterparties}`);
  }

  score = Math.max(0, Math.min(100, score));

  let walletType = 'unknown';
  if (score >= 70) walletType = 'service';
  else if (score <= 30) walletType = 'personal';

  if (txCount24h > 500 && uniqueCounterparties > 150 && smallTxRatio > 0.8) {
    walletType = 'suspicious';
    reasons.push('Аномально высокая массовая активность');
  }

  const confidence = Math.max(10, Math.min(100, Math.round(Math.abs(score - 50) * 2)));

  return {
    walletType,
    score,
    confidence,
    reasons,
    metrics: {
      txCountSample,
      txCount24h,
      uniqueCounterparties,
      smallTxRatio: Number(smallTxRatio.toFixed(4)),
      activeHoursSpan: Number(activeHoursSpan.toFixed(2)),
      contractInteractionRatio: Number(contractInteractionRatio.toFixed(4))
    }
  };
};
