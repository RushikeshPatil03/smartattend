const mongoose = require("mongoose");

const SubjectAssignmentSchema = new mongoose.Schema(
  {
    subject: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Subject",
      required: true,
      index: true,
    },
    faculty: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Faculty",
      required: true,
    },
    department: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Department",
      required: true,
    },
    year: {
      type: Number,
      required: true,
      min: 1,
      max: 4,
    },
    semester: {
      type: Number,
      required: true,
      min: 1,
      max: 8,
    },
    section: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },
    classCode: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      index: true,
    },
    createdByAdmin: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      required: true,
      index: true,
    },
  },
  { timestamps: true }
);

SubjectAssignmentSchema.index(
  {
    subject: 1,
    department: 1,
    year: 1,
    semester: 1,
    section: 1,
    createdByAdmin: 1,
  },
  { unique: true }
);

SubjectAssignmentSchema.index(
  { classCode: 1, createdByAdmin: 1 },
  { unique: true }
);

module.exports = mongoose.model("SubjectAssignment", SubjectAssignmentSchema);
