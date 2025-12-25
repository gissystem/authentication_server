import mongoose from 'mongoose';

const credentialSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
      trim: true,
    },
    password: {
      type: String,
      required: true,
    },
    url: {
      type: String,
      required: true,
      trim: true,
    },
    firstName: {
      type: String,
      trim: true,
    },
    lastName: {
      type: String,
      trim: true,
    },
    title: {
      type: String,
      trim: true,
    },
    appId: {
      type: [String],
      default: [],
    },
    deviceId: {
      type: String,
      default: '',
    },
  },
  { timestamps: true }
);

// Removed unique index to allow fresh entries
// credentialSchema.index({ userId: 1, url: 1 }, { unique: true });

export const Credential = mongoose.model('Credential', credentialSchema);
