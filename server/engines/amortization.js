export function convertToMonthlyEvents(transactions) {
  const today = new Date();
  const amortized = [];

  for (const tx of transactions) {
    if (!tx.amortize) continue;

    const amort = tx.amortize; // { totalMonths, startDate, monthlyAmount }
    const start = new Date(amort.startDate);
    if (isNaN(start.getTime())) continue;

    for (let m = 0; m < amort.totalMonths; m++) {
      const monthDate = new Date(start);
      monthDate.setMonth(monthDate.getMonth() + m);
      if (monthDate > today) break;

      // skip months in the future beyond current
      amortized.push({
        ...tx,
        id: `${tx.id}-amort-m${m}`,
        amount: amort.monthlyAmount || (tx.amount / amort.totalMonths),
        date: monthDate.toISOString().slice(0, 7),
        isAmortized: true,
        originalTxId: tx.id,
        amortMonth: m,
      });
    }
  }

  return amortized;
}

export function computeAmortizedView(allTransactions) {
  // All transactions with amortize flag processed into monthly buckets
  const prepaid = allTransactions.filter((t) => t.amortize && t.amount > 0);
  const amortizedMonthly = convertToMonthlyEvents(prepaid);

  // Combine amortized view with non-amortized transactions
  const cashView = allTransactions.filter((t) => !t.amortize);
  const amortizedView = [...cashView, ...amortizedMonthly];

  return {
    cash: groupByMonth(cashView),
    amortized: groupByMonth(amortizedView),
  };
}

function groupByMonth(transactions) {
  const months = {};
  for (const tx of transactions) {
    const monthKey = tx.date?.slice(0, 7) || tx.timestamp?.slice(0, 7);
    if (!monthKey) continue;
    if (!months[monthKey]) months[monthKey] = { income: 0, expense: 0, count: 0, transactions: [] };
    const amount = typeof tx.amount === 'number' ? tx.amount : parseFloat(tx.amount) || 0;
    if (amount > 0) months[monthKey].income += amount;
    else months[monthKey].expense += Math.abs(amount);
    months[monthKey].count++;
    months[monthKey].transactions.push(tx);
  }
  return months;
}