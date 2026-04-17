import mongoose from 'mongoose';

const whitelistUserSchema = new mongoose.Schema(
  {
    telegramUserId: {
      type: Number,
      required: true,
      unique: true,
      index: true
    },
    username: { type: String, default: '' },
    firstName: { type: String, default: '' },
    addedByTelegramUserId: { type: Number, default: null },
    isActive: { type: Boolean, default: true }
  },
  { timestamps: true }
);

export const WhitelistUser = mongoose.model('WhitelistUser', whitelistUserSchema);
