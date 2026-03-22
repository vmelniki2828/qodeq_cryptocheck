import mongoose from 'mongoose';

const botSubscriberSchema = new mongoose.Schema(
  {
    chatId: {
      type: Number,
      required: true,
      unique: true,
      index: true
    },
    chatType: {
      type: String,
      default: 'private'
    },
    username: { type: String, default: '' },
    firstName: { type: String, default: '' },
    lastActiveAt: {
      type: Date,
      default: Date.now
    }
  },
  { timestamps: true }
);

export const BotSubscriber = mongoose.model('BotSubscriber', botSubscriberSchema);
