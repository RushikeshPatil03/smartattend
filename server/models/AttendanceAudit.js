const mongoose = require("mongoose");

const AttendanceAuditSchema = new mongoose.Schema(
  {
    attendance: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Attendance",
      required: true,
      index: true,
    },
    session: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Session",
      required: true,
      index: true,
    },
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Student",
      required: true,
      index: true,
    },
    faculty: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Faculty",
      required: true,
      index: true,
    },
    subject: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Subject",
      required: true,
      index: true,
    },
    action: {
      type: String,
      enum: ["MARK_PRESENT", "MANUAL_PRESENT", "MANUAL_ABSENT"],
      required: true,
      index: true,
    },
    method: {
      type: String,
      enum: ["QR_TWO_STEP", "QR_TOTP", "MANUAL"],
      required: true,
      index: true,
    },
    actorRole: {
      type: String,
      enum: ["STUDENT", "FACULTY", "ADMIN"],
      required: true,
      index: true,
    },
    actor: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    deviceFingerprint: {
      type: String,
      default: "",
    },
    location: {
      lat: { type: Number },
      lng: { type: Number },
      accuracy: { type: Number },
    },
    qr: {
      firstIat: { type: Number },
      secondIat: { type: Number },
      gapSeconds: { type: Number },
    },
    faceVerification: {
      verified: { type: Boolean, default: false },
      score: { type: Number },
      threshold: { type: Number },
      provider: { type: String },
      model: { type: String },
      modelVersion: { type: String },
    },
    requestMeta: {
      ip: { type: String, default: "" },
      userAgent: { type: String, default: "" },
    },
  },
  { timestamps: true }
);

AttendanceAuditSchema.index({ session: 1, student: 1, action: 1 });
AttendanceAuditSchema.index({ createdAt: -1 });

module.exports = mongoose.model("AttendanceAudit", AttendanceAuditSchema);
