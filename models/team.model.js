import mongoose from "mongoose";
const { Schema } = mongoose;

// Team Schema
const teamSchema = new Schema(
  {
    hackathonId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Hackathon",
      required: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxLength: 100,
    },
    description: {
      type: String,
      trim: true,
      maxLength: 500,
    },
    problemStatement: {
      type: String,
      required: true,
      trim: true,
    },
    projectRepo: {
      type: String,
      trim: true,
    },
    projectDemo: {
      type: String,
      trim: true,
    },
    projectPresentation: {
      type: String,
      trim: true,
    },
    submissionStatus: {
      type: String,
      enum: ["not_submitted", "draft", "submitted", "late_submission"],
      default: "not_submitted",
    },
    submittedAt: {
      type: Date,
    },
    score: {
      type: Number,
      min: 0,
      max: 100,
    },
    rank: {
      type: Number,
      min: 1,
    },
    feedback: {
      type: String,
      trim: true,
    },
    // Additional fields for hackathon
    teamSize: {
      type: Number,
      required: true,
      min: 1,
    },
    technologies: [
      {
        type: String,
        trim: true,
      },
    ],
    isEligibleForPrize: {
      type: Boolean,
      default: true,
    },
    disqualified: {
      type: Boolean,
      default: false,
    },
    disqualificationReason: {
      type: String,
      trim: true,
    },
    // Track team activity
    lastActivity: {
      type: Date,
      default: Date.now,
    },
    // Team communication channels
    communicationChannel: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: true,
    collection: "teams",
  }
);

// Indexes
teamSchema.index({ hackathonId: 1 });
teamSchema.index({ submissionStatus: 1 });
teamSchema.index({ hackathonId: 1, rank: 1 });
teamSchema.index({ isEligibleForPrize: 1 });

// Virtual for team members
teamSchema.virtual("members", {
  ref: "TeamMember",
  localField: "_id",
  foreignField: "teamId",
});

// Virtual for hackathon details
teamSchema.virtual("hackathon", {
  ref: "Hackathon",
  localField: "hackathonId",
  foreignField: "_id",
  justOne: true,
});

// Ensure virtual fields are serialized
teamSchema.set("toJSON", { virtuals: true });
teamSchema.set("toObject", { virtuals: true });

// Pre-save middleware to update lastActivity
teamSchema.pre("save", function (next) {
  if (this.isModified()) {
    this.lastActivity = Date.now();
  }
  next();
});

const Team = mongoose.model("Team", teamSchema);

export default Team;
