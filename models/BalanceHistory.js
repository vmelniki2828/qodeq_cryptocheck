import mongoose from 'mongoose';

const balanceHistorySchema = new mongoose.Schema({
  wallet_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Wallet',
    required: true,
    index: true
  },
  wallet_destination: {
    type: String,
    required: true,
    index: true
  },
  balance: {
    type: Number,
    required: true
  },
  previousBalance: {
    type: Number,
    default: null
  },
  balanceTRX: {
    type: Number,
    default: 0
  },
  balanceUSDT: {
    type: Number,
    default: 0
  },
  checkedAt: {
    type: Date,
    default: Date.now,
    index: true
  }
});

// Индекс для быстрого поиска по кошельку и дате
balanceHistorySchema.index({ wallet_id: 1, checkedAt: -1 });
balanceHistorySchema.index({ wallet_destination: 1, checkedAt: -1 });

export const BalanceHistory = mongoose.model('BalanceHistory', balanceHistorySchema);

