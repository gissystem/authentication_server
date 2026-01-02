import mongoose from 'mongoose';

const credentialSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
      trim: true,
    },
    schoolId: {
      type: String,
      required: true,
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
    email: {
      type: String,
      lowercase: true,
      trim: true,
    },
    schoolGroupId: {
      type: String,
      trim: true,
    },
  },
  { timestamps: true }
);

// Removed unique index to allow fresh entries
// credentialSchema.index({ userId: 1, url: 1 }, { unique: true });

export const Credential = mongoose.model('Credential', credentialSchema);
