const mongoose = require("mongoose");

const SubjectSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },

    code: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      index: true,
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

    // A subject may belong to multiple departments
    departments: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Department",
        required: true,
      },
    ],

    // Faculties allotted to this subject
    allottedFaculties: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Faculty",
      },
    ],

    createdByAdmin: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      required: true,
    },
  },
  { timestamps: true }
);

// Prevent duplicate subject codes under same admin
SubjectSchema.index(
  { code: 1, year: 1, semester: 1, createdByAdmin: 1 },
  { unique: true }
);

module.exports = mongoose.model("Subject", SubjectSchema);
