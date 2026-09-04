const mongoose = require("mongoose");

const DeviceChangeRequestSchema = new mongoose.Schema(
  {
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Student",
      required: true,
      index: true,
    },
    department: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Department",
      required: true,
      index: true,
    },
    createdByAdmin: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      required: true,
      index: true,
    },
    oldDeviceFingerprint: {
      type: String,
      required: true,
    },
    requestedDeviceFingerprint: {
      type: String,
      required: true,
      index: true,
    },
    requestedCredentialId: {
      type: String,
      default: null,
    },
    requestedPublicKey: {
      type: String,
      default: null,
    },
    requestedTransports: {
      type: [String],
      default: [],
    },
    selfieDataUrl: {
      type: String,
      default: "",
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected", "expired"],
      default: "pending",
      index: true,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: true,
    },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Faculty",
      default: null,
    },
    reviewedAt: {
      type: Date,
      default: null,
    },
    reviewNote: {
      type: String,
      default: "",
      trim: true,
    },
  },
  { timestamps: true }
);

DeviceChangeRequestSchema.index({ student: 1, createdAt: -1 });
DeviceChangeRequestSchema.index({ department: 1, status: 1, expiresAt: 1 });
// Automatically purge device change requests after 7 days across all statuses
DeviceChangeRequestSchema.index({ createdAt: 1 }, { expireAfterSeconds: 7 * 24 * 60 * 60 });

module.exports = mongoose.model("DeviceChangeRequest", DeviceChangeRequestSchema);
