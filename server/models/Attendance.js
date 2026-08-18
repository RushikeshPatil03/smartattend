const mongoose = require("mongoose");

const AttendanceSchema = new mongoose.Schema(
  {
    // Session reference
    session: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Session",
      required: true,
      index: true,
    },

    // Student reference
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Student",
      required: true,
      index: true,
    },

    // Faculty reference
    faculty: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Faculty",
      required: true,
      index: true,
    },

    // Subject reference
    subject: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Subject",
      required: true,
      index: true,
    },

    // Attendance timestamp
    timestamp: {
      type: Date,
      default: Date.now,
      index: true,
    },

    // Attendance status
    status: {
      type: String,
      enum: ["present", "absent"],
      default: "present",
      index: true,
    },

    // Location captured during scan
    location: {
      lat: { type: Number },
      lng: { type: Number },
    },

    // Device fingerprint (anti-replay / anti-spoof)
    deviceFingerprint: {
      type: String,
      index: true,
    },

    faceVerification: {
      verified: { type: Boolean, default: false },
      score: { type: Number },
      threshold: { type: Number },
      capturedAt: { type: Date },
      matchedAt: { type: Date },
      freshnessMs: { type: Number },
      signatureVersion: { type: String },
      model: { type: String },
      modelVersion: { type: String },
      distance: { type: Number },
      provider: { type: String },
    },
  },
  { timestamps: true }
);

// Ensure one attendance per student per session
AttendanceSchema.index({ session: 1, student: 1 }, { unique: true });

// Fast lookups for reports
AttendanceSchema.index({ subject: 1, timestamp: 1 });
AttendanceSchema.index({ student: 1, timestamp: 1 });
AttendanceSchema.index({ student: 1, session: 1, status: 1 });
AttendanceSchema.index({ session: 1, timestamp: -1 });
AttendanceSchema.index({ session: 1, status: 1, timestamp: -1 });
AttendanceSchema.index({ faculty: 1, timestamp: -1 });
AttendanceSchema.index({ subject: 1, faculty: 1, timestamp: -1 });

module.exports = mongoose.model("Attendance", AttendanceSchema);
