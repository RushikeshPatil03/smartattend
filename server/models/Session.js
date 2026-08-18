const mongoose = require("mongoose");

const SessionSchema = new mongoose.Schema(
  {
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

    // Class filtering
    year: {
      type: Number,
      required: true,
    },

    semester: {
      type: Number,
      required: true,
    },

    section: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },
    department: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Department",
      index: true,
      default: null,
    },

    startTime: {
      type: Date,
      default: Date.now,
      index: true,
    },
    lastActivityAt: {
      type: Date,
      default: Date.now,
      index: true,
    },

    endTime: {
      type: Date,
      default: null,
    },

    location: {
      lat: { type: Number, required: true },
      lng: { type: Number, required: true },
      radiusMeters: { type: Number, default: 200 },
    },

    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  { timestamps: true }
);

// One active session per faculty at a time
SessionSchema.index(
  { faculty: 1, isActive: 1 },
  { unique: true, partialFilterExpression: { isActive: true } }
);

// Fast student dashboard lookups for today's class timeline.
SessionSchema.index({
  year: 1,
  semester: 1,
  section: 1,
  department: 1,
  isActive: 1,
  startTime: 1,
});

SessionSchema.index({
  year: 1,
  semester: 1,
  section: 1,
  isActive: 1,
  startTime: 1,
});

SessionSchema.index({
  faculty: 1,
  startTime: -1,
});

SessionSchema.index({
  subject: 1,
  year: 1,
  semester: 1,
  section: 1,
  startTime: -1,
});

SessionSchema.index({
  year: 1,
  semester: 1,
  section: 1,
  department: 1,
  startTime: -1,
});

module.exports = mongoose.model("Session", SessionSchema);
