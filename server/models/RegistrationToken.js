const mongoose = require("mongoose");

const RegistrationTokenSchema = new mongoose.Schema(
  {
    token: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    type: {
      type: String,
      enum: ["student", "faculty"],
      required: true,
      index: true,
    },

    adminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      required: true,
      index: true,
    },

    collegeName: {
      type: String,
      trim: true,
      default: null,
    },

    expiresAt: {
      type: Date,
      default: null,
      index: true,
    },

    maxUses: {
      type: Number,
      required: true,
      min: 1,
      default: 1,
    },

    usesCount: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },

    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },

    lastUsedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

// Auto-delete expired tokens
RegistrationTokenSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 0 }
);

module.exports = mongoose.model(
  "RegistrationToken",
  RegistrationTokenSchema
);
