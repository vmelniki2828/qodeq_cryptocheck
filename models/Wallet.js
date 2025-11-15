import mongoose from 'mongoose';

const walletSchema = new mongoose.Schema({
  project: {
    type: String,
    required: true,
    trim: true
  },
  user_id: {
    type: Number,
    required: true,
    index: true
  },
  type: {
    type: String,
    required: true,
    trim: true
  },
  alias: {
    type: String,
    trim: true,
    default: ''
  },
  wallet_destination: {
    type: String,
    required: true,
    trim: true,
    unique: true,
    index: true
  },
  last_transaction: {
    type: String,
    trim: true,
    default: ''
  },
  balance: {
    type: Number,
    default: 0
  },
  lastBalanceCheck: {
    type: Date,
    default: null
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Обновление updatedAt перед сохранением
walletSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Индекс для быстрого поиска по проекту и user_id
walletSchema.index({ project: 1, user_id: 1 });

export const Wallet = mongoose.model('Wallet', walletSchema);

